'use strict';

// Camera card structures that switch FLT on automatically. The list is closed
// by design: there is no user-facing way to add a structure. Paths in an index
// are lower-cased and relative to the folder being inspected, joined with "/".

function depth(rel) {
  return rel.split('/').length;
}

function hasDir(ix, re) {
  return ix.dirs.some((d) => re.test(d));
}

function hasFile(ix, re) {
  return ix.files.some((f) => re.test(f));
}

const PROFILES = Object.freeze([
  {
    id: 'arriraw',
    name: 'ARRIRAW',
    seq: true,
    match: (ix) => ix.files.some((f) => /\.(ari|arx)$/.test(f) && depth(f) >= 2),
    include: (rel) => /\.(ari|arx|mxf|wav)$/.test(rel)
  },
  {
    id: 'red',
    name: 'RED',
    match: (ix) => /\.(rdm|rdc)$/.test(ix.rootName) || hasDir(ix, /^[^/]+\.(rdm|rdc)$/),
    // First R3D segment only (the host spans the rest), plus .wav sidecars (v1.5.3).
    include: (rel) => /_001\.r3d$/.test(rel) || /\.wav$/.test(rel)
  },
  {
    id: 'avchd',
    name: 'AVCHD',
    match: (ix) => hasDir(ix, /^(private\/)?(avchd\/)?bdmv\/stream$/),
    include: (rel) => /(^|\/)bdmv\/stream\/[^/]+\.(mts|m2ts)$/.test(rel)
  },
  {
    id: 'canon-xf',
    name: 'Canon XF',
    match: (ix) => hasDir(ix, /^contents\/clips\d{3}$/),
    include: (rel) => /^contents\/clips\d{3}\/.+\.mxf$/.test(rel)
  },
  {
    id: 'p2',
    name: 'Panasonic P2',
    // Spanned clips are not supported: every video MXF imports on its own.
    match: (ix) => hasDir(ix, /^contents\/video$/) && hasDir(ix, /^contents\/clip$/),
    include: (rel) => /^contents\/video\/[^/]+\.mxf$/.test(rel)
  },
  {
    id: 'xdcam-ex',
    name: 'XDCAM-EX',
    match: (ix) => hasDir(ix, /^bpav\/clpr$/),
    include: (rel) => /^bpav\/clpr\/[^/]+\/[^/]+\.mp4$/.test(rel)
  },
  {
    id: 'xdcam-hd',
    name: 'XDCAM-HD',
    match: (ix) => hasDir(ix, /^clip$/) && hasFile(ix, /^(mediapro|discmeta)\.xml$/),
    include: (rel) => /^clip\/[^/]+\.mxf$/.test(rel)
  },
  {
    id: 'hdv',
    name: 'Sony HDV',
    match: (ix) =>
      (/^(hdv|hvr)$/.test(ix.rootName) && hasFile(ix, /^[^/]+\.m2t$/)) ||
      hasFile(ix, /^(hdv|hvr)\/[^/]+\.m2t$/),
    include: (rel) => /^((hdv|hvr)\/)?[^/]+\.m2t$/.test(rel)
  },
  {
    id: 'sony-a7s',
    name: 'Sony a7S',
    match: (ix) => hasDir(ix, /^private\/m4root\/clip$/),
    include: (rel) => /^private\/m4root\/clip\/[^/]+\.mp4$/.test(rel)
  },
  {
    id: 'sony-xavc',
    name: 'Sony FS/XAVC',
    match: (ix) => hasDir(ix, /^(private\/)?xdroot\/clip$/),
    include: (rel) => /^(private\/)?xdroot\/clip\/[^/]+\.mxf$/.test(rel)
  },
  {
    id: 'dcim',
    name: 'DCIM',
    match: (ix) => ix.rootName === 'dcim' || hasDir(ix, /^dcim$/),
    include: (rel, rootName) =>
      rootName === 'dcim' ? /^[^/]+\/[^/]+$/.test(rel) : /^dcim\/[^/]+\/[^/]+$/.test(rel)
  }
]);

function profileById(id) {
  return PROFILES.filter((p) => p.id === id)[0] || null;
}

/** Return the ids of every camera structure found in an index. */
function detectCameras(index) {
  const ix = {
    rootName: String(index.rootName || '').toLowerCase(),
    dirs: (index.dirs || []).map((d) => d.toLowerCase()),
    files: (index.files || []).map((f) => f.toLowerCase())
  };
  return PROFILES.filter((p) => p.match(ix)).map((p) => p.id);
}

/** Whether a file (path relative to the camera folder) belongs to the clip set. */
function cameraIncludes(ids, rel, rootName) {
  const r = String(rel).replace(/\\/g, '/').toLowerCase();
  const root = String(rootName || '').toLowerCase();
  return (ids || []).some((id) => {
    const p = profileById(id);
    return !!p && p.include(r, root);
  });
}

function cameraWantsSequences(ids) {
  return (ids || []).some((id) => {
    const p = profileById(id);
    return !!p && !!p.seq;
  });
}

function cameraNames(ids) {
  return (ids || []).map(profileById).filter(Boolean).map((p) => p.name);
}

module.exports = { PROFILES, detectCameras, cameraIncludes, cameraWantsSequences, cameraNames };
