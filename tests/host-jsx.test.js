'use strict';

// Runs the real ExtendScript files in a Node VM against small mock object
// models of Premiere Pro and After Effects. This checks the scripts' logic
// and ES3 compatibility; it cannot prove the real host APIs behave the same.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HOST_DIR = path.join(__dirname, '..', 'host');

function load(ctx, files) {
  vm.createContext(ctx);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(HOST_DIR, f), 'utf8'), ctx, { filename: f }));
  return (method, args) => JSON.parse(ctx.WT_call(method, JSON.stringify(args || {})));
}

function mockXMP() {
  function XMPMeta(packet) {
    this.props = packet ? JSON.parse(packet) : {};
  }
  XMPMeta.prototype.doesPropertyExist = function (ns, f) {
    return Object.prototype.hasOwnProperty.call(this.props, ns + f);
  };
  XMPMeta.prototype.getProperty = function (ns, f) {
    return { value: this.props[ns + f] };
  };
  XMPMeta.prototype.setProperty = function (ns, f, v) {
    this.props[ns + f] = String(v);
  };
  XMPMeta.prototype.serialize = function () {
    return JSON.stringify(this.props);
  };
  XMPMeta.registerNamespace = function () {};
  return XMPMeta;
}

function pproMock() {
  let nextId = 1;
  const T = { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 };
  function makeItem(type, name, mediaPath) {
    const item = {
      nodeId: String(nextId++),
      type,
      name,
      kids: [],
      meta: '',
      colour: -1,
      refreshed: 0,
      get children() {
        const arr = item.kids.slice();
        arr.numItems = arr.length;
        return arr;
      },
      createBin(n) {
        const b = makeItem(T.BIN, n);
        item.kids.push(b);
        return b;
      },
      getMediaPath: () => mediaPath || '',
      isSequence: () => false,
      getProjectMetadata: () => item.meta,
      setProjectMetadata: (xml) => {
        item.meta = xml;
      },
      setColorLabel: (l) => {
        item.colour = l;
      },
      refreshMedia: () => {
        item.refreshed += 1;
      }
    };
    return item;
  }
  const root = makeItem(T.ROOT, 'root');
  const project = {
    documentID: 'doc-1',
    name: 'Show.prproj',
    path: '/proj/Show.prproj',
    rootItem: root,
    schema: [],
    imports: [],
    addPropertyToProjectMetadataSchema(n) {
      this.schema.push(n);
      return true;
    },
    importFiles(paths, suppressUI, bin, stills) {
      this.imports.push({ paths, suppressUI, stills });
      paths.forEach((p) => bin.kids.push(makeItem(T.CLIP, p.split('/').pop(), p)));
      return true;
    }
  };
  const app = {
    projects: { numProjects: 1, 0: project },
    project,
    version: '26.0',
    messages: [],
    selection: [],
    setSDKEventMessage(m) {
      this.messages.push(m);
    },
    getCurrentProjectViewSelection() {
      return this.selection;
    }
  };
  const ctx = { app, ProjectItemType: T, XMPMeta: mockXMP(), ExternalObject: { AdobeXMPScript: {} } };
  return { ctx, app, project, root, makeItem, T };
}

function binNamed(parent, name) {
  return parent.kids.filter((k) => k.type === 2 && k.name === name)[0];
}

test('WTJSON matches JSON for tricky values and rejects malformed input', () => {
  const ctx = {};
  load(ctx, ['json.jsx']);
  const value = { s: 'quote " back \\ nl \n tab \t ctl \u0001 sep \u2028 π 한', n: [-1.5e3, 0, 42], b: [true, false, null], o: {} };
  const text = ctx.WTJSON.stringify(value);
  assert.deepEqual(JSON.parse(text), value);
  // Values built inside the VM belong to another realm; compare plain copies.
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.WTJSON.parse(JSON.stringify(value)))), value);
  assert.equal(ctx.WTJSON.stringify({ u: undefined, f() {}, x: Infinity }), '{"x":null}');
  ['{', '{"a" 1}', '[1,]', '"open', '{"a":1} x', 'nope'].forEach((bad) =>
    assert.throws(() => ctx.WTJSON.parse(bad), undefined, bad)
  );
});

test('WT_call wraps results and errors in an envelope', () => {
  const m = pproMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'ppro.jsx']);
  assert.equal(call('nope').ok, false);
  assert.match(call('nope').error, /Unknown method/);
  const bad = JSON.parse(m.ctx.WT_call('env', '{broken'));
  assert.equal(bad.ok, false);
});

test('Premiere: env lists open projects', () => {
  const m = pproMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'ppro.jsx']);
  const env = call('env').data;
  assert.equal(env.host, 'PPRO');
  assert.equal(env.activeId, 'doc-1');
  assert.deepEqual(env.projects, [{ id: 'doc-1', name: 'Show.prproj', path: '/proj/Show.prproj', cloud: false }]);
});

test('Premiere: config is stored on the linked bin and read back', () => {
  const m = pproMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'ppro.jsx']);
  const root = { id: 'r1', name: 'Footage', path: '../Footage', settings: { rel: true }, children: [] };
  const saved = call('saveConfig', { projectId: 'doc-1', autoSync: true, savedAt: '2026-09-28T10:00:00.000Z', roots: [root] }).data;
  assert.equal(saved.supported, true);
  assert.equal(call('loadConfig', { projectId: 'doc-1' }).data.config.savedAt, '2026-09-28T10:00:00.000Z');
  const bin = binNamed(m.root, 'Footage');
  assert.ok(bin, 'root bin created');
  assert.deepEqual(saved.roots, [{ id: 'r1', bin: { ref: bin.nodeId, name: 'Footage' } }]);
  assert.deepEqual(m.project.schema, ['WatchtowerConfig']);

  bin.name = 'Footage (renamed)';
  const loaded = call('loadConfig', { projectId: 'doc-1' }).data;
  assert.equal(loaded.supported, true);
  assert.equal(loaded.config.autoSync, true);
  assert.equal(loaded.config.roots[0].path, '../Footage');
  assert.deepEqual(loaded.config.roots[0].bin, { ref: bin.nodeId, name: 'Footage (renamed)' }, 'link survives renames');

  call('saveConfig', { projectId: 'doc-1', autoSync: true, roots: [] });
  assert.deepEqual(call('loadConfig', { projectId: 'doc-1' }).data.config.roots, [], 'removed roots are unlinked');
});

test('Premiere: two roots with the same folder name get separate bins', () => {
  const m = pproMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'ppro.jsx']);
  const roots = [
    { id: 'a', name: 'Audio', path: '/x/Audio', children: [] },
    { id: 'b', name: 'Audio', path: '/y/Audio', children: [] }
  ];
  const saved = call('saveConfig', { projectId: 'doc-1', autoSync: false, roots }).data;
  assert.notEqual(saved.roots[0].bin.ref, saved.roots[1].bin.ref);
});

test('Premiere: a bin without working metadata reports storage unsupported', () => {
  const m = pproMock();
  m.ctx.XMPMeta = function () {
    throw new Error('no XMP');
  };
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'ppro.jsx']);
  const saved = call('saveConfig', { projectId: 'doc-1', roots: [{ id: 'a', name: 'A', path: '/a', children: [] }] }).data;
  assert.equal(saved.supported, false);
  assert.equal(saved.roots.length, 1, 'bins are still created');
  assert.equal(call('loadConfig', { projectId: 'doc-1' }).data.supported, false);
});

test('Premiere: importBatch mirrors bins, labels, dates and sequences', () => {
  const m = pproMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'ppro.jsx']);
  const res = call('importBatch', {
    projectId: 'doc-1',
    options: { showImportOptions: true, importDate: true },
    bins: [{ rootId: 'r', rootRef: null, rootName: 'Media', sub: ['Empty'], label: 13 }],
    groups: [
      { rootId: 'r', rootRef: null, rootName: 'Media', sub: ['Day1'], label: 4, files: ['/m/Day1/a.mov', '/m/Day1/art.psd'], sequences: ['/m/Day1/f_001.exr'] }
    ],
    refresh: []
  }).data;
  assert.equal(res.imported, 3);
  assert.equal(res.rootBins.length, 1, 'missing root bin was created and reported');
  const media = binNamed(m.root, 'Media');
  assert.equal(binNamed(media, 'Empty').colour, 13);
  const day1 = binNamed(media, 'Day1');
  assert.deepEqual(day1.kids.map((k) => k.colour), [4, 4, 4]);
  assert.deepEqual(
    m.project.imports.map((i) => [i.paths.length, i.suppressUI, i.stills]),
    [[1, true, false], [1, false, false], [1, true, true]],
    'PSDs show the import dialog; sequences import as numbered stills'
  );
  assert.ok(m.project.schema.indexOf('WatchtowerImportDate') >= 0);
  assert.match(JSON.parse(day1.kids[0].meta)[m.ctx.WT.PPRO_NS + 'WatchtowerImportDate'], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.deepEqual(res.importedPaths.sort(), ['/m/Day1/a.mov', '/m/Day1/art.psd', '/m/Day1/f_001.exr']);
});

test('Premiere: mediaItems, refresh and existing root bins', () => {
  const m = pproMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'ppro.jsx']);
  const bin = m.root.createBin('Media');
  const clip = m.makeItem(1, 'seq', '/m/seq_001.exr');
  bin.kids.push(clip);
  assert.deepEqual(call('mediaItems', { projectId: 'doc-1' }).data, [{ p: '/m/seq_001.exr', id: clip.nodeId }]);
  const res = call('importBatch', {
    projectId: 'doc-1',
    options: {},
    bins: [],
    groups: [{ rootId: 'r', rootRef: bin.nodeId, rootName: 'Media', sub: [], label: -1, files: ['/m/b.mov'], sequences: [] }],
    refresh: [clip.nodeId]
  }).data;
  assert.equal(res.refreshed, 1);
  assert.equal(clip.refreshed, 1);
  assert.deepEqual(res.rootBins, []);
  assert.equal(bin.kids.length, 2);
});

test('Premiere: selected bins report their first media file and depth', () => {
  const m = pproMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'ppro.jsx']);
  const music = m.root.createBin('Music');
  const rock = music.createBin('Rock');
  rock.kids.push(m.makeItem(1, 'song', '/lib/Music/Rock/song.wav'));
  const empty = m.root.createBin('Empty');
  m.app.selection = [music, empty, m.makeItem(1, 'clip', '/x.mov')];
  const res = call('selectedBins').data;
  assert.deepEqual(res.bins, [
    { ref: music.nodeId, name: 'Music', file: '/lib/Music/Rock/song.wav', depth: 1 },
    { ref: empty.nodeId, name: 'Empty', file: '', depth: 0 }
  ]);
  call('notify', { message: 'hello' });
  assert.deepEqual(m.app.messages, ['hello']);
  assert.equal(call('loadConfig', { projectId: 'other' }).ok, false);
});

function aeMock() {
  let nextId = 1;
  const all = [];
  class Item {
    constructor(name) {
      this.id = nextId++;
      this.name = name;
      this.parentFolder = null;
      this.label = 0;
    }
  }
  class FolderItem extends Item {
    get numItems() {
      return all.filter((i) => i.parentFolder === this).length;
    }
    item(k) {
      return all.filter((i) => i.parentFolder === this)[k - 1];
    }
  }
  class File {
    constructor(p) {
      this.fsName = p.replace(/%25/g, '%');
      this.name = this.fsName.split('/').pop();
      this.displayName = this.name;
      this.exists = true;
    }
  }
  class FootageItem extends Item {
    constructor(file) {
      super(file.name);
      this.file = file;
      this.reloaded = 0;
      this.mainSource = { reload: () => (this.reloaded += 1) };
    }
  }
  const ImportAsType = { FOOTAGE: 'footage', COMP: 'comp', COMP_CROPPED_LAYERS: 'cropped' };
  class ImportOptions {
    constructor(file) {
      this.file = file;
      this.sequence = false;
      this.importAs = null;
    }
    canImportAs() {
      return true;
    }
  }
  const rootFolder = new FolderItem('root');
  const track = (item) => {
    all.push(item);
    return item;
  };
  const output = [];
  const project = {
    file: new File('/proj/Show.aep'),
    rootFolder,
    xmpPacket: '',
    selection: [],
    get numItems() {
      return all.length;
    },
    item: (i) => all[i - 1],
    itemByID(id) {
      const hit = all.filter((i) => i.id === id)[0];
      if (!hit) throw new Error('no item');
      return hit;
    },
    items: {
      addFolder(n) {
        const f = track(new FolderItem(n));
        f.parentFolder = rootFolder;
        return f;
      }
    },
    importFile(io) {
      const it = track(new FootageItem(io.file));
      it.parentFolder = rootFolder;
      it.sequence = io.sequence;
      it.importAs = io.importAs;
      if (io.importAs === 'comp') {
        const layers = track(new FolderItem(it.name + ' Layers'));
        layers.parentFolder = rootFolder;
      }
      return it;
    }
  };
  const app = {
    project,
    version: '25.0',
    undo: [],
    beginUndoGroup(n) {
      this.undo.push(n);
    },
    endUndoGroup() {
      this.undo.push('end');
    }
  };
  const ctx = {
    app,
    File,
    FolderItem,
    FootageItem,
    ImportOptions,
    ImportAsType,
    XMPMeta: mockXMP(),
    ExternalObject: { AdobeXMPScript: {} },
    clearOutput: () => output.splice(0),
    writeLn: (s) => output.push(s)
  };
  return { ctx, app, project, all, rootFolder, output, track, FootageItem, FolderItem, File };
}

test('After Effects: config round-trips through the project XMP packet', () => {
  const m = aeMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'aeft.jsx']);
  const env = call('env').data;
  assert.deepEqual(env.projects, [{ id: '/proj/Show.aep', name: 'Show.aep', path: '/proj/Show.aep', cloud: false }]);
  assert.equal(call('loadConfig', { projectId: env.activeId }).data.config, null);
  const saved = call('saveConfig', {
    projectId: env.activeId,
    autoSync: true,
    savedAt: '2026-09-28T10:00:00.000Z',
    roots: [{ id: 'r', name: 'Renders', path: '/r', children: [] }]
  }).data;
  assert.equal(saved.supported, true);
  const loaded = call('loadConfig', { projectId: env.activeId }).data.config;
  assert.equal(loaded.autoSync, true);
  assert.equal(loaded.savedAt, '2026-09-28T10:00:00.000Z');
  assert.equal(loaded.roots[0].bin.ref, saved.roots[0].bin.ref);
  assert.equal(call('loadConfig', { projectId: '/other.aep' }).ok, false);
});

test('After Effects: imports land in mirrored folders with labels and PSD options', () => {
  const m = aeMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'aeft.jsx']);
  const res = call('importBatch', {
    projectId: '/proj/Show.aep',
    options: { psdImportAs: 'composition' },
    bins: [],
    groups: [{ rootId: 'r', rootRef: null, rootName: 'Renders', sub: ['v01'], label: 9, files: ['/r/v01/100%.mov', '/r/v01/art.psd'], sequences: ['/r/v01/f_001.exr'] }],
    refresh: []
  }).data;
  assert.equal(res.imported, 3);
  assert.deepEqual(m.app.undo, ['Watchtower Sync', 'end']);
  const footage = m.all.filter((i) => i instanceof m.FootageItem);
  const v01 = footage[0].parentFolder;
  assert.equal(v01.name, 'v01');
  assert.equal(v01.parentFolder.name, 'Renders');
  assert.ok(footage.every((f) => f.parentFolder === v01 && f.label === 9));
  assert.equal(footage[0].file.fsName, '/r/v01/100%.mov', 'percent signs survive File()');
  assert.equal(footage.filter((f) => f.importAs === 'comp').length, 1);
  assert.equal(footage.filter((f) => f.sequence).length, 1);
  const layers = m.all.filter((i) => i.name === 'art.psd Layers')[0];
  assert.equal(layers.parentFolder, v01, 'layer folders move with their comp');
});

test('After Effects: media items, refresh, notifications and selection', () => {
  const m = aeMock();
  const call = load(m.ctx, ['json.jsx', 'common.jsx', 'aeft.jsx']);
  const folder = m.project.items.addFolder('Music');
  const inner = m.project.items.addFolder('Rock');
  inner.parentFolder = folder;
  const song = m.track(new m.FootageItem(new m.File('/lib/Music/Rock/song.wav')));
  song.parentFolder = inner;
  assert.deepEqual(call('mediaItems', { projectId: '/proj/Show.aep' }).data, [{ p: '/lib/Music/Rock/song.wav', id: String(song.id) }]);
  const res = call('importBatch', { projectId: '/proj/Show.aep', options: {}, bins: [], groups: [], refresh: [String(song.id), '999'] }).data;
  assert.equal(res.refreshed, 1);
  call('notify', { message: 'Watchtower: done' });
  assert.deepEqual(m.output, ['Watchtower: done']);
  m.project.selection = [folder, song];
  assert.deepEqual(call('selectedBins').data.bins, [
    { ref: String(folder.id), name: 'Music', file: '/lib/Music/Rock/song.wav', depth: 1 }
  ]);
});
