'use strict';

// Import formats per host, compiled from Adobe's published "supported file
// formats" pages for Premiere Pro and After Effects. Hosts add and drop
// formats between versions; users can edit the allowed list in Settings.

const SHARED = [
  // video and containers
  '264', '3g2', '3gp', '3gpp', 'ari', 'arx', 'asf', 'avc', 'avi', 'braw', 'crm', 'dv',
  'f4v', 'flv', 'gif', 'h264', 'hevc', 'm1v', 'm2p', 'm2t', 'm2ts', 'm2v', 'm4v',
  'mod', 'mov', 'mp4', 'mpe', 'mpeg', 'mpg', 'mpg4', 'mpv', 'mts', 'mxf', 'r3d',
  'swf', 'ts', 'vob', 'webm', 'wmv',
  // audio
  'aac', 'ac3', 'aif', 'aifc', 'aiff', 'bwf', 'm1a', 'm2a', 'm4a', 'mp2', 'mp3', 'mpa',
  'wav', 'wma',
  // stills
  'ai', 'bmp', 'cin', 'dib', 'dng', 'dpx', 'eps', 'exr', 'heic', 'heif', 'ico', 'jfif',
  'jpe', 'jpeg', 'jpg', 'pct', 'pict', 'png', 'psd', 'rle', 'sgi', 'tga', 'tif', 'tiff',
  'webp'
];

const PPRO_ONLY = ['aaf', 'aec', 'mcc', 'prtl', 'scc', 'srt', 'stl', 'vtt'];
const AEFT_ONLY = ['c4d', 'csv', 'glb', 'gltf', 'hdr', 'json', 'mgjson', 'obj', 'svg', 'tsv'];

// Project containers are host-importable but deliberately left out of the
// default allowed list: a watched folder often holds the project's own
// Auto-Save folder, and auto-importing a .prproj/.aep drags whole projects in.
const PROJECT_CONTAINERS = ['prproj', 'aep', 'aepx', 'xml', 'edl'];

function uniqueSorted(list) {
  return list.filter((v, i, a) => a.indexOf(v) === i).sort();
}

const HOST_SUPPORTED = Object.freeze({
  PPRO: Object.freeze(uniqueSorted(SHARED.concat(PPRO_ONLY, ['prproj', 'xml', 'edl']))),
  AEFT: Object.freeze(uniqueSorted(SHARED.concat(AEFT_ONLY, ['aep', 'aepx'])))
});

const DEFAULT_ALLOWED = Object.freeze(
  uniqueSorted(SHARED.concat(PPRO_ONLY, AEFT_ONLY)).filter((e) => PROJECT_CONTAINERS.indexOf(e) < 0)
);

const STILL_IMAGE = Object.freeze([
  'ari', 'bmp', 'cin', 'dng', 'dpx', 'exr', 'gif', 'hdr', 'jpeg', 'jpg', 'png', 'psd',
  'rle', 'sgi', 'tga', 'tif', 'tiff', 'webp'
]);

const LAYERED = Object.freeze(['psd', 'ai']);

/** Lower-cased extension without the dot, or '' when there is none. */
function extOf(name) {
  const base = String(name).replace(/^.*[\\/]/, '');
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

/** Normalise user input (".MOV", "*.mov", " mov ") to "mov"; null when invalid. */
function normalizeExt(input) {
  const s = String(input == null ? '' : input).trim().toLowerCase().replace(/^\*?\.+/, '');
  return /^[a-z0-9_+-]{1,12}$/.test(s) ? s : null;
}

function isImportable(name, allowedSet, host) {
  const ext = extOf(name);
  if (!ext || !allowedSet.has(ext)) return false;
  const supported = HOST_SUPPORTED[host];
  return !supported || supported.indexOf(ext) >= 0;
}

function isStillImage(name) {
  return STILL_IMAGE.indexOf(extOf(name)) >= 0;
}

function isLayered(name) {
  return LAYERED.indexOf(extOf(name)) >= 0;
}

module.exports = {
  HOST_SUPPORTED,
  DEFAULT_ALLOWED,
  PROJECT_CONTAINERS,
  extOf,
  normalizeExt,
  isImportable,
  isStillImage,
  isLayered
};
