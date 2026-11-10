'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTree, removeTree } = require('./helpers');
const { planProject } = require('../lib/planner');
const { buildRoot, detectFolder } = require('../lib/tree-builder');
const { compileRules, DEFAULT_IGNORED } = require('../lib/ignore');
const { DEFAULT_ALLOWED } = require('../lib/extensions');
const tree = require('../lib/tree');

function ctx(extra) {
  return Object.assign(
    {
      fs,
      platform: 'posix',
      projectDir: '',
      allowed: new Set(DEFAULT_ALLOWED),
      host: 'PPRO',
      ignoreRules: compileRules(DEFAULT_IGNORED)
    },
    extra
  );
}

function rootFor(dir, settings, children) {
  return tree.createNode({ id: 'root', name: path.basename(dir), path: dir, settings, children });
}

function destinations(plan) {
  return plan.items.map((i) => [i.sub.join('/'), path.basename(i.path), i.kind]).sort();
}

test('mirrors folders into bins and discovers subfolders with inherited settings', (t) => {
  const dir = makeTree({ 'a.mov': 'x', 'A/b.mov': 'x', 'A/Deep/c.wav': 'x', 'Empty/': '' });
  t.after(() => removeTree(dir));
  const plan = planProject([rootFor(dir, { label: 4 })], ctx());
  assert.deepEqual(destinations(plan), [
    ['', 'a.mov', 'file'],
    ['A', 'b.mov', 'file'],
    ['A/Deep', 'c.wav', 'file']
  ]);
  assert.deepEqual(plan.bins.map((b) => b.sub.join('/')).sort(), ['', 'A', 'A/Deep', 'Empty']);
  assert.equal(plan.changed, true);
  const a = tree.childNamed(plan.roots[0], 'A');
  assert.equal(a.settings.label, 4, 'discovered child inherits the label');
  assert.equal(tree.childNamed(a, 'Deep').settings.label, 4);
  assert.ok(plan.items.every((i) => i.label === 4));
});

test('a second plan over an unchanged tree reports no discoveries', (t) => {
  const dir = makeTree({ 'A/b.mov': 'x' });
  t.after(() => removeTree(dir));
  const first = planProject([rootFor(dir)], ctx());
  const second = planProject(first.roots, ctx());
  assert.equal(second.changed, false);
  assert.equal(second.roots[0], first.roots[0]);
});

test('SUB off ignores subfolder contents', (t) => {
  const dir = makeTree({ 'a.mov': 'x', 'A/b.mov': 'x' });
  t.after(() => removeTree(dir));
  const plan = planProject([rootFor(dir, { sub: false })], ctx());
  assert.deepEqual(destinations(plan), [['', 'a.mov', 'file']]);
  assert.equal(plan.bins.length, 1);
});

test('FLT imports every file at any depth into the parent bin', (t) => {
  const dir = makeTree({ 'A/B/c.mov': 'x', 'A/d.mov': 'x', 'e.mov': 'x' });
  t.after(() => removeTree(dir));
  const plan = planProject([rootFor(dir, { flt: true })], ctx());
  assert.deepEqual(destinations(plan).map((d) => d[0]), ['', '', '']);
  assert.equal(plan.bins.length, 1);
});

test('SEQ groups numbered stills per folder, even across flattened subfolders', (t) => {
  const dir = makeTree({
    'part1/f_001.exr': 'x',
    'part1/f_002.exr': 'x',
    'part2/f_003.exr': 'x',
    'ref.mov': 'x'
  });
  t.after(() => removeTree(dir));
  const plan = planProject([rootFor(dir, { flt: true, seq: true })], ctx());
  const seqs = plan.items.filter((i) => i.kind === 'sequence');
  assert.equal(seqs.length, 2);
  assert.deepEqual(seqs.map((s) => s.frames.length).sort(), [1, 2]);
  assert.equal(plan.items.filter((i) => i.kind === 'file').length, 1);
});

test('disallowed extensions, hidden files and ignored folders are skipped', (t) => {
  const dir = makeTree({
    'a.mov': 'x',
    'notes.txt': 'x',
    '.DS_Store': 'x',
    'New folder/b.mov': 'x',
    'Project_1_AME/c.mov': 'x',
    'd.mts': 'x'
  });
  t.after(() => removeTree(dir));
  const allowed = new Set(DEFAULT_ALLOWED.filter((e) => e !== 'mts'));
  const rules = compileRules(DEFAULT_IGNORED.concat(['/_AME$/']));
  const plan = planProject([rootFor(dir)], ctx({ allowed, ignoreRules: rules }));
  assert.deepEqual(destinations(plan), [['', 'a.mov', 'file']]);
  assert.equal(plan.roots[0].children.length, 0);
});

test('removed (excluded) subfolders are not rediscovered', (t) => {
  const dir = makeTree({ 'A/a.mov': 'x', 'B/b.mov': 'x' });
  t.after(() => removeTree(dir));
  const root = Object.assign(rootFor(dir), { excluded: ['B'] });
  const plan = planProject([root], ctx());
  assert.deepEqual(destinations(plan), [['A', 'a.mov', 'file']]);
});

test('a missing root is reported offline; so is an unresolvable relative root', () => {
  const plan = planProject([rootFor('/definitely/not/here')], ctx());
  assert.deepEqual(plan.offline, ['root']);
  const rel = tree.createNode({ id: 'rel', name: 'M', path: 'Media', settings: { rel: true } });
  assert.deepEqual(planProject([rel], ctx({ projectDir: '' })).offline, ['rel']);
});

test('a relative root resolves against the project folder', (t) => {
  const dir = makeTree({ 'Project/': '', 'Media/a.mov': 'x' });
  t.after(() => removeTree(dir));
  const rel = tree.createNode({ id: 'rel', name: 'Media', path: '../Media', settings: { rel: true } });
  const plan = planProject([rel], ctx({ projectDir: path.join(dir, 'Project') }));
  assert.deepEqual(destinations(plan), [['', 'a.mov', 'file']]);
});

test('a child with its own path is planned from that path', (t) => {
  const dir = makeTree({ 'Root/A/': '', 'Elsewhere/x.mov': 'x' });
  t.after(() => removeTree(dir));
  const child = tree.createNode({ name: 'A', path: path.join(dir, 'Elsewhere') });
  const plan = planProject([rootFor(path.join(dir, 'Root'), {}, [child])], ctx());
  assert.deepEqual(destinations(plan), [['A', 'x.mov', 'file']]);
});

test('camera folders flatten to the clip files only', (t) => {
  const dir = makeTree({
    'Card/PRIVATE/M4ROOT/CLIP/C0001.MP4': 'x',
    'Card/PRIVATE/M4ROOT/CLIP/C0001M01.XML': 'x',
    'Card/PRIVATE/M4ROOT/THMBNL/C0001T01.JPG': 'x',
    'Card/DCIM/100MSDCF/DSC0001.JPG': 'x'
  });
  t.after(() => removeTree(dir));
  const detected = detectFolder(fs, path.join(dir, 'Card'), []);
  assert.equal(detected.flt, true);
  const node = rootFor(path.join(dir, 'Card'), { flt: true, cameras: detected.cameras });
  const plan = planProject([node], ctx());
  assert.deepEqual(destinations(plan).map((d) => d[1]), ['C0001.MP4', 'DSC0001.JPG']);
});

test('symlinked folders are followed once and loops are cut', (t) => {
  const dir = makeTree({ 'Real/a.mov': 'x' });
  t.after(() => removeTree(dir));
  fs.symlinkSync(path.join(dir, 'Real'), path.join(dir, 'Link'), 'dir');
  fs.symlinkSync(dir, path.join(dir, 'Real', 'Loop'), 'dir');
  const plan = planProject([rootFor(dir)], ctx());
  const count = plan.items.length;
  assert.ok(count >= 1 && count <= 3, 'bounded: ' + count);
  const flat = planProject([rootFor(dir, { flt: true })], ctx());
  assert.ok(flat.items.length >= 1 && flat.items.length <= 3);
});

test('buildRoot auto-ticks SEQ on sequence folders and FLT on camera cards', (t) => {
  const dir = makeTree({
    'Renders/cleanup_000.png': 'x',
    'Renders/cleanup_001.png': 'x',
    'Stills/sframe_00.png': 'x',
    'Stills/sframe_01.png': 'x',
    'CardA/DCIM/100CANON/IMG_0001.JPG': 'x',
    'New folder/': ''
  });
  t.after(() => removeTree(dir));
  const root = buildRoot(fs, dir, { ignoreRules: compileRules(DEFAULT_IGNORED), platform: 'posix' });
  const byName = {};
  root.children.forEach((c) => {
    byName[c.name] = c;
  });
  assert.equal(byName.Renders.settings.seq, true);
  assert.equal(byName.Stills.settings.seq, false, 'two digits are not auto-detected');
  assert.equal(byName.CardA.settings.flt, true);
  assert.deepEqual(byName.CardA.settings.cameras, ['dcim']);
  assert.equal(byName.CardA.children.length, 0, 'flattened folders do not list children');
  assert.equal(byName['New folder'], undefined);
  assert.equal(root.path, dir);
});

test('buildRoot stores a relative path when asked', (t) => {
  const dir = makeTree({ 'Project/': '', 'Media/a.mov': 'x' });
  t.after(() => removeTree(dir));
  const root = buildRoot(fs, path.join(dir, 'Media'), {
    ignoreRules: [],
    relative: true,
    projectDir: path.join(dir, 'Project'),
    platform: 'posix',
    bin: { ref: '7', name: 'Media' }
  });
  assert.equal(root.path, '../Media');
  assert.equal(root.settings.rel, true);
  assert.deepEqual(root.bin, { ref: '7', name: 'Media' });
});
