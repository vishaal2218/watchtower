'use strict';

// The sync engine. Runs in the hidden background extension so syncing keeps
// going when the panel is closed. Every dependency is injected so the engine
// can be exercised in tests with a fake host and an in-memory file system.

const C = require('./constants');
const paths = require('./paths');
const { planProject } = require('./planner');
const { diffItems, itemKeys, binKey, groupImports } = require('./sync-diff');
const { createStabilityTracker } = require('./stability');
const { sanitizeRoots, setBin } = require('./tree');
const { compileRules } = require('./ignore');
const { detectFolder, withDetection } = require('./tree-builder');
const { sanitizeSettings } = require('./settings-store');
const { createTranslator } = require('./i18n');

// How long a cached list of project media paths is trusted during auto-sync.
// Refreshing it is what lets an item deleted from the project be re-imported.
const KEYS_MAX_AGE_MS = 30000;
// Imports the host refused are not retried for this long (unless forced).
const FAILED_RETRY_MS = 5 * 60 * 1000;
const WAIT_STEP_MS = 200;
const WAIT_MAX_MS = 60000;

function deriveSettings(s) {
  return { allowed: new Set(s.allowedExtensions), ignoreRules: compileRules(s.ignoredFolders) };
}

/**
 * Pick between the copy stored in the project and the local copy: the most
 * recently saved wins, so a save the host failed to store (the local copy is
 * written regardless) can never resurrect removed watch folders.
 */
function chooseConfig(embedded, local) {
  if (!embedded) return local || null;
  if (!local) return embedded;
  return String(local.savedAt || '') > String(embedded.savedAt || '') ? local : embedded;
}

function chunkGroups(groups, max) {
  const chunks = [];
  let current = [];
  let count = 0;
  groups.forEach((g) => {
    const size = g.files.length + g.sequences.length;
    if (current.length && count + size > max) {
      chunks.push(current);
      current = [];
      count = 0;
    }
    current.push(g);
    count += size;
  });
  if (current.length) chunks.push(current);
  return chunks;
}

function createEngine(deps) {
  const fs = deps.fs;
  const host = deps.host;
  const platform = deps.platform || paths.currentPlatform();
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const t = deps.t || createTranslator('en');
  const log = deps.log || function () {};
  const resolveDrive = deps.resolveDrive || ((p) => p);
  const emitState = deps.emitState || function () {};
  const onImported = deps.onImported || function () {};
  // One comparison key for disk paths and project media paths alike: mapped
  // drives resolve to UNC on both sides, or nothing would ever match.
  const keyOf = (p) => paths.toKey(resolveDrive(p));

  let settings = sanitizeSettings(deps.settingsStore.load());
  let derived = deriveSettings(settings);
  let hostName = null;
  let activeId = null;
  let hostError = null;
  let ticking = false;
  let prefill = [];
  const projects = new Map();

  function projectKey(info) {
    return info.path ? paths.toKey(info.path) : 'doc:' + info.id;
  }

  function newProjectState(info) {
    return {
      id: info.id,
      name: info.name,
      path: info.path || '',
      dir: info.path ? paths.dirname(platform, info.path) : '',
      cloud: !!info.cloud,
      key: projectKey(info),
      autoSync: false,
      roots: [],
      embedded: false,
      projectKeys: null,
      keysAt: 0,
      inFlight: new Set(),
      failed: new Map(),
      tracker: createStabilityTracker({ stableMs: C.STABLE_MS, now }),
      seqCounts: new Map(),
      knownBins: new Set(),
      offline: [],
      syncing: false,
      lastResult: null
    };
  }

  function publicState() {
    return {
      version: C.VERSION,
      host: hostName,
      activeId,
      hostError,
      projects: Array.from(projects.values()).map((p) => ({
        id: p.id,
        name: p.name,
        autoSync: p.autoSync,
        rootCount: p.roots.length,
        syncing: p.syncing,
        offline: p.offline.length,
        lastResult: p.lastResult
      }))
    };
  }

  function broadcast() {
    emitState(publicState());
  }

  async function loadProject(p) {
    let embedded = null;
    try {
      const res = await host.loadConfig({ projectId: p.id });
      p.embedded = !!(res && res.supported);
      if (p.embedded) embedded = res.config || { autoSync: false, roots: [], savedAt: '' };
    } catch (e) {
      log('warn', 'Reading the embedded configuration failed: ' + e.message);
    }
    const cfg = chooseConfig(embedded, deps.projectStore.load(p.key)) || { autoSync: false, roots: [] };
    p.roots = sanitizeRoots(cfg.roots);
    p.autoSync = !!cfg.autoSync;
  }

  async function persistProject(p) {
    const savedAt = new Date(now()).toISOString();
    try {
      const res = await host.saveConfig({ projectId: p.id, autoSync: p.autoSync, roots: p.roots, savedAt });
      if (res && Array.isArray(res.roots)) {
        p.roots = res.roots.reduce((acc, r) => (r.bin ? setBin(acc, r.id, r.bin) : acc), p.roots);
      }
      p.embedded = !!(res && res.supported);
    } catch (e) {
      log('warn', 'Saving the embedded configuration failed: ' + e.message);
    }
    try {
      deps.projectStore.save(p.key, { autoSync: p.autoSync, roots: p.roots, savedAt });
    } catch (e) {
      log('error', 'Saving the local configuration copy failed: ' + e.message);
    }
  }

  async function refreshProjects() {
    const env = await host.env();
    hostName = env.host;
    activeId = env.activeId;
    hostError = null;
    const seen = new Set();
    for (const info of env.projects || []) {
      seen.add(info.id);
      const existing = projects.get(info.id);
      if (existing && existing.path === (info.path || '')) {
        existing.name = info.name;
        continue;
      }
      const p = newProjectState(info);
      projects.set(info.id, p);
      await loadProject(p);
    }
    Array.from(projects.keys()).forEach((id) => {
      if (!seen.has(id)) projects.delete(id);
    });
  }

  function planCtx(p) {
    return {
      fs,
      platform,
      projectDir: p.dir,
      allowed: derived.allowed,
      host: hostName,
      ignoreRules: derived.ignoreRules,
      keyOf,
      detect: (abs, inherited) => withDetection(inherited, detectFolder(fs, abs, derived.ignoreRules))
    };
  }

  async function planAndPersist(p) {
    const plan = planProject(p.roots, planCtx(p));
    if (plan.changed) {
      p.roots = plan.roots;
      await persistProject(p);
    }
    return plan;
  }

  async function refreshKeys(p) {
    const items = await host.mediaItems({ projectId: p.id });
    const map = new Map();
    (items || []).forEach((it) => map.set(keyOf(it.p), it.id));
    p.inFlight.forEach((k) => {
      if (!map.has(k)) p.failed.set(k, now());
    });
    p.inFlight = new Set();
    p.projectKeys = map;
    p.keysAt = now();
  }

  function diffState(p) {
    const suppressed = new Set();
    p.failed.forEach((at, key) => {
      if (now() - at < FAILED_RETRY_MS) suppressed.add(key);
      else p.failed.delete(key);
    });
    return { projectKeys: p.projectKeys || new Map(), tracker: p.tracker, seqCounts: p.seqCounts, failed: suppressed };
  }

  function importOptions() {
    return {
      showImportOptions: settings.showImportOptions,
      importDate: settings.addImportDate,
      psdImportAs: settings.psdImportAs
    };
  }

  async function applyToHost(p, diff, newBins) {
    const rootsById = {};
    p.roots.forEach((r) => {
      rootsById[r.id] = r;
    });
    const binRequest = (b) => {
      const root = rootsById[b.rootId] || {};
      return { rootId: b.rootId, rootRef: root.bin ? root.bin.ref : null, rootName: root.name, sub: b.sub, label: b.label };
    };
    const groups = groupImports(diff.imports, rootsById);
    const chunks = chunkGroups(groups, C.MAX_IMPORTS_PER_CALL);
    if (!chunks.length) chunks.push([]);

    const total = { imported: 0, bins: 0, refreshed: 0, errors: [], importedPaths: [] };
    const rootBins = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const res = await host.importBatch({
        projectId: p.id,
        groups: chunks[i],
        bins: i === 0 ? newBins.map(binRequest) : [],
        refresh: i === 0 ? diff.refresh : [],
        options: importOptions()
      });
      total.imported += res.imported || 0;
      total.bins += res.binsCreated || 0;
      total.refreshed += res.refreshed || 0;
      total.errors = total.errors.concat(res.errors || []);
      total.importedPaths = total.importedPaths.concat(res.importedPaths || []);
      (res.rootBins || []).forEach((rb) => {
        rootBins.push(rb);
        // Keep rootRef current for later chunks when the host (re)created a root bin.
        if (rootsById[rb.rootId]) rootsById[rb.rootId] = Object.assign({}, rootsById[rb.rootId], { bin: rb.bin });
      });
      chunks.slice(i + 1).forEach((chunk) =>
        chunk.forEach((g) => {
          const r = rootsById[g.rootId];
          if (r && r.bin) g.rootRef = r.bin.ref;
        })
      );
    }

    diff.imports.forEach((item) => p.inFlight.add(item.key));
    p.keysAt = 0;
    newBins.forEach((b) => p.knownBins.add(binKey(b.rootId, b.sub)));
    if (rootBins.length) {
      // A root bin was missing and got recreated: store the link on the new bin.
      p.roots = rootBins.reduce((acc, rb) => setBin(acc, rb.rootId, rb.bin), p.roots);
      await persistProject(p);
    }
    if (settings.jumper && total.importedPaths.length) onImported(total.importedPaths);
    return total;
  }

  async function report(p, result, force) {
    if (!settings.showNotifications) return;
    if (!force && !result.imported && !result.refreshed) return;
    const parts = [];
    if (result.imported) parts.push(t('notify.imported', { count: result.imported, bins: result.binCount }));
    else if (force && !result.refreshed) parts.push(t('notify.upToDate'));
    if (result.refreshed) parts.push(t('notify.refreshed', { count: result.refreshed }));
    if (result.pending) parts.push(t('notify.pending', { count: result.pending }));
    if (result.offline) parts.push(t('notify.offline', { count: result.offline }));
    if (result.errors.length) parts.push(t('notify.errors', { count: result.errors.length }));
    try {
      await host.notify({ projectId: p.id, message: parts.join(' ') });
    } catch (e) {
      log('warn', 'Notification failed: ' + e.message);
    }
  }

  async function syncProject(p, force) {
    if (!p.roots.length) return null;
    p.syncing = true;
    broadcast();
    try {
      let plan = await planAndPersist(p);
      if (force) {
        p.failed = new Map();
        diffItems(plan.items, diffState(p));
        await sleep(C.FORCE_SYNC_SETTLE_MS);
        plan = await planAndPersist(p);
        await refreshKeys(p);
      } else if (!p.projectKeys || now() - p.keysAt > KEYS_MAX_AGE_MS) {
        await refreshKeys(p);
      }
      let diff = diffItems(plan.items, diffState(p));
      if (!force && diff.imports.length && now() - p.keysAt > 1000) {
        // Re-check against the live project right before importing, so an item
        // imported by hand in the meantime is never duplicated.
        await refreshKeys(p);
        diff = diffItems(plan.items, diffState(p));
      }
      p.seqCounts = diff.seqCounts;
      p.tracker.prune(itemKeys(plan.items));
      p.offline = plan.offline;

      const newBins = plan.bins.filter((b) => !p.knownBins.has(binKey(b.rootId, b.sub)));
      const destBins = new Set(diff.imports.map((i) => binKey(i.rootId, i.sub)));
      let result = { imported: 0, bins: 0, refreshed: 0, errors: [], importedPaths: [] };
      if (diff.imports.length || newBins.length || diff.refresh.length) {
        result = await applyToHost(p, diff, newBins);
      }
      const summary = {
        at: now(),
        force: !!force,
        imported: result.imported,
        binCount: destBins.size,
        refreshed: result.refreshed,
        pending: diff.pending,
        offline: plan.offline.length,
        errors: result.errors.concat(plan.errors.map((e) => e.path + ': ' + e.error))
      };
      p.lastResult = summary;
      await report(p, summary, force);
      return summary;
    } finally {
      p.syncing = false;
      broadcast();
    }
  }

  async function waitIdle(p) {
    let waited = 0;
    while (p.syncing && waited < WAIT_MAX_MS) {
      await sleep(WAIT_STEP_MS);
      waited += WAIT_STEP_MS;
    }
  }

  function projectOrActive(id) {
    return projects.get(id || activeId) || null;
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await refreshProjects();
      for (const p of Array.from(projects.values())) {
        if (p.autoSync && p.roots.length && !p.syncing) await syncProject(p, false);
      }
    } catch (e) {
      // Typically the host is busy (modal dialog, render); try again next tick.
      hostError = e.message;
      log('warn', 'Sync tick failed: ' + e.message);
    } finally {
      ticking = false;
      broadcast();
    }
  }

  async function forceSync(id) {
    await refreshProjects();
    const p = projectOrActive(id);
    if (!p) throw new Error(t('panel.info.noProject'));
    await waitIdle(p);
    return syncProject(p, true);
  }

  async function toggleAutoSync(id) {
    await refreshProjects();
    const p = projectOrActive(id);
    if (!p) throw new Error(t('panel.info.noProject'));
    p.autoSync = !p.autoSync;
    await persistProject(p);
    broadcast();
    return publicState();
  }

  function takePrefill() {
    const out = prefill;
    prefill = [];
    return out;
  }

  function addPrefill(entries) {
    prefill = prefill.concat((entries || []).filter((e) => e && typeof e === 'object'));
    return prefill.length;
  }

  async function getManagerData() {
    await refreshProjects();
    return {
      platform,
      host: hostName,
      activeId,
      projects: Array.from(projects.values()).map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        dir: p.dir,
        cloud: p.cloud,
        roots: p.roots
      })),
      prefill: takePrefill()
    };
  }

  async function saveConfigs(payload) {
    await refreshProjects();
    for (const entry of (payload && payload.projects) || []) {
      const p = projects.get(entry.id);
      if (!p) throw new Error('The project "' + entry.id + '" is no longer open.');
      await waitIdle(p);
      p.roots = sanitizeRoots(entry.roots);
      p.knownBins = new Set();
      p.offline = [];
      p.keysAt = 0;
      await persistProject(p);
    }
    broadcast();
    return publicState();
  }

  /** Folder suggestion for a bin: walk up from a contained file by its bin depth. */
  function suggestFolder(bin) {
    if (!bin.file) return '';
    let dir = paths.dirname(platform, bin.file);
    for (let i = 0; i < (bin.depth || 0); i += 1) dir = paths.dirname(platform, dir);
    return resolveDrive(dir);
  }

  async function linkSelectedBins() {
    const res = await host.selectedBins();
    const entries = ((res && res.bins) || []).map((b) => ({
      projectId: res.projectId,
      path: suggestFolder(b),
      bin: { ref: b.ref, name: b.name }
    }));
    addPrefill(entries);
    return entries.length;
  }

  function reloadSettings() {
    settings = sanitizeSettings(deps.settingsStore.load());
    derived = deriveSettings(settings);
    projects.forEach((p) => {
      p.knownBins = new Set();
    });
    return settings;
  }

  return {
    tick,
    forceSync,
    toggleAutoSync,
    getState: publicState,
    getManagerData,
    saveConfigs,
    addPrefill,
    takePrefill,
    linkSelectedBins,
    suggestFolder,
    reloadSettings,
    refreshProjects,
    // exposed for tests
    _projects: projects
  };
}

module.exports = { createEngine, chooseConfig, chunkGroups, KEYS_MAX_AGE_MS };
