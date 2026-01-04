/**
 * Web Viewer HTTP Server
 *
 * Wraps the existing fig-mcp parser and renderer to serve a web-based viewer.
 * Does not modify any existing code - just imports and uses public APIs.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFigFile, buildNodeIdIndex } from "../parser/index.js";
import { formatGUID, parseGUID } from "../parser/kiwi-parser.js";
import { renderScreen } from "../renderer/index.js";
import type { FigNode, SceneNode } from "../parser/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache parsed files in memory
const fileCache = new Map<string, {
  document: FigNode;
  images: Map<string, Uint8Array>;
  blobs: Array<{ bytes: Uint8Array }>;
  nodeIndex: Map<string, FigNode>;
  rawNodeIndex: Map<string, Record<string, unknown>>;
  meta: Record<string, unknown>;
}>();

interface ServerOptions {
  port?: number;
  figFile?: string;
}

function serializeNode(node: FigNode, depth = 0, maxDepth = 50): unknown {
  if (depth > maxDepth) return null;

  const scene = node as SceneNode;
  const base: Record<string, unknown> = {
    id: formatGUID(node.guid),
    type: node.type,
    name: node.name,
  };

  // Include bounds
  if (scene.x !== undefined) base.x = scene.x;
  if (scene.y !== undefined) base.y = scene.y;
  if (scene.width !== undefined) base.width = scene.width;
  if (scene.height !== undefined) base.height = scene.height;
  if (scene.rotation !== undefined) base.rotation = scene.rotation;

  // Include visibility
  if (scene.visible !== undefined) base.visible = scene.visible;
  if (scene.opacity !== undefined) base.opacity = scene.opacity;

  // Include styling (simplified for tree view)
  if (scene.fills && scene.fills.length > 0) {
    base.hasFills = true;
  }
  if (scene.strokes && scene.strokes.length > 0) {
    base.hasStrokes = true;
  }

  // Include text content
  if (scene.characters) {
    base.characters = scene.characters;
  }

  // Recurse children
  if (node.children && node.children.length > 0) {
    base.children = node.children
      .map(c => serializeNode(c, depth + 1, maxDepth))
      .filter(Boolean);
    base.childCount = node.children.length;
  }

  return base;
}

interface FlatNode {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  absX: number;
  absY: number;
  width: number;
  height: number;
  visible: boolean;
  depth: number;
}

function collectFlatNodes(
  node: FigNode,
  parentId: string | null,
  offsetX: number,
  offsetY: number,
  depth: number,
  result: FlatNode[]
): void {
  if (node.visible === false) return;

  const scene = node as SceneNode;
  const id = formatGUID(node.guid);

  // Calculate absolute position
  const x = scene.x ?? 0;
  const y = scene.y ?? 0;
  const absX = offsetX + x;
  const absY = offsetY + y;
  const width = scene.width ?? 0;
  const height = scene.height ?? 0;

  // Only add nodes with dimensions (skip DOCUMENT, include CANVAS and below)
  if (node.type !== "DOCUMENT" && width > 0 && height > 0) {
    result.push({
      id,
      type: node.type ?? "UNKNOWN",
      name: node.name ?? "",
      parentId,
      absX,
      absY,
      width,
      height,
      visible: scene.visible !== false,
      depth,
    });
  }

  // Recurse children
  if (node.children) {
    const childOffsetX = node.type === "DOCUMENT" ? 0 : absX;
    const childOffsetY = node.type === "DOCUMENT" ? 0 : absY;
    for (const child of node.children as FigNode[]) {
      collectFlatNodes(child, id, childOffsetX, childOffsetY, depth + 1, result);
    }
  }
}

function serializeNodeFull(node: FigNode): unknown {
  const result: Record<string, unknown> = {
    id: formatGUID(node.guid),
    ...node,
  };

  // Ensure children are serialized with ids as well.
  if (node.children && node.children.length > 0) {
    result.children = node.children.map(c => serializeNodeFull(c));
  }

  return result;
}

function buildRawNodeIndex(message: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>();

  const addNode = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const obj = raw as Record<string, unknown>;
    const guidValue = obj["guid"] ?? obj["id"];
    let key: string | null = null;

    if (typeof guidValue === "string") {
      key = guidValue.includes(":") ? guidValue : null;
    } else {
      const guid = parseGUID(guidValue);
      if (guid) {
        key = formatGUID(guid);
      }
    }

    if (key) {
      index.set(key, obj);
    }

    const children = obj["children"];
    if (Array.isArray(children)) {
      for (const child of children) {
        addNode(child);
      }
    }
  };

  const nodeChanges = message["nodeChanges"];
  if (Array.isArray(nodeChanges)) {
    for (const change of nodeChanges) {
      addNode(change);
    }
  }

  const nodes = message["nodes"];
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      addNode(node);
    }
  }

  if (message["document"]) {
    addNode(message["document"]);
  }

  if (message["root"]) {
    addNode(message["root"]);
  }

  return index;
}

async function loadFigFile(filePath: string) {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath)!;
  }

  console.log(`Parsing ${filePath}...`);
  const parsed = await parseFigFile(filePath);

  const nodeIndex = buildNodeIdIndex(parsed.document);

  const cached = {
    document: parsed.document,
    images: parsed.images,
    blobs: parsed.blobs || [],
    nodeIndex,
    rawNodeIndex: parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map(),
    meta: parsed.meta,
  };

  fileCache.set(filePath, cached);
  console.log(`Cached ${filePath} with ${nodeIndex.size} nodes`);

  return cached;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

function sendJson(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data, jsonReplacer));
}

function sendError(res: http.ServerResponse, message: string, status = 500) {
  sendJson(res, { error: message }, status);
}

function sendFile(res: http.ServerResponse, filePath: string, contentType: string) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function getContentType(ext: string): string {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  return types[ext] || "application/octet-stream";
}

export function createServer(options: ServerOptions = {}) {
  const port = options.port || 3000;
  let currentFile = options.figFile;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    try {
      // API routes
      if (pathname === "/api/status") {
        sendJson(res, {
          ready: !!currentFile,
          file: currentFile,
        });
        return;
      }

      if (pathname === "/api/open" && req.method === "POST") {
        // Read body
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }
        const { filePath } = JSON.parse(body);
        currentFile = filePath;
        await loadFigFile(filePath);
        sendJson(res, { success: true, file: filePath });
        return;
      }

      if (pathname === "/api/tree") {
        if (!currentFile) {
          sendError(res, "No file loaded", 400);
          return;
        }
        const cached = await loadFigFile(currentFile);
        const tree = serializeNode(cached.document);
        sendJson(res, { tree, meta: cached.meta });
        return;
      }

      if (pathname.startsWith("/api/flat-nodes/")) {
        if (!currentFile) {
          sendError(res, "No file loaded", 400);
          return;
        }
        // Get the page/node ID to get flat nodes for
        const rootId = decodeURIComponent(pathname.slice("/api/flat-nodes/".length));
        const cached = await loadFigFile(currentFile);
        const rootNode = cached.nodeIndex.get(rootId);

        if (!rootNode) {
          sendError(res, `Node not found: ${rootId}`, 404);
          return;
        }

        const flatNodes: FlatNode[] = [];
        collectFlatNodes(rootNode, null, 0, 0, 0, flatNodes);
        sendJson(res, { nodes: flatNodes });
        return;
      }

      if (pathname.startsWith("/api/node/")) {
        if (!currentFile) {
          sendError(res, "No file loaded", 400);
          return;
        }
        // Node ID is after /api/node/
        const nodeId = decodeURIComponent(pathname.slice("/api/node/".length));
        const cached = await loadFigFile(currentFile);
        const node = cached.nodeIndex.get(nodeId);

        if (!node) {
          sendError(res, `Node not found: ${nodeId}`, 404);
          return;
        }

        const full = serializeNodeFull(node);
        sendJson(res, { node: full });
        return;
      }

      if (pathname.startsWith("/api/node-raw/")) {
        if (!currentFile) {
          sendError(res, "No file loaded", 400);
          return;
        }
        const nodeId = decodeURIComponent(pathname.slice("/api/node-raw/".length));
        const cached = await loadFigFile(currentFile);
        const node = cached.rawNodeIndex.get(nodeId);

        if (!node) {
          sendError(res, `Raw node not found: ${nodeId}`, 404);
          return;
        }

        sendJson(res, { node });
        return;
      }

      if (pathname.startsWith("/api/render/")) {
        if (!currentFile) {
          sendError(res, "No file loaded", 400);
          return;
        }
        const nodeId = decodeURIComponent(pathname.slice("/api/render/".length));
        const cached = await loadFigFile(currentFile);
        const node = cached.nodeIndex.get(nodeId);

        if (!node) {
          sendError(res, `Node not found: ${nodeId}`, 404);
          return;
        }

        const result = renderScreen(
          node,
          cached.images,
          cached.blobs,
          {
            includeImages: true,
            includeText: true,
            includeFills: true,
            includeStrokes: true,
          }
        );

        res.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(result.svg);
        return;
      }

      if (pathname.startsWith("/api/images/")) {
        if (!currentFile) {
          sendError(res, "No file loaded", 400);
          return;
        }
        const hash = pathname.slice("/api/images/".length);
        const cached = await loadFigFile(currentFile);
        const imageData = cached.images.get(hash);

        if (!imageData) {
          sendError(res, `Image not found: ${hash}`, 404);
          return;
        }

        // Detect format from magic bytes
        let contentType = "application/octet-stream";
        if (imageData[0] === 0x89 && imageData[1] === 0x50) {
          contentType = "image/png";
        } else if (imageData[0] === 0xFF && imageData[1] === 0xD8) {
          contentType = "image/jpeg";
        } else if (imageData[0] === 0x52 && imageData[1] === 0x49) {
          contentType = "image/webp";
        }

        res.writeHead(200, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000",
        });
        res.end(imageData);
        return;
      }

      // Static files
      let staticPath: string;
      if (pathname === "/" || pathname === "/index.html") {
        staticPath = path.join(__dirname, "client", "index.html");
      } else if (pathname === "/viewer.js") {
        staticPath = path.join(__dirname, "client", "dist", "viewer.js");
      } else if (pathname === "/styles.css") {
        staticPath = path.join(__dirname, "client", "styles.css");
      } else {
        staticPath = path.join(__dirname, "client", pathname);
      }

      const ext = path.extname(staticPath);
      sendFile(res, staticPath, getContentType(ext));

    } catch (err) {
      console.error("Server error:", err);
      if (!res.headersSent) {
        sendError(res, err instanceof Error ? err.message : "Unknown error");
      }
    }
  });

  return {
    start(onReady?: (url: string) => void) {
      server.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`\nFig Viewer running at ${url}`);
        if (currentFile) {
          console.log(`Loaded: ${currentFile}`);
        } else {
          console.log("No file loaded. Use the UI to open a .fig file.");
        }
        onReady?.(url);
      });
    },
    close() {
      server.close();
    }
  };
}

// CLI entry point
if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
  const figFile = process.argv[2];
  const port = parseInt(process.argv[3] || "3000", 10);

  const server = createServer({ figFile, port });
  server.start();
}
