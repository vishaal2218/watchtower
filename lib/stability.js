'use strict';

// Decides when a file has finished being written. A file is ready once its
// size and modification time have been observed unchanged for `stableMs`.
// Modification time alone is not enough: Finder and `cp -p` preserve the
// source mtime, so a half-copied file can carry an old timestamp.

// While Finder copies a file it stamps the creation date with 1984-01-24
// ("kMagicBusyCreationDate"); the real date is written when the copy ends.
function isFinderBusy(birthtimeMs) {
  if (!birthtimeMs) return false;
  const d = new Date(birthtimeMs);
  return d.getUTCFullYear() === 1984 && d.getUTCMonth() === 0 && Math.abs(d.getUTCDate() - 24) <= 1;
}

function createStabilityTracker(options) {
  const stableMs = options.stableMs;
  const now = options.now || Date.now;
  const seen = new Map();

  function observe(key, stat) {
    const size = stat.size;
    const mtimeMs = stat.mtimeMs;
    const prev = seen.get(key);
    const unchanged = prev && prev.size === size && prev.mtimeMs === mtimeMs;
    if (!unchanged) {
      seen.set(key, { size, mtimeMs, since: now() });
      return false;
    }
    if (size <= 0 || isFinderBusy(stat.birthtimeMs)) return false;
    return now() - prev.since >= stableMs;
  }

  /** Forget files no longer present so the map cannot grow without bound. */
  function prune(activeKeys) {
    Array.from(seen.keys()).forEach((k) => {
      if (!activeKeys.has(k)) seen.delete(k);
    });
  }

  return { observe, prune, size: () => seen.size };
}

module.exports = { createStabilityTracker, isFinderBusy };
