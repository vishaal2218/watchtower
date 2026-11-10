'use strict';

const { extOf, isStillImage } = require('./extensions');
const { MIN_SEQ_DIGITS_AUTO } = require('./constants');

const TRAILING_DIGITS = /^(.*?)(\d+)$/;

function stem(name) {
  const base = String(name).replace(/^.*[\\/]/, '');
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}

/** Split "shot_0042.exr" into { prefix: 'shot_', digits: '0042', number: 42, ext: 'exr' }. */
function splitFrame(name) {
  const m = stem(name).match(TRAILING_DIGITS);
  if (!m) return null;
  return { prefix: m[1], digits: m[2], number: parseInt(m[2], 10), ext: extOf(name) };
}

/** Auto-detection rule: a still image whose name ends in three or more digits. */
function qualifiesForAutoDetect(name) {
  const f = splitFrame(name);
  return !!f && isStillImage(name) && f.digits.length >= MIN_SEQ_DIGITS_AUTO;
}

function groupKey(f) {
  return f.prefix.toLowerCase() + '\u0000' + f.ext;
}

/**
 * Decide whether a folder's files look like an image sequence: at least two
 * qualifying stills sharing a prefix, extension and digit width.
 */
function detectSequenceFolder(fileNames) {
  const counts = {};
  return (fileNames || []).some((name) => {
    if (!qualifiesForAutoDetect(name)) return false;
    const f = splitFrame(name);
    const key = groupKey(f) + '\u0000' + f.digits.length;
    counts[key] = (counts[key] || 0) + 1;
    return counts[key] >= 2;
  });
}

/**
 * Group a folder's files for import when SEQ is on. Any still image ending in
 * digits joins a sequence (a hand-ticked two-digit sequence must still work),
 * and a lone numbered frame is already a sequence so later frames extend it.
 * `files` are objects with at least a `name`.
 */
function groupSequences(files) {
  const groups = {};
  const order = [];
  const singles = [];
  (files || []).forEach((file) => {
    const f = isStillImage(file.name) ? splitFrame(file.name) : null;
    if (!f) {
      singles.push(file);
      return;
    }
    const key = groupKey(f);
    if (!groups[key]) {
      groups[key] = { key, prefix: f.prefix, ext: f.ext, frames: [] };
      order.push(key);
    }
    groups[key].frames.push({ file, number: f.number });
  });
  const sequences = order.map((key) => {
    const g = groups[key];
    const frames = g.frames
      .slice()
      .sort((a, b) => a.number - b.number || (a.file.name < b.file.name ? -1 : 1))
      .map((fr) => fr.file);
    return { key: g.key, prefix: g.prefix, ext: g.ext, frames, first: frames[0] };
  });
  return { sequences, singles };
}

module.exports = { splitFrame, qualifiesForAutoDetect, detectSequenceFolder, groupSequences };
