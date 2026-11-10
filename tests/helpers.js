'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Create a temporary tree. `spec` maps relative paths to file contents; a key
 * ending in "/" creates an (empty) directory.
 */
function makeTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-'));
  Object.keys(spec || {}).forEach((rel) => {
    const full = path.join(root, rel);
    if (rel.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, spec[rel]);
    }
  });
  return root;
}

function removeTree(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function fakeClock(start) {
  let t = start || 1000000;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    }
  };
}

module.exports = { makeTree, removeTree, fakeClock };
