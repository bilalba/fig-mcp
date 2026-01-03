/**
 * FigReader - Reads and extracts .fig files
 *
 * .fig files are ZIP archives containing:
 * - canvas.fig: The main document data (kiwi binary format)
 * - meta.json: File metadata
 * - thumbnail.png: Preview image
 * - images/: Directory with image assets
 */

import { readFile } from "fs/promises";
import { inflateRaw } from "pako";
import type { FigMeta } from "./types.js";

// ZIP Central Directory Entry
interface CentralDirEntry {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface FigArchive {
  canvasFig: Uint8Array;
  meta: FigMeta;
  thumbnail?: Uint8Array;
  images: Map<string, Uint8Array>;
}

/**
 * Read a little-endian uint16 from buffer
 */
function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

/**
 * Read a little-endian uint32 from buffer
 */
function readUint32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24)
  ) >>> 0;
}

/**
 * Find the End of Central Directory record
 */
function findEOCD(data: Uint8Array): number {
  // EOCD signature: 0x06054b50
  // Search backwards from end of file (EOCD can have variable-length comment)
  const minEOCDSize = 22;
  const maxCommentSize = 65535;
  const searchStart = Math.max(0, data.length - minEOCDSize - maxCommentSize);

  for (let i = data.length - minEOCDSize; i >= searchStart; i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse the Central Directory to get file entries with correct sizes
 */
function parseCentralDirectory(data: Uint8Array): CentralDirEntry[] {
  const eocdOffset = findEOCD(data);
  if (eocdOffset === -1) {
    throw new Error("Cannot find End of Central Directory record");
  }

  const centralDirOffset = readUint32LE(data, eocdOffset + 16);
  const entryCount = readUint16LE(data, eocdOffset + 10);

  const entries: CentralDirEntry[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    // Central directory file header signature: 0x02014b50
    const signature = readUint32LE(data, offset);
    if (signature !== 0x02014b50) {
      throw new Error(`Invalid central directory signature at offset ${offset}`);
    }

    const compressionMethod = readUint16LE(data, offset + 10);
    const compressedSize = readUint32LE(data, offset + 20);
    const uncompressedSize = readUint32LE(data, offset + 24);
    const filenameLength = readUint16LE(data, offset + 28);
    const extraFieldLength = readUint16LE(data, offset + 30);
    const commentLength = readUint16LE(data, offset + 32);
    const localHeaderOffset = readUint32LE(data, offset + 42);

    const filenameStart = offset + 46;
    const filename = new TextDecoder().decode(
      data.slice(filenameStart, filenameStart + filenameLength)
    );

    entries.push({
      filename,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset += 46 + filenameLength + extraFieldLength + commentLength;
  }

  return entries;
}

/**
 * Extract file data using central directory info
 */
function extractFileData(
  data: Uint8Array,
  entry: CentralDirEntry
): Uint8Array {
  const localHeaderOffset = entry.localHeaderOffset;

  // Verify local file header signature
  const signature = readUint32LE(data, localHeaderOffset);
  if (signature !== 0x04034b50) {
    throw new Error(`Invalid local file header at offset ${localHeaderOffset}`);
  }

  const filenameLength = readUint16LE(data, localHeaderOffset + 26);
  const extraFieldLength = readUint16LE(data, localHeaderOffset + 28);

  const dataStart = localHeaderOffset + 30 + filenameLength + extraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;

  return data.slice(dataStart, dataEnd);
}

/**
 * Decompress file data
 */
function decompressData(
  compressedData: Uint8Array,
  compressionMethod: number
): Uint8Array {
  // Method 0 = stored (no compression)
  if (compressionMethod === 0) {
    return compressedData;
  }

  // Method 8 = deflate
  if (compressionMethod === 8) {
    return inflateRaw(compressedData);
  }

  throw new Error(`Unsupported compression method: ${compressionMethod}`);
}

/**
 * Read a .fig file from disk and extract its contents
 */
export async function readFigFile(filePath: string): Promise<FigArchive> {
  const data = await readFile(filePath);
  return parseFigArchive(new Uint8Array(data));
}

/**
 * Parse a .fig archive from a buffer
 */
export function parseFigArchive(data: Uint8Array): FigArchive {
  // Check for ZIP signature (PK..)
  if (data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new Error("Invalid .fig file: not a ZIP archive");
  }

  // Parse central directory to get accurate file info
  const entries = parseCentralDirectory(data);
  const files = new Map<string, Uint8Array>();

  for (const entry of entries) {
    // Skip directories
    if (entry.filename.endsWith("/")) {
      continue;
    }

    const compressedData = extractFileData(data, entry);
    const fileData = decompressData(compressedData, entry.compressionMethod);
    files.set(entry.filename, fileData);
  }

  // Extract required files
  const canvasFig = files.get("canvas.fig");
  if (!canvasFig) {
    throw new Error("Invalid .fig file: missing canvas.fig");
  }

  // Parse meta.json
  let meta: FigMeta = {};
  const metaJson = files.get("meta.json");
  if (metaJson) {
    try {
      meta = JSON.parse(new TextDecoder().decode(metaJson)) as FigMeta;
    } catch {
      console.warn("Failed to parse meta.json");
    }
  }

  // Get thumbnail if present
  const thumbnail = files.get("thumbnail.png");

  // Collect images
  const images = new Map<string, Uint8Array>();
  for (const [filename, fileData] of files) {
    if (filename.startsWith("images/")) {
      const imageName = filename.slice(7); // Remove "images/" prefix
      images.set(imageName, fileData);
    }
  }

  return {
    canvasFig,
    meta,
    thumbnail,
    images,
  };
}

/**
 * List all files in a .fig archive
 */
export async function listFigContents(filePath: string): Promise<string[]> {
  const data = await readFile(filePath);
  const entries = parseCentralDirectory(new Uint8Array(data));
  return entries.map((e) => e.filename);
}
