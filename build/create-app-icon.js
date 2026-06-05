const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const assetsDir = path.join(__dirname, "..", "assets");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function readChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(pngSignature)) {
    throw new Error("Invalid PNG signature.");
  }

  const chunks = [];
  let offset = 8;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;

    if (type === "IEND") break;
  }

  return chunks;
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function decodePng(filePath) {
  const chunks = readChunks(fs.readFileSync(filePath));
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR").data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format in ${filePath}.`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)));
  const rgba = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let outputOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;

    const row = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= channels ? previous[x - channels] || 0 : 0;

      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      if (filter === 2) row[x] = (row[x] + up) & 0xff;
      if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
      if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      rgba[outputOffset] = row[source];
      rgba[outputOffset + 1] = row[source + 1];
      rgba[outputOffset + 2] = row[source + 2];
      rgba[outputOffset + 3] = channels === 4 ? row[source + 3] : 255;
      outputOffset += 4;
    }

    previous = row;
  }

  return { width, height, rgba };
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    rgba.copy(raw, rowOffset + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    pngSignature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", zlib.deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function sampleBilinear(image, x, y, channel) {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(image.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(image.height - 1, y0 + 1));
  const xWeight = x - x0;
  const yWeight = y - y0;

  const topLeft = image.rgba[(y0 * image.width + x0) * 4 + channel];
  const topRight = image.rgba[(y0 * image.width + x1) * 4 + channel];
  const bottomLeft = image.rgba[(y1 * image.width + x0) * 4 + channel];
  const bottomRight = image.rgba[(y1 * image.width + x1) * 4 + channel];
  const top = topLeft + (topRight - topLeft) * xWeight;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;

  return Math.round(top + (bottom - top) * yWeight);
}

function scaleBilinear(image, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  const xRatio = image.width / width;
  const yRatio = image.height / height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;

      const sourceX = (x + 0.5) * xRatio - 0.5;
      const sourceY = (y + 0.5) * yRatio - 0.5;
      rgba[target] = sampleBilinear(image, sourceX, sourceY, 0);
      rgba[target + 1] = sampleBilinear(image, sourceX, sourceY, 1);
      rgba[target + 2] = sampleBilinear(image, sourceX, sourceY, 2);
      rgba[target + 3] = sampleBilinear(image, sourceX, sourceY, 3);
    }
  }

  return { width, height, rgba };
}

const sourceIcon = decodePng(path.join(assetsDir, "ZeFoX_icon_with_background_1_omx8nj.png"));

fs.writeFileSync(
  path.join(assetsDir, "app-icon.png"),
  encodePng(scaleBilinear(sourceIcon, 512, 512))
);

const iconSources = [
  { size: 16, file: "app-icon-16.png" },
  { size: 24, file: "app-icon-24.png" },
  { size: 32, file: "app-icon-32.png" },
  { size: 48, file: "app-icon-48.png" },
  { size: 64, file: "app-icon-64.png" },
  { size: 128, file: "app-icon-128.png" },
  { size: 256, file: "app-icon-256.png" },
];

for (const icon of iconSources) {
  fs.writeFileSync(
    path.join(assetsDir, icon.file),
    encodePng(scaleBilinear(sourceIcon, icon.size, icon.size))
  );
}

const images = iconSources.map((source) => ({
  ...source,
  data: fs.readFileSync(path.join(assetsDir, source.file)),
}));

const headerSize = 6;
const directorySize = images.length * 16;
let imageOffset = headerSize + directorySize;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

const entries = images.map((image) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(image.size === 256 ? 0 : image.size, 0);
  entry.writeUInt8(image.size === 256 ? 0 : image.size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(imageOffset, 12);
  imageOffset += image.data.length;
  return entry;
});

fs.writeFileSync(
  path.join(assetsDir, "app.ico"),
  Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
);
