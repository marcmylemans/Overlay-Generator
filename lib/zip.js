/* ===========================================================================
   zip.js — minimal, dependency-free ZIP writer (STORE method only)

   PNGs are already DEFLATE-compressed internally, so storing them uncompressed
   keeps this tiny and avoids pulling in a compression dependency. Produces a
   standard .zip Buffer that any unzip tool (and DaVinci Resolve's import) reads.
   =========================================================================== */
'use strict';

// CRC-32 (IEEE 802.3) with a precomputed table.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// DOS date/time for a fixed, reproducible timestamp (2020-01-01 00:00:00).
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/**
 * @param {{name:string, data:Buffer}[]} files
 * @returns {Buffer} a STORE-method zip archive
 */
function createZip(files) {
  const localParts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // method = store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra len
    localParts.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);     // central dir header signature
    cen.writeUInt16LE(20, 4);             // version made by
    cen.writeUInt16LE(20, 6);             // version needed
    cen.writeUInt16LE(0, 8);              // flags
    cen.writeUInt16LE(0, 10);             // method
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);             // extra len
    cen.writeUInt16LE(0, 32);             // comment len
    cen.writeUInt16LE(0, 34);             // disk number
    cen.writeUInt16LE(0, 36);             // internal attrs
    cen.writeUInt32LE(0, 38);             // external attrs
    cen.writeUInt32LE(offset, 42);        // local header offset
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const centralOffset = offset;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central dir signature
  end.writeUInt16LE(0, 4);                // disk number
  end.writeUInt16LE(0, 6);                // central dir disk
  end.writeUInt16LE(files.length, 8);     // entries on this disk
  end.writeUInt16LE(files.length, 10);    // total entries
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);               // comment len

  return Buffer.concat([...localParts, centralBuf, end]);
}

module.exports = { createZip, crc32 };
