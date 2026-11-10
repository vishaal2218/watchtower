'use strict';

const nodePath = require('path');
const { DEFAULT_ALLOWED, normalizeExt } = require('./extensions');
const { DEFAULT_IGNORED, parseRule } = require('./ignore');

const PSD_IMPORT_AS = Object.freeze(['footage', 'composition', 'compositionRetain']);

const DEFAULT_SETTINGS = Object.freeze({
  showImportOptions: false,
  addImportDate: false,
  showNotifications: true,
  jumper: false,
  psdImportAs: 'footage',
  allowedExtensions: DEFAULT_ALLOWED,
  ignoredFolders: DEFAULT_IGNORED
});

function uniq(list) {
  return list.filter((v, i, a) => a.indexOf(v) === i);
}

/** Validate settings read from disk or sent by a panel; unknown keys are dropped. */
function sanitizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const bool = (k) => (typeof r[k] === 'boolean' ? r[k] : DEFAULT_SETTINGS[k]);
  const allowed = Array.isArray(r.allowedExtensions)
    ? uniq(r.allowedExtensions.map(normalizeExt).filter(Boolean)).sort()
    : DEFAULT_SETTINGS.allowedExtensions.slice();
  const ignored = Array.isArray(r.ignoredFolders)
    ? uniq(r.ignoredFolders.map((e) => String(e).trim()).filter((e) => parseRule(e).kind !== 'invalid'))
    : DEFAULT_SETTINGS.ignoredFolders.slice();
  return {
    showImportOptions: bool('showImportOptions'),
    addImportDate: bool('addImportDate'),
    showNotifications: bool('showNotifications'),
    jumper: bool('jumper'),
    psdImportAs: PSD_IMPORT_AS.indexOf(r.psdImportAs) >= 0 ? r.psdImportAs : DEFAULT_SETTINGS.psdImportAs,
    allowedExtensions: allowed,
    ignoredFolders: ignored
  };
}

/** Per-user data folder shared by every panel of the extension. */
function dataDir(platform, env, homedir) {
  if (platform === 'win32') {
    const base = env.APPDATA || nodePath.win32.join(homedir, 'AppData', 'Roaming');
    return nodePath.win32.join(base, 'WatchtowerReplica');
  }
  return nodePath.posix.join(homedir, 'Library', 'Application Support', 'WatchtowerReplica');
}

function ensureDir(fs, dir) {
  if (fs.existsSync(dir)) return;
  const parent = nodePath.dirname(dir);
  if (parent !== dir) ensureDir(fs, parent);
  fs.mkdirSync(dir);
}

/** Write via a temp file and rename so a crash never leaves half a JSON file. */
function writeJsonAtomic(fs, file, data) {
  ensureDir(fs, nodePath.dirname(file));
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(fs, file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function createSettingsStore(options) {
  const fs = options.fs;
  const file = nodePath.join(options.dir, 'settings.json');
  return {
    file,
    load() {
      return sanitizeSettings(readJson(fs, file));
    },
    save(settings) {
      const clean = sanitizeSettings(settings);
      writeJsonAtomic(fs, file, clean);
      return clean;
    }
  };
}

module.exports = {
  PSD_IMPORT_AS,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  dataDir,
  ensureDir,
  writeJsonAtomic,
  readJson,
  createSettingsStore
};
