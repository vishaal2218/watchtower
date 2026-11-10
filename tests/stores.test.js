'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTree, removeTree } = require('./helpers');
const store = require('../lib/settings-store');
const { createProjectStore, fileFor } = require('../lib/project-store');
const { createTranslator, pickLocale, TABLES } = require('../lib/i18n');
const { labelsFor, labelColor } = require('../lib/labels');

test('settings default sensibly and drop invalid values', () => {
  const s = store.sanitizeSettings({
    showNotifications: 'yes',
    psdImportAs: 'nonsense',
    allowedExtensions: ['.MOV', 'mov', 'bad ext', '*.mxf'],
    ignoredFolders: ['proxies', '/[bad/', '  ', 'proxies'],
    extra: 1
  });
  assert.equal(s.showNotifications, true);
  assert.equal(s.psdImportAs, 'footage');
  assert.deepEqual(s.allowedExtensions, ['mov', 'mxf']);
  assert.deepEqual(s.ignoredFolders, ['proxies']);
  assert.equal(s.extra, undefined);
  assert.equal(store.sanitizeSettings(null).showNotifications, true, 'notifications are on by default');
});

test('settings round-trip through the store atomically', (t) => {
  const dir = makeTree({});
  t.after(() => removeTree(dir));
  const s = store.createSettingsStore({ fs, dir: path.join(dir, 'nested', 'data') });
  assert.deepEqual(s.load(), store.sanitizeSettings({}));
  s.save({ addImportDate: true, psdImportAs: 'compositionRetain' });
  const loaded = s.load();
  assert.equal(loaded.addImportDate, true);
  assert.equal(loaded.psdImportAs, 'compositionRetain');
  assert.deepEqual(fs.readdirSync(path.dirname(s.file)), ['settings.json'], 'no temp files left behind');
});

test('data folder follows platform conventions', () => {
  assert.equal(
    store.dataDir('darwin', {}, '/Users/ed'),
    '/Users/ed/Library/Application Support/WatchtowerReplica'
  );
  assert.equal(
    store.dataDir('win32', { APPDATA: 'C:\\Users\\ed\\AppData\\Roaming' }, 'C:\\Users\\ed'),
    'C:\\Users\\ed\\AppData\\Roaming\\WatchtowerReplica'
  );
});

test('project configs are keyed by project and sanitised on load', (t) => {
  const dir = makeTree({});
  t.after(() => removeTree(dir));
  const ps = createProjectStore({ fs, dir, now: () => Date.UTC(2026, 8, 28) });
  assert.equal(ps.load('/p/a.prproj'), null);
  ps.save('/p/a.prproj', { autoSync: true, roots: [{ name: 'M', path: '/m' }, { broken: true }] });
  const loaded = ps.load('/p/a.prproj');
  assert.equal(loaded.autoSync, true);
  assert.equal(loaded.roots.length, 1);
  assert.equal(ps.load('/p/b.prproj'), null);
  const raw = JSON.parse(fs.readFileSync(fileFor(dir, '/p/a.prproj'), 'utf8'));
  assert.equal(raw.savedAt, '2026-09-28T00:00:00.000Z');
});

test('translations: Japanese when the host is Japanese, English otherwise', () => {
  assert.equal(pickLocale('ja_JP'), 'ja');
  assert.equal(pickLocale('de_DE'), 'en');
  const t = createTranslator('en');
  assert.equal(t('notify.imported', { count: 3, bins: 2 }), 'Watchtower: imported 3 item(s) into 2 bin(s).');
  assert.equal(t('missing.key'), 'missing.key');
  assert.equal(createTranslator('ja')('panel.sync'), '同期');
});

test('every English string has a Japanese translation', () => {
  const missing = Object.keys(TABLES.en).filter((k) => TABLES.ja[k] === undefined);
  assert.deepEqual(missing, []);
});

test('label tables match each host API range', () => {
  assert.deepEqual(labelsFor('PPRO').map((l) => l.index), Array.from({ length: 16 }, (_, i) => i));
  assert.deepEqual(labelsFor('AEFT').map((l) => l.index), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.equal(labelColor('PPRO', 13), '#3ac044');
  assert.equal(labelColor('AEFT', 0), null);
});
