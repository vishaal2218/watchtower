/* Thin wrapper over the CEP runtime (window.__adobe_cep__), plus access to the
   Node modules in /lib. Loaded first by every page; exposes window.WTCEP. */
(function (global) {
  'use strict';

  var nodePath = require('path');
  var cep = global.__adobe_cep__;
  var THEME_EVENT = 'com.adobe.csxs.events.ThemeColorChanged';

  function parseData(data) {
    if (typeof data !== 'string') return data;
    try {
      return JSON.parse(data);
    } catch (e) {
      return data;
    }
  }

  function hostEnv() {
    return JSON.parse(cep.getHostEnvironment());
  }

  function systemPath(type) {
    var p = decodeURI(cep.getSystemPath(type));
    return process.platform === 'win32' ? p.replace(/^file:\/\/\//, '') : p.replace(/^file:\/\//, '');
  }

  var extRoot = systemPath('extension');

  function lib(name) {
    return require(nodePath.join(extRoot, 'lib', name));
  }

  var transport = {
    on: function (type, fn) {
      cep.addEventListener(type, function (ev) {
        fn(parseData(ev && ev.data));
      });
    },
    emit: function (type, data) {
      cep.dispatchEvent({
        type: type,
        scope: 'APPLICATION',
        appId: hostEnv().appId,
        extensionId: cep.getExtensionId(),
        data: JSON.stringify(data)
      });
    }
  };

  function hostName() {
    return hostEnv().appName === 'AEFT' ? 'AEFT' : 'PPRO';
  }

  function hostScripts(host) {
    var dir = nodePath.join(extRoot, 'host');
    var main = host === 'AEFT' ? 'aeft.jsx' : 'ppro.jsx';
    return ['json.jsx', 'common.jsx', main].map(function (f) {
      return nodePath.join(dir, f);
    });
  }

  function evalScript(script) {
    return new Promise(function (resolve) {
      cep.evalScript(script, resolve);
    });
  }

  function chooseFolders(title, multiple) {
    var result = global.cep.fs.showOpenDialogEx(!!multiple, true, title, '', []);
    return result && result.err === 0 && Array.isArray(result.data) ? result.data : [];
  }

  /** Follow the host's panel colour; switches to the light theme (v1.5.3) on bright UIs. */
  function applyTheme() {
    var skin = hostEnv().appSkinInfo;
    var c = skin && skin.panelBackgroundColor && skin.panelBackgroundColor.color;
    if (!c) return;
    var root = global.document.documentElement;
    var rgb = 'rgb(' + Math.round(c.red) + ',' + Math.round(c.green) + ',' + Math.round(c.blue) + ')';
    var luminance = (0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue) / 255;
    root.style.setProperty('--host-bg', rgb);
    root.setAttribute('data-theme', luminance > 0.5 ? 'light' : 'dark');
  }

  function watchTheme() {
    applyTheme();
    cep.addEventListener(THEME_EVENT, applyTheme);
  }

  var constants = lib('constants.js');
  var i18n = lib('i18n.js');
  var translate = i18n.createTranslator(i18n.pickLocale(hostEnv().appUILocale));

  /** Fill every [data-i18n] / [data-i18n-title] / [data-i18n-placeholder] element. */
  function localize(root) {
    var scope = root || global.document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = translate(el.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-title]'), function (el) {
      el.title = translate(el.getAttribute('data-i18n-title'));
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-placeholder]'), function (el) {
      el.placeholder = translate(el.getAttribute('data-i18n-placeholder'));
    });
  }

  function rpcClient() {
    return lib('rpc.js').createRpcClient(transport, constants.EVENTS, { timeoutMs: constants.RPC_TIMEOUT_MS });
  }

  /** Make sure the background engine runs and answers; resolves true when it does. */
  function ensureEngine(rpc) {
    var attempts = 0;
    function ping() {
      return rpc.call('ping', {}, 2500).then(
        function () {
          return true;
        },
        function () {
          attempts += 1;
          if (attempts > 3) return false;
          cep.requestOpenExtension(constants.EXTENSION_IDS.ENGINE, '');
          return new Promise(function (r) {
            setTimeout(r, 1500);
          }).then(ping);
        }
      );
    }
    return ping();
  }

  global.WTCEP = {
    C: constants,
    t: translate,
    lib: lib,
    extRoot: extRoot,
    transport: transport,
    hostEnv: hostEnv,
    hostName: hostName,
    hostScripts: hostScripts,
    evalScript: evalScript,
    chooseFolders: chooseFolders,
    watchTheme: watchTheme,
    localize: localize,
    rpcClient: rpcClient,
    ensureEngine: ensureEngine,
    open: function (id) {
      cep.requestOpenExtension(id, '');
    },
    close: function () {
      cep.closeExtension();
    }
  };
})(window);
