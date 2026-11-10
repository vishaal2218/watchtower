'use strict';

// Pure view-model logic for the watch-folders manager window.

const paths = require('./paths');
const tree = require('./tree');

function isRelStored(stored) {
  return !!stored && !/^([a-zA-Z]:[\\/]|[\\/])/.test(stored);
}

/** Absolute folder for a node, given its parent's absolute folder. */
function nodeAbsPath(node, parentAbs, projectDir, platform) {
  if (node.path) return paths.resolveStored(node.path, node.settings.rel, projectDir, platform);
  return parentAbs ? paths.join(platform, parentAbs, node.name) : '';
}

/** Text shown in the PATH column: relative paths stay relative, with "/". */
function nodeDisplayPath(node, parentDisplay, platform) {
  if (node.path) return node.path;
  if (!parentDisplay) return '';
  const sep = isRelStored(parentDisplay) || platform !== 'win32' ? '/' : '\\';
  return parentDisplay.replace(/[\\/]+$/, '') + sep + node.name;
}

function matchesSearch(node, needle) {
  if (!needle) return true;
  if (node.name.toLowerCase().indexOf(needle) >= 0) return true;
  return node.children.some((c) => matchesSearch(c, needle));
}

/**
 * Flatten the visible tree into rows. options: { scope: 'all' | projectId,
 * search, expanded: Set<nodeId>, platform, isDirectory(abs) }.
 */
function buildRows(projects, drafts, options) {
  const needle = String(options.search || '').trim().toLowerCase();
  const visible = projects.filter((p) => options.scope === 'all' || options.scope === p.id);
  const rows = [];
  const showHeaders = options.scope === 'all' && visible.length > 1;

  visible.forEach((project) => {
    const roots = drafts[project.id] || [];
    if (showHeaders) rows.push({ kind: 'project', project, count: roots.length });

    function visit(node, depth, parentAbs, parentDisplay, inactive) {
      if (!matchesSearch(node, needle)) return;
      const abs = nodeAbsPath(node, parentAbs, project.dir, options.platform);
      const display = nodeDisplayPath(node, parentDisplay, options.platform);
      const expanded = needle ? true : options.expanded.has(node.id);
      rows.push({
        kind: 'node',
        projectId: project.id,
        node,
        depth,
        isRoot: depth === 0,
        abs,
        display,
        online: !!abs && options.isDirectory(abs),
        inactive,
        hasChildren: node.children.length > 0,
        expanded
      });
      if (!expanded) return;
      const childInactive = inactive || !node.settings.sub || node.settings.flt;
      node.children.forEach((c) => visit(c, depth + 1, abs, display, childInactive));
    }

    roots.forEach((r) => visit(r, 0, '', '', false));
  });
  return rows;
}

/** Why a folder cannot be added to a project, as an i18n key, or null. */
function validateNewFolder(roots, abs, projectDir, platform) {
  let error = null;
  roots.forEach((root) => {
    if (error) return;
    const rootAbs = paths.resolveStored(root.path, root.settings.rel, projectDir, platform);
    if (!rootAbs) return;
    if (paths.isInside(abs, rootAbs)) error = 'manager.alreadyWatched';
    else if (paths.isInside(rootAbs, abs)) error = 'manager.containsWatched';
  });
  return error;
}

function subtreeIds(node) {
  const ids = [];
  tree.walk([node], (n) => ids.push(n.id));
  return ids;
}

/**
 * Switch REL on or off for a node and its subtree, converting every stored
 * path. Returns { roots } or { error } when a path cannot be made relative.
 */
function setRelative(roots, nodeId, on, projectDir, platform) {
  const hit = tree.findNode(roots, nodeId);
  if (!hit) return { roots };
  let next = roots;
  try {
    subtreeIds(hit.node).forEach((id) => {
      const n = tree.findNode(next, id).node;
      if (!n.path) return;
      const abs = paths.resolveStored(n.path, n.settings.rel, projectDir, platform);
      if (!abs) throw new Error('unresolvable');
      next = tree.relinkNode(next, id, paths.toStored(abs, on, projectDir, platform));
    });
  } catch (e) {
    return { error: 'manager.relUnavailable' };
  }
  return { roots: tree.updateSettings(next, nodeId, { rel: on }) };
}

/** Absolute path of any node, walking down from its root. */
function absOf(roots, nodeId, projectDir, platform) {
  let found = '';
  function visit(node, parentAbs) {
    const abs = nodeAbsPath(node, parentAbs, projectDir, platform);
    if (node.id === nodeId) {
      found = abs;
      return;
    }
    node.children.forEach((c) => visit(c, abs));
  }
  roots.forEach((r) => visit(r, ''));
  return found;
}

/**
 * Point a node at a different folder. A child relinked back to the folder its
 * parent implies drops its own path again.
 */
function relink(roots, nodeId, newAbs, projectDir, platform) {
  const hit = tree.findNode(roots, nodeId);
  if (!hit) return { roots };
  const rel = hit.node.settings.rel;
  if (rel && !paths.canBeRelative(newAbs, projectDir, platform)) return { error: 'manager.relUnavailable' };
  if (hit.parent) {
    const parentAbs = absOf(roots, hit.parent.id, projectDir, platform);
    if (parentAbs && paths.toKey(paths.join(platform, parentAbs, hit.node.name)) === paths.toKey(newAbs)) {
      return {
        roots: tree.replaceNode(roots, nodeId, (n) => {
          const copy = Object.assign({}, n);
          delete copy.path;
          return copy;
        })
      };
    }
  }
  return { roots: tree.relinkNode(roots, nodeId, paths.toStored(newAbs, rel, projectDir, platform)) };
}

/** Ids of every project whose draft differs from what was loaded. */
function changedProjectIds(originals, drafts) {
  return Object.keys(drafts).filter((id) => JSON.stringify(originals[id] || []) !== JSON.stringify(drafts[id]));
}

module.exports = {
  nodeAbsPath,
  nodeDisplayPath,
  buildRows,
  validateNewFolder,
  setRelative,
  relink,
  absOf,
  changedProjectIds
};
