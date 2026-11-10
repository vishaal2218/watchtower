/* After Effects host API. After Effects has one project open at a time; the
   watch-folder configuration is stored in the project's own XMP packet. */

WT.host = 'AEFT';
WT.AE_NS = 'http://ns.watchtower-replica.local/1.0/';
WT.AE_PREFIX = 'wtr';
WT.AE_FIELD = 'config';

WT.ae = {
    id: function () {
        return app.project && app.project.file ? String(app.project.file.fsName) : 'untitled';
    },

    project: function (id) {
        if (!app.project) { throw new Error('No project is open.'); }
        if (id && String(id) !== WT.ae.id()) { throw new Error('The project is no longer open.'); }
        return app.project;
    },

    /* ExtendScript File() decodes %XX escapes, so a literal % must be encoded. */
    file: function (p) {
        var f = new File(String(p).replace(/%/g, '%25'));
        return f.exists ? f : new File(String(p));
    },

    items: function () {
        var out = [];
        for (var i = 1; i <= app.project.numItems; i++) { out.push(app.project.item(i)); }
        return out;
    },

    findById: function (ref) {
        if (ref === null || ref === undefined || ref === '') { return null; }
        try {
            var it = app.project.itemByID(Number(ref));
            if (it) { return it; }
        } catch (e) { /* itemByID throws for unknown ids */ }
        return null;
    },

    childFolder: function (parent, name, counter, claimed) {
        var all = WT.ae.items();
        for (var i = 0; i < all.length; i++) {
            var it = all[i];
            if (it instanceof FolderItem && it.name === name && it.parentFolder.id === parent.id &&
                !(claimed && claimed[it.id])) {
                return it;
            }
        }
        var made = app.project.items.addFolder(name);
        made.parentFolder = parent;
        if (counter) { counter.n++; }
        return made;
    },

    folderRef: function (folder) {
        return { ref: String(folder.id), name: folder.name };
    },

    readXmp: function () {
        WT.ensureXMP();
        var packet = app.project.xmpPacket;
        var xmp = packet ? new XMPMeta(packet) : new XMPMeta();
        XMPMeta.registerNamespace(WT.AE_NS, WT.AE_PREFIX);
        return xmp;
    },

    label: function (item, label) {
        if (label === null || label === undefined || label < 1) { return; }
        try { item.label = label; } catch (e) { /* ignore */ }
    }
};

WT.api.env = function () {
    var projects = [];
    if (app.project) {
        projects.push({
            id: WT.ae.id(),
            name: app.project.file ? app.project.file.displayName : 'Untitled Project',
            path: app.project.file ? String(app.project.file.fsName) : '',
            cloud: false
        });
    }
    return { host: 'AEFT', version: String(app.version), activeId: app.project ? WT.ae.id() : null, projects: projects };
};

WT.api.loadConfig = function (args) {
    WT.ae.project(args.projectId);
    var xmp;
    try {
        xmp = WT.ae.readXmp();
    } catch (e) {
        return { supported: false, config: null, error: WT.errorText(e) };
    }
    if (!xmp.doesPropertyExist(WT.AE_NS, WT.AE_FIELD)) { return { supported: true, config: null }; }
    var rec = WT.decodeRecord(String(xmp.getProperty(WT.AE_NS, WT.AE_FIELD).value));
    if (!rec || !rec.roots) { return { supported: true, config: null }; }
    for (var i = 0; i < rec.roots.length; i++) {
        var root = rec.roots[i];
        var folder = root.bin ? WT.ae.findById(root.bin.ref) : null;
        if (folder && folder instanceof FolderItem) { root.bin = WT.ae.folderRef(folder); }
        else { root.bin = undefined; }
    }
    return { supported: true, config: { autoSync: !!rec.autoSync, roots: rec.roots, savedAt: String(rec.savedAt || '') } };
};

WT.api.saveConfig = function (args) {
    WT.ae.project(args.projectId);
    var roots = args.roots || [];
    var stored = [];
    var out = [];
    var claimed = {};
    var counter = { n: 0 };
    for (var i = 0; i < roots.length; i++) {
        var root = roots[i];
        var folder = root.bin ? WT.ae.findById(root.bin.ref) : null;
        if (!folder || !(folder instanceof FolderItem)) {
            folder = WT.ae.childFolder(app.project.rootFolder, root.name, counter, claimed);
        }
        claimed[folder.id] = true;
        var copy = WT.copy(root);
        copy.bin = WT.ae.folderRef(folder);
        stored.push(copy);
        out.push({ id: root.id, bin: WT.ae.folderRef(folder) });
    }
    var supported = true;
    try {
        var xmp = WT.ae.readXmp();
        var encoded = WT.encodeRecord({ v: 1, autoSync: !!args.autoSync, savedAt: String(args.savedAt || ''), roots: stored });
        xmp.setProperty(WT.AE_NS, WT.AE_FIELD, encoded);
        app.project.xmpPacket = xmp.serialize();
        supported = String(WT.ae.readXmp().getProperty(WT.AE_NS, WT.AE_FIELD).value) === encoded;
    } catch (e) {
        supported = false;
    }
    return { supported: supported, roots: out };
};

WT.api.mediaItems = function (args) {
    WT.ae.project(args.projectId);
    var out = [];
    var all = WT.ae.items();
    for (var i = 0; i < all.length; i++) {
        var it = all[i];
        if (it instanceof FootageItem && it.file) {
            out.push({ p: String(it.file.fsName), id: String(it.id) });
        }
    }
    return out;
};

WT.api.importBatch = function (args) {
    WT.ae.project(args.projectId);
    var opts = args.options || {};
    var res = { imported: 0, binsCreated: 0, refreshed: 0, errors: [], importedPaths: [], rootBins: [] };
    var counter = { n: 0 };
    var rootCache = {};
    var asMap = {
        footage: ImportAsType.FOOTAGE,
        composition: ImportAsType.COMP,
        compositionRetain: ImportAsType.COMP_CROPPED_LAYERS
    };
    var i;
    var j;

    function rootFolder(rootId, rootRef, rootName) {
        if (rootCache[rootId]) { return rootCache[rootId]; }
        var f = WT.ae.findById(rootRef);
        if (!f || !(f instanceof FolderItem)) {
            f = WT.ae.childFolder(app.project.rootFolder, rootName, counter, null);
            res.rootBins.push({ rootId: rootId, bin: WT.ae.folderRef(f) });
        }
        rootCache[rootId] = f;
        return f;
    }

    function target(spec) {
        var f = rootFolder(spec.rootId, spec.rootRef, spec.rootName);
        for (var k = 0; k < spec.sub.length; k++) { f = WT.ae.childFolder(f, spec.sub[k], counter, null); }
        return f;
    }

    function importOne(p, sequence, folder, label) {
        var before = {};
        var existing = WT.ae.items();
        var k;
        for (k = 0; k < existing.length; k++) { before[existing[k].id] = true; }
        try {
            var io = new ImportOptions(WT.ae.file(p));
            if (sequence) {
                if (io.canImportAs(ImportAsType.FOOTAGE)) { io.importAs = ImportAsType.FOOTAGE; }
                io.sequence = true;
                io.forceAlphabetical = false;
            } else if (WT.isLayered(p) && asMap[opts.psdImportAs] !== undefined && io.canImportAs(asMap[opts.psdImportAs])) {
                io.importAs = asMap[opts.psdImportAs];
            }
            app.project.importFile(io);
        } catch (e) {
            res.errors.push(p + ': ' + WT.errorText(e));
            return;
        }
        /* A layered import can create a comp plus a layers folder; move every
           new top-level item into the target folder and label it. */
        var after = WT.ae.items();
        for (k = 0; k < after.length; k++) {
            var it = after[k];
            if (before[it.id]) { continue; }
            if (it.parentFolder.id === app.project.rootFolder.id) { it.parentFolder = folder; }
            WT.ae.label(it, label);
        }
        res.imported++;
        res.importedPaths.push(p);
    }

    app.beginUndoGroup('Watchtower Sync');
    try {
        for (i = 0; i < (args.bins || []).length; i++) {
            try {
                WT.ae.label(target(args.bins[i]), args.bins[i].label);
            } catch (eb) {
                res.errors.push(WT.errorText(eb));
            }
        }
        for (i = 0; i < (args.groups || []).length; i++) {
            var g = args.groups[i];
            var folder;
            try {
                folder = target(g);
            } catch (et) {
                res.errors.push(WT.errorText(et));
                continue;
            }
            for (j = 0; j < g.files.length; j++) { importOne(g.files[j], false, folder, g.label); }
            for (j = 0; j < g.sequences.length; j++) { importOne(g.sequences[j], true, folder, g.label); }
        }
        for (i = 0; i < (args.refresh || []).length; i++) {
            var item = WT.ae.findById(args.refresh[i]);
            if (item && item.mainSource && typeof item.mainSource.reload === 'function') {
                try {
                    item.mainSource.reload();
                    res.refreshed++;
                } catch (er) {
                    res.errors.push(WT.errorText(er));
                }
            }
        }
    } finally {
        app.endUndoGroup();
    }
    res.binsCreated = counter.n;
    return res;
};

/* After Effects reports sync results in its Info panel. */
WT.api.notify = function (args) {
    clearOutput();
    writeLn(String(args.message || ''));
    return true;
};

WT.api.selectedBins = function () {
    var out = [];
    var sel = app.project ? app.project.selection : [];
    for (var i = 0; i < sel.length; i++) {
        var folder = sel[i];
        if (!(folder instanceof FolderItem)) { continue; }
        var found = null;
        var queue = [{ item: folder, depth: 0 }];
        while (queue.length && !found) {
            var cur = queue.shift();
            for (var k = 1; k <= cur.item.numItems && !found; k++) {
                var child = cur.item.item(k);
                if (child instanceof FootageItem && child.file) { found = { path: String(child.file.fsName), depth: cur.depth }; }
                else if (child instanceof FolderItem) { queue.push({ item: child, depth: cur.depth + 1 }); }
            }
        }
        out.push({ ref: String(folder.id), name: folder.name, file: found ? found.path : '', depth: found ? found.depth : 0 });
    }
    return { projectId: WT.ae.id(), bins: out };
};
