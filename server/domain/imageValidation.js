import { BRANDING_SLOT_NAMES } from './branding.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DIMENSION = 12000;
const MAX_PIXELS = 48_000_000;

function fail(message = 'Upload a valid PNG, JPEG, or WebP image.') {
  const error = new Error(message);
  error.code = 'INVALID_IMAGE';
  return error;
}

function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw fail('Image dimensions exceed the supported limit.');
  return { width, height };
}

function parsePng(input) {
  if (input.length < 33 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) throw fail();
  let offset = 8;
  let width;
  let height;
  const chunks = [];
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > input.length || end > input.length) throw fail();
    const type = input.toString('ascii', offset + 4, offset + 8);
    const chunk = input.subarray(offset, end);
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) throw fail();
      width = input.readUInt32BE(offset + 8);
      height = input.readUInt32BE(offset + 12);
    }
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(type)) chunks.push(chunk);
    offset = end;
    if (type === 'IEND') break;
  }
  if (!width || !height || offset !== input.length || input.toString('ascii', offset - 8, offset - 4) !== 'IEND') throw fail();
  return { bytes: Buffer.concat([PNG_SIGNATURE, ...chunks]), contentType: 'image/png', ...dimensions(width, height) };
}

function parseJpeg(input) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8 || input.at(-2) !== 0xff || input.at(-1) !== 0xd9) throw fail();
  let offset = 2;
  let width;
  let height;
  const chunks = [input.subarray(0, 2)];
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < input.length) {
    if (input[offset] !== 0xff) throw fail();
    const markerStart = offset;
    while (input[offset] === 0xff) offset += 1;
    const marker = input[offset++];
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      if (offset + 2 > input.length) throw fail();
      const length = input.readUInt16BE(offset);
      if (length < 2 || offset + length > input.length) throw fail();
      chunks.push(input.subarray(markerStart));
      offset = input.length;
      break;
    }
    if ([0xd8, 0x01, ...Array.from({ length: 7 }, (_, index) => 0xd0 + index)].includes(marker)) {
      chunks.push(input.subarray(markerStart, offset));
      continue;
    }
    if (offset + 2 > input.length) throw fail();
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) throw fail();
    const end = offset + length;
    if (startOfFrame.has(marker)) {
      if (length < 8) throw fail();
      height = input.readUInt16BE(offset + 3);
      width = input.readUInt16BE(offset + 5);
    }
    // EXIF/XMP (APP1), IPTC (APP13), and comments may contain identifying metadata.
    if (!(marker === 0xe1 || marker === 0xed || marker === 0xfe)) chunks.push(input.subarray(markerStart, end));
    offset = end;
  }
  if (!width || !height || offset !== input.length) throw fail();
  return { bytes: Buffer.concat(chunks), contentType: 'image/jpeg', ...dimensions(width, height) };
}

function parseWebp(input) {
  if (input.length < 20 || input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WEBP'
    || input.readUInt32LE(4) + 8 !== input.length) throw fail();
  let width;
  let height;
  let offset = 12;
  const chunks = [];
  while (offset + 8 <= input.length) {
    const type = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const paddedSize = size + (size % 2);
    const end = offset + 8 + paddedSize;
    if (end > input.length) throw fail();
    const data = input.subarray(offset + 8, offset + 8 + size);
    if (type === 'VP8X' && data.length >= 10) {
      width = 1 + data.readUIntLE(4, 3);
      height = 1 + data.readUIntLE(7, 3);
    } else if (type === 'VP8 ' && data.length >= 10 && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L' && data.length >= 5 && data[0] === 0x2f) {
      width = 1 + data[1] + ((data[2] & 0x3f) << 8);
      height = 1 + (data[2] >> 6) + (data[3] << 2) + ((data[4] & 0x0f) << 10);
    }
    if (type !== 'EXIF' && type !== 'XMP ') {
      const retainedChunk = Buffer.from(input.subarray(offset, end));
      if (type === 'VP8X') retainedChunk[8] &= ~0x0c; // EXIF and XMP feature flags.
      chunks.push(retainedChunk);
    }
    offset = end;
  }
  if (offset !== input.length || !width || !height) throw fail();
  const body = Buffer.concat(chunks);
  const header = Buffer.from('RIFF');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length + 4);
  return { bytes: Buffer.concat([header, size, Buffer.from('WEBP'), body]), contentType: 'image/webp', ...dimensions(width, height) };
}

export function validateRasterImageBase64(value, { maxBytes = 2 * 1024 * 1024 } = {}) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw fail();
  const input = Buffer.from(value, 'base64');
  if (input.length < 12 || input.length > maxBytes || input.toString('base64') !== value) throw fail('Image size or encoding is invalid.');
  let parsed;
  if (input.subarray(0, 8).equals(PNG_SIGNATURE)) parsed = parsePng(input);
  else if (input[0] === 0xff && input[1] === 0xd8) parsed = parseJpeg(input);
  else if (input.toString('ascii', 0, 4) === 'RIFF') parsed = parseWebp(input);
  else throw fail();
  if (parsed.bytes.length > maxBytes) throw fail('Image size exceeds the supported limit.');
  return { ...parsed, sizeBytes: parsed.bytes.length };
}

export function validateBrandingSlot(slot) {
  return BRANDING_SLOT_NAMES.includes(slot);
}
