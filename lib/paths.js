'use strict';

const nodePath = require('path');

function impl(platform) {
  return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

function currentPlatform() {
  return process.platform === 'win32' ? 'win32' : 'posix';
}

function nfc(p) {
  return typeof p.normalize === 'function' ? p.normalize('NFC') : p;
}

/**
 * Canonical comparison key for a file path. Detection is path-only, so the key
 * must be identical for the same file whichever API reported it: separators,
 * Unicode normalisation (macOS returns NFD, hosts often NFC) and case (default
 * macOS and Windows volumes are case-insensitive) are all folded.
 */
function toKey(p) {
  if (!p) return '';
  let s = nfc(String(p)).replace(/\\/g, '/');
  const unc = s.indexOf('//') === 0;
  s = s.replace(/\/{2,}/g, '/');
  if (unc) s = '/' + s;
  if (s.length > 1 && s[s.length - 1] === '/') s = s.slice(0, -1);
  return s.toLowerCase();
}

/** Root of an absolute path: drive ("c:"), UNC share ("//server/share") or "/". */
function rootOf(absPath, platform) {
  const p = impl(platform);
  if (platform === 'win32') {
    const unc = String(absPath).match(/^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/);
    if (unc) return toKey('//' + unc[1] + '/' + unc[2]);
  }
  return toKey(p.parse(p.resolve(absPath)).root);
}

function canBeRelative(absPath, projectDir, platform) {
  if (!absPath || !projectDir) return false;
  return rootOf(absPath, platform) === rootOf(projectDir, platform);
}

/**
 * Convert an absolute path to its stored form. Relative paths always use "/"
 * so a project moved between macOS and Windows resolves without a relink.
 */
function toStored(absPath, relative, projectDir, platform) {
  if (!relative) return absPath;
  if (!canBeRelative(absPath, projectDir, platform)) {
    throw new Error('A relative path is only possible for a folder on the same drive as the project file.');
  }
  const p = impl(platform);
  const rel = p.relative(projectDir, absPath);
  return rel === '' ? '.' : rel.split(p.sep).join('/');
}

function resolveStored(stored, relative, projectDir, platform) {
  if (!stored) return '';
  if (!relative) return stored;
  if (!projectDir) return '';
  const p = impl(platform);
  const parts = String(stored).split(/[\\/]+/).filter(Boolean);
  return p.resolve.apply(p, [projectDir].concat(parts));
}

function join(platform, base, name) {
  return impl(platform).join(base, name);
}

function dirname(platform, p) {
  return impl(platform).dirname(p);
}

function basename(platform, p) {
  return impl(platform).basename(p);
}

/** True when `child` is `parent` or lies inside it. */
function isInside(child, parent) {
  const c = toKey(child);
  const p = toKey(parent);
  if (!c || !p) return false;
  return c === p || c.indexOf(p === '/' ? '/' : p + '/') === 0;
}

module.exports = {
  currentPlatform,
  toKey,
  rootOf,
  canBeRelative,
  toStored,
  resolveStored,
  join,
  dirname,
  basename,
  isInside
};
