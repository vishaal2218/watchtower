/* Watch-folders manager: edit a draft of every open project's watch folders,
   then hand the result to the engine on Ok. Cancel discards the draft. */
(function () {
  'use strict';

  var W = window.WTCEP;
  var UI = window.WTUI;
  var C = W.C;
  var t = W.t;
  var fs = require('fs');
  var os = require('os');
  var tree = W.lib('tree.js');
  var model = W.lib('manager-model.js');
  var builder = W.lib('tree-builder.js');
  var fsScan = W.lib('fs-scan.js');
  var paths = W.lib('paths.js');
  var labels = W.lib('labels.js');
  var camera = W.lib('camera.js');
  var ignore = W.lib('ignore.js');
  var store = W.lib('settings-store.js');
  var drives = W.lib('drives.js');

  var rpc = W.rpcClient();
  var host = W.hostName();
  var platform = paths.currentPlatform();
  var driveResolver = drives.createDriveResolver();
  var dataDir = store.dataDir(process.platform, process.env, os.homedir());
  var ignoreRules = ignore.compileRules(store.createSettingsStore({ fs: fs, dir: dataDir }).load().ignoredFolders);
  var SAVE_TIMEOUT_MS = 30000;
  var INDENT_PX = 16;

  var ui = {
    loaded: false,
    busy: false,
    projects: [],
    activeId: null,
    originals: {},
    drafts: {},
    scope: 'all',
    search: '',
    expanded: new Set(),
    selectedId: null
  };
  var rows = [];

  function $(id) {
    return document.getElementById(id);
  }

  function projectById(id) {
    return ui.projects.filter(function (p) {
      return p.id === id;
    })[0] || null;
  }

  function projectDir(project) {
    return project && !project.cloud ? project.dir : '';
  }

  function targetProjectId() {
    if (ui.scope !== 'all') return ui.scope;
    if (projectById(ui.activeId)) return ui.activeId;
    return ui.projects.length ? ui.projects[0].id : null;
  }

  function setStatus(text, isError) {
    $('status').textContent = text || '';
    $('status').classList.toggle('error', !!isError);
  }

  function setDraft(projectId, roots) {
    var next = Object.assign({}, ui.drafts);
    next[projectId] = roots;
    ui.drafts = next;
    render();
  }

  /* ----- adding, relinking, editing ----- */

  function addFolder(projectId, rawPath, bin) {
    var project = projectById(projectId);
    if (!project) {
      setStatus(t('manager.noProject'), true);
      return;
    }
    var abs = driveResolver.resolve(rawPath);
    if (!fsScan.isDirectory(fs, abs)) {
      setStatus(t('manager.notFolder', { path: abs }), true);
      return;
    }
    var roots = ui.drafts[projectId] || [];
    var problem = model.validateNewFolder(roots, abs, projectDir(project), platform);
    if (problem) {
      setStatus(t(problem, { path: abs }), true);
      return;
    }
    var root = builder.buildRoot(fs, abs, {
      ignoreRules: ignoreRules,
      relative: false,
      projectDir: projectDir(project),
      platform: platform,
      bin: bin || undefined
    });
    ui.expanded.add(root.id);
    ui.selectedId = root.id;
    setStatus(bin ? t('manager.linkedBin', { name: bin.name }) : '');
    setDraft(projectId, roots.concat([root]));
  }

  function chooseAndAdd() {
    var projectId = targetProjectId();
    if (!projectId) {
      setStatus(t('manager.noProject'), true);
      return;
    }
    W.chooseFolders(t('manager.chooseFolder'), true).forEach(function (p) {
      addFolder(projectId, p, null);
    });
  }

  function applyPrefill(entries) {
    (entries || []).forEach(function (entry) {
      var projectId = entry.projectId && projectById(entry.projectId) ? entry.projectId : targetProjectId();
      var bin = entry.bin && entry.bin.ref ? { ref: String(entry.bin.ref), name: String(entry.bin.name || '') } : null;
      var folder = typeof entry.path === 'string' && fsScan.isDirectory(fs, entry.path) ? entry.path : '';
      if (!folder && bin) folder = W.chooseFolders(t('manager.chooseForBin', { name: bin.name }), false)[0] || '';
      if (folder) addFolder(projectId, folder, bin);
    });
  }

  function changeSetting(row, key, value) {
    var project = projectById(row.projectId);
    var roots = ui.drafts[row.projectId];
    if (key === 'rel') {
      var res = model.setRelative(roots, row.node.id, value, projectDir(project), platform);
      if (res.error) {
        setStatus(t(res.error), true);
        render();
        return;
      }
      setStatus('');
      setDraft(row.projectId, res.roots);
      return;
    }
    var patch = {};
    patch[key] = value;
    setDraft(row.projectId, tree.updateSettings(roots, row.node.id, patch));
  }

  function relinkRow(row) {
    var picked = W.chooseFolders(t('manager.chooseRelink'), false)[0];
    if (!picked) return;
    var project = projectById(row.projectId);
    var res = model.relink(ui.drafts[row.projectId], row.node.id, driveResolver.resolve(picked), projectDir(project), platform);
    if (res.error) {
      setStatus(t(res.error), true);
      return;
    }
    setStatus('');
    setDraft(row.projectId, res.roots);
  }

  function removeRow(row) {
    setDraft(row.projectId, tree.removeNode(ui.drafts[row.projectId], row.node.id));
  }

  /** Toggle one row; with Option/Alt held, expand or collapse every row. */
  function toggleExpand(nodeId, all) {
    var open = !ui.expanded.has(nodeId);
    if (!all) {
      if (open) ui.expanded.add(nodeId);
      else ui.expanded.delete(nodeId);
    } else {
      Object.keys(ui.drafts).forEach(function (pid) {
        tree.walk(ui.drafts[pid], function (n) {
          if (open) ui.expanded.add(n.id);
          else ui.expanded.delete(n.id);
        });
      });
    }
    render();
  }

  /* ----- rendering ----- */

  function labelCell(row) {
    var current = row.node.settings.label;
    var colour = labels.labelColor(host, current);
    var swatch = UI.el('span', { class: 'swatch' + (colour ? '' : ' none'), style: colour ? 'background:' + colour : '' });
    var options = [UI.el('option', { value: '-1', text: t('label.none'), selected: current < 0 })].concat(
      labels.labelsFor(host).map(function (l) {
        return UI.el('option', { value: String(l.index), text: l.name, selected: l.index === current });
      })
    );
    var select = UI.el('select', {
      class: 'field label-select',
      'aria-label': t('manager.col.label'),
      disabled: row.inactive,
      onclick: function (e) {
        e.stopPropagation();
      },
      onchange: function (e) {
        changeSetting(row, 'label', parseInt(e.target.value, 10));
      }
    }, options);
    return UI.el('div', { class: 'c-label' }, [swatch, select]);
  }

  function checkCell(row, key) {
    return UI.el('div', { class: 'c-check' }, [
      UI.el('input', {
        type: 'checkbox',
        checked: !!row.node.settings[key],
        disabled: row.inactive,
        title: t('manager.tip.' + key),
        'aria-label': t('manager.col.' + key),
        onclick: function (e) {
          e.stopPropagation();
        },
        onchange: function (e) {
          changeSetting(row, key, e.target.checked);
        }
      })
    ]);
  }

  function nameCell(row) {
    var n = row.node;
    var chevron = row.hasChildren
      ? UI.el('button', {
          class: 'chev' + (row.expanded ? ' open' : ''),
          'aria-label': n.name,
          tabindex: '-1',
          onclick: function (e) {
            e.stopPropagation();
            toggleExpand(n.id, e.altKey);
          }
        }, [UI.icon('chevron')])
      : UI.el('span', { class: 'chev-space' });
    var cams = camera.cameraNames(n.settings.cameras);
    var badges = [];
    if (cams.length) badges.push(UI.el('span', { class: 'badge', title: t('manager.camera', { names: cams.join(', ') }), text: cams[0] }));
    if (row.isRoot && n.bin) badges.push(UI.el('span', { class: 'badge', title: t('manager.linkedBin', { name: n.bin.name }), text: n.bin.name }));
    return UI.el('div', { class: 'c-name', style: 'padding-left:' + row.depth * INDENT_PX + 'px' }, [
      chevron,
      UI.icon('folder', 'folder-ic'),
      UI.el('span', { class: 'name-text', title: n.name, text: n.name })
    ].concat(badges));
  }

  function nodeRow(row) {
    var n = row.node;
    var classes = ['row', 'grid'];
    if (ui.selectedId === n.id) classes.push('selected');
    if (row.inactive) classes.push('inactive');
    if (!row.online) classes.push('offline');
    return UI.el('div', {
      class: classes.join(' '),
      role: 'row',
      'aria-level': String(row.depth + 1),
      'aria-expanded': row.hasChildren ? String(row.expanded) : null,
      'data-id': n.id,
      onclick: function () {
        ui.selectedId = n.id;
        render();
      }
    }, [
      UI.el('div', { class: 'c-state' }, [
        UI.el('span', { class: 'dot ' + (row.online ? 'online' : 'offline'), title: t(row.online ? 'manager.online' : 'manager.offline') })
      ]),
      nameCell(row),
      UI.el('button', {
        class: 'path c-path',
        title: (row.abs || row.display) + '\n' + t('manager.tip.relink'),
        onclick: function (e) {
          e.stopPropagation();
          relinkRow(row);
        }
      }, [UI.el('span', { text: row.display })]),
      checkCell(row, 'sub'),
      checkCell(row, 'rel'),
      checkCell(row, 'seq'),
      checkCell(row, 'flt'),
      labelCell(row),
      UI.el('button', {
        class: 'icon-btn remove',
        title: t('manager.tip.remove'),
        'aria-label': t('manager.tip.remove'),
        onclick: function (e) {
          e.stopPropagation();
          removeRow(row);
        }
      }, [UI.icon('close')])
    ]);
  }

  function projectRow(row) {
    return UI.el('div', { class: 'project-row' }, [
      UI.el('span', { text: row.project.name }),
      UI.el('span', { class: 'count', text: '(' + row.count + ')' })
    ]);
  }

  function render() {
    rows = model.buildRows(ui.projects, ui.drafts, {
      scope: ui.scope,
      search: ui.search,
      expanded: ui.expanded,
      platform: platform,
      isDirectory: function (abs) {
        return fsScan.isDirectory(fs, abs);
      }
    });
    var box = $('rows');
    var scrollTop = box.scrollTop;
    UI.clear(box);
    if (!rows.length) {
      box.appendChild(UI.el('div', { class: 'empty', text: t(ui.search ? 'manager.noMatch' : 'manager.empty') }));
    } else {
      rows.forEach(function (row) {
        box.appendChild(row.kind === 'project' ? projectRow(row) : nodeRow(row));
      });
    }
    box.scrollTop = scrollTop;
    $('okBtn').disabled = ui.busy || !ui.loaded;
    $('addBtn').disabled = ui.busy || !ui.loaded;
  }

  function renderScope() {
    var select = $('scope');
    UI.clear(select);
    select.appendChild(UI.el('option', { value: 'all', text: t('manager.allProjects') }));
    ui.projects.forEach(function (p) {
      select.appendChild(UI.el('option', { value: p.id, text: p.name }));
    });
    select.value = ui.scope;
  }

  /* ----- keyboard navigation ----- */

  function nodeRows() {
    return rows.filter(function (r) {
      return r.kind === 'node';
    });
  }

  function selectIndex(list, i) {
    var row = list[Math.max(0, Math.min(list.length - 1, i))];
    if (!row) return;
    ui.selectedId = row.node.id;
    render();
    var el = $('rows').querySelector('[data-id="' + row.node.id + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function onRowsKey(e) {
    var list = nodeRows();
    var i = list.map(function (r) {
      return r.node.id;
    }).indexOf(ui.selectedId);
    var row = list[i];
    if (e.key === 'ArrowDown') selectIndex(list, i + 1);
    else if (e.key === 'ArrowUp') selectIndex(list, i < 0 ? 0 : i - 1);
    else if (e.key === 'ArrowRight' && row) {
      if (row.hasChildren && !row.expanded) toggleExpand(row.node.id, e.altKey);
      else if (row.hasChildren) selectIndex(list, i + 1);
    } else if (e.key === 'ArrowLeft' && row) {
      if (row.hasChildren && row.expanded) toggleExpand(row.node.id, e.altKey);
      else {
        for (var j = i - 1; j >= 0; j -= 1) {
          if (list[j].depth < row.depth) {
            selectIndex(list, j);
            break;
          }
        }
      }
    } else if ((e.key === ' ' || e.key === 'Enter') && row && row.hasChildren) toggleExpand(row.node.id, e.altKey);
    else return;
    e.preventDefault();
  }

  /* ----- save / close ----- */

  function save() {
    var ids = model.changedProjectIds(ui.originals, ui.drafts);
    if (!ids.length) {
      W.close();
      return;
    }
    ui.busy = true;
    render();
    rpc.call('saveConfigs', {
      projects: ids.map(function (id) {
        return { id: id, roots: ui.drafts[id] };
      })
    }, SAVE_TIMEOUT_MS).then(
      function () {
        W.close();
      },
      function (e) {
        ui.busy = false;
        setStatus(t('manager.saveFailed', { error: e.message }), true);
        render();
      }
    );
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
      var projectId = targetProjectId();
      UI.droppedPaths(e.dataTransfer).forEach(function (p) {
        if (fsScan.isDirectory(fs, p)) addFolder(projectId, p, null);
      });
    });
  }

  function wire() {
    $('search').addEventListener('input', function (e) {
      ui.search = e.target.value;
      render();
    });
    $('scope').addEventListener('change', function (e) {
      ui.scope = e.target.value;
      render();
    });
    $('rows').addEventListener('keydown', onRowsKey);
    $('addBtn').addEventListener('click', chooseAndAdd);
    $('okBtn').addEventListener('click', save);
    $('cancelBtn').addEventListener('click', function () {
      W.close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (document.activeElement === $('search') && ui.search) {
        $('search').value = '';
        ui.search = '';
        render();
        return;
      }
      W.close();
    });
    wireDrop();
    // Folders dropped on the main panel while this window is already open.
    W.transport.on(C.EVENTS.PREFILL, function () {
      if (ui.loaded) rpc.call('takePrefill').then(applyPrefill, function () {});
    });
  }

  function load() {
    W.ensureEngine(rpc)
      .then(function (ok) {
        if (!ok) throw new Error(t('panel.info.engineDown'));
        return rpc.call('getManagerData');
      })
      .then(function (data) {
        ui.projects = data.projects;
        ui.activeId = data.activeId;
        data.projects.forEach(function (p) {
          ui.originals[p.id] = p.roots;
          ui.drafts[p.id] = p.roots;
          p.roots.forEach(function (r) {
            ui.expanded.add(r.id);
          });
        });
        ui.loaded = true;
        renderScope();
        render();
        applyPrefill(data.prefill);
        // Entries queued while this window was still loading.
        return rpc.call('takePrefill').then(applyPrefill);
      })
      .catch(function (e) {
        setStatus(e.message, true);
      });
  }

  W.watchTheme();
  W.localize();
  $('searchIcon').appendChild(UI.icon('search'));
  $('addIcon').appendChild(UI.icon('folderPlus'));
  wire();
  render();
  load();
})();
