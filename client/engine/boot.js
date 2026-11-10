/* Boots the sync engine inside the hidden background extension, serves the
   panels' requests and runs the auto-sync loop. */
(function () {
  'use strict';

  var fs = require('fs');
  var os = require('os');
  var nodePath = require('path');
  var W = window.WTCEP;
  var C = W.C;
  var store = W.lib('settings-store.js');
  var dataDir = store.dataDir(process.platform, process.env, os.homedir());
  var LOG_MAX_BYTES = 1024 * 1024;

  function log(level, message) {
    var line = new Date().toISOString() + ' ' + String(level).toUpperCase() + ' ' + message + '\n';
    try {
      store.ensureDir(fs, dataDir);
      var file = nodePath.join(dataDir, 'engine.log');
      try {
        if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, file + '.1');
      } catch (e) {
        /* no log file yet */
      }
      fs.appendFileSync(file, line);
    } catch (e) {
      /* logging must never stop syncing */
    }
  }

  var host = W.hostName();
  var bridge = W.lib('host-bridge.js').createHostBridge(W.evalScript, W.hostScripts(host));
  var engine = W.lib('engine.js').createEngine({
    fs: fs,
    host: bridge,
    platform: W.lib('paths.js').currentPlatform(),
    t: W.t,
    log: log,
    settingsStore: store.createSettingsStore({ fs: fs, dir: dataDir }),
    projectStore: W.lib('project-store.js').createProjectStore({ fs: fs, dir: dataDir }),
    resolveDrive: W.lib('drives.js').createDriveResolver().resolve,
    emitState: function (state) {
      W.transport.emit(C.EVENTS.STATE, state);
    },
    // Jumper's interface is not public; this event is the integration point.
    onImported: function (paths) {
      W.transport.emit(C.EVENTS.JUMPER_ANALYZE, { paths: paths });
    }
  });

  function optionalId(value) {
    return typeof value === 'string' && value ? value : undefined;
  }

  function announcePrefill(count) {
    W.transport.emit(C.EVENTS.PREFILL, { count: count });
    return count;
  }

  function runCommand(name) {
    switch (name) {
      case C.COMMANDS.SHOW:
        W.open(C.EXTENSION_IDS.PANEL);
        return Promise.resolve(true);
      case C.COMMANDS.OPEN_MANAGER:
        W.open(C.EXTENSION_IDS.MANAGER);
        return Promise.resolve(true);
      case C.COMMANDS.SYNC:
        return engine.forceSync();
      case C.COMMANDS.TOGGLE:
        return engine.toggleAutoSync();
      default:
        return Promise.reject(new Error('Unknown command: ' + name));
    }
  }

  W.lib('rpc.js').serveRpc(W.transport, C.EVENTS, {
    ping: function () {
      return { version: C.VERSION, host: host };
    },
    getState: function () {
      return engine.getState();
    },
    toggleAutoSync: function (p) {
      return engine.toggleAutoSync(optionalId(p.projectId));
    },
    forceSync: function (p) {
      return engine.forceSync(optionalId(p.projectId));
    },
    getManagerData: function () {
      return engine.getManagerData();
    },
    saveConfigs: function (p) {
      return engine.saveConfigs({ projects: Array.isArray(p.projects) ? p.projects : [] });
    },
    addPrefill: function (p) {
      return announcePrefill(engine.addPrefill(Array.isArray(p.entries) ? p.entries : []));
    },
    takePrefill: function () {
      return engine.takePrefill();
    },
    linkSelectedBins: function () {
      return engine.linkSelectedBins().then(announcePrefill);
    },
    reloadSettings: function () {
      engine.reloadSettings();
      return true;
    },
    command: function (p) {
      return runCommand(p.name);
    }
  });

  // Automation entry point: any controller (Spell Book, Stream Deck bridge,
  // another panel) can dispatch this event with one of the command names.
  W.transport.on(C.EVENTS.COMMAND, function (data) {
    var name = typeof data === 'string' ? data : data && (data.command || data.name);
    runCommand(name).catch(function (e) {
      log('warn', 'Command failed: ' + e.message);
    });
  });

  function schedule() {
    setTimeout(loop, C.SCAN_INTERVAL_MS);
  }

  function loop() {
    engine.tick().then(schedule, function (e) {
      log('error', 'Sync loop: ' + e.message);
      schedule();
    });
  }

  log('info', 'Engine started in ' + host + ' ' + W.hostEnv().appVersion);
  bridge.load().then(loop, function (e) {
    log('error', 'Loading host scripts failed: ' + e.message);
    schedule();
  });
})();
