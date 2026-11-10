'use strict';

// Local fallback copy of each project's watch-folder configuration. The
// primary copy lives inside the project itself (see host/*.jsx); this one is
// used when the host cannot store it (for example a Team Project).

const nodePath = require('path');
const crypto = require('crypto');
const { sanitizeRoots } = require('./tree');
const { writeJsonAtomic, readJson } = require('./settings-store');

function fileFor(dir, projectKey) {
  const hash = crypto.createHash('sha1').update(String(projectKey)).digest('hex');
  return nodePath.join(dir, 'projects', hash + '.json');
}

function createProjectStore(options) {
  const fs = options.fs;
  const dir = options.dir;
  const now = options.now || Date.now;
  return {
    load(projectKey) {
      const data = readJson(fs, fileFor(dir, projectKey));
      if (!data || data.projectKey !== projectKey) return null;
      return { autoSync: !!data.autoSync, roots: sanitizeRoots(data.roots), savedAt: String(data.savedAt || '') };
    },
    save(projectKey, config) {
      writeJsonAtomic(fs, fileFor(dir, projectKey), {
        v: 1,
        projectKey,
        savedAt: config.savedAt || new Date(now()).toISOString(),
        autoSync: !!config.autoSync,
        roots: config.roots
      });
    }
  };
}

module.exports = { createProjectStore, fileFor };
