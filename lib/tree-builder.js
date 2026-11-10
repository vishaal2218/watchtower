'use strict';

const { MAX_DETECT_DEPTH, MAX_TREE_DEPTH } = require('./constants');
const { listDir, indexTree, realpathOr } = require('./fs-scan');
const { isIgnored } = require('./ignore');
const { detectCameras, cameraWantsSequences } = require('./camera');
const { detectSequenceFolder } = require('./sequence');
const { createNode, inheritSettings, normalizeSettings } = require('./tree');
const paths = require('./paths');

/** Auto-detection for one folder: SEQ from its own filenames, FLT from camera structure. */
function detectFolder(fs, abs, ignoreRules) {
  const ix = indexTree(fs, abs, { maxDepth: MAX_DETECT_DEPTH, ignoreRules });
  const cameras = detectCameras(ix);
  return {
    seq: detectSequenceFolder(ix.topFiles) || cameraWantsSequences(cameras),
    flt: cameras.length > 0,
    cameras
  };
}

/** Merge detection into inherited settings: detection can switch SEQ/FLT on, never off. */
function withDetection(baseSettings, detected) {
  return normalizeSettings(
    Object.assign({}, baseSettings, {
      seq: !!baseSettings.seq || detected.seq,
      flt: !!baseSettings.flt || detected.flt,
      cameras: detected.cameras
    })
  );
}

function buildNode(fs, abs, name, baseSettings, ctx, depth, visited) {
  const settings = withDetection(baseSettings, detectFolder(fs, abs, ctx.ignoreRules));
  let children = [];
  if (settings.sub && !settings.flt && depth < MAX_TREE_DEPTH) {
    const listing = listDir(fs, abs);
    if (listing.ok) {
      children = listing.dirs
        .filter((d) => !isIgnored(d.name, ctx.ignoreRules))
        .filter((d) => {
          if (!d.linked) return true;
          const real = realpathOr(fs, d.abs);
          if (visited[real]) return false;
          visited[real] = true;
          return true;
        })
        .map((d) => buildNode(fs, d.abs, d.name, inheritSettings(settings), ctx, depth + 1, visited));
    }
  }
  return createNode({ name, settings, children });
}

/**
 * Build a new watch-folder root from disk. `ctx`: { ignoreRules, relative,
 * projectDir, platform, bin, baseSettings }.
 */
function buildRoot(fs, absPath, ctx) {
  const platform = ctx.platform || paths.currentPlatform();
  const name = paths.basename(platform, absPath) || absPath;
  const base = normalizeSettings(Object.assign({}, ctx.baseSettings, { rel: !!ctx.relative }));
  const node = buildNode(fs, absPath, name, base, ctx, 0, {});
  const stored = paths.toStored(absPath, !!ctx.relative, ctx.projectDir, platform);
  return Object.assign({}, node, { path: stored }, ctx.bin ? { bin: ctx.bin } : {});
}

module.exports = { detectFolder, withDetection, buildRoot };
