/* Settings dialog: General (per host), Allowed Files, Ignored Folders.
   Changes are kept in a draft and written only on Ok. */
(function () {
  'use strict';

  var W = window.WTCEP;
  var UI = window.WTUI;
  var t = W.t;
  var fs = require('fs');
  var os = require('os');
  var store = W.lib('settings-store.js');
  var extensions = W.lib('extensions.js');
  var ignore = W.lib('ignore.js');
  var dataDir = store.dataDir(process.platform, process.env, os.homedir());
  var settingsStore = store.createSettingsStore({ fs: fs, dir: dataDir });
  var licenseStore = W.lib('license.js').createLicenseStore({ fs: fs, dir: dataDir });
  var rpc = W.rpcClient();
  var host = W.hostName();
  var RELOAD_TIMEOUT_MS = 2000;

  var draft = settingsStore.load();
  var searches = { allowed: '', ignored: '' };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text, isError) {
    $('status').textContent = text || '';
    $('status').classList.toggle('error', !!isError);
  }

  function update(patch) {
    draft = Object.assign({}, draft, patch);
  }

  /* ----- tabs ----- */

  function selectTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var on = tab.getAttribute('data-tab') === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      $('panel-' + tab.getAttribute('data-tab')).hidden = !on;
    });
    setStatus('');
  }

  /* ----- General ----- */

  function checkRow(key, labelKey, hintKey) {
    return UI.el('label', { class: 'check-row' }, [
      UI.el('input', {
        type: 'checkbox',
        checked: !!draft[key],
        onchange: function (e) {
          var patch = {};
          patch[key] = e.target.checked;
          update(patch);
        }
      }),
      UI.el('span', { class: 'text', text: t(labelKey) }),
      hintKey ? UI.el('p', { class: 'hint', text: t(hintKey) }) : null
    ]);
  }

  function psdRow() {
    var select = UI.el('select', {
      class: 'field',
      'aria-label': t('settings.psdImportAs'),
      onchange: function (e) {
        update({ psdImportAs: e.target.value });
      }
    }, store.PSD_IMPORT_AS.map(function (value) {
      return UI.el('option', { value: value, text: t('settings.psd.' + value), selected: draft.psdImportAs === value });
    }));
    return UI.el('div', { class: 'select-row' }, [UI.el('span', { text: t('settings.psdImportAs') }), select]);
  }

  function licenseSection() {
    var status = licenseStore.status();
    var text = UI.el('span', {
      text: status.activated ? t('settings.license.active', { machine: status.machine }) : t('settings.license.none')
    });
    var button = UI.el('button', {
      class: 'btn',
      disabled: !status.activated,
      text: t('settings.license.deactivate'),
      onclick: function () {
        try {
          licenseStore.deactivate();
          renderGeneral();
        } catch (e) {
          setStatus(e.message, true);
        }
      }
    });
    return UI.el('div', { class: 'section' }, [
      UI.el('h3', { text: t('settings.license') }),
      UI.el('div', { class: 'license-row' }, [text, button])
    ]);
  }

  function renderGeneral() {
    var box = $('panel-general');
    UI.clear(box);
    if (host === 'AEFT') {
      box.appendChild(psdRow());
      box.appendChild(checkRow('showNotifications', 'settings.showNotifications'));
    } else {
      box.appendChild(checkRow('showImportOptions', 'settings.showImportOptions', 'settings.showImportOptions.hint'));
      box.appendChild(checkRow('addImportDate', 'settings.addImportDate', 'settings.addImportDate.hint'));
      box.appendChild(checkRow('showNotifications', 'settings.showNotifications'));
      box.appendChild(checkRow('jumper', 'settings.jumper', 'settings.jumper.hint'));
    }
    box.appendChild(licenseSection());
  }

  /* ----- Allowed Files / Ignored Folders ----- */

  var LISTS = {
    allowed: {
      key: 'allowedExtensions',
      display: function (e) {
        return '.' + e;
      },
      parse: function (raw) {
        var ext = extensions.normalizeExt(raw);
        return ext ? { value: ext } : { error: t('settings.invalidExt') };
      },
      same: function (a, b) {
        return a === b;
      },
      sort: true
    },
    ignored: {
      key: 'ignoredFolders',
      display: function (e) {
        return e;
      },
      parse: function (raw) {
        var rule = ignore.parseRule(raw);
        if (rule.kind === 'invalid') return { error: t('settings.invalidRegex', { error: rule.error }) };
        return { value: rule.source };
      },
      same: function (a, b) {
        return a.toLowerCase() === b.toLowerCase();
      },
      sort: false
    }
  };

  function renderList(kind) {
    var spec = LISTS[kind];
    var needle = searches[kind].trim().toLowerCase();
    var list = $(kind + '-list');
    UI.clear(list);
    draft[spec.key]
      .filter(function (entry) {
        return !needle || spec.display(entry).toLowerCase().indexOf(needle) >= 0;
      })
      .forEach(function (entry) {
        var isRegex = kind === 'ignored' && ignore.parseRule(entry).kind === 'regex';
        list.appendChild(UI.el('li', {}, [
          UI.el('span', { class: 'value', text: spec.display(entry), title: spec.display(entry) }),
          isRegex ? UI.el('span', { class: 'tag', text: 'regex' }) : null,
          UI.el('button', {
            class: 'icon-btn',
            title: t('settings.remove'),
            'aria-label': t('settings.remove') + ' ' + spec.display(entry),
            onclick: function () {
              var patch = {};
              patch[spec.key] = draft[spec.key].filter(function (e) {
                return e !== entry;
              });
              update(patch);
              renderList(kind);
            }
          }, [UI.icon('close')])
        ]));
      });
  }

  function addEntry(kind) {
    var spec = LISTS[kind];
    var input = $(kind + '-add');
    var parsed = spec.parse(input.value);
    if (parsed.error) {
      setStatus(parsed.error, true);
      return;
    }
    var exists = draft[spec.key].some(function (e) {
      return spec.same(e, parsed.value);
    });
    if (exists) {
      setStatus(t('settings.duplicate'), true);
      return;
    }
    var next = draft[spec.key].concat([parsed.value]);
    var patch = {};
    patch[spec.key] = spec.sort ? next.sort() : next;
    update(patch);
    input.value = '';
    setStatus('');
    renderList(kind);
  }

  /* ----- save / close ----- */

  function save() {
    try {
      settingsStore.save(draft);
    } catch (e) {
      setStatus(t('settings.saveFailed', { error: e.message }), true);
      return;
    }
    // The engine rereads settings; if it is not running it will on start.
    rpc.call('reloadSettings', {}, RELOAD_TIMEOUT_MS).then(W.close, W.close);
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        selectTab(tab.getAttribute('data-tab'));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.add-form'), function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        addEntry(form.getAttribute('data-kind'));
      });
    });
    ['allowed', 'ignored'].forEach(function (kind) {
      $(kind + '-search').addEventListener('input', function (e) {
        searches[kind] = e.target.value;
        renderList(kind);
      });
    });
    $('okBtn').addEventListener('click', save);
    $('cancelBtn').addEventListener('click', function () {
      W.close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') W.close();
    });
  }

  W.watchTheme();
  W.localize();
  wire();
  renderGeneral();
  renderList('allowed');
  renderList('ignored');
  selectTab('general');
})();
