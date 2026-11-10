'use strict';

// Watch-folder tree. Every node mirrors a folder on disk and carries its own
// explicit settings. Parent changes propagate live to every descendant, and a
// newly discovered subfolder copies its parent's settings when it is added.
// All operations return new trees; inputs are never mutated.

const { NO_LABEL } = require('./constants');

const INHERITED_KEYS = Object.freeze(['sub', 'rel', 'seq', 'flt', 'label']);

const DEFAULT_SETTINGS = Object.freeze({
  sub: true,
  rel: false,
  seq: false,
  flt: false,
  label: NO_LABEL,
  cameras: Object.freeze([])
});

let counter = 0;
function newId() {
  counter = (counter + 1) % 1679616;
  return 'n' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeSettings(raw) {
  const s = raw || {};
  const label = parseInt(s.label, 10);
  return {
    sub: s.sub === undefined ? DEFAULT_SETTINGS.sub : !!s.sub,
    rel: !!s.rel,
    seq: !!s.seq,
    flt: !!s.flt,
    label: isNaN(label) || label < NO_LABEL || label > 16 ? NO_LABEL : label,
    cameras: Array.isArray(s.cameras) ? s.cameras.filter((c) => typeof c === 'string') : []
  };
}

function inheritSettings(parentSettings) {
  const out = {};
  INHERITED_KEYS.forEach((k) => {
    out[k] = parentSettings[k];
  });
  out.cameras = [];
  return normalizeSettings(out);
}

function createNode(fields) {
  const f = fields || {};
  const node = {
    id: f.id || newId(),
    name: String(f.name || ''),
    settings: normalizeSettings(f.settings),
    children: (f.children || []).slice(),
    excluded: (f.excluded || []).slice()
  };
  if (f.path) node.path = String(f.path);
  if (f.bin && f.bin.ref !== undefined && f.bin.ref !== null && f.bin.ref !== '') {
    node.bin = { ref: String(f.bin.ref), name: String(f.bin.name || '') };
  }
  return node;
}

/** Validate a tree loaded from storage; drops anything malformed. */
function sanitizeNode(raw, isRoot, depth) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || depth > 64) return null;
  if (isRoot && (typeof raw.path !== 'string' || !raw.path)) return null;
  const children = Array.isArray(raw.children)
    ? raw.children.map((c) => sanitizeNode(c, false, depth + 1)).filter(Boolean)
    : [];
  return createNode({
    id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
    name: raw.name,
    path: typeof raw.path === 'string' ? raw.path : undefined,
    bin: raw.bin,
    settings: raw.settings,
    children,
    excluded: Array.isArray(raw.excluded) ? raw.excluded.filter((e) => typeof e === 'string') : []
  });
}

function sanitizeRoots(raw) {
  return (Array.isArray(raw) ? raw : []).map((r) => sanitizeNode(r, true, 0)).filter(Boolean);
}

function withChildren(node, children) {
  return Object.assign({}, node, { children });
}

/** Depth-first visit: fn(node, parent, depth, root). */
function walk(roots, fn) {
  function visit(node, parent, depth, root) {
    fn(node, parent, depth, root);
    node.children.forEach((c) => visit(c, node, depth + 1, root));
  }
  roots.forEach((r) => visit(r, null, 0, r));
}

function findNode(roots, id) {
  let found = null;
  walk(roots, (node, parent, depth, root) => {
    if (!found && node.id === id) found = { node, parent, root, depth };
  });
  return found;
}

/** Replace a single node (by id), rebuilding only its ancestors. */
function replaceNode(roots, id, fn) {
  function visit(node) {
    if (node.id === id) return fn(node);
    let changed = false;
    const children = node.children.map((c) => {
      const next = visit(c);
      if (next !== c) changed = true;
      return next;
    });
    return changed ? withChildren(node, children) : node;
  }
  return roots.map(visit).filter(Boolean);
}

function applyDeep(node, patch) {
  return Object.assign({}, node, {
    settings: Object.assign({}, node.settings, patch),
    children: node.children.map((c) => applyDeep(c, patch))
  });
}

/**
 * Change settings on a node. Inherited keys re-apply to every descendant;
 * `cameras` is detection state and stays on the node itself.
 */
function updateSettings(roots, id, patch) {
  const inherited = {};
  const own = {};
  Object.keys(patch || {}).forEach((k) => {
    if (INHERITED_KEYS.indexOf(k) >= 0) inherited[k] = patch[k];
    else if (k === 'cameras') own.cameras = patch.cameras;
  });
  return replaceNode(roots, id, (node) => {
    const deep = applyDeep(node, inherited);
    return Object.assign({}, deep, {
      settings: normalizeSettings(Object.assign({}, deep.settings, own))
    });
  });
}

function childNamed(node, name) {
  return node.children.filter((c) => c.name === name)[0] || null;
}

function addChild(roots, parentId, name, extraSettings) {
  return replaceNode(roots, parentId, (parent) => {
    if (childNamed(parent, name)) return parent;
    const settings = Object.assign(inheritSettings(parent.settings), extraSettings || {});
    return withChildren(parent, parent.children.concat([createNode({ name, settings })]));
  });
}

/**
 * Remove a node. A root simply stops being watched. A child is also recorded
 * in its parent's `excluded` list, otherwise the next scan would rediscover it.
 */
function removeNode(roots, id) {
  const hit = findNode(roots, id);
  if (!hit) return roots;
  if (!hit.parent) return roots.filter((r) => r.id !== id);
  return replaceNode(roots, hit.parent.id, (parent) =>
    Object.assign({}, parent, {
      children: parent.children.filter((c) => c.id !== id),
      excluded:
        parent.excluded.indexOf(hit.node.name) >= 0 ? parent.excluded : parent.excluded.concat([hit.node.name])
    })
  );
}

/** Point a node at a new folder. Children without their own path follow it. */
function relinkNode(roots, id, storedPath) {
  return replaceNode(roots, id, (node) => Object.assign({}, node, { path: storedPath }));
}

function setBin(roots, id, bin) {
  return replaceNode(roots, id, (node) => {
    const next = Object.assign({}, node);
    if (bin && bin.ref !== undefined && bin.ref !== null) {
      next.bin = { ref: String(bin.ref), name: String(bin.name || '') };
    } else {
      delete next.bin;
    }
    return next;
  });
}

function countNodes(roots) {
  let n = 0;
  walk(roots, () => {
    n += 1;
  });
  return n;
}

module.exports = {
  INHERITED_KEYS,
  DEFAULT_SETTINGS,
  newId,
  normalizeSettings,
  inheritSettings,
  createNode,
  sanitizeRoots,
  walk,
  findNode,
  replaceNode,
  updateSettings,
  childNamed,
  addChild,
  removeNode,
  relinkNode,
  setBin,
  countNodes
};
