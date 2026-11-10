'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStabilityTracker, isFinderBusy } = require('../lib/stability');
const { diffItems, itemKeys, groupImports } = require('../lib/sync-diff');
const { fakeClock } = require('./helpers');

const STABLE = 3000;

function file(key, size) {
  return { kind: 'file', rootId: 'r', sub: [], label: -1, path: '/' + key, key, stat: { size: size || 10, mtimeMs: 5, birthtimeMs: 0 } };
}

function sequence(key, count) {
  const frames = [];
  for (let i = 1; i <= count; i += 1) frames.push({ path: '/' + key + i, key: key + i, stat: { size: 10, mtimeMs: 5 } });
  return { kind: 'sequence', rootId: 'r', sub: ['S'], label: 2, path: frames[0].path, key: frames[0].key, frames };
}

function state(clock, extra) {
  return Object.assign(
    {
      projectKeys: new Map(),
      tracker: createStabilityTracker({ stableMs: STABLE, now: clock.now }),
      seqCounts: new Map(),
      failed: new Set()
    },
    extra
  );
}

test('a file is ready only after its size and date hold still for the window', () => {
  const clock = fakeClock();
  const tr = createStabilityTracker({ stableMs: STABLE, now: clock.now });
  const stat = { size: 100, mtimeMs: 1 };
  assert.equal(tr.observe('a', stat), false);
  clock.advance(STABLE - 1);
  assert.equal(tr.observe('a', stat), false);
  clock.advance(1);
  assert.equal(tr.observe('a', stat), true);
});

test('growth restarts the stability window', () => {
  const clock = fakeClock();
  const tr = createStabilityTracker({ stableMs: STABLE, now: clock.now });
  tr.observe('a', { size: 100, mtimeMs: 1 });
  clock.advance(STABLE);
  assert.equal(tr.observe('a', { size: 200, mtimeMs: 1 }), false);
  clock.advance(STABLE);
  assert.equal(tr.observe('a', { size: 200, mtimeMs: 1 }), true);
});

test('empty files and Finder copies in progress are never ready', () => {
  const clock = fakeClock();
  const tr = createStabilityTracker({ stableMs: STABLE, now: clock.now });
  const busy = { size: 10, mtimeMs: 1, birthtimeMs: Date.UTC(1984, 0, 24, 8) };
  tr.observe('empty', { size: 0, mtimeMs: 1 });
  tr.observe('busy', busy);
  clock.advance(STABLE * 10);
  assert.equal(tr.observe('empty', { size: 0, mtimeMs: 1 }), false);
  assert.equal(tr.observe('busy', busy), false);
  assert.equal(isFinderBusy(Date.UTC(2024, 5, 1)), false);
  assert.equal(isFinderBusy(0), false);
});

test('prune forgets files that disappeared', () => {
  const clock = fakeClock();
  const tr = createStabilityTracker({ stableMs: STABLE, now: clock.now });
  tr.observe('a', { size: 1, mtimeMs: 1 });
  tr.observe('b', { size: 1, mtimeMs: 1 });
  tr.prune(new Set(['a']));
  assert.equal(tr.size(), 1);
});

test('new files import once stable; files already in the project never do', () => {
  const clock = fakeClock();
  const s = state(clock, { projectKeys: new Map([['old', 'id1']]) });
  const items = [file('new'), file('old')];
  let d = diffItems(items, s);
  assert.equal(d.imports.length, 0);
  assert.equal(d.pending, 1);
  clock.advance(STABLE);
  d = diffItems(items, s);
  assert.deepEqual(d.imports.map((i) => i.key), ['new']);
  assert.equal(d.pending, 0);
});

test('failed imports are skipped', () => {
  const clock = fakeClock();
  const s = state(clock, { failed: new Set(['bad']) });
  diffItems([file('bad')], s);
  clock.advance(STABLE);
  assert.equal(diffItems([file('bad')], s).imports.length, 0);
});

test('a sequence imports when its first frame is stable, then refreshes as frames grow', () => {
  const clock = fakeClock();
  const s = state(clock);
  const two = sequence('f', 2);
  diffItems([two], s);
  clock.advance(STABLE);
  let d = diffItems([two], s);
  assert.equal(d.imports.length, 1);
  assert.equal(d.imports[0].frameCount, 2);

  // The host now reports the sequence under its first frame.
  const s2 = Object.assign({}, s, { projectKeys: new Map([['f1', 'item-9']]), seqCounts: d.seqCounts });
  const four = sequence('f', 4);
  d = diffItems([four], s2);
  assert.deepEqual(d.refresh, [], 'new frames are not stable yet');
  clock.advance(STABLE);
  d = diffItems([four], Object.assign({}, s2, { seqCounts: d.seqCounts }));
  assert.deepEqual(d.refresh, ['item-9']);
  assert.equal(d.seqCounts.get('f1'), 4);
});

test('a frame still being written at import time triggers a refresh once it settles', () => {
  const clock = fakeClock();
  const s = state(clock);
  const growing = (size) => {
    const seq = sequence('f', 2);
    seq.frames[1].stat = { size, mtimeMs: 5 };
    return seq;
  };
  diffItems([growing(1)], s);
  clock.advance(STABLE);
  let d = diffItems([growing(2)], s);
  assert.equal(d.imports.length, 1, 'imports once the first frame is stable');
  assert.equal(d.imports[0].frameCount, 1, 'the tail frame is not counted yet');
  const s2 = Object.assign({}, s, { projectKeys: new Map([['f1', 'item-1']]), seqCounts: d.seqCounts });
  clock.advance(STABLE);
  d = diffItems([growing(2)], s2);
  assert.deepEqual(d.refresh, ['item-1'], 'the host re-reads the sequence when the tail settles');
});

test('a sequence already in the project before the engine started is only baselined', () => {
  const clock = fakeClock();
  const s = state(clock, { projectKeys: new Map([['f2', 'x']]) });
  const first = diffItems([sequence('f', 3)], s);
  clock.advance(STABLE);
  const d = diffItems([sequence('f', 3)], Object.assign({}, s, { seqCounts: first.seqCounts }));
  assert.deepEqual(d.refresh, []);
  assert.equal(d.seqCounts.get('f1'), 3);
});

test('diffItems does not mutate the seqCounts it was given', () => {
  const clock = fakeClock();
  const counts = new Map();
  diffItems([sequence('f', 2)], state(clock, { seqCounts: counts }));
  assert.equal(counts.size, 0);
});

test('itemKeys lists every file and frame key', () => {
  assert.deepEqual(Array.from(itemKeys([file('a'), sequence('s', 2)])).sort(), ['a', 's1', 's2']);
});

test('groupImports groups by destination bin with the root reference', () => {
  const items = [file('a'), Object.assign(file('b'), { sub: ['X'] }), sequence('s', 2)];
  const groups = groupImports(items, { r: { name: 'Root', bin: { ref: '12' } } });
  assert.equal(groups.length, 3);
  const top = groups.filter((g) => g.sub.length === 0)[0];
  assert.deepEqual(top.files, ['/a']);
  assert.equal(top.rootRef, '12');
  assert.equal(top.rootName, 'Root');
  const seqGroup = groups.filter((g) => g.sub[0] === 'S')[0];
  assert.deepEqual(seqGroup.sequences, ['/s1']);
  assert.equal(groupImports([file('a')], {})[0].rootRef, null);
});
