'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ext = require('../lib/extensions');
const { parseRule, compileRules, isIgnored, isHiddenEntry, DEFAULT_IGNORED } = require('../lib/ignore');

test('default allowed list starts with the documented extensions, alphabetically', () => {
  assert.deepEqual(ext.DEFAULT_ALLOWED.slice(0, 7), ['264', '3g2', '3gp', '3gpp', 'aac', 'aaf', 'ac3']);
  assert.ok(ext.DEFAULT_ALLOWED.indexOf('aec') >= 0);
  assert.ok(ext.DEFAULT_ALLOWED.indexOf('braw') >= 0);
  assert.ok(ext.DEFAULT_ALLOWED.indexOf('swf') >= 0);
  assert.deepEqual(ext.DEFAULT_ALLOWED.slice(), ext.DEFAULT_ALLOWED.slice().sort());
});

test('project containers are left out of the default allowed list', () => {
  ext.PROJECT_CONTAINERS.forEach((e) => assert.equal(ext.DEFAULT_ALLOWED.indexOf(e), -1, e));
});

test('extOf and normalizeExt', () => {
  assert.equal(ext.extOf('/a/B.MOV'), 'mov');
  assert.equal(ext.extOf('noext'), '');
  assert.equal(ext.extOf('.hidden'), '');
  assert.equal(ext.normalizeExt(' *.MXF '), 'mxf');
  assert.equal(ext.normalizeExt('.264'), '264');
  assert.equal(ext.normalizeExt('bad ext'), null);
  assert.equal(ext.normalizeExt(''), null);
});

test('a file needs an allowed extension that the host also supports', () => {
  const allowed = new Set(['mov', 'svg', 'mts']);
  assert.equal(ext.isImportable('a.mov', allowed, 'PPRO'), true);
  assert.equal(ext.isImportable('a.svg', allowed, 'PPRO'), false, 'Premiere cannot import SVG');
  assert.equal(ext.isImportable('a.svg', allowed, 'AEFT'), true);
  assert.equal(ext.isImportable('a.mp4', allowed, 'PPRO'), false, 'not on the allowed list');
  assert.equal(ext.isImportable('a.mts', new Set(['mov']), 'PPRO'), false, 'removed .mts stays out');
});

test('layered and still-image helpers', () => {
  assert.equal(ext.isLayered('art.PSD'), true);
  assert.equal(ext.isLayered('clip.mov'), false);
  assert.equal(ext.isStillImage('f_001.exr'), true);
});

test('ignored names match exactly, case-insensitively', () => {
  const rules = compileRules(['proxies']);
  ['proxies', 'Proxies', 'PROXIES', 'pRoXiEs'].forEach((n) => assert.equal(isIgnored(n, rules), true, n));
  assert.equal(isIgnored('proxies2', rules), false);
  assert.equal(isIgnored('my proxies', rules), false);
});

test('regex filters behave as in the documented examples', () => {
  const cases = [
    ['/_ame/', ['project_ame', 'south_America', '_amethyst'], ['projectame']],
    ['/_ame$/', ['project_AME'], ['_amethyst']],
    ['/^_ame/', ['_amethyst'], ['project_ame']],
    ['/\\d/', ['100_images', 'image_5_best'], ['images']]
  ];
  cases.forEach(([pattern, hits, misses]) => {
    const rules = compileRules([pattern]);
    hits.forEach((n) => assert.equal(isIgnored(n, rules), true, pattern + ' should match ' + n));
    misses.forEach((n) => assert.equal(isIgnored(n, rules), false, pattern + ' should not match ' + n));
  });
});

test('one regex covers every Media Encoder output folder', () => {
  const rules = compileRules(['/_AME$/']);
  ['Project_1_AME', 'Project_2_AME'].forEach((n) => assert.equal(isIgnored(n, rules), true));
});

test('default ignored entries guard against unnamed and downloading folders', () => {
  const rules = compileRules(DEFAULT_IGNORED);
  ['New folder', 'untitled folder', 'clip.download', 'video.downiepart'].forEach((n) =>
    assert.equal(isIgnored(n, rules), true, n)
  );
  assert.equal(isIgnored('Footage', rules), false);
});

test('invalid regexes and empty entries never match', () => {
  const bad = parseRule('/[unclosed/');
  assert.equal(bad.kind, 'invalid');
  assert.equal(parseRule('   ').kind, 'invalid');
  assert.equal(isIgnored('anything', [bad]), false);
  assert.equal(parseRule('/').kind, 'name', 'a lone slash is a plain name');
});

test('hidden and system entries are recognised', () => {
  ['.DS_Store', '.git', 'Thumbs.db', 'desktop.ini'].forEach((n) => assert.equal(isHiddenEntry(n), true, n));
  assert.equal(isHiddenEntry('clip.mov'), false);
});
