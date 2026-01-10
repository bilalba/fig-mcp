/**
 * KiwiParser - Parses canvas.fig binary using kiwi schema
 *
 * The canvas.fig file structure:
 * - Header: "fig-kiwi" magic bytes (8 bytes)
 * - Version: uint32 little-endian (4 bytes)
 * - Schema chunk length: uint32 little-endian (4 bytes)
 * - Schema chunk: deflate-compressed binary kiwi schema
 * - Data chunk length: uint32 little-endian (4 bytes)
 * - Data chunk: deflate-compressed document data encoded with the schema
 */

import * as kiwi from "kiwi-schema";
import { inflateRaw } from "pako";
import * as fzstd from "fzstd";
import type { GUID, NodeType, FigNode, DocumentNode } from "./types.js";

// ZSTD magic number
const ZSTD_MAGIC = 0xfd2fb528;

// Re-export ByteBuffer for external use
export const ByteBuffer = kiwi.ByteBuffer;

/**
 * Decompress a buffer that might be deflate or zstd compressed
 */
function decompressChunk(data: Uint8Array): Uint8Array {
  // Check for ZSTD magic
  const magic = readUint32LE(data, 0);
  if (magic === ZSTD_MAGIC) {
    return fzstd.decompress(data);
  }
  // Otherwise try deflate raw
  return inflateRaw(data);
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
 * Check if buffer starts with "fig-kiwi" magic
 */
function hasFigKiwiMagic(data: Uint8Array): boolean {
  const magic = "fig-kiwi";
  for (let i = 0; i < magic.length; i++) {
    if (data[i] !== magic.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

export interface ParsedCanvas {
  version: number;
  schema: kiwi.Schema;
  compiledSchema: ReturnType<typeof kiwi.compileSchema>;
  message: Record<string, unknown>;
  rawSchemaBuffer: Uint8Array;
}

/**
 * Parse canvas.fig binary data
 */
export function parseCanvasFig(data: Uint8Array): ParsedCanvas {
  // Check magic bytes
  if (!hasFigKiwiMagic(data)) {
    throw new Error("Invalid canvas.fig: missing fig-kiwi magic header");
  }

  let offset = 8; // Skip magic

  // Read version
  const version = readUint32LE(data, offset);
  offset += 4;

  // Read schema chunk (compressed)
  const schemaCompressedLength = readUint32LE(data, offset);
  offset += 4;
  const schemaCompressed = data.slice(offset, offset + schemaCompressedLength);
  offset += schemaCompressedLength;

  // Read data chunk (compressed)
  const dataCompressedLength = readUint32LE(data, offset);
  offset += 4;
  const dataCompressed = data.slice(offset, offset + dataCompressedLength);

  // Decompress both chunks (may be deflate or zstd)
  const schemaBuffer = decompressChunk(schemaCompressed);
  const dataBuffer = decompressChunk(dataCompressed);

  // Decode the binary schema
  const schema = kiwi.decodeBinarySchema(schemaBuffer);

  // Compile the schema for decoding data
  const compiledSchema = kiwi.compileSchema(schema);

  // Find the root message type (usually "Message" or "Document")
  const rootType = findRootMessageType(schema);

  // Decode the data using the compiled schema
  const decodeFn = compiledSchema[`decode${rootType}`];
  if (typeof decodeFn !== "function") {
    throw new Error(`Cannot find decoder for root type: ${rootType}`);
  }

  const message = decodeFn.call(compiledSchema, dataBuffer);

  return {
    version,
    schema,
    compiledSchema,
    message,
    rawSchemaBuffer: schemaBuffer,
  };
}

/**
 * Find the root message type in the schema
 * The root type for .fig files is always "Message" which contains nodeChanges[]
 */
function findRootMessageType(schema: kiwi.Schema): string {
  // Priority order - "Message" is the main container with nodeChanges
  const possibleRoots = ["Message", "Document", "Fig", "Root"];

  for (const rootName of possibleRoots) {
    const def = schema.definitions.find(d => d.name === rootName);
    if (def) {
      return def.name;
    }
  }

  // If no common root found, try the first MESSAGE type
  for (const def of schema.definitions) {
    if (def.kind === "MESSAGE") {
      return def.name;
    }
  }

  throw new Error("Cannot find root message type in schema");
}

/**
 * Convert a raw parsed GUID to our GUID type
 */
export function parseGUID(raw: unknown): GUID | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    sessionID: typeof obj["sessionID"] === "number" ? obj["sessionID"] : 0,
    localID: typeof obj["localID"] === "number" ? obj["localID"] : 0,
  };
}

/**
 * Format a GUID as a string for display
 */
export function formatGUID(guid: GUID | null): string {
  if (!guid) return "null";
  return `${guid.sessionID}:${guid.localID}`;
}

/**
 * Map numeric node type to string type
 */
export function getNodeTypeName(typeValue: unknown): NodeType {
  // Type values are typically stored as enum indices or strings
  // This mapping may need adjustment based on actual schema
  const typeMap: Record<number | string, NodeType> = {
    0: "DOCUMENT",
    1: "CANVAS",
    2: "FRAME",
    3: "GROUP",
    4: "VECTOR",
    5: "BOOLEAN_OPERATION",
    6: "STAR",
    7: "LINE",
    8: "ELLIPSE",
    9: "REGULAR_POLYGON",
    10: "RECTANGLE",
    11: "TEXT",
    12: "SLICE",
    13: "COMPONENT",
    14: "COMPONENT_SET",
    15: "INSTANCE",
    // String mappings
    DOCUMENT: "DOCUMENT",
    CANVAS: "CANVAS",
    FRAME: "FRAME",
    GROUP: "GROUP",
    VECTOR: "VECTOR",
    BOOLEAN_OPERATION: "BOOLEAN_OPERATION",
    STAR: "STAR",
    LINE: "LINE",
    ELLIPSE: "ELLIPSE",
    REGULAR_POLYGON: "REGULAR_POLYGON",
    RECTANGLE: "RECTANGLE",
    TEXT: "TEXT",
    SLICE: "SLICE",
    COMPONENT: "COMPONENT",
    COMPONENT_SET: "COMPONENT_SET",
    INSTANCE: "INSTANCE",
    STICKY: "STICKY",
    SHAPE_WITH_TEXT: "SHAPE_WITH_TEXT",
    CONNECTOR: "CONNECTOR",
    SECTION: "SECTION",
    TABLE: "TABLE",
    TABLE_CELL: "TABLE_CELL",
    WIDGET: "WIDGET",
  };

  if (typeValue !== undefined && typeValue !== null) {
    const mapped = typeMap[typeValue as number | string];
    if (mapped) return mapped;
  }

  return "FRAME"; // Default fallback
}

/**
 * Build a tree from the flat nodeChanges array using parentIndex references
 */
function buildTreeFromNodeChanges(nodeChanges: unknown[]): DocumentNode | null {
  // Create a map of guid -> node
  const nodeMap = new Map<string, FigNode & { children: FigNode[] }>();
  const childrenMap = new Map<string, FigNode[]>();
  let documentNode: (FigNode & { children: FigNode[] }) | null = null;

  // First pass: convert all nodes and build the map
  for (const change of nodeChanges) {
    if (!change || typeof change !== "object") continue;
    const changeObj = change as Record<string, unknown>;

    const node = convertToFigNode(change);
    if (!node) continue;

    // Add children array
    const nodeWithChildren = node as FigNode & { children: FigNode[] };
    nodeWithChildren.children = [];

    const guidKey = formatGUID(node.guid);
    nodeMap.set(guidKey, nodeWithChildren);

    // Track the document node
    if (changeObj["type"] === "DOCUMENT") {
      documentNode = nodeWithChildren;
    }

    // Track parent-child relationships
    const parentIndex = changeObj["parentIndex"] as Record<string, unknown> | undefined;
    if (parentIndex && parentIndex["guid"]) {
      const parentGuid = parseGUID(parentIndex["guid"]);
      if (parentGuid) {
        const parentKey = formatGUID(parentGuid);
        if (!childrenMap.has(parentKey)) {
          childrenMap.set(parentKey, []);
        }
        childrenMap.get(parentKey)!.push(nodeWithChildren);
      }
    }
  }

  // Second pass: connect children to parents
  for (const [parentKey, children] of childrenMap) {
    const parent = nodeMap.get(parentKey);
    if (parent) {
      parent.children = children;
    }
  }

  return documentNode as DocumentNode | null;
}

/**
 * Extract document tree from parsed message
 * This handles the specific structure of the kiwi format used in .fig files
 */
export function extractDocumentTree(message: Record<string, unknown>): DocumentNode | null {
  // Try direct document property (unlikely in .fig files)
  if (message["document"]) {
    return convertToFigNode(message["document"]) as DocumentNode;
  }

  // Try root property
  if (message["root"]) {
    return convertToFigNode(message["root"]) as DocumentNode;
  }

  // Try nodeChanges array (the standard format for .fig files)
  // NodeChanges is a flat array - we need to rebuild the tree using parentIndex
  const nodeChanges = message["nodeChanges"] as unknown[];
  if (Array.isArray(nodeChanges) && nodeChanges.length > 0) {
    return buildTreeFromNodeChanges(nodeChanges);
  }

  // Try to find nodes array
  const nodes = message["nodes"] as unknown[];
  if (Array.isArray(nodes) && nodes.length > 0) {
    return buildTreeFromNodeChanges(nodes);
  }

  return null;
}

function inferFontWeight(styleName: string): number {
  const name = styleName.toLowerCase();
  if (name.includes("thin")) return 100;
  if (name.includes("extra light") || name.includes("ultra light")) return 200;
  if (name.includes("light")) return 300;
  if (name.includes("regular") || name.includes("normal") || name.includes("book")) return 400;
  if (name.includes("medium")) return 500;
  if (name.includes("semi bold") || name.includes("semibold") || name.includes("demi")) return 600;
  if (name.includes("bold")) return 700;
  if (name.includes("extra bold") || name.includes("extrabold") || name.includes("heavy")) return 800;
  if (name.includes("black") || name.includes("ultra black")) return 900;
  return 400;
}

function inferFontStyle(styleName: string): "normal" | "italic" | "oblique" {
  const name = styleName.toLowerCase();
  if (name.includes("italic")) return "italic";
  if (name.includes("oblique")) return "oblique";
  return "normal";
}

/**
 * Convert a raw parsed node to our FigNode type
 */
function convertToFigNode(raw: unknown): FigNode | null {
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;

  const node: FigNode = {
    guid: parseGUID(obj["guid"] || obj["id"]) || { sessionID: 0, localID: 0 },
    type: getNodeTypeName(obj["type"]),
    name: String(obj["name"] || "Unnamed"),
    visible: obj["visible"] !== false,
  } as FigNode;

  // Copy over additional properties
  const propsToKeep = [
    "x", "y", "width", "height", "rotation", "transform",
    "opacity", "blendMode",
    "fills", "strokes", "strokeWeight",
    "strokeAlign", "strokeCap", "strokeJoin", "strokeDashes", "strokeWeights",
    "cornerRadius", "effects",
    "constraints", "layoutMode",
    "characters", "style",
    "backgroundColor",
    "clipsContent", "isMask",
    "fillGeometry", "strokeGeometry", "vectorData",
  ];

  // Use an indexable type for property assignment
  const nodeRecord = node as unknown as Record<string, unknown>;
  const fillPaints = obj["fills"] ?? obj["fillPaints"];
  if (fillPaints !== undefined) {
    nodeRecord["fills"] = fillPaints;
  }

  const strokePaints = obj["strokes"] ?? obj["strokePaints"];
  if (strokePaints !== undefined) {
    nodeRecord["strokes"] = strokePaints;
  }

  for (const prop of propsToKeep) {
    if (obj[prop] !== undefined) {
      nodeRecord[prop] = obj[prop];
    }
  }

  const textData = obj["textData"] as Record<string, unknown> | undefined;
  if (nodeRecord["characters"] === undefined && textData?.["characters"]) {
    nodeRecord["characters"] = textData["characters"];
  }

  // Preserve derivedTextData for text wrapping
  const derivedTextData = obj["derivedTextData"] as Record<string, unknown> | undefined;
  if (derivedTextData) {
    const layoutSize = derivedTextData["layoutSize"] as Record<string, unknown> | undefined;
    const baselines = derivedTextData["baselines"] as Array<Record<string, unknown>> | undefined;

    if (layoutSize && baselines) {
      nodeRecord["derivedTextData"] = {
        layoutSize: {
          x: typeof layoutSize["x"] === "number" ? layoutSize["x"] : 0,
          y: typeof layoutSize["y"] === "number" ? layoutSize["y"] : 0,
        },
        baselines: baselines.map(baseline => {
          const pos = baseline["position"] as Record<string, unknown> | undefined;
          return {
            position: {
              x: typeof pos?.["x"] === "number" ? pos["x"] : 0,
              y: typeof pos?.["y"] === "number" ? pos["y"] : 0,
            },
            width: typeof baseline["width"] === "number" ? baseline["width"] : 0,
            lineY: typeof baseline["lineY"] === "number" ? baseline["lineY"] : 0,
            lineHeight: typeof baseline["lineHeight"] === "number" ? baseline["lineHeight"] : 0,
            lineAscent: typeof baseline["lineAscent"] === "number" ? baseline["lineAscent"] : 0,
            firstCharacter: typeof baseline["firstCharacter"] === "number" ? baseline["firstCharacter"] : 0,
            endCharacter: typeof baseline["endCharacter"] === "number" ? baseline["endCharacter"] : 0,
          };
        }),
      };
    }
  }

  if (nodeRecord["style"] === undefined) {
    const fontName = obj["fontName"] as Record<string, unknown> | undefined;
    const fontSize = typeof obj["fontSize"] === "number" ? obj["fontSize"] : undefined;
    const textAlignHorizontal =
      typeof obj["textAlignHorizontal"] === "string"
        ? obj["textAlignHorizontal"]
        : "LEFT";
    const textAlignVertical =
      typeof obj["textAlignVertical"] === "string"
        ? obj["textAlignVertical"]
        : "TOP";
    const letterSpacing = obj["letterSpacing"] as Record<string, unknown> | undefined;
    const lineHeight = obj["lineHeight"] as Record<string, unknown> | undefined;
    const fontStyleName = typeof fontName?.["style"] === "string" ? fontName["style"] : "";
    const fontWeightValue =
      typeof obj["fontWeight"] === "number" ? obj["fontWeight"] : inferFontWeight(fontStyleName);
    const fontStyleValue = inferFontStyle(fontStyleName);

    if (fontName || fontSize || letterSpacing || lineHeight) {
      nodeRecord["style"] = {
        fontFamily: typeof fontName?.["family"] === "string" ? fontName["family"] : "Inter",
        fontPostScriptName:
          typeof fontName?.["postscript"] === "string" ? fontName["postscript"] : undefined,
        fontStyle: fontStyleValue,
        fontWeight: fontWeightValue,
        fontSize: fontSize ?? 14,
        textAlignHorizontal,
        textAlignVertical,
        letterSpacing:
          typeof letterSpacing?.["value"] === "number" ? letterSpacing["value"] : 0,
        lineHeightPx:
          lineHeight?.["units"] === "PIXELS" && typeof lineHeight?.["value"] === "number"
            ? lineHeight["value"]
            : undefined,
        lineHeightPercent:
          lineHeight?.["units"] === "PERCENT" && typeof lineHeight?.["value"] === "number"
            ? lineHeight["value"]
            : undefined,
        lineHeightUnit:
          lineHeight?.["units"] === "PERCENT"
            ? "FONT_SIZE_%"
            : lineHeight?.["units"] === "PIXELS"
            ? "PIXELS"
            : "INTRINSIC_%",
        textCase:
          typeof obj["textCase"] === "string" ? (obj["textCase"] as string) : undefined,
        textDecoration:
          typeof obj["textDecoration"] === "string"
            ? (obj["textDecoration"] as string)
            : undefined,
      };
    }
  }

  const bounds =
    (obj["absoluteBoundingBox"] as Record<string, unknown> | undefined) ??
    (obj["absoluteRenderBounds"] as Record<string, unknown> | undefined) ??
    (obj["bounds"] as Record<string, unknown> | undefined);

  if (bounds) {
    if (nodeRecord["x"] === undefined && typeof bounds["x"] === "number") {
      nodeRecord["x"] = bounds["x"];
    }
    if (nodeRecord["y"] === undefined && typeof bounds["y"] === "number") {
      nodeRecord["y"] = bounds["y"];
    }
    if (nodeRecord["width"] === undefined && typeof bounds["width"] === "number") {
      nodeRecord["width"] = bounds["width"];
    }
    if (nodeRecord["height"] === undefined && typeof bounds["height"] === "number") {
      nodeRecord["height"] = bounds["height"];
    }
  }

  const size = obj["size"] as Record<string, unknown> | undefined;
  if (size && typeof size["x"] === "number" && typeof size["y"] === "number") {
    // Preserve original size field for vector scaling
    nodeRecord["size"] = { x: size["x"], y: size["y"] };
    if (nodeRecord["width"] === undefined) {
      nodeRecord["width"] = size["x"];
    }
    if (nodeRecord["height"] === undefined) {
      nodeRecord["height"] = size["y"];
    }
  }

  const transform = obj["transform"] as Record<string, unknown> | undefined;
  if (transform) {
    if (nodeRecord["x"] === undefined && typeof transform["m02"] === "number") {
      nodeRecord["x"] = transform["m02"];
    }
    if (nodeRecord["y"] === undefined && typeof transform["m12"] === "number") {
      nodeRecord["y"] = transform["m12"];
    }
  }

  // Preserve symbolData for INSTANCE nodes (references the component/symbol this instance is based on)
  const symbolData = obj["symbolData"] as Record<string, unknown> | undefined;
  if (symbolData) {
    const symbolIdRaw = symbolData["symbolID"] as Record<string, unknown> | undefined;
    nodeRecord["symbolData"] = {
      symbolID: symbolIdRaw ? parseGUID(symbolIdRaw) : undefined,
      symbolOverrides: symbolData["symbolOverrides"],
    };
  }

  // Handle children
  const children = obj["children"] as unknown[];
  if (Array.isArray(children)) {
    nodeRecord["children"] = children
      .map(convertToFigNode)
      .filter((n): n is FigNode => n !== null);
  }

  return node;
}

/**
 * Convert image hash bytes object to hex string filename
 * Images in .fig files are referenced by SHA-1 hash (20 bytes)
 * The hash is stored as an object: {"0": byte, "1": byte, ..., "19": byte}
 * The filename in images/ folder is the hex representation of these bytes
 */
export function hashBytesToHex(hashObj: Record<string, number>): string {
  const bytes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const byte = hashObj[String(i)];
    if (byte !== undefined) {
      bytes.push(byte);
    }
  }
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get schema information for debugging/inspection
 */
export function getSchemaInfo(schema: kiwi.Schema): {
  definitionCount: number;
  definitions: Array<{
    name: string;
    kind: string;
    fieldCount: number;
    fields: Array<{ name: string; type: string | null; isArray: boolean }>;
  }>;
} {
  return {
    definitionCount: schema.definitions.length,
    definitions: schema.definitions.map((def) => ({
      name: def.name,
      kind: def.kind,
      fieldCount: def.fields.length,
      fields: def.fields.map((f) => ({
        name: f.name,
        type: f.type,
        isArray: f.isArray,
      })),
    })),
  };
}
