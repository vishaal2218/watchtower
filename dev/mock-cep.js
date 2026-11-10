/* Development-only stand-in for the CEP runtime: window.__adobe_cep__,
   window.cep.fs, a synchronous CommonJS `require` for /lib, Node shims
   (fs over a virtual tree, path, os, crypto, child_process) and a canned
   engine that answers the pages' RPC calls. */
(function (global) {
  'use strict';

  var params = new URLSearchParams(global.location.search);
  var HOST = params.get('host') === 'AEFT' ? 'AEFT' : 'PPRO';
  var LIGHT = params.get('theme') === 'light';
  var LOCALE = params.get('lang') === 'ja' ? 'ja_JP' : 'en_US';

  global.process = { platform: 'darwin', env: {}, pid: 1 };

  /* ----- path (posix only) ----- */
  function normalizeParts(parts) {
    var out = [];
    parts.forEach(function (p) {
      if (!p || p === '.') return;
      if (p === '..') out.pop();
      else out.push(p);
    });
    return out;
  }
  var posix = {
    sep: '/',
    isAbsolute: function (p) { return String(p).charAt(0) === '/'; },
    join: function () {
      var s = Array.prototype.slice.call(arguments).filter(Boolean).join('/');
      var abs = s.charAt(0) === '/';
      var joined = normalizeParts(s.split('/')).join('/');
      return (abs ? '/' : '') + joined || (abs ? '/' : '.');
    },
    resolve: function () {
      var args = Array.prototype.slice.call(arguments);
      var acc = '';
      args.forEach(function (a) { acc = String(a).charAt(0) === '/' ? a : acc + '/' + a; });
      return '/' + normalizeParts(acc.split('/')).join('/');
    },
    dirname: function (p) {
      var parts = String(p).split('/');
      parts.pop();
      var d = parts.join('/');
      return d || '/';
    },
    basename: function (p) { return String(p).split('/').filter(Boolean).pop() || ''; },
    extname: function (p) { var m = String(p).match(/(\.[^./]+)$/); return m ? m[1] : ''; },
    relative: function (from, to) {
      var a = normalizeParts(from.split('/'));
      var b = normalizeParts(to.split('/'));
      while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
      return a.map(function () { return '..'; }).concat(b).join('/');
    },
    parse: function (p) { return { root: String(p).charAt(0) === '/' ? '/' : '' }; }
  };
  posix.posix = posix;
  posix.win32 = posix;

  /* ----- virtual file system ----- */
  var NOW = Date.now();
  var TREE = {};
  function addFile(p) { TREE[p] = { file: true, size: 1024, mtime: NOW - 60000 }; addDir(posix.dirname(p)); }
  function addDir(p) { if (!TREE[p]) { TREE[p] = { dir: true }; if (p !== '/') addDir(posix.dirname(p)); } }
  ['/Volumes/RAID/Show/Footage/Day01/A001C001.mov', '/Volumes/RAID/Show/Footage/Day01/A001C002.mov',
    '/Volumes/RAID/Show/Footage/Day02/B001C001.mov',
    '/Volumes/RAID/Show/Footage/CardA/PRIVATE/M4ROOT/CLIP/C0001.MP4',
    '/Volumes/RAID/Show/VFX/shot010/comp_v003/shot010_comp_0001.exr', '/Volumes/RAID/Show/VFX/shot010/comp_v003/shot010_comp_0002.exr',
    '/Volumes/RAID/Show/VFX/shot010/comp_v003/shot010_comp_0003.exr',
    '/Volumes/RAID/Show/Audio/Music/theme.wav', '/Volumes/RAID/Show/Audio/SFX/whoosh_01.wav',
    '/Users/editor/Downloads/stock_clip.mp4'
  ].forEach(addFile);
  addDir('/Volumes/RAID/Show/Audio/New folder');

  function stat(p) {
    var n = TREE[String(p).replace(/\/+$/, '') || '/'];
    if (!n) { var e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
    return {
      isDirectory: function () { return !!n.dir; },
      isFile: function () { return !!n.file; },
      isSymbolicLink: function () { return false; },
      size: n.size || 0,
      mtime: new Date(n.mtime || NOW),
      birthtime: new Date(NOW - 120000)
    };
  }
  var memFiles = {};
  var fsShim = {
    readdirSync: function (p) {
      stat(p);
      var prefix = p === '/' ? '/' : p + '/';
      return Object.keys(TREE).filter(function (k) {
        return k !== p && k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf('/') < 0;
      }).map(function (k) { return k.slice(prefix.length); });
    },
    statSync: stat,
    lstatSync: stat,
    existsSync: function (p) { try { stat(p); return true; } catch (e) { return !!memFiles[p]; } },
    realpathSync: function (p) { return p; },
    readFileSync: function (p) {
      if (memFiles[p]) return memFiles[p];
      var e = new Error('ENOENT'); e.code = 'ENOENT'; throw e;
    },
    writeFileSync: function (p, d) { memFiles[p] = String(d); },
    renameSync: function (a, b) { memFiles[b] = memFiles[a]; delete memFiles[a]; },
    mkdirSync: function () {},
    unlinkSync: function (p) { delete memFiles[p]; },
    appendFileSync: function () {}
  };

  /* ----- CommonJS loader for /lib ----- */
  var BUILTINS = {
    fs: fsShim,
    path: posix,
    os: { homedir: function () { return '/Users/editor'; } },
    crypto: { createHash: function () { var s = ''; return { update: function (v) { s += v; return this; }, digest: function () { return btoa(unescape(encodeURIComponent(s))).replace(/\W/g, ''); } }; } },
    child_process: { execSync: function () { return ''; } }
  };
  var cache = {};
  function load(file) {
    if (cache[file]) return cache[file].exports;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', file.replace(/^\/ext\//, '/'), false);
    xhr.send();
    if (xhr.status !== 200) throw new Error('Cannot load ' + file);
    var module = { exports: {} };
    cache[file] = module;
    var dir = posix.dirname(file);
    var localRequire = function (name) { return requireFrom(dir, name); };
    new Function('module', 'exports', 'require', xhr.responseText + '\n//# sourceURL=' + file)(module, module.exports, localRequire);
    return module.exports;
  }
  function requireFrom(dir, name) {
    if (BUILTINS[name]) return BUILTINS[name];
    var file = name.charAt(0) === '/' ? name : posix.join(dir, name);
    if (!/\.js$/.test(file)) file += '.js';
    return load(file);
  }
  global.require = function (name) { return requireFrom('/ext', name); };

  /* ----- event bus + CEP runtime ----- */
  var listeners = {};
  function deliver(type, data) {
    (listeners[type] || []).forEach(function (fn) {
      setTimeout(function () { fn({ type: type, data: data }); }, 5);
    });
  }
  var bg = LIGHT ? { red: 214, green: 214, blue: 214 } : { red: 35, green: 35, blue: 35 };
  global.__adobe_cep__ = {
    getHostEnvironment: function () {
      return JSON.stringify({ appName: HOST, appId: HOST, appVersion: '26.0', appUILocale: LOCALE,
        appSkinInfo: { panelBackgroundColor: { color: bg } } });
    },
    getSystemPath: function () { return 'file:///ext'; },
    getExtensionId: function () { return 'dev.preview'; },
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: function (ev) { deliver(ev.type, ev.data); },
    evalScript: function (s, cb) { if (cb) cb('{"ok":true,"data":null}'); },
    requestOpenExtension: function (id) { global.console.info('[dev] open extension', id); },
    closeExtension: function () { global.console.info('[dev] close extension'); }
  };
  global.cep = {
    fs: {
      showOpenDialogEx: function () { return { err: 0, data: ['/Users/editor/Downloads'] }; }
    }
  };

  /* ----- canned engine ----- */
  var RPC_REQUEST = 'watchtower.replica.rpc.request';
  var RPC_RESPONSE = 'watchtower.replica.rpc.response';
  var autoSync = params.get('watching') !== '0';

  function sampleRoots() {
    var builder = global.require('/ext/lib/tree-builder.js');
    var ignore = global.require('/ext/lib/ignore.js');
    var rules = ignore.compileRules(ignore.DEFAULT_IGNORED);
    var footage = builder.buildRoot(fsShim, '/Volumes/RAID/Show/Footage', { ignoreRules: rules, platform: 'posix', projectDir: '/Volumes/RAID/Show/Project' });
    var vfx = builder.buildRoot(fsShim, '/Volumes/RAID/Show/VFX', { ignoreRules: rules, platform: 'posix', projectDir: '/Volumes/RAID/Show/Project', relative: true });
    var audio = builder.buildRoot(fsShim, '/Volumes/RAID/Show/Audio', { ignoreRules: rules, platform: 'posix', projectDir: '/Volumes/RAID/Show/Project' });
    var tree = global.require('/ext/lib/tree.js');
    audio = tree.updateSettings([audio], audio.id, { label: HOST === 'AEFT' ? 9 : 13 })[0];
    var offline = tree.createNode({ name: 'Archive', path: '/Volumes/Backup/Archive' });
    return [footage, vfx, audio, offline];
  }

  function state() {
    return { version: '1.6.1', host: HOST, activeId: 'p1', projects: [
      { id: 'p1', name: 'Show.prproj', autoSync: autoSync, rootCount: 4, syncing: false, offline: 1, lastResult: null }
    ] };
  }

  var handlers = {
    ping: function () { return { version: '1.6.1' }; },
    getState: state,
    toggleAutoSync: function () { autoSync = !autoSync; return state(); },
    forceSync: function () { return { imported: 3, binCount: 2, pending: 0, errors: [] }; },
    getManagerData: function () {
      return { platform: 'posix', host: HOST, activeId: 'p1', prefill: [], projects: [
        { id: 'p1', name: 'Show.prproj', path: '/Volumes/RAID/Show/Project/Show.prproj', dir: '/Volumes/RAID/Show/Project', cloud: false, roots: sampleRoots() },
        { id: 'p2', name: 'Trailer.prproj', path: '/Volumes/RAID/Trailer/Trailer.prproj', dir: '/Volumes/RAID/Trailer', cloud: false, roots: [] }
      ] };
    },
    saveConfigs: state,
    takePrefill: function () { return []; },
    addPrefill: function (p) { return (p.entries || []).length; },
    linkSelectedBins: function () { return 0; },
    reloadSettings: function () { return true; }
  };
  global.__adobe_cep__.addEventListener(RPC_REQUEST, function (ev) {
    var msg = JSON.parse(ev.data);
    var fn = handlers[msg.method];
    var reply = fn ? { to: msg.from, id: msg.id, ok: true, data: fn(msg.params || {}) } : { to: msg.from, id: msg.id, ok: false, error: 'unknown' };
    deliver(RPC_RESPONSE, JSON.stringify(reply));
  });
})(window);
