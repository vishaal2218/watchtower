'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const seq = require('../lib/sequence');
const cam = require('../lib/camera');

function names(prefix, digits, count, extension) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(prefix + String(i).padStart(digits, '0') + '.' + extension);
  return out;
}

test('sequence auto-detection needs three or more trailing digits', () => {
  assert.equal(seq.detectSequenceFolder(names('cleanup_', 3, 10, 'png')), true);
  assert.equal(seq.detectSequenceFolder(names('page_', 5, 10, 'tif')), true);
  assert.equal(seq.detectSequenceFolder(names('sframe_', 2, 10, 'png')), false);
});

test('sequence auto-detection ignores video files and lone frames', () => {
  assert.equal(seq.detectSequenceFolder(names('A001C', 3, 5, 'mov')), false);
  assert.equal(seq.detectSequenceFolder(['shot_001.exr', 'notes.txt']), false);
  assert.equal(seq.detectSequenceFolder([]), false);
});

test('splitFrame reads prefix, digits and extension', () => {
  assert.deepEqual(seq.splitFrame('/x/shot_0042.exr'), { prefix: 'shot_', digits: '0042', number: 42, ext: 'exr' });
  assert.equal(seq.splitFrame('shot.exr'), null);
});

test('with SEQ on, even two-digit frames group into one sequence in frame order', () => {
  const files = ['sframe_10.png', 'sframe_02.png', 'sframe_01.png', 'readme.pdf', 'logo.png'].map((name) => ({ name }));
  const g = seq.groupSequences(files);
  assert.equal(g.sequences.length, 1);
  assert.deepEqual(
    g.sequences[0].frames.map((f) => f.name),
    ['sframe_01.png', 'sframe_02.png', 'sframe_10.png']
  );
  assert.equal(g.sequences[0].first.name, 'sframe_01.png');
  assert.deepEqual(g.singles.map((f) => f.name), ['readme.pdf', 'logo.png']);
});

test('different prefixes or extensions make different sequences', () => {
  const files = ['a_001.png', 'a_002.png', 'b_001.png', 'a_001.exr'].map((name) => ({ name }));
  assert.equal(seq.groupSequences(files).sequences.length, 3);
});

function index(rootName, dirs, files) {
  return { rootName, dirs, files: files || [] };
}

test('each documented camera structure is detected', () => {
  const cases = [
    ['arriraw', index('Mag', ['A001C001'], ['A001C001/A001C001.0000001.ari'])],
    ['red', index('Card', ['A001_0101AB.RDM', 'A001_0101AB.RDM/A001_C001.RDC'], [])],
    ['red', index('A001_C001.RDC', [], ['A001_C001_001.R3D'])],
    ['avchd', index('Card', ['PRIVATE', 'PRIVATE/AVCHD', 'PRIVATE/AVCHD/BDMV', 'PRIVATE/AVCHD/BDMV/STREAM'])],
    ['canon-xf', index('Card', ['CONTENTS', 'CONTENTS/CLIPS001'])],
    ['p2', index('Card', ['CONTENTS', 'CONTENTS/VIDEO', 'CONTENTS/CLIP', 'CONTENTS/AUDIO'])],
    ['xdcam-ex', index('Card', ['BPAV', 'BPAV/CLPR'])],
    ['xdcam-hd', index('Disc', ['Clip', 'Edit'], ['MEDIAPRO.XML'])],
    ['hdv', index('HDV', [], ['clip0001.m2t'])],
    ['sony-a7s', index('Card', ['PRIVATE', 'PRIVATE/M4ROOT', 'PRIVATE/M4ROOT/CLIP'])],
    ['sony-xavc', index('Card', ['XDROOT', 'XDROOT/Clip'])],
    ['sony-xavc', index('Card', ['PRIVATE', 'PRIVATE/XDROOT', 'PRIVATE/XDROOT/Clip'])],
    ['dcim', index('Card', ['DCIM', 'DCIM/100CANON'])],
    ['dcim', index('DCIM', ['100GOPRO'])]
  ];
  cases.forEach(([id, ix]) => assert.ok(cam.detectCameras(ix).indexOf(id) >= 0, id + ' in ' + JSON.stringify(ix)));
});

test('ordinary folders are not camera folders', () => {
  assert.deepEqual(cam.detectCameras(index('Footage', ['A', 'B'], ['a.mov'])), []);
  assert.deepEqual(cam.detectCameras(index('Renders', [], ['shot.0001.ari'])), [], 'ARRIRAW needs clip folders');
  assert.deepEqual(cam.detectCameras(index('Stuff', ['CONTENTS', 'CONTENTS/VIDEO'])), [], 'P2 needs CLIP too');
});

test('an a7S card reports both its clip and its stills structure', () => {
  const ids = cam.detectCameras(index('Card', ['DCIM', 'DCIM/100MSDCF', 'PRIVATE', 'PRIVATE/M4ROOT', 'PRIVATE/M4ROOT/CLIP']));
  assert.deepEqual(ids.sort(), ['dcim', 'sony-a7s']);
});

test('camera include rules keep clip media and drop sidecars', () => {
  assert.equal(cam.cameraIncludes(['p2'], 'CONTENTS/VIDEO/0001AB.MXF', 'card'), true);
  assert.equal(cam.cameraIncludes(['p2'], 'CONTENTS/AUDIO/0001AB00.MXF', 'card'), false, 'P2 audio is linked by the host');
  assert.equal(cam.cameraIncludes(['red'], 'A.RDM/A_C001.RDC/A_C001_001.R3D', 'card'), true);
  assert.equal(cam.cameraIncludes(['red'], 'A.RDM/A_C001.RDC/A_C001_002.R3D', 'card'), false, 'later segments span');
  assert.equal(cam.cameraIncludes(['red'], 'A.RDM/A_C001.RDC/A_C001.wav', 'card'), true, '.wav sidecars (v1.5.3)');
  assert.equal(cam.cameraIncludes(['sony-a7s'], 'PRIVATE/M4ROOT/CLIP/C0001.MP4', 'card'), true);
  assert.equal(cam.cameraIncludes(['sony-a7s'], 'PRIVATE/M4ROOT/THMBNL/C0001T01.JPG', 'card'), false);
  assert.equal(cam.cameraIncludes(['dcim'], '100GOPRO/GX010001.MP4', 'dcim'), true);
  assert.equal(cam.cameraIncludes(['dcim'], 'DCIM/100GOPRO/GX010001.MP4', 'card'), true);
  assert.equal(cam.cameraIncludes(['avchd'], 'PRIVATE/AVCHD/BDMV/STREAM/00000.MTS', 'card'), true);
  assert.equal(cam.cameraIncludes(['xdcam-ex'], 'BPAV/CLPR/461_0001_01/461_0001_01.MP4', 'card'), true);
  assert.equal(cam.cameraIncludes(['canon-xf'], 'CONTENTS/CLIPS001/AA0001/AA000101.MXF', 'card'), true);
  assert.equal(cam.cameraIncludes(['hdv'], 'HDV/clip0001.m2t', 'card'), true);
  assert.equal(cam.cameraIncludes([], 'anything.mov', 'card'), false);
});

test('ARRIRAW asks for sequence import; camera names are the documented ones', () => {
  assert.equal(cam.cameraWantsSequences(['arriraw']), true);
  assert.equal(cam.cameraWantsSequences(['red']), false);
  assert.deepEqual(
    cam.PROFILES.map((p) => p.name),
    ['ARRIRAW', 'RED', 'AVCHD', 'Canon XF', 'Panasonic P2', 'XDCAM-EX', 'XDCAM-HD', 'Sony HDV', 'Sony a7S', 'Sony FS/XAVC', 'DCIM']
  );
  assert.deepEqual(cam.cameraNames(['red', 'nope']), ['RED']);
});
