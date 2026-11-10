'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const paths = require('../lib/paths');
const { parseNetUse, toUnc, createDriveResolver } = require('../lib/drives');

test('toKey folds separators, case, trailing slash and Unicode form', () => {
  assert.equal(paths.toKey('C:\\Media\\Clip.MOV'), 'c:/media/clip.mov');
  assert.equal(paths.toKey('/Volumes/Card/'), '/volumes/card');
  const nfd = '/media/\u1100\u1161.mov'; // Korean jamo, decomposed
  const nfc = '/media/\uAC00.mov';
  assert.equal(paths.toKey(nfd), paths.toKey(nfc));
});

test('toKey keeps UNC paths distinct from rooted paths', () => {
  assert.equal(paths.toKey('\\\\server\\share\\a.mov'), '//server/share/a.mov');
  assert.notEqual(paths.toKey('\\\\server\\share\\a.mov'), paths.toKey('/server/share/a.mov'));
});

test('relative paths are stored with forward slashes and resolve on either OS', () => {
  const stored = paths.toStored('C:\\Jobs\\Show\\Media\\A', true, 'C:\\Jobs\\Show\\Project', 'win32');
  assert.equal(stored, '../Media/A');
  assert.equal(paths.resolveStored(stored, true, '/Users/ed/Show/Project', 'posix'), '/Users/ed/Show/Media/A');
  assert.equal(paths.resolveStored(stored, true, 'D:\\Show\\Project', 'win32'), 'D:\\Show\\Media\\A');
});

test('a folder is stored as "." when it is the project folder itself', () => {
  assert.equal(paths.toStored('/p', true, '/p', 'posix'), '.');
});

test('relative paths are refused across drives and without a project folder', () => {
  assert.equal(paths.canBeRelative('D:\\Media', 'C:\\Project', 'win32'), false);
  assert.equal(paths.canBeRelative('\\\\nas\\media\\x', '\\\\nas\\media\\p', 'win32'), true);
  assert.equal(paths.canBeRelative('/a', '', 'posix'), false);
  assert.throws(() => paths.toStored('D:\\Media', true, 'C:\\Project', 'win32'));
  assert.equal(paths.resolveStored('Media', true, '', 'posix'), '');
});

test('absolute stored paths are returned unchanged', () => {
  assert.equal(paths.toStored('/a/b', false, '/p', 'posix'), '/a/b');
  assert.equal(paths.resolveStored('/a/b', false, '/p', 'posix'), '/a/b');
  assert.equal(paths.resolveStored('', false, '/p', 'posix'), '');
});

test('isInside matches the folder itself and descendants only', () => {
  assert.equal(paths.isInside('/a/b/c', '/a/b'), true);
  assert.equal(paths.isInside('/a/b', '/a/b'), true);
  assert.equal(paths.isInside('/a/bc', '/a/b'), false);
  assert.equal(paths.isInside('', '/a'), false);
});

test('net use output maps drive letters to UNC shares', () => {
  const out = [
    'Status       Local     Remote                    Network',
    '-------------------------------------------------------------------------------',
    'OK           Z:        \\\\nas01\\media               Microsoft Windows Network',
    'Unavailable  Y:        \\\\nas02\\archive             Microsoft Windows Network'
  ].join('\r\n');
  const map = parseNetUse(out);
  assert.deepEqual(map, { Z: '\\\\nas01\\media', Y: '\\\\nas02\\archive' });
  assert.equal(toUnc('z:\\Shoot\\Day1', map), '\\\\nas01\\media\\Shoot\\Day1');
  assert.equal(toUnc('Z:', map), '\\\\nas01\\media');
  assert.equal(toUnc('C:\\Local', map), 'C:\\Local');
});

test('drive resolver only rewrites on Windows and survives a failing net use', () => {
  const win = createDriveResolver({ platform: 'win32', exec: () => 'OK  Z:  \\\\nas\\m  Network' });
  assert.equal(win.resolve('Z:\\a'), '\\\\nas\\m\\a');
  const failing = createDriveResolver({
    platform: 'win32',
    exec: () => {
      throw new Error('denied');
    }
  });
  assert.equal(failing.resolve('Z:\\a'), 'Z:\\a');
  const mac = createDriveResolver({ platform: 'darwin' });
  assert.equal(mac.resolve('/Volumes/x'), '/Volumes/x');
});
