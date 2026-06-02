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
