'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTree, removeTree, fakeClock } = require('./helpers');
const { createEngine, chunkGroups } = require('../lib/engine');
const { sanitizeSettings } = require('../lib/settings-store');
const tree = require('../lib/tree');
const C = require('../lib/constants');

/** In-memory stand-in for the ExtendScript host. */
function fakeHost(options) {
  const opts = options || {};
  const h = {
    items: [],
    config: opts.config || null,
    supported: opts.supported !== false,
    imports: [],
    notifications: [],
    saves: 0,
    refuse: opts.refuse || [],
    nextId: 1,
    async env() {
      return { host: 'PPRO', activeId: 'p1', projects: [{ id: 'p1', name: 'Show', path: opts.projectPath || '/proj/Show.prproj' }] };
    },
    async loadConfig() {
      return { supported: h.supported, config: h.supported ? h.config : null };
    },
    async saveConfig(args) {
      h.saves += 1;
      h.config = { autoSync: args.autoSync, roots: args.roots, savedAt: args.savedAt };
      return {
        supported: h.supported,
        roots: args.roots.map((r) => ({ id: r.id, bin: r.bin || { ref: 'bin-' + r.id, name: r.name } }))
      };
    },
    async mediaItems() {
      return h.items.map((i) => ({ p: i.path, id: i.id }));
    },
    async importBatch(req) {
      h.imports.push(req);
      let imported = 0;
      const importedPaths = [];
      req.groups.forEach((g) =>
        g.files.concat(g.sequences).forEach((p) => {
          if (h.refuse.some((r) => p.endsWith(r))) return;
          h.items.push({ path: p, id: 'item' + h.nextId++ });
          imported += 1;
          importedPaths.push(p);
        })
      );
      return { imported, binsCreated: req.bins.length, refreshed: req.refresh.length, errors: [], importedPaths };
    },
    async notify(args) {
      h.notifications.push(args.message);
    },
    async selectedBins() {
      return { projectId: 'p1', bins: [{ ref: 'b1', name: 'Music', file: '/lib/Music/Rock/song.wav', depth: 1 }] };
    }
  };
  return h;
}

function memoryStores(initialSettings) {
  const saved = {};
  return {
    settingsStore: { load: () => sanitizeSettings(initialSettings || {}) },
    projectStore: {
      load: (k) => saved[k] || null,
      save: (k, v) => {
        saved[k] = JSON.parse(JSON.stringify(v));
      }
    },
    saved
  };
}

function makeEngine(env, extra) {
  return createEngine(Object.assign({
    fs,
    host: env.host,
    platform: 'posix',
    now: env.clock.now,
    sleep: env.clock.sleep,
    settingsStore: env.stores.settingsStore,
    projectStore: env.stores.projectStore,
    onImported: (paths) => env.jumper.push(paths)
  }, extra));
}

function setup(t, spec, options) {
  const opts = options || {};
  const dir = makeTree(spec);
  t.after(() => removeTree(dir));
  const env = { dir, clock: fakeClock(), host: fakeHost(opts.host), stores: memoryStores(opts.settings), jumper: [] };
  env.engine = makeEngine(env, opts.resolveDrive ? { resolveDrive: opts.resolveDrive(dir) } : {});
  return env;
}

async function watch(env, extraSettings) {
  const root = tree.createNode({ id: 'R', name: 'Media', path: env.dir, settings: extraSettings });
  await env.engine.saveConfigs({ projects: [{ id: 'p1', roots: [root] }] });
  await env.engine.toggleAutoSync('p1');
}

async function tickAfter(env, ms) {
  env.clock.advance(ms);
  await env.engine.tick();
}

test('auto-sync imports new files once they finish writing, and only once', async (t) => {
  const env = setup(t, { 'a.mov': 'data', 'Sub/b.wav': 'data' });
  await watch(env);
  await env.engine.tick();
  assert.equal(env.host.items.length, 0, 'first sighting only starts the stability window');
  await tickAfter(env, C.STABLE_MS);
  assert.deepEqual(env.host.items.map((i) => path.basename(i.path)).sort(), ['a.mov', 'b.wav']);
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  assert.equal(env.host.items.length, 2, 'no duplicates on later ticks');
  assert.equal(env.host.notifications.length, 1);
  assert.match(env.host.notifications[0], /imported 2 item\(s\) into 2 bin\(s\)/);
});

test('bins are created for every mirrored folder, including empty ones', async (t) => {
  const env = setup(t, { 'Empty/': '', 'A/a.mov': 'x' });
  await watch(env);
  await env.engine.tick();
  const bins = env.host.imports[0].bins.map((b) => b.sub.join('/')).sort();
  assert.deepEqual(bins, ['', 'A', 'Empty']);
});

test('nothing happens while auto-sync is off; a forced sync imports immediately', async (t) => {
  const env = setup(t, { 'a.mov': 'x' });
  const root = tree.createNode({ id: 'R', name: 'Media', path: env.dir });
  await env.engine.saveConfigs({ projects: [{ id: 'p1', roots: [root] }] });
  await tickAfter(env, 10000);
  assert.equal(env.host.imports.length, 0);
  const result = await env.engine.forceSync();
  assert.equal(result.imported, 1);
  assert.equal(result.force, true);
  const again = await env.engine.forceSync();
  assert.equal(again.imported, 0);
  assert.match(env.host.notifications[1], /up to date/);
});

test('a file that keeps growing waits until it stops', async (t) => {
  const env = setup(t, { 'big.mov': 'x' });
  await watch(env);
  const file = path.join(env.dir, 'big.mov');
  for (let i = 0; i < 4; i += 1) {
    fs.appendFileSync(file, 'more data');
    await tickAfter(env, C.STABLE_MS);
    assert.equal(env.host.items.length, 0, 'still being written on tick ' + i);
  }
  await tickAfter(env, C.STABLE_MS);
  assert.equal(env.host.items.length, 1);
});

test('an item manually imported before the watch folder was added is not duplicated', async (t) => {
  const env = setup(t, { 'a.mov': 'x' });
  env.host.items.push({ path: path.join(env.dir, 'a.mov'), id: 'manual' });
  await watch(env);
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  assert.equal(env.host.items.length, 1);
});

test('an item deleted from the project is re-imported (path is the only key)', async (t) => {
  const env = setup(t, { 'a.mov': 'x' });
  await watch(env);
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  await tickAfter(env, C.SCAN_INTERVAL_MS); // engine confirms its own import
  assert.equal(env.host.items.length, 1);
  env.host.items = [];
  await tickAfter(env, 31000);
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  assert.equal(env.host.items.length, 1);
});

test('a renamed file on disk is imported again as a new item', async (t) => {
  const env = setup(t, { 'a.mov': 'x' });
  await watch(env);
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  fs.renameSync(path.join(env.dir, 'a.mov'), path.join(env.dir, 'renamed.mov'));
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  await tickAfter(env, C.STABLE_MS);
  assert.deepEqual(env.host.items.map((i) => path.basename(i.path)).sort(), ['a.mov', 'renamed.mov']);
});

test('refused imports are not retried every tick', async (t) => {
  const env = setup(t, { 'bad.mov': 'x' }, { host: { refuse: ['bad.mov'] } });
  await watch(env);
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  const attempts = env.host.imports.filter((r) => r.groups.some((g) => g.files.length)).length;
  assert.equal(attempts, 1);
});

test('new subfolders are discovered, inherit settings and are persisted', async (t) => {
  const env = setup(t, { 'a.mov': 'x' });
  await watch(env, { label: 7 });
  await env.engine.tick();
  const savesBefore = env.host.saves;
  fs.mkdirSync(path.join(env.dir, 'Day2'));
  fs.writeFileSync(path.join(env.dir, 'Day2', 'b.mov'), 'x');
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  assert.ok(env.host.saves > savesBefore);
  const day2 = tree.childNamed(env.host.config.roots[0], 'Day2');
  assert.equal(day2.settings.label, 7);
  await tickAfter(env, C.STABLE_MS);
  const req = env.host.imports.filter((r) => r.groups.some((g) => g.sub[0] === 'Day2'))[0];
  assert.equal(req.groups.filter((g) => g.sub[0] === 'Day2')[0].label, 7);
});

test('image sequences refresh when new frames land', async (t) => {
  const env = setup(t, { 'r_001.exr': 'x', 'r_002.exr': 'x' });
  await watch(env, { seq: true });
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  assert.equal(env.host.items.length, 1);
  fs.writeFileSync(path.join(env.dir, 'r_003.exr'), 'x');
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  await tickAfter(env, C.STABLE_MS);
  const refreshed = env.host.imports.filter((r) => r.refresh.length);
  assert.equal(refreshed.length, 1);
  assert.deepEqual(refreshed[0].refresh, [env.host.items[0].id]);
});

test('import options and the Jumper hook follow settings', async (t) => {
  const env = setup(t, { 'a.psd': 'x' }, {
    settings: { showImportOptions: true, addImportDate: true, jumper: true, showNotifications: false }
  });
  await watch(env);
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  const req = env.host.imports.filter((r) => r.groups.length)[0];
  assert.deepEqual(req.options, { showImportOptions: true, importDate: true, psdImportAs: 'footage' });
  assert.equal(env.jumper.length, 1);
  assert.equal(env.host.notifications.length, 0, 'notifications can be switched off');
});

test('configuration falls back to the local copy when the host cannot store it', async (t) => {
  const env = setup(t, { 'a.mov': 'x' }, { host: { supported: false } });
  await watch(env);
  const saved = env.stores.saved['/proj/show.prproj'];
  assert.equal(saved.autoSync, true);
  assert.equal(saved.roots.length, 1);
  assert.equal(saved.roots[0].bin.ref, 'bin-R', 'bin refs from the host are kept');
});

test('a project created from a template picks up its embedded config and auto-syncs', async (t) => {
  const dir = makeTree({ 'Project/': '', 'Footage/a.mov': 'x' });
  t.after(() => removeTree(dir));
  const root = tree.createNode({ id: 'R', name: 'Footage', path: '../Footage', settings: { rel: true } });
  const env = setup(t, {}, {
    host: { projectPath: path.join(dir, 'Project', 'New Job.prproj'), config: { autoSync: true, roots: [root] } }
  });
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  assert.deepEqual(env.host.items.map((i) => i.path), [path.join(dir, 'Footage', 'a.mov')]);
});

test('offline watch folders are counted in the state', async (t) => {
  const env = setup(t, {});
  const root = tree.createNode({ id: 'R', name: 'Gone', path: '/no/such/folder' });
  await env.engine.saveConfigs({ projects: [{ id: 'p1', roots: [root] }] });
  await env.engine.toggleAutoSync('p1');
  await env.engine.tick();
  const state = env.engine.getState();
  assert.equal(state.projects[0].offline, 1);
  assert.equal(state.projects[0].autoSync, true);
  assert.equal(state.version, C.VERSION);
});

test('a failing host is recorded and does not crash the loop', async (t) => {
  const env = setup(t, {});
  env.host.env = async () => {
    throw new Error('EvalScript error.');
  };
  await env.engine.tick();
  assert.equal(env.engine.getState().hostError, 'EvalScript error.');
});

test('manager data carries projects and drains the prefill queue', async (t) => {
  const env = setup(t, {});
  env.engine.addPrefill([{ path: '/x' }, null]);
  const data = await env.engine.getManagerData();
  assert.equal(data.projects[0].dir, '/proj');
  assert.deepEqual(data.prefill, [{ path: '/x' }]);
  assert.deepEqual((await env.engine.getManagerData()).prefill, []);
});

test('linking a bin suggests the folder its media came from', async (t) => {
  const env = setup(t, {});
  assert.equal(await env.engine.linkSelectedBins(), 1);
  const [entry] = env.engine.takePrefill();
  assert.equal(entry.path, '/lib/Music', 'one sub-bin level up from the file folder');
  assert.deepEqual(entry.bin, { ref: 'b1', name: 'Music' });
  assert.equal(env.engine.suggestFolder({ file: '' }), '');
});

test('forceSync without a project reports an error', async (t) => {
  const env = setup(t, {});
  env.host.env = async () => ({ host: 'PPRO', activeId: null, projects: [] });
  await assert.rejects(env.engine.forceSync(), /Open a project/);
});

test('reloading settings applies new ignore rules on the next scan', async (t) => {
  const env = setup(t, { 'Keep/a.mov': 'x', 'Proxies/b.mov': 'x' });
  await watch(env);
  env.stores.settingsStore.load = () => sanitizeSettings({ ignoredFolders: ['proxies'] });
  env.engine.reloadSettings();
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  assert.deepEqual(env.host.items.map((i) => path.basename(i.path)), ['a.mov']);
});

test('mapped-drive paths match whichever side reports the drive letter', async (t) => {
  // Simulate a share mounted at the temp folder that the host reports by its UNC name.
  const env = setup(t, { 'a.mov': 'x' }, {
    resolveDrive: (dir) => (p) => (p.indexOf(dir) === 0 ? '//nas/share' + p.slice(dir.length) : p)
  });
  env.host.items.push({ path: '//nas/share/a.mov', id: 'unc-item' });
  await watch(env);
  await env.engine.tick();
  await tickAfter(env, C.STABLE_MS);
  await tickAfter(env, C.SCAN_INTERVAL_MS);
  assert.equal(env.host.items.length, 1, 'the UNC-reported item is recognised, not re-imported');
});

test('a save the host failed to store cannot resurrect removed watch folders', async (t) => {
  const env = setup(t, { 'a.mov': 'x' });
  await watch(env);
  assert.equal(env.host.config.roots.length, 1);
  env.clock.advance(1000);
  env.host.saveConfig = async () => {
    throw new Error('EvalScript error.');
  };
  await env.engine.saveConfigs({ projects: [{ id: 'p1', roots: [] }] });
  assert.equal(env.host.config.roots.length, 1, 'embedded copy is stale');
  const reopened = makeEngine(env);
  await reopened.refreshProjects();
  assert.equal(reopened.getState().projects[0].rootCount, 0, 'the newer local copy wins');
});

test('chooseConfig prefers the most recently saved copy', () => {
  const { chooseConfig } = require('../lib/engine');
  const embedded = { roots: [1], savedAt: '2026-09-28T10:00:00.000Z' };
  const olderLocal = { roots: [], savedAt: '2026-09-28T09:00:00.000Z' };
  const newerLocal = { roots: [], savedAt: '2026-09-28T11:00:00.000Z' };
  assert.equal(chooseConfig(embedded, olderLocal), embedded);
  assert.equal(chooseConfig(embedded, newerLocal), newerLocal);
  assert.equal(chooseConfig(embedded, null), embedded);
  assert.equal(chooseConfig(null, olderLocal), olderLocal);
  assert.equal(chooseConfig({ roots: [], savedAt: '' }, olderLocal), olderLocal, 'undated embedded copy loses');
  assert.equal(chooseConfig(null, null), null);
});

test('chunkGroups splits large imports without splitting a group', () => {
  const g = (n) => ({ files: new Array(n).fill('f'), sequences: [] });
  assert.deepEqual(chunkGroups([g(300), g(300), g(100)], 500).map((c) => c.length), [1, 2]);
  assert.deepEqual(chunkGroups([], 500), []);
});
