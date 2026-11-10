'use strict';

// Windows mapped drives are always stored and compared as UNC paths (v1.3.0),
// so a project opened where the share has a different letter still matches.

const CACHE_MS = 60000;

/** Parse the output of `net use` into { Z: '\\\\server\\share' }. */
function parseNetUse(output) {
  const map = {};
  String(output || '').split(/\r?\n/).forEach((line) => {
    const m = line.match(/(?:^|\s)([A-Za-z]):\s+(\\\\\S+)/);
    if (m) map[m[1].toUpperCase()] = m[2];
  });
  return map;
}

function toUnc(p, driveMap) {
  if (!p || !driveMap) return p;
  const m = String(p).match(/^([A-Za-z]):(?:[\\/](.*))?$/);
  if (!m) return p;
  const share = driveMap[m[1].toUpperCase()];
  if (!share) return p;
  const rest = (m[2] || '').replace(/\//g, '\\');
  return rest ? share + '\\' + rest : share;
}

function defaultExec(cmd) {
  return require('child_process').execSync(cmd, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
}

function createDriveResolver(options) {
  const opts = options || {};
  const platform = opts.platform || process.platform;
  const now = opts.now || Date.now;
  const exec = opts.exec || defaultExec;
  let cached = null;
  let cachedAt = 0;

  function driveMap() {
    if (cached && now() - cachedAt < CACHE_MS) return cached;
    try {
      cached = parseNetUse(exec('net use'));
    } catch (e) {
      // `net use` can fail on locked-down machines; fall back to drive letters.
      cached = {};
    }
    cachedAt = now();
    return cached;
  }

  return {
    resolve(p) {
      return platform === 'win32' ? toUnc(p, driveMap()) : p;
    }
  };
}

module.exports = { parseNetUse, toUnc, createDriveResolver };
