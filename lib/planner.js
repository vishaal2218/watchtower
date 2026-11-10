'use strict';

// Turns a project's watch-folder tree plus the current state of the disk into
// a list of candidate items and the bins they belong in. Pure apart from the
// injected fs; it never talks to the host application.

const { MAX_TREE_DEPTH } = require('./constants');
const { listDir, realpathOr } = require('./fs-scan');
const { isIgnored } = require('./ignore');
const { isImportable } = require('./extensions');
const { groupSequences } = require('./sequence');
const { cameraIncludes } = require('./camera');
const { createNode, inheritSettings, childNamed } = require('./tree');
const paths = require('./paths');

function statOf(f) {
  return { size: f.size, mtimeMs: f.mtimeMs, birthtimeMs: f.birthtimeMs };
}

/** Emit import candidates for one directory's files into `out.items`. */
function emitFiles(files, relDir, node, target, ctx, out) {
  // Keys must be built exactly like the project-side keys (see engine.refreshKeys).
  const keyOf = ctx.keyOf || paths.toKey;
  const fileItem = (f) => ({ path: f.abs, key: keyOf(f.abs), stat: statOf(f) });
  const s = node.settings;
  const useCamera = s.flt && s.cameras.length > 0;
  const importable = files.filter((f) => {
    if (!isImportable(f.name, ctx.allowed, ctx.host)) return false;
    if (!useCamera) return true;
    return cameraIncludes(s.cameras, relDir ? relDir + '/' + f.name : f.name, node.name);
  });
  const base = { rootId: target.rootId, sub: target.sub, label: s.label };
  if (!s.seq) {
    importable.forEach((f) => out.items.push(Object.assign({ kind: 'file' }, base, fileItem(f))));
    return;
  }
  const grouped = groupSequences(importable);
  grouped.singles.forEach((f) => out.items.push(Object.assign({ kind: 'file' }, base, fileItem(f))));
  grouped.sequences.forEach((seq) => {
    out.items.push(
      Object.assign({ kind: 'sequence' }, base, {
        path: seq.first.abs,
        key: keyOf(seq.first.abs),
        frames: seq.frames.map(fileItem)
      })
    );
  });
}

function enterLinked(dir, ctx, visited) {
  if (!dir.linked) return true;
  const real = paths.toKey(realpathOr(ctx.fs, dir.abs));
  if (visited.has(real)) return false;
  visited.add(real);
  return true;
}

/** FLT: every file at any depth goes to the node's own bin; sequences stay per folder. */
function collectFlat(abs, relDir, node, target, ctx, out, depth, visited) {
  const listing = listDir(ctx.fs, abs);
  if (!listing.ok) {
    out.errors.push({ nodeId: node.id, path: abs, error: listing.error });
    return;
  }
  emitFiles(listing.files, relDir, node, target, ctx, out);
  if (depth >= MAX_TREE_DEPTH) return;
  listing.dirs.forEach((d) => {
    if (isIgnored(d.name, ctx.ignoreRules) || !enterLinked(d, ctx, visited)) return;
    collectFlat(d.abs, relDir ? relDir + '/' + d.name : d.name, node, target, ctx, out, depth + 1, visited);
  });
}

function discoverChildren(node, listing, ctx, out) {
  let children = node.children;
  listing.dirs.forEach((d) => {
    if (isIgnored(d.name, ctx.ignoreRules) || node.excluded.indexOf(d.name) >= 0) return;
    if (childNamed(node, d.name)) return;
    const inherited = inheritSettings(node.settings);
    const settings = ctx.detect ? ctx.detect(d.abs, inherited) : inherited;
    children = children.concat([createNode({ name: d.name, settings })]);
    out.discovered += 1;
  });
  return children;
}

function childAbsPath(child, dirByName, ctx) {
  if (child.path) return paths.resolveStored(child.path, child.settings.rel, ctx.projectDir, ctx.platform);
  const d = dirByName[child.name];
  return d ? d.abs : '';
}

function planNode(node, abs, root, sub, ctx, out, depth, visited) {
  const listing = listDir(ctx.fs, abs);
  if (!listing.ok) {
    if (listing.code === 'ENOENT' || listing.code === 'ENOTDIR') out.offline.push(node.id);
    else out.errors.push({ nodeId: node.id, path: abs, error: listing.error });
    return node;
  }
  const s = node.settings;
  const target = { rootId: root.id, sub };
  out.bins.push({ rootId: root.id, sub, label: s.label });

  if (s.sub && s.flt) {
    collectFlat(abs, '', node, target, ctx, out, depth, visited);
    return node;
  }
  emitFiles(listing.files, '', node, target, ctx, out);
  if (!s.sub || depth >= MAX_TREE_DEPTH) return node;

  const before = out.discovered;
  const children = discoverChildren(node, listing, ctx, out);
  const dirByName = {};
  listing.dirs.forEach((d) => {
    dirByName[d.name] = d;
  });

  let changed = out.discovered !== before;
  const nextChildren = children.map((child) => {
    if (isIgnored(child.name, ctx.ignoreRules)) return child;
    const d = dirByName[child.name];
    if (!child.path && d && !enterLinked(d, ctx, visited)) return child;
    const childAbs = childAbsPath(child, dirByName, ctx);
    if (!childAbs) return child;
    const next = planNode(child, childAbs, root, sub.concat([child.name]), ctx, out, depth + 1, visited);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? Object.assign({}, node, { children: nextChildren }) : node;
}

/**
 * ctx: { fs, platform, projectDir, allowed: Set, host: 'PPRO'|'AEFT',
 *        ignoreRules, keyOf?(abs) -> comparison key,
 *        detect?(abs, inheritedSettings) -> settings }
 */
function planProject(roots, ctx) {
  const out = { items: [], bins: [], offline: [], errors: [], discovered: 0 };
  const nextRoots = roots.map((root) => {
    const abs = paths.resolveStored(root.path, root.settings.rel, ctx.projectDir, ctx.platform);
    if (!abs) {
      out.offline.push(root.id);
      return root;
    }
    return planNode(root, abs, root, [], ctx, out, 0, new Set());
  });
  return {
    roots: nextRoots,
    items: out.items,
    bins: out.bins,
    offline: out.offline,
    errors: out.errors,
    changed: out.discovered > 0
  };
}

module.exports = { planProject };
