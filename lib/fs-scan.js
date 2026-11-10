'use strict';

const nodePath = require('path');
const { isHiddenEntry, isIgnored } = require('./ignore');

/**
 * List one directory. Symbolic links and Windows junctions are followed, so a
 * junction to a folder is listed as a folder (v1.6.0). Entries that cannot be
 * stat'ed (permissions, broken links) are skipped rather than failing the list.
 */
function listDir(fs, abs) {
  let names;
  try {
    names = fs.readdirSync(abs);
  } catch (e) {
    return { ok: false, code: e.code || 'EUNKNOWN', error: e.message };
  }
  const files = [];
  const dirs = [];
  names.forEach((name) => {
    if (isHiddenEntry(name)) return;
    const full = nodePath.join(abs, name);
    let st;
    let linked = false;
    try {
      st = fs.lstatSync(full);
      if (st.isSymbolicLink()) {
        linked = true;
        st = fs.statSync(full);
      }
    } catch (e) {
      return;
    }
    if (st.isDirectory()) {
      dirs.push({ name, abs: full, linked });
    } else if (st.isFile()) {
      files.push({
        name,
        abs: full,
        size: st.size,
        mtimeMs: +st.mtime,
        birthtimeMs: st.birthtime ? +st.birthtime : 0
      });
    }
  });
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { ok: true, files: files.sort(byName), dirs: dirs.sort(byName) };
}

function isDirectory(fs, abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch (e) {
    return false;
  }
}

function realpathOr(fs, abs) {
  try {
    return fs.realpathSync(abs);
  } catch (e) {
    return abs;
  }
}

/**
 * Walk a tree for auto-detection. Returns relative paths ("PRIVATE/M4ROOT/CLIP")
 * of folders and files up to `maxDepth` levels deep, plus the names of the
 * files directly inside the root.
 */
function indexTree(fs, rootAbs, options) {
  const opts = options || {};
  const maxDepth = opts.maxDepth || 6;
  const rules = opts.ignoreRules || [];
  const dirs = [];
  const files = [];
  const visited = {};
  let topFiles = [];

  function walkDir(abs, rel, level) {
    const listing = listDir(fs, abs);
    if (!listing.ok) return;
    if (level === 0) topFiles = listing.files.map((f) => f.name);
    listing.files.forEach((f) => files.push(rel ? rel + '/' + f.name : f.name));
    if (level + 1 > maxDepth) return;
    listing.dirs.forEach((d) => {
      if (isIgnored(d.name, rules)) return;
      if (d.linked) {
        const real = realpathOr(fs, d.abs);
        if (visited[real]) return;
        visited[real] = true;
      }
      const childRel = rel ? rel + '/' + d.name : d.name;
      dirs.push(childRel);
      walkDir(d.abs, childRel, level + 1);
    });
  }

  walkDir(rootAbs, '', 0);
  return { rootName: nodePath.basename(rootAbs), dirs, files, topFiles };
}

module.exports = { listDir, isDirectory, realpathOr, indexTree };
