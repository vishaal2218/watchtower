'use strict';

// Licence state on this machine. The original product activates against its
// developer's licence server (two machines per licence); that protocol is not
// public, so this build has no activation client. It only reports a stored
// activation and lets the user deactivate this machine, freeing the slot.

const nodePath = require('path');
const { readJson } = require('./settings-store');

function createLicenseStore(options) {
  const fs = options.fs;
  const file = nodePath.join(options.dir, 'license.json');
  return {
    status() {
      const data = readJson(fs, file);
      if (!data || typeof data.machine !== 'string') return { activated: false };
      return { activated: true, machine: data.machine, activatedAt: String(data.activatedAt || '') };
    },
    deactivate() {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      return { activated: false };
    }
  };
}

module.exports = { createLicenseStore };
