/* Lightweight test suite — run with `npm test`. No test framework needed. */
'use strict';

const assert = require('assert');
const render = require('../src/render.js');
const { createZip } = require('../lib/zip.js');
const QRCode = require('../lib/qrcode.js');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ✓ ' + name); })
    .catch((e) => { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; });
}

function pngDims(buf) {
  assert.ok(buf.slice(0, 8).equals(PNG_SIG), 'not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

(async () => {
  await render.init();
  console.log('Overlay Generator — tests');

  for (const key of render.KEYS) {
    await test(`renders ${key} as a 4K PNG`, () => {
      const buf = render.renderOverlay(key, render.mergeData({}));
      const { width, height } = pngDims(buf);
      assert.strictEqual(width, 3840);
      assert.strictEqual(height, 2160);
      assert.ok(buf.length > 1000, 'PNG suspiciously small');
    });
  }

  await test('mergeData overrides only the provided fields', () => {
    const m = render.mergeData({ chapter: { num: '42' } });
    assert.strictEqual(m.chapter.num, '42');
    assert.strictEqual(m.chapter.label, 'Step'); // default preserved
    assert.strictEqual(m.slate.brand, 'Mylemans Online'); // other overlays untouched
  });

  await test('edited content changes the rendered bytes', () => {
    const a = render.renderOverlay('chapter', render.mergeData({}));
    const b = render.renderOverlay('chapter', render.mergeData({ chapter: { title: 'Totally different title here' } }));
    assert.ok(!a.equals(b), 'expected different output for different text');
  });

  await test('compare collapses to a single panel when the right side is empty', () => {
    const two = render.renderOverlay('compare', render.mergeData({}));
    const one = render.renderOverlay('compare', render.mergeData({ compare: { rightHeading: '', rightBody: '' } }));
    assert.ok(!two.equals(one), 'single-column should differ from two-column');
  });

  await test('checklist reflects its item count', () => {
    const a = render.renderOverlay('checklist', render.mergeData({ checklist: { items: 'One\nTwo' } }));
    const b = render.renderOverlay('checklist', render.mergeData({ checklist: { items: 'One\nTwo\nThree\nFour' } }));
    assert.ok(!a.equals(b), 'more items should change the render');
  });

  await test('new overlays are registered in keys/meta/files', () => {
    assert.ok(render.KEYS.includes('compare') && render.KEYS.includes('checklist'));
    assert.strictEqual(render.FILES.compare, '07_comparison-slide');
    assert.strictEqual(render.FILES.checklist, '08_numbered-list');
  });

  await test('unknown overlay key throws', () => {
    assert.throws(() => render.renderOverlay('bogus', render.mergeData({})));
  });

  await test('QR encoder produces a valid, stable matrix', () => {
    const qr = QRCode.encode('https://mylemans.online/proxmox-cluster', 'M');
    assert.ok(qr.size >= 21 && qr.size % 4 === 1, 'unexpected QR size');
    // finder pattern: top-left 7x7 corners must be dark, with light ring
    assert.strictEqual(qr.get(0, 0), true);
    assert.strictEqual(qr.get(1, 1), false);
    assert.strictEqual(qr.get(3, 3), true);
  });

  await test('terminal prompt is configurable (BUG-1)', () => {
    const def = render.renderOverlay('terminal', render.mergeData({}));
    const ps = render.renderOverlay('terminal', render.mergeData({ terminal: { prompt: 'PS C:\\>' } }));
    assert.ok(!def.equals(ps), 'changing the prompt should change the render');
    // empty prompt is honoured (no prefix drawn) and differs from default
    const none = render.renderOverlay('terminal', render.mergeData({ terminal: { prompt: '' } }));
    assert.ok(!def.equals(none), 'empty prompt should drop the prefix');
  });

  await test('terminal prompt is exposed in defaults/schema', () => {
    assert.strictEqual(render.defaultData().terminal.prompt, 'root@pve:~#');
  });

  await test('renderPack returns ordered, numbered, collision-free files (ENH-1)', () => {
    const files = render.renderPack([
      { key: 'slate', fields: { title: 'Episode title' } },
      { key: 'chapter', fields: { num: '01', title: 'First' } },
      { key: 'terminal', fields: { prompt: 'PS C:\\>', cmd: 'Get-Service' } },
      { key: 'terminal', fields: { prompt: 'PS C:\\>', cmd: 'Restart-Service' } }
    ]);
    assert.deepStrictEqual(files.map((f) => f.name),
      ['01_slate.png', '02_chapter.png', '03_terminal.png', '04_terminal.png']);
    // same type, different copy → different bytes
    assert.ok(!files[2].data.equals(files[3].data));
    files.forEach((f) => assert.ok(f.data.slice(0, 8).equals(PNG_SIG)));
  });

  await test('renderPack honours caller filenames and stays sortable', () => {
    const files = render.renderPack([
      { key: 'chapter', fields: {}, filename: 'intro' },
      { key: 'chapter', fields: {}, filename: 'intro' } // duplicate label, still unique via index
    ]);
    assert.deepStrictEqual(files.map((f) => f.name), ['01_intro.png', '02_intro.png']);
  });

  await test('renderPack rejects empty input and unknown keys', () => {
    assert.throws(() => render.renderPack([]), /non-empty/);
    assert.throws(() => render.renderPack([{ key: 'nope' }]), /unknown key/);
  });

  await test('createZip yields a valid End-Of-Central-Directory record', () => {
    const zip = createZip([
      { name: 'a.png', data: render.renderOverlay('chapter', render.mergeData({})) },
      { name: 'b.png', data: render.renderOverlay('tip', render.mergeData({})) }
    ]);
    // EOCD signature sits in the last 22 bytes (no zip comment)
    const eocd = zip.slice(zip.length - 22);
    assert.strictEqual(eocd.readUInt32LE(0), 0x06054b50, 'missing EOCD signature');
    assert.strictEqual(eocd.readUInt16LE(10), 2, 'expected 2 entries');
  });

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
