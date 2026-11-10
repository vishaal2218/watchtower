'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../lib/manager-model');
const tree = require('../lib/tree');

function sampleRoots() {
  const deep = tree.createNode({ id: 'd', name: 'Deep' });
  const a = tree.createNode({ id: 'a', name: 'A', children: [deep] });
  const b = tree.createNode({ id: 'b', name: 'Beta' });
  return [tree.createNode({ id: 'r', name: 'Media', path: '/show/Media', children: [a, b] })];
}

const project = { id: 'p1', name: 'Show', dir: '/show/Project' };
const online = (abs) => abs !== '/show/Media/Beta';

function rows(extra) {
  return model.buildRows(
    [project],
    { p1: sampleRoots() },
    Object.assign({ scope: 'all', search: '', expanded: new Set(['r', 'a']), platform: 'posix', isDirectory: online }, extra)
  );
}

test('rows follow the tree, honouring expansion', () => {
  const r = rows();
  assert.deepEqual(r.map((x) => [x.node.name, x.depth]), [['Media', 0], ['A', 1], ['Deep', 2], ['Beta', 1]]);
  assert.equal(r[2].display, '/show/Media/A/Deep');
  assert.equal(r[2].abs, '/show/Media/A/Deep');
  assert.equal(r[3].online, false);
  assert.equal(r[0].hasChildren, true);
  const collapsed = rows({ expanded: new Set() });
  assert.deepEqual(collapsed.map((x) => x.node.name), ['Media']);
});

test('search keeps matches and their ancestors, expanded', () => {
  const r = rows({ search: 'dee', expanded: new Set() });
  assert.deepEqual(r.map((x) => x.node.name), ['Media', 'A', 'Deep']);
  assert.deepEqual(rows({ search: 'zzz' }), []);
});

test('children under SUB-off or flattened folders are marked inactive', () => {
  const roots = tree.updateSettings(sampleRoots(), 'a', { flt: true });
  const r = model.buildRows([project], { p1: roots }, {
    scope: 'p1', search: '', expanded: new Set(['r', 'a']), platform: 'posix', isDirectory: () => true
  });
  const byName = {};
  r.forEach((x) => {
    byName[x.node.name] = x;
  });
  assert.equal(byName.A.inactive, false);
  assert.equal(byName.Deep.inactive, true);
});

test('project headers appear only when several projects are shown', () => {
  const two = [project, { id: 'p2', name: 'Other', dir: '/o' }];
  const r = model.buildRows(two, { p1: sampleRoots(), p2: [] }, {
    scope: 'all', search: '', expanded: new Set(), platform: 'posix', isDirectory: () => true
  });
  assert.deepEqual(r.filter((x) => x.kind === 'project').map((x) => x.project.id), ['p1', 'p2']);
  const one = model.buildRows(two, { p1: sampleRoots(), p2: [] }, {
    scope: 'p2', search: '', expanded: new Set(), platform: 'posix', isDirectory: () => true
  });
  assert.deepEqual(one, []);
});

test('relative roots display relative child paths', () => {
  assert.equal(model.nodeDisplayPath({ name: 'A' }, '../Media', 'win32'), '../Media/A');
  assert.equal(model.nodeDisplayPath({ name: 'A' }, 'C:\\Media', 'win32'), 'C:\\Media\\A');
  assert.equal(model.nodeDisplayPath({ name: 'A' }, '', 'posix'), '');
});

test('new folders may not overlap existing watch folders', () => {
  const roots = sampleRoots();
  assert.equal(model.validateNewFolder(roots, '/show/Media/A', '/p', 'posix'), 'manager.alreadyWatched');
  assert.equal(model.validateNewFolder(roots, '/show', '/p', 'posix'), 'manager.containsWatched');
  assert.equal(model.validateNewFolder(roots, '/music', '/p', 'posix'), null);
});

test('REL converts stored paths for the node and its subtree', () => {
  const withOverride = tree.relinkNode(sampleRoots(), 'b', '/elsewhere/B');
  const on = model.setRelative(withOverride, 'r', true, '/show/Project', 'posix');
  assert.equal(on.roots[0].path, '../Media');
  assert.equal(tree.findNode(on.roots, 'b').node.path, '../../elsewhere/B');
  tree.walk(on.roots, (n) => assert.equal(n.settings.rel, true));
  const off = model.setRelative(on.roots, 'r', false, '/show/Project', 'posix');
  assert.equal(off.roots[0].path, '/show/Media');
  assert.equal(tree.findNode(off.roots, 'b').node.path, '/elsewhere/B');
});

test('REL is refused without a saved project or across drives', () => {
  assert.equal(model.setRelative(sampleRoots(), 'r', true, '', 'posix').error, 'manager.relUnavailable');
  const win = [tree.createNode({ id: 'w', name: 'M', path: 'D:\\Media' })];
  assert.equal(model.setRelative(win, 'w', true, 'C:\\Project', 'win32').error, 'manager.relUnavailable');
  assert.deepEqual(model.setRelative(win, 'missing', true, 'C:\\P', 'win32').roots, win);
});

test('relinking a root moves every child with it', () => {
  const { roots } = model.relink(sampleRoots(), 'r', '/volumes/Backup/Media', '/p', 'posix');
  assert.equal(roots[0].path, '/volumes/Backup/Media');
  assert.equal(model.absOf(roots, 'd', '/p', 'posix'), '/volumes/Backup/Media/A/Deep');
});

test('relinking a child sets its own path, or clears it when it matches the parent', () => {
  const moved = model.relink(sampleRoots(), 'b', '/other/place', '/p', 'posix').roots;
  assert.equal(tree.findNode(moved, 'b').node.path, '/other/place');
  const back = model.relink(moved, 'b', '/show/Media/Beta', '/p', 'posix').roots;
  assert.equal(tree.findNode(back, 'b').node.path, undefined);
  const relRoots = tree.updateSettings(sampleRoots(), 'r', { rel: true });
  assert.equal(model.relink(relRoots, 'r', '/x', '', 'posix').error, 'manager.relUnavailable');
  assert.deepEqual(model.relink(relRoots, 'nope', '/x', '', 'posix').roots, relRoots);
});

test('only projects whose drafts changed are saved', () => {
  const roots = sampleRoots();
  const originals = { p1: roots, p2: [] };
  assert.deepEqual(model.changedProjectIds(originals, { p1: roots, p2: [] }), []);
  assert.deepEqual(model.changedProjectIds(originals, { p1: tree.removeNode(roots, 'b'), p2: [] }), ['p1']);
});
