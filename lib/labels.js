'use strict';

// Default label names per host, with approximate swatch colours for the UI.
// `index` is the value the host API expects: Premiere's setColorLabel takes
// 0-15, After Effects' item.label takes 1-16 (0 means none).

const PPRO = Object.freeze([
  { index: 0, name: 'Violet', color: '#a58ada' },
  { index: 1, name: 'Iris', color: '#7182e6' },
  { index: 2, name: 'Caribbean', color: '#29c2a3' },
  { index: 3, name: 'Lavender', color: '#e384e3' },
  { index: 4, name: 'Cerulean', color: '#1d9ee8' },
  { index: 5, name: 'Forest', color: '#569e32' },
  { index: 6, name: 'Rose', color: '#f06790' },
  { index: 7, name: 'Mango', color: '#f59f24' },
  { index: 8, name: 'Purple', color: '#9147c6' },
  { index: 9, name: 'Blue', color: '#3a5ce6' },
  { index: 10, name: 'Teal', color: '#128f8f' },
  { index: 11, name: 'Magenta', color: '#e2208e' },
  { index: 12, name: 'Tan', color: '#c9a67a' },
  { index: 13, name: 'Green', color: '#3ac044' },
  { index: 14, name: 'Brown', color: '#8e5a2c' },
  { index: 15, name: 'Yellow', color: '#e6d83a' }
]);

const AEFT = Object.freeze([
  { index: 1, name: 'Red', color: '#b53838' },
  { index: 2, name: 'Yellow', color: '#e4d84c' },
  { index: 3, name: 'Aqua', color: '#a9cbc7' },
  { index: 4, name: 'Pink', color: '#e5bcc9' },
  { index: 5, name: 'Lavender', color: '#a9a9ca' },
  { index: 6, name: 'Peach', color: '#e7c19e' },
  { index: 7, name: 'Sea Foam', color: '#b3c7b3' },
  { index: 8, name: 'Blue', color: '#677de0' },
  { index: 9, name: 'Green', color: '#4aa44c' },
  { index: 10, name: 'Purple', color: '#8e2c9a' },
  { index: 11, name: 'Orange', color: '#e8920d' },
  { index: 12, name: 'Brown', color: '#7f452a' },
  { index: 13, name: 'Fuchsia', color: '#f46dd6' },
  { index: 14, name: 'Cyan', color: '#3da2a5' },
  { index: 15, name: 'Sandstone', color: '#a89677' },
  { index: 16, name: 'Dark Green', color: '#1e401e' }
]);

function labelsFor(host) {
  return host === 'AEFT' ? AEFT : PPRO;
}

function labelColor(host, index) {
  const hit = labelsFor(host).filter((l) => l.index === index)[0];
  return hit ? hit.color : null;
}

module.exports = { labelsFor, labelColor };
