/**
 * Generate minimal valid PNG icons for the AirBrowse Chrome extension.
 *
 * Creates solid #007ACC colored square PNGs at 16x16, 48x48, and 128x128.
 * Run with: node generate-icons.js
 *
 * Uses raw PNG encoding (no dependencies). Each PNG is an uncompressed
 * RGBA image using zlib stored blocks.
 */

const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput));

  return Buffer.concat([length, typeBytes, data, crcVal]);
}

function generatePNG(size) {
  // Color: #007ACC → R=0, G=122, B=204, A=255
  const r = 0, g = 122, b = 204, a = 255;

  // Build raw image data: each row starts with filter byte 0 (None)
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const offset = 1 + x * 4;
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = a;
    }
    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);  // width
  ihdr.writeUInt32BE(size, 4);  // height
  ihdr[8] = 8;                  // bit depth
  ihdr[9] = 6;                  // color type: RGBA
  ihdr[10] = 0;                 // compression
  ihdr[11] = 0;                 // filter
  ihdr[12] = 0;                 // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const sizes = [16, 48, 128];
const dir = __dirname;

sizes.forEach((size) => {
  const png = generatePNG(size);
  const path = `${dir}/icon${size}.png`;
  fs.writeFileSync(path, png);
  console.log(`Created ${path} (${png.length} bytes)`);
});

console.log('Done!');
