/* Main panel: Watch/Unwatch, Sync, Folders, and the flyout menu. The panel
   only controls the background engine; closing it does not stop syncing. */
(function () {
  'use strict';

  var W = window.WTCEP;
  var UI = window.WTUI;
  var C = W.C;
  var t = W.t;
  var fs = require('fs');
  var fsScan = W.lib('fs-scan.js');
  var rpc = W.rpcClient();
  var MESSAGE_MS = 6000;

  var state = null;
  var engineUp = false;
  var syncing = false;
  var message = null;
  var messageTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function activeProject() {
    if (!state) return null;
    return state.projects.filter(function (p) {
      return p.id === state.activeId;
    })[0] || null;
  }

  function infoText(p) {
    if (!engineUp) return { text: t('panel.info.engineDown'), error: true };
    if (!p) return { text: t('panel.info.noProject') };
    var text;
    if (syncing || p.syncing) text = t('panel.syncing');
    else if (!p.rootCount) text = t('panel.info.empty');
    else text = t(p.autoSync ? 'panel.info.running' : 'panel.info.off');
    if (p.offline) text += ' ' + t('panel.info.offline', { count: p.offline });
    return { text: text };
  }

  function render() {
    var p = activeProject();
    var on = !!(p && p.autoSync);
    var busy = syncing || !!(p && p.syncing);
    $('watchBtn').disabled = !engineUp || !p;
    $('syncBtn').disabled = !engineUp || !p || busy;
    $('watchBtn').classList.toggle('on', on);
    $('watchBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('watchLabel').textContent = t(on ? 'panel.unwatch' : 'panel.watch');
    $('syncBtn').classList.toggle('busy', busy);
    var info = message || infoText(p);
    $('info').textContent = info.text;
    $('info').classList.toggle('error', !!info.error);
  }

  function flash(text, isError) {
    message = { text: text, error: !!isError };
    clearTimeout(messageTimer);
    messageTimer = setTimeout(function () {
      message = null;
      render();
    }, MESSAGE_MS);
    render();
  }

  function showError(e) {
    flash(e && e.message ? e.message : String(e), true);
  }

  function summary(result) {
    if (!result || !result.imported) return t('notify.upToDate');
    var text = t('notify.imported', { count: result.imported, bins: result.binCount });
    return result.pending ? text + ' ' + t('notify.pending', { count: result.pending }) : text;
  }

  function toggleWatch() {
    rpc.call('toggleAutoSync', { projectId: state && state.activeId }).then(function (s) {
      state = s;
      render();
    }, showError);
  }

  function forceSync() {
    syncing = true;
    render();
    rpc.call('forceSync', { projectId: state && state.activeId }, C.FORCE_SYNC_TIMEOUT_MS).then(
      function (result) {
        syncing = false;
        flash(summary(result));
      },
      function (e) {
        syncing = false;
        showError(e);
      }
    );
  }

  /* ----- flyout / context menu ----- */

  function openMenu(x, y) {
    var menu = $('menu');
    menu.hidden = false;
    var maxX = window.innerWidth - menu.offsetWidth - 4;
    var maxY = window.innerHeight - menu.offsetHeight - 4;
    menu.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, maxY)) + 'px';
    $('menuBtn').setAttribute('aria-expanded', 'true');
    $('settingsItem').focus();
  }

  function closeMenu() {
    $('menu').hidden = true;
    $('menuBtn').setAttribute('aria-expanded', 'false');
  }

  /* ----- drag and drop: folders to watch, or bins to link ----- */

  function handleDrop(dataTransfer) {
    var dropped = UI.droppedPaths(dataTransfer);
    var folders = dropped.filter(function (p) {
      return fsScan.isDirectory(fs, p);
    });
    var request = folders.length
      ? rpc.call('addPrefill', {
          entries: folders.map(function (p) {
            return { projectId: state && state.activeId, path: p };
          })
        })
      : rpc.call('linkSelectedBins');
    request.then(function (count) {
      if (count) W.open(C.EXTENSION_IDS.MANAGER);
      else flash(t('panel.noBins'));
    }, showError);
  }

  function wireDrop() {
    var depth = 0;
    document.addEventListener('dragenter', function (e) {
      e.preventDefault();
      depth += 1;
      $('drop').hidden = false;
    });
    document.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (!depth) $('drop').hidden = true;
    });
    document.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      $('drop').hidden = true;
      handleDrop(e.dataTransfer);
    });
  }

  function wire() {
    $('watchBtn').addEventListener('click', toggleWatch);
    $('syncBtn').addEventListener('click', forceSync);
    $('foldersBtn').addEventListener('click', function () {
      W.open(C.EXTENSION_IDS.MANAGER);
    });
    $('settingsItem').addEventListener('click', function () {
      closeMenu();
      W.open(C.EXTENSION_IDS.SETTINGS);
    });
    $('menuBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (!$('menu').hidden) return closeMenu();
      var r = $('menuBtn').getBoundingClientRect();
      openMenu(r.left, r.bottom + 2);
    });
    document.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      openMenu(e.clientX, e.clientY);
    });
    document.addEventListener('click', function (e) {
      if (!$('menu').contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
    wireDrop();
  }

  function init() {
    W.watchTheme();
    W.localize();
    $('menuBtn').appendChild(UI.icon('menu'));
    $('watchBtn').querySelector('.glyph').appendChild(UI.icon('eye'));
    $('syncBtn').querySelector('.glyph').appendChild(UI.icon('sync'));
    $('foldersBtn').querySelector('.glyph').appendChild(UI.icon('folder'));
    $('menuVersion').textContent = C.PRODUCT_NAME + ' ' + C.VERSION;
    wire();
    render();

    W.transport.on(C.EVENTS.STATE, function (s) {
      state = s;
      engineUp = true;
      render();
    });
    W.ensureEngine(rpc)
      .then(function (ok) {
        engineUp = ok;
        return ok ? rpc.call('getState') : null;
      })
      .then(function (s) {
        if (s) state = s;
        render();
      }, showError);
  }

  init();
})();
