/**
 * Fig Parser - Main entry point for parsing .fig files
 */

import { readFigFile, parseFigArchive, listFigContents } from "./fig-reader.js";
import { parseCanvasFig, extractDocumentTree, getSchemaInfo, formatGUID } from "./kiwi-parser.js";
import {
  simplifyNode,
  getDocumentSummary,
  findNodesByType,
  findNodesByName,
  countNodesByType,
} from "./layout-inference.js";
import type { ParsedFigFile, DocumentNode, FigNode, SimplifiedNode } from "./types.js";

export * from "./types.js";
export * from "./fig-reader.js";
export * from "./kiwi-parser.js";
export * from "./layout-inference.js";

/**
 * Build an O(1) GUID lookup index for a document tree.
 */
export function buildNodeIdIndex(document: FigNode): Map<string, FigNode> {
  const index = new Map<string, FigNode>();

  function walk(node: FigNode): void {
    index.set(formatGUID(node.guid), node);
    if (node.children) {
      for (const child of node.children) {
        walk(child as FigNode);
      }
    }
  }

  walk(document);
  return index;
}

/**
 * Build a GUID -> path lookup index (path uses GUID segments with "/" separators).
 */
export function buildNodePathIndex(document: FigNode): Map<string, string> {
  const index = new Map<string, string>();

  function walk(node: FigNode, path: string): void {
    const nodeId = formatGUID(node.guid);
    const nodePath = path ? `${path}/${nodeId}` : nodeId;
    index.set(nodeId, nodePath);
    if (node.children) {
      for (const child of node.children) {
        walk(child as FigNode, nodePath);
      }
    }
  }

  walk(document, "");
  return index;
}

/**
 * Parse a .fig file completely
 */
export async function parseFigFile(filePath: string): Promise<ParsedFigFile> {
  // Read and extract the archive
  const archive = await readFigFile(filePath);

  // Parse the canvas.fig binary
  const parsed = parseCanvasFig(archive.canvasFig);

  // Extract document tree
  const document = extractDocumentTree(parsed.message);

  if (!document) {
    throw new Error("Could not extract document tree from fig file");
  }

  return {
    version: parsed.version,
    schema: parsed.schema,
    document,
    images: archive.images,
    thumbnail: archive.thumbnail,
    blobs: (parsed.message as { blobs?: Array<{ bytes: Uint8Array }> }).blobs,
    meta: archive.meta,
    rawMessage: parsed.message,
  };
}

/**
 * Parse a .fig file and return simplified structure for MCP
 */
export async function parseFigFileSimplified(filePath: string, maxDepth = 10): Promise<{
  meta: ParsedFigFile["meta"];
  document: SimplifiedNode | null;
  stats: {
    version: number;
    nodeCount: Record<string, number>;
    imageCount: number;
  };
}> {
  const parsed = await parseFigFile(filePath);

  return {
    meta: parsed.meta,
    document: simplifyNode(parsed.document, 0, maxDepth),
    stats: {
      version: parsed.version,
      nodeCount: countNodesByType(parsed.document),
      imageCount: parsed.images.size,
    },
  };
}

/**
 * Get raw schema information from a .fig file (for debugging)
 */
export async function getFigSchema(filePath: string): Promise<{
  version: number;
  schemaInfo: ReturnType<typeof getSchemaInfo>;
}> {
  const archive = await readFigFile(filePath);
  const parsed = parseCanvasFig(archive.canvasFig);

  return {
    version: parsed.version,
    schemaInfo: getSchemaInfo(parsed.schema),
  };
}

/**
 * Dump raw message content from a .fig file (for debugging)
 */
export async function getFigRawMessage(filePath: string): Promise<{
  version: number;
  message: Record<string, unknown>;
}> {
  const archive = await readFigFile(filePath);
  const parsed = parseCanvasFig(archive.canvasFig);

  return {
    version: parsed.version,
    message: parsed.message,
  };
}
