import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrandingSlot, validateRasterImageBase64 } from './imageValidation.js';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function pngChunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}
function png(width = 2, height = 3) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([pngSignature, pngChunk('IHDR', header), pngChunk('iTXt', Buffer.from('owner data')), pngChunk('IDAT', Buffer.from([1, 2, 3])), pngChunk('IEND', Buffer.alloc(0))]);
}
function jpeg() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x06, 1, 2, 3, 4,
    0xff, 0xc0, 0x00, 0x0b, 8, 0, 3, 0, 2, 1, 1, 0x11, 0,
    0xff, 0xda, 0x00, 0x02,
    0x11, 0x22, 0xff, 0xd9,
  ]);
}
function webp() {
  const imageData = Buffer.from([0x2f, 1, 0x80, 0, 0x00]); // VP8L: 2x3
  const chunk = Buffer.alloc(8 + imageData.length + 1);
  chunk.write('VP8L', 0, 'ascii');
  chunk.writeUInt32LE(imageData.length, 4);
  imageData.copy(chunk, 8);
  chunk[chunk.length - 1] = 0;
  const body = Buffer.concat([Buffer.from('WEBP'), chunk]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

test('raster uploads validate bytes and strip PNG/JPEG/WebP metadata where supported', () => {
  for (const [buffer, mime, width, height] of [[png(), 'image/png', 2, 3], [jpeg(), 'image/jpeg', 2, 3], [webp(), 'image/webp', 2, 3]]) {
    const result = validateRasterImageBase64(buffer.toString('base64'));
    assert.equal(result.contentType, mime);
    assert.equal(result.width, width);
    assert.equal(result.height, height);
    assert.ok(Buffer.isBuffer(result.bytes));
  }
  assert.equal(validateRasterImageBase64(png().toString('base64')).bytes.includes(Buffer.from('iTXt')), false);
  assert.equal(validateRasterImageBase64(jpeg().toString('base64')).bytes.includes(Buffer.from([0xff, 0xe1])), false);
  assert.throws(() => validateRasterImageBase64(Buffer.from('<svg></svg>').toString('base64')), { code: 'INVALID_IMAGE' });
  assert.throws(() => validateRasterImageBase64(png(12001, 1).toString('base64')), { code: 'INVALID_IMAGE' });
  assert.throws(() => validateRasterImageBase64(png().toString('base64'), { maxBytes: 20 }), { code: 'INVALID_IMAGE' });
});

test('branding slots are a fixed allowlist', () => {
  assert.equal(validateBrandingSlot('applicationLogo'), true);
  assert.equal(validateBrandingSlot('schoolSeal'), true);
  assert.equal(validateBrandingSlot('landingHeroPhoto'), true);
  assert.equal(validateBrandingSlot('landingCommunityPhoto'), true);
  assert.equal(validateBrandingSlot('../../incidents'), false);
  assert.equal(validateBrandingSlot('content'), false);
});
