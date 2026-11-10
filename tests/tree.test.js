'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tree = require('../lib/tree');

function sample() {
  const grand = tree.createNode({ id: 'g', name: 'G', settings: { seq: false } });
  const child = tree.createNode({ id: 'c', name: 'C', children: [grand] });
  const root = tree.createNode({ id: 'r', name: 'R', path: '/r', children: [child], settings: { cameras: ['dcim'] } });
  return [root];
}

test('changing a parent re-applies the setting to every descendant', () => {
  const next = tree.updateSettings(sample(), 'r', { seq: true, label: 5 });
  tree.walk(next, (n) => {
    assert.equal(n.settings.seq, true, n.name);
    assert.equal(n.settings.label, 5, n.name);
  });
});

test('changing a child leaves its parent alone', () => {
  const next = tree.updateSettings(sample(), 'c', { flt: true });
  assert.equal(tree.findNode(next, 'r').node.settings.flt, false);
  assert.equal(tree.findNode(next, 'c').node.settings.flt, true);
  assert.equal(tree.findNode(next, 'g').node.settings.flt, true);
});

test('detected cameras stay on their own node', () => {
  const next = tree.updateSettings(sample(), 'c', { cameras: ['red'] });
  assert.deepEqual(tree.findNode(next, 'c').node.settings.cameras, ['red']);
  assert.deepEqual(tree.findNode(next, 'g').node.settings.cameras, []);
});

test('tree operations never mutate their input', () => {
  const roots = sample();
  const snapshot = JSON.stringify(roots);
  tree.updateSettings(roots, 'r', { seq: true });
  tree.addChild(roots, 'r', 'New');
  tree.removeNode(roots, 'c');
  tree.relinkNode(roots, 'r', '/elsewhere');
  tree.setBin(roots, 'r', { ref: '1', name: 'R' });
  assert.equal(JSON.stringify(roots), snapshot);
});

test('a new child copies its parent settings at the moment it is added', () => {
  const roots = tree.updateSettings(sample(), 'r', { label: 3, sub: true, rel: true });
  const next = tree.addChild(roots, 'r', 'Fresh');
  const fresh = tree.childNamed(tree.findNode(next, 'r').node, 'Fresh');
  assert.equal(fresh.settings.label, 3);
  assert.equal(fresh.settings.rel, true);
  assert.deepEqual(fresh.settings.cameras, []);
});

test('adding an existing child name is a no-op', () => {
  const next = tree.addChild(sample(), 'r', 'C');
  assert.equal(tree.countNodes(next), 3);
});

test('removing a child excludes it from rediscovery; removing a root drops it', () => {
  const next = tree.removeNode(sample(), 'c');
  const root = tree.findNode(next, 'r').node;
  assert.equal(root.children.length, 0);
  assert.deepEqual(root.excluded, ['C']);
  assert.deepEqual(tree.removeNode(sample(), 'r'), []);
  const same = sample();
  assert.equal(tree.removeNode(same, 'missing'), same);
});

test('relinking a root changes only its path; children follow by name', () => {
  const next = tree.relinkNode(sample(), 'r', '/new/place');
  assert.equal(next[0].path, '/new/place');
  assert.equal(next[0].children[0].path, undefined);
});

test('setBin sets and clears the linked bin', () => {
  const linked = tree.setBin(sample(), 'r', { ref: 42, name: 'Footage' });
  assert.deepEqual(linked[0].bin, { ref: '42', name: 'Footage' });
  assert.equal(tree.setBin(linked, 'r', null)[0].bin, undefined);
});

test('sanitizeRoots drops malformed nodes and clamps settings', () => {
  const roots = tree.sanitizeRoots([
    { name: 'ok', path: '/ok', settings: { label: 99, sub: 'yes' }, children: [{ name: 'kid' }, { bad: true }] },
    { name: 'no path' },
    null,
    'string'
  ]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].settings.label, -1);
  assert.equal(roots[0].settings.sub, true);
  assert.equal(roots[0].children.length, 1);
  assert.deepEqual(tree.sanitizeRoots('nope'), []);
});

test('ids are unique', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i += 1) ids.add(tree.newId());
  assert.equal(ids.size, 1000);
});
