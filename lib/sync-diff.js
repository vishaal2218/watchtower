'use strict';

// Compares planned items against what is already in the project. The file
// path is the only identity: an item whose key is not in the project is new.

/**
 * state: {
 *   projectKeys: Map<key, hostItemId>,
 *   tracker: stability tracker,
 *   seqCounts: Map<sequenceKey, stableFrameCount>,
 *   failed: Set<key>   // imports the host refused this session
 * }
 * Returns { imports, refresh: [hostItemId], pending, seqCounts } and never
 * mutates `seqCounts`; the tracker keeps its own observation history.
 */
function diffItems(items, state) {
  const imports = [];
  const refresh = [];
  const seqCounts = new Map(state.seqCounts);
  let pending = 0;

  items.forEach((item) => {
    if (state.failed.has(item.key)) return;

    if (item.kind === 'file') {
      if (state.projectKeys.has(item.key)) return;
      if (state.tracker.observe(item.key, item.stat)) imports.push(item);
      else pending += 1;
      return;
    }

    const stable = item.frames.filter((fr) => state.tracker.observe(fr.key, fr.stat));
    const matched = item.frames.filter((fr) => state.projectKeys.has(fr.key))[0];
    if (matched) {
      // Already imported: pick up new frames (Premiere does not do this itself).
      const prev = seqCounts.get(item.key);
      if (prev === undefined) {
        // First sighting of a sequence imported earlier: baseline on every frame
        // present, so only frames that arrive from now on trigger a refresh.
        seqCounts.set(item.key, item.frames.length);
        return;
      }
      if (stable.length > prev) refresh.push(state.projectKeys.get(matched.key));
      seqCounts.set(item.key, Math.max(prev, stable.length));
      return;
    }
    const firstStable = stable.length > 0 && stable[0].key === item.frames[0].key;
    if (firstStable) {
      imports.push(Object.assign({}, item, { frameCount: stable.length }));
      seqCounts.set(item.key, stable.length);
    }
    pending += item.frames.length - stable.length;
  });

  return { imports, refresh: refresh.filter((id) => id !== undefined && id !== null), pending, seqCounts };
}

/** Every stat key an item list refers to (for pruning the stability tracker). */
function itemKeys(items) {
  const keys = new Set();
  items.forEach((item) => {
    if (item.kind === 'file') keys.add(item.key);
    else item.frames.forEach((fr) => keys.add(fr.key));
  });
  return keys;
}

function binKey(rootId, sub) {
  return rootId + '\u0000' + sub.join('\u0000');
}

/**
 * Group imports by destination bin for the host call. `rootsById` supplies the
 * bin reference and name for each watch-folder root.
 */
function groupImports(imports, rootsById) {
  const groups = {};
  const order = [];
  imports.forEach((item) => {
    const k = binKey(item.rootId, item.sub);
    if (!groups[k]) {
      const root = rootsById[item.rootId] || {};
      groups[k] = {
        rootId: item.rootId,
        rootRef: root.bin ? root.bin.ref : null,
        rootName: root.name || '',
        sub: item.sub.slice(),
        label: item.label,
        files: [],
        sequences: []
      };
      order.push(k);
    }
    if (item.kind === 'sequence') groups[k].sequences.push(item.path);
    else groups[k].files.push(item.path);
  });
  return order.sort().map((k) => groups[k]);
}

module.exports = { diffItems, itemKeys, binKey, groupImports };
