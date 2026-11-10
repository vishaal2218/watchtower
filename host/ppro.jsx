/* Premiere Pro host API. Each watched root's configuration is stored inside
   the project, in a custom project-metadata field on the bin it syncs into,
   so it travels with the project file (templates, Save As, other machines). */

WT.host = 'PPRO';
WT.PPRO_NS = 'http://ns.adobe.com/premierePrivateProjectMetaData/1.0/';
WT.CONFIG_FIELD = 'WatchtowerConfig';
WT.CONFIG_LABEL = 'Watchtower';
WT.DATE_FIELD = 'WatchtowerImportDate';
WT.DATE_LABEL = 'Import Date';
WT.STRING_TYPE = 2;

WT.pp = {
    schemaDone: {},

    projects: function () {
        var out = [];
        if (!app.projects) { return out; }
        for (var i = 0; i < app.projects.numProjects; i++) { out.push(app.projects[i]); }
        return out;
    },

    find: function (id) {
        var ps = WT.pp.projects();
        for (var i = 0; i < ps.length; i++) {
            if (String(ps[i].documentID) === String(id)) { return ps[i]; }
        }
        throw new Error('The project is no longer open.');
    },

    isBin: function (item) {
        return item.type === ProjectItemType.BIN;
    },

    isMedia: function (item) {
        return item.type === ProjectItemType.CLIP || item.type === ProjectItemType.FILE;
    },

    kids: function (item) {
        var out = [];
        var c = item.children;
        if (!c) { return out; }
        for (var i = 0; i < c.numItems; i++) { out.push(c[i]); }
        return out;
    },

    /* Depth-first walk; return false from fn to stop. */
    walk: function (item, fn, depth) {
        var kids = WT.pp.kids(item);
        for (var i = 0; i < kids.length; i++) {
            if (fn(kids[i], depth) === false) { return false; }
            if (WT.pp.isBin(kids[i]) && WT.pp.walk(kids[i], fn, depth + 1) === false) { return false; }
        }
        return true;
    },

    findById: function (project, ref, binsOnly) {
        var hit = null;
        if (ref === null || ref === undefined || ref === '') { return null; }
        WT.pp.walk(project.rootItem, function (it) {
            if (String(it.nodeId) === String(ref) && (!binsOnly || WT.pp.isBin(it))) {
                hit = it;
                return false;
            }
        }, 0);
        return hit;
    },

    childBin: function (parent, name, counter, claimed) {
        var kids = WT.pp.kids(parent);
        var i;
        for (i = 0; i < kids.length; i++) {
            if (WT.pp.isBin(kids[i]) && kids[i].name === name && !(claimed && claimed[kids[i].nodeId])) {
                return kids[i];
            }
        }
        var made = parent.createBin(name);
        if (counter) { counter.n++; }
        if (made && made.nodeId) { return made; }
        kids = WT.pp.kids(parent);
        for (i = kids.length - 1; i >= 0; i--) {
            if (WT.pp.isBin(kids[i]) && kids[i].name === name) { return kids[i]; }
        }
        throw new Error('Could not create bin "' + name + '".');
    },

    mediaPath: function (item) {
        try {
            if (typeof item.isSequence === 'function' && item.isSequence()) { return ''; }
            return String(item.getMediaPath() || '');
        } catch (e) {
            return '';
        }
    },

    ensureField: function (project, name, label) {
        var key = project.documentID + '|' + name;
        if (WT.pp.schemaDone[key]) { return; }
        project.addPropertyToProjectMetadataSchema(name, label, WT.STRING_TYPE);
        WT.pp.schemaDone[key] = true;
    },

    getMeta: function (item, field) {
        WT.ensureXMP();
        var xmp = new XMPMeta(item.getProjectMetadata());
        if (!xmp.doesPropertyExist(WT.PPRO_NS, field)) { return ''; }
        var prop = xmp.getProperty(WT.PPRO_NS, field);
        return prop ? String(prop.value) : '';
    },

    setMeta: function (item, field, value) {
        WT.ensureXMP();
        var xmp = new XMPMeta(item.getProjectMetadata());
        xmp.setProperty(WT.PPRO_NS, field, value);
        item.setProjectMetadata(xmp.serialize(), [field]);
    },

    label: function (item, label) {
        if (label === null || label === undefined || label < 0) { return; }
        try { item.setColorLabel(label); } catch (e) { /* older versions: labels unsupported on bins */ }
    },

    binRef: function (bin) {
        return { ref: String(bin.nodeId), name: bin.name };
    }
};

WT.api.env = function () {
    var ps = WT.pp.projects();
    var out = [];
    for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        var cloud = false;
        try { cloud = !!p.isCloudProject; } catch (e) { cloud = false; }
        out.push({ id: String(p.documentID), name: p.name, path: cloud ? '' : String(p.path || ''), cloud: cloud });
    }
    var active = null;
    try { active = app.project ? String(app.project.documentID) : null; } catch (e2) { active = null; }
    return { host: 'PPRO', version: String(app.version), activeId: active, projects: out };
};

WT.api.loadConfig = function (args) {
    var project = WT.pp.find(args.projectId);
    var roots = [];
    var autoSync = false;
    var savedAt = '';
    try {
        WT.pp.walk(project.rootItem, function (it) {
            if (!WT.pp.isBin(it)) { return; }
            var rec = WT.decodeRecord(WT.pp.getMeta(it, WT.CONFIG_FIELD));
            if (!rec || !rec.root) { return; }
            rec.root.bin = WT.pp.binRef(it);
            roots.push(rec.root);
            if (rec.autoSync) { autoSync = true; }
            if (rec.savedAt && String(rec.savedAt) > savedAt) { savedAt = String(rec.savedAt); }
        }, 0);
    } catch (e) {
        return { supported: false, config: null, error: WT.errorText(e) };
    }
    return { supported: true, config: { autoSync: autoSync, roots: roots, savedAt: savedAt } };
};

WT.api.saveConfig = function (args) {
    var project = WT.pp.find(args.projectId);
    var roots = args.roots || [];
    var out = [];
    var claimed = {};
    var supported = true;
    var counter = { n: 0 };

    try { WT.pp.ensureField(project, WT.CONFIG_FIELD, WT.CONFIG_LABEL); } catch (e) { supported = false; }

    for (var i = 0; i < roots.length; i++) {
        var root = roots[i];
        var bin = root.bin ? WT.pp.findById(project, root.bin.ref, true) : null;
        if (!bin) { bin = WT.pp.childBin(project.rootItem, root.name, counter, claimed); }
        claimed[bin.nodeId] = true;
        var stored = WT.copy(root);
        stored.bin = WT.pp.binRef(bin);
        if (supported) {
            try {
                var encoded = WT.encodeRecord({ v: 1, autoSync: !!args.autoSync, savedAt: String(args.savedAt || ''), root: stored });
                WT.pp.setMeta(bin, WT.CONFIG_FIELD, encoded);
                if (WT.pp.getMeta(bin, WT.CONFIG_FIELD) !== encoded) { supported = false; }
            } catch (e2) {
                supported = false;
            }
        }
        out.push({ id: root.id, bin: WT.pp.binRef(bin) });
    }

    /* Unlink bins that no longer back a watch folder. */
    if (supported) {
        try {
            WT.pp.walk(project.rootItem, function (it) {
                if (WT.pp.isBin(it) && !claimed[it.nodeId] && WT.pp.getMeta(it, WT.CONFIG_FIELD) !== '') {
                    WT.pp.setMeta(it, WT.CONFIG_FIELD, '');
                }
            }, 0);
        } catch (e3) { /* leave stale records; they are ignored on load if unreadable */ }
    }
    return { supported: supported, roots: out };
};

WT.api.mediaItems = function (args) {
    var project = WT.pp.find(args.projectId);
    var out = [];
    WT.pp.walk(project.rootItem, function (it) {
        if (!WT.pp.isMedia(it)) { return; }
        var p = WT.pp.mediaPath(it);
        if (p) { out.push({ p: p, id: String(it.nodeId) }); }
    }, 0);
    return out;
};

WT.api.importBatch = function (args) {
    var project = WT.pp.find(args.projectId);
    var opts = args.options || {};
    var res = { imported: 0, binsCreated: 0, refreshed: 0, errors: [], importedPaths: [], rootBins: [] };
    var counter = { n: 0 };
    var rootCache = {};
    var i;
    var j;

    function rootBin(rootId, rootRef, rootName) {
        if (rootCache[rootId]) { return rootCache[rootId]; }
        var b = WT.pp.findById(project, rootRef, true);
        if (!b) {
            b = WT.pp.childBin(project.rootItem, rootName, counter, null);
            res.rootBins.push({ rootId: rootId, bin: WT.pp.binRef(b) });
        }
        rootCache[rootId] = b;
        return b;
    }

    function target(spec) {
        var b = rootBin(spec.rootId, spec.rootRef, spec.rootName);
        for (var k = 0; k < spec.sub.length; k++) { b = WT.pp.childBin(b, spec.sub[k], counter, null); }
        return b;
    }

    function tryImport(paths, suppressUI, bin, asStills) {
        if (!paths.length) { return; }
        try {
            project.importFiles(paths, suppressUI, bin, asStills);
        } catch (e) {
            res.errors.push(WT.errorText(e));
        }
    }

    if (opts.importDate) {
        try { WT.pp.ensureField(project, WT.DATE_FIELD, WT.DATE_LABEL); } catch (e0) { opts.importDate = false; }
    }

    for (i = 0; i < (args.bins || []).length; i++) {
        try {
            WT.pp.label(target(args.bins[i]), args.bins[i].label);
        } catch (eb) {
            res.errors.push(WT.errorText(eb));
        }
    }

    for (i = 0; i < (args.groups || []).length; i++) {
        var g = args.groups[i];
        var bin;
        try {
            bin = target(g);
        } catch (et) {
            res.errors.push(WT.errorText(et));
            continue;
        }
        var before = {};
        var kids = WT.pp.kids(bin);
        for (j = 0; j < kids.length; j++) { before[kids[j].nodeId] = true; }

        var plain = [];
        var layered = [];
        for (j = 0; j < g.files.length; j++) {
            if (opts.showImportOptions && WT.isLayered(g.files[j])) { layered.push(g.files[j]); }
            else { plain.push(g.files[j]); }
        }
        tryImport(plain, true, bin, false);
        tryImport(layered, false, bin, false);
        tryImport(g.sequences, true, bin, true);

        var stamp = WT.dateStamp();
        kids = WT.pp.kids(bin);
        for (j = 0; j < kids.length; j++) {
            var item = kids[j];
            if (before[item.nodeId]) { continue; }
            res.imported++;
            WT.pp.label(item, g.label);
            var mp = WT.pp.isMedia(item) ? WT.pp.mediaPath(item) : '';
            if (mp) { res.importedPaths.push(mp); }
            if (opts.importDate && WT.pp.isMedia(item)) {
                try { WT.pp.setMeta(item, WT.DATE_FIELD, stamp); } catch (ed) { opts.importDate = false; }
            }
        }
    }

    if (args.refresh && args.refresh.length) {
        var wanted = {};
        for (i = 0; i < args.refresh.length; i++) { wanted[args.refresh[i]] = true; }
        WT.pp.walk(project.rootItem, function (it) {
            if (!wanted[String(it.nodeId)]) { return; }
            try {
                it.refreshMedia();
                res.refreshed++;
            } catch (er) {
                res.errors.push(WT.errorText(er));
            }
        }, 0);
    }

    res.binsCreated = counter.n;
    return res;
};

WT.api.notify = function (args) {
    app.setSDKEventMessage(String(args.message || ''), 'info');
    return true;
};

/* Bins currently selected in the Project panel (the ones being dragged onto
   the Watchtower panel), each with the first media file found inside. */
WT.api.selectedBins = function () {
    var sel = null;
    try { sel = app.getCurrentProjectViewSelection(); } catch (e) { sel = null; }
    var out = [];
    if (!sel) { return { projectId: String(app.project.documentID), bins: out }; }
    for (var i = 0; i < sel.length; i++) {
        var bin = sel[i];
        if (!WT.pp.isBin(bin)) { continue; }
        var found = null;
        var queue = [{ item: bin, depth: 0 }];
        while (queue.length && !found) {
            var cur = queue.shift();
            var kids = WT.pp.kids(cur.item);
            for (var k = 0; k < kids.length && !found; k++) {
                var p = WT.pp.isMedia(kids[k]) ? WT.pp.mediaPath(kids[k]) : '';
                if (p) { found = { path: p, depth: cur.depth }; }
                else if (WT.pp.isBin(kids[k])) { queue.push({ item: kids[k], depth: cur.depth + 1 }); }
            }
        }
        out.push({ ref: String(bin.nodeId), name: bin.name, file: found ? found.path : '', depth: found ? found.depth : 0 });
    }
    return { projectId: String(app.project.documentID), bins: out };
};
