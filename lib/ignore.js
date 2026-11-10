'use strict';

// Ignored folder names. A plain entry matches a folder name exactly, ignoring
// case. An entry written between two forward slashes is a regular expression,
// also case-insensitive (v1.3.2), matched anywhere in the name unless anchored.

const DEFAULT_IGNORED = Object.freeze([
  '/\\.downiepart$/',
  '/\\.download$/',
  'New folder',
  'untitled folder'
]);

function isRegexEntry(source) {
  return source.length >= 3 && source[0] === '/' && source[source.length - 1] === '/';
}

function parseRule(entry) {
  const source = String(entry == null ? '' : entry).trim();
  if (!source) return { kind: 'invalid', source, error: 'Empty entry' };
  if (isRegexEntry(source)) {
    try {
      return { kind: 'regex', source, re: new RegExp(source.slice(1, -1), 'i') };
    } catch (e) {
      return { kind: 'invalid', source, error: e.message };
    }
  }
  return { kind: 'name', source, lower: source.toLowerCase() };
}

function compileRules(entries) {
  return (entries || []).map(parseRule);
}

function isIgnored(folderName, rules) {
  const name = String(folderName);
  const lower = name.toLowerCase();
  return (rules || []).some((r) => {
    if (r.kind === 'name') return r.lower === lower;
    if (r.kind === 'regex') return r.re.test(name);
    return false;
  });
}

/** Hidden and system entries that are never mirrored or imported. */
function isHiddenEntry(name) {
  const n = String(name);
  return n[0] === '.' || n === 'Thumbs.db' || n === 'desktop.ini' || n === '$RECYCLE.BIN';
}

module.exports = { DEFAULT_IGNORED, parseRule, compileRules, isIgnored, isHiddenEntry };
