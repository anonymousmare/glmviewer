const decoder = new TextDecoder("utf-8", { fatal: true });
const u16 = (view, offset) => view.getUint16(offset, true);
const u32 = (view, offset) => view.getUint32(offset, true);
function u64(view, offset) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This archive contains offsets too large for this browser.");
  return Number(value);
}

export function cleanPath(value) {
  return value.replaceAll("\\", "/").replace(/^(\.\/|\/)+/, "").split("/").filter((part) => part && part !== "." && part !== "..").join("/");
}
const readSlice = async (file, start, length) => new Uint8Array(await file.slice(start, start + length).arrayBuffer());
function decodeName(bytes) {
  const end = bytes.at(-1) === 0 ? bytes.length - 1 : bytes.length;
  return decoder.decode(bytes.subarray(0, end));
}

export async function parseGlm(file) {
  // Supreme Ruler GLM: a directory/name table followed by uncompressed payloads.
  let readSize = Math.min(file.size, 1024 * 1024);
  while (readSize) {
    const bytes = await readSlice(file, 0, readSize);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cursor = 0;
    const need = (amount) => { if (cursor + amount > bytes.length) throw new RangeError("INDEX_BUFFER_END"); };
    try {
      need(4); const directoryCount = u32(view, cursor); cursor += 4;
      if (!directoryCount || directoryCount > 1_000_000) throw new Error("Not a recognized GLM archive.");
      const entries = [];
      for (let directoryIndex = 0; directoryIndex < directoryCount; directoryIndex++) {
        need(4); const pathLength = u32(view, cursor); cursor += 4;
        if (!pathLength || pathLength > 1_048_576) throw new Error("The GLM directory table is invalid.");
        need(pathLength + 4);
        const path = cleanPath(decodeName(bytes.subarray(cursor, cursor + pathLength))); cursor += pathLength;
        const fileCount = u32(view, cursor); cursor += 4;
        if (fileCount > 10_000_000) throw new Error("The GLM file table is invalid.");
        for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
          need(4); const nameLength = u32(view, cursor); cursor += 4;
          if (!nameLength || nameLength > 1_048_576) throw new Error("The GLM filename table is invalid.");
          need(nameLength + 17);
          const filename = cleanPath(decodeName(bytes.subarray(cursor, cursor + nameLength))); cursor += nameLength;
          const offset = u64(view, cursor); cursor += 8;
          const size = u64(view, cursor); cursor += 8;
          const flags = bytes[cursor++];
          if (flags !== 0 || offset + size > file.size) throw new Error("The GLM file table contains an invalid entry.");
          if (filename) entries.push({ name: [path, filename].filter(Boolean).join("/"), size, compressedSize: size, offset, method: "glm", isDirectory: false });
        }
      }
      if (entries.some((entry) => entry.offset < cursor)) throw new Error("The GLM index overlaps its file data.");
      return { format: "GLM", entries };
    } catch (error) {
      if (!(error instanceof RangeError) || error.message !== "INDEX_BUFFER_END" || readSize === file.size) throw error;
      readSize = Math.min(file.size, readSize * 2);
    }
  }
  throw new Error("The archive is empty.");
}

export async function parseZip(file) {
  const tailSize = Math.min(file.size, 65557), tail = await readSlice(file, file.size - tailSize, tailSize);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(view, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("This is not a supported GLM or ZIP archive.");
  const entryCount = u16(view, end + 10), directorySize = u32(view, end + 12), directoryOffset = u32(view, end + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported yet.");
  const directory = await readSlice(file, directoryOffset, directorySize);
  const dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries = []; let cursor = 0;
  while (cursor + 46 <= directory.length && entries.length < entryCount) {
    if (u32(dirView, cursor) !== 0x02014b50) throw new Error("The ZIP directory is damaged or unreadable.");
    const flags = u16(dirView, cursor + 8), method = u16(dirView, cursor + 10);
    const compressedSize = u32(dirView, cursor + 20), size = u32(dirView, cursor + 24);
    const nameLength = u16(dirView, cursor + 28), extraLength = u16(dirView, cursor + 30), commentLength = u16(dirView, cursor + 32);
    const rawName = directory.subarray(cursor + 46, cursor + 46 + nameLength), decodedName = decodeName(rawName), name = cleanPath(decodedName);
    if (name) entries.push({ name, isDirectory: decodedName.endsWith("/"), size, compressedSize, method, flags, offset: u32(dirView, cursor + 42) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { format: "ZIP", entries };
}

export async function parseArchive(file) {
  const signature = await readSlice(file, 0, Math.min(4, file.size));
  return signature.length === 4 && signature[0] === 0x50 && signature[1] === 0x4b ? parseZip(file) : parseGlm(file);
}

export async function extractEntry(file, entry) {
  if (entry.method === "glm") return file.slice(entry.offset, entry.offset + entry.size);
  if (entry.flags & 1) throw new Error("Password-protected entries cannot be extracted.");
  const header = await readSlice(file, entry.offset, 30), view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (u32(view, 0) !== 0x04034b50) throw new Error("The file header is damaged.");
  const dataOffset = entry.offset + 30 + u16(view, 26) + u16(view, 28);
  const compressed = file.slice(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8 && typeof DecompressionStream !== "undefined") return new Response(compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  throw new Error(`Compression method ${entry.method} is not supported by this browser.`);
}

const zipEncoder = new TextEncoder();
let crcTable;
function crc32(bytes) {
  if (!crcTable) crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function zipRecord(length, values) {
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  for (const [offset, size, value] of values) view[`setUint${size}`](offset, value, true);
  return bytes;
}

export async function createZip(file, entries, onProgress = () => {}) {
  if (!entries.length) throw new Error("This folder contains no files to extract.");
  if (entries.length > 0xffff) throw new Error("This selection has too many files for a browser-created ZIP.");
  const parts = [], directoryParts = []; let offset = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], blob = await extractEntry(file, entry);
    const data = new Uint8Array(await blob.arrayBuffer()), name = zipEncoder.encode(cleanPath(entry.zipName || entry.name));
    if (!name.length || name.length > 0xffff || data.length > 0xffffffff || offset > 0xffffffff) throw new Error("This selection is too large for a browser-created ZIP.");
    const crc = crc32(data);
    const local = zipRecord(30, [[0, 32, 0x04034b50], [4, 16, 20], [6, 16, 0x0800], [8, 16, 0], [14, 32, crc], [18, 32, data.length], [22, 32, data.length], [26, 16, name.length]]);
    const central = zipRecord(46, [[0, 32, 0x02014b50], [4, 16, 20], [6, 16, 20], [8, 16, 0x0800], [10, 16, 0], [16, 32, crc], [20, 32, data.length], [24, 32, data.length], [28, 16, name.length], [42, 32, offset]]);
    parts.push(local, name, data); directoryParts.push(central, name);
    offset += local.length + name.length + data.length;
    onProgress(index + 1, entries.length);
  }
  const directory = new Blob(directoryParts), end = zipRecord(22, [[0, 32, 0x06054b50], [8, 16, entries.length], [10, 16, entries.length], [12, 32, directory.size], [16, 32, offset]]);
  if (offset + directory.size > 0xffffffff) throw new Error("This selection is too large for a browser-created ZIP.");
  return new Blob([...parts, directory, end], { type: "application/zip" });
}
