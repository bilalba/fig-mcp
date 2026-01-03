/**
 * MCP Server for .fig file parsing
 *
 * Provides tools for:
 * - Parsing .fig files
 * - Extracting document structure
 * - Finding nodes by type/name
 * - Getting layout information
 * - Inspecting schema/raw data
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  parseFigFile,
  parseFigFileSimplified,
  getFigSchema,
  getFigRawMessage,
  listFigContents,
  simplifyNode,
  getDocumentSummary,
  findNodesByType,
  findNodesByName,
  countNodesByType,
  hashBytesToHex,
  formatGUID,
  buildNodeIdIndex,
  buildNodePathIndex,
} from "../parser/index.js";
import type { FigNode } from "../parser/types.js";
import { renderScreen } from "../experimental/render-screen.js";
import { generateScreenshot } from "../experimental/screenshot.js";
import { isVectorNode, exportVector, nodeToSvg } from "../vector-export.js";
import type { VectorFormat } from "../vector-export.js";
import { config } from "../shared-config.js";

// Cache for parsed fig files
const fileCache = new Map<
  string,
  {
    document: FigNode;
    meta: Record<string, unknown>;
    images: Map<string, Uint8Array>;
    thumbnail?: Uint8Array;
    version: number;
    nodeIdIndex: Map<string, FigNode>;
    nodePathIndex: Map<string, string>;
    blobs?: Array<{ bytes: Uint8Array }>;
  }
>();

type ImageReference = {
  hash: string;
  kind: "image" | "thumbnail";
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodePath: string;
  paintIndex: number;
  paintType: string;
  originalWidth?: number;
  originalHeight?: number;
  scaleMode?: string;
  scale?: number;
  rotation?: number;
};

type FillSummary = {
  paintCount: number;
  paintTypes: string[];
};

type NodeWithFills = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodePath: string;
  fillSummary: FillSummary;
  imageRefs?: ImageReference[];
};


export function normalizeImageHash(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    return value.toLowerCase();
  }

  if (Array.isArray(value) && value.length === 20) {
    const bytes = value.filter((b) => typeof b === "number") as number[];
    if (bytes.length === 20) {
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj["hash"] && typeof obj["hash"] === "object") {
      return hashBytesToHex(obj["hash"] as Record<string, number>);
    }
    const hasByteKeys = Object.keys(obj).some((key) => /^\d+$/.test(key));
    if (hasByteKeys) {
      return hashBytesToHex(obj as Record<string, number>);
    }
  }

  return null;
}

export function detectImageFormat(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xd8) return "jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "png";
  }
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "gif";
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
    return "webp";
  }
  return "unknown";
}

function normalizeNodeId(nodeId: string): string {
  // Trim whitespace
  let normalized = nodeId.trim();
  // Convert hyphen to colon if it looks like a node ID (digits-digits)
  if (/^\d+-\d+$/.test(normalized)) {
    normalized = normalized.replace('-', ':');
  }
  return normalized;
}

function extractImageReferences(node: FigNode, nodePath: string): ImageReference[] {
  const refs: ImageReference[] = [];
  const nodeRecord = node as unknown as Record<string, unknown>;
  const fills = nodeRecord["fills"] ?? nodeRecord["fillPaints"];
  if (!Array.isArray(fills)) return refs;

  for (let i = 0; i < fills.length; i++) {
    const paint = fills[i] as Record<string, unknown>;
    if (!paint || typeof paint !== "object") continue;

    const paintType = String(paint["type"] ?? "UNKNOWN");
    const originalWidth =
      typeof paint["originalImageWidth"] === "number"
        ? paint["originalImageWidth"]
        : undefined;
    const originalHeight =
      typeof paint["originalImageHeight"] === "number"
        ? paint["originalImageHeight"]
        : undefined;
    const scaleMode =
      typeof paint["imageScaleMode"] === "string"
        ? paint["imageScaleMode"]
        : typeof paint["scaleMode"] === "string"
        ? paint["scaleMode"]
        : undefined;
    const scale = typeof paint["scale"] === "number" ? paint["scale"] : undefined;
    const rotation = typeof paint["rotation"] === "number" ? paint["rotation"] : undefined;

    const imageHash =
      normalizeImageHash(paint["image"]) ??
      normalizeImageHash(paint["imageHash"]);
    if (imageHash) {
      refs.push({
        hash: imageHash,
        kind: "image",
        nodeId: formatGUID(node.guid),
        nodeName: node.name,
        nodeType: node.type,
        nodePath,
        paintIndex: i,
        paintType,
        originalWidth,
        originalHeight,
        scaleMode,
        scale,
        rotation,
      });
    }

    const thumbHash = normalizeImageHash(paint["imageThumbnail"]);
    if (thumbHash) {
      refs.push({
        hash: thumbHash,
        kind: "thumbnail",
        nodeId: formatGUID(node.guid),
        nodeName: node.name,
        nodeType: node.type,
        nodePath,
        paintIndex: i,
        paintType,
        originalWidth,
        originalHeight,
        scaleMode,
        scale,
        rotation,
      });
    }
  }

  return refs;
}

function summarizeFills(fills: unknown[]): FillSummary {
  const paintTypes = new Set<string>();

  for (const fill of fills) {
    if (!fill || typeof fill !== "object") continue;
    const paint = fill as Record<string, unknown>;
    paintTypes.add(String(paint["type"] ?? "UNKNOWN"));
  }

  return {
    paintCount: fills.length,
    paintTypes: Array.from(paintTypes),
  };
}

function collectNodesWithFills(
  node: FigNode,
  nodePathIndex: Map<string, string>,
  results: NodeWithFills[],
  includeImageRefs: boolean,
  maxResults?: number
): boolean {
  if (maxResults !== undefined && results.length >= maxResults) return true;

  const nodeRecord = node as unknown as Record<string, unknown>;
  const fills = nodeRecord["fills"] ?? nodeRecord["fillPaints"];
  if (Array.isArray(fills) && fills.length > 0) {
    const nodeId = formatGUID(node.guid);
    const nodePath = nodePathIndex.get(nodeId) ?? node.name;
    const entry: NodeWithFills = {
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      nodePath,
      fillSummary: summarizeFills(fills),
    };
    if (includeImageRefs) {
      entry.imageRefs = extractImageReferences(node, nodePath);
    }
    results.push(entry);
    if (maxResults !== undefined && results.length >= maxResults) return true;
  }

  if (node.children) {
    for (const child of node.children) {
      if (
        collectNodesWithFills(
          child as FigNode,
          nodePathIndex,
          results,
          includeImageRefs,
          maxResults
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get or parse a fig file with caching
 */
export async function getOrParseFigFile(filePath: string) {
  if (!fileCache.has(filePath)) {
    const parsed = await parseFigFile(filePath);
    const nodeIdIndex = buildNodeIdIndex(parsed.document);
    const nodePathIndex = buildNodePathIndex(parsed.document);
    fileCache.set(filePath, {
      document: parsed.document,
      meta: parsed.meta,
      images: parsed.images,
      thumbnail: parsed.thumbnail,
      version: parsed.version,
      nodeIdIndex,
      nodePathIndex,
      blobs: parsed.blobs,
    });
  }
  return fileCache.get(filePath)!;
}

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: "fig-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "parse_fig_file",
          description:
            "Parse a .fig file and return its document structure. Returns a simplified representation suitable for understanding the design hierarchy, layout, and styling.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              maxDepth: {
                type: "number",
                description: "Maximum depth to traverse (default: 10)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_document_summary",
          description:
            "Get a text summary of the document structure showing node types, names, and dimensions in a tree format. Supports pagination to handle large documents.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              maxNodes: {
                type: "number",
                description: "Maximum number of nodes to return (default: 100)",
              },
              offset: {
                type: "number",
                description: "Number of nodes to skip for pagination (default: 0)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_tree_summary",
          description:
            "Get hierarchical summary with child counts for drill-down navigation. Returns high-level structure without full node details.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodePath: {
                type: "string",
                description: "Optional path to start from (e.g., 'Page 1'). If not provided, starts from root.",
              },
              depth: {
                type: "number",
                description: "Levels to show (default: 2)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "find_nodes",
          description:
            "Find nodes in the document by type or name. Useful for locating specific components, frames, or text elements.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              type: {
                type: "string",
                description:
                  "Node type to find (e.g., FRAME, TEXT, COMPONENT, INSTANCE)",
              },
              name: {
                type: "string",
                description: "Node name to search for (partial match)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_node_details",
          description:
            "Get detailed information about a specific node by its path in the document tree. Use format like 'Page 1/Frame Name/Child Name'.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodePath: {
                type: "string",
                description: "Path to the node (e.g., 'Page 1/Header/Logo')",
              },
              maxDepth: {
                type: "number",
                description: "Maximum depth to traverse children (default: 1, max: 10)",
                default: 1,
              },
              includeChildren: {
                type: "boolean",
                description: "Include child nodes in response (default: true)",
                default: true,
              },
              includeStyles: {
                type: "boolean",
                description: "Include style properties (fills, strokes, effects) (default: true)",
                default: true,
              },
              includeLayout: {
                type: "boolean",
                description: "Include layout inference (gap, padding, alignment) (default: true)",
                default: true,
              },
              includeImageRefs: {
                type: "boolean",
                description: "Include image reference metadata (default: true)",
                default: true,
              },
              compact: {
                type: "boolean",
                description: "Use compact JSON formatting (no indentation) (default: false)",
                default: false,
              },
            },
            required: ["filePath", "nodePath"],
          },
        },
        {
          name: "get_node_by_id",
          description:
            "Get detailed information about a specific node by its GUID. Node ID format: 'sessionID:localID' (e.g., '457:1607'). Hyphen format also accepted.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodeId: {
                type: "string",
                description: "GUID string in format 'sessionID:localID' (e.g., '457:1607') or 'sessionID-localID'",
              },
              maxDepth: {
                type: "number",
                description: "Maximum depth to traverse children (default: 1, max: 10)",
                default: 1,
              },
              includeChildren: {
                type: "boolean",
                description: "Include child nodes in response (default: true)",
                default: true,
              },
              includeStyles: {
                type: "boolean",
                description: "Include style properties (fills, strokes, effects) (default: true)",
                default: true,
              },
              includeLayout: {
                type: "boolean",
                description: "Include layout inference (gap, padding, alignment) (default: true)",
                default: true,
              },
              includeImageRefs: {
                type: "boolean",
                description: "Include image reference metadata (default: true)",
                default: true,
              },
              compact: {
                type: "boolean",
                description: "Use compact JSON formatting (no indentation) (default: false)",
                default: false,
              },
            },
            required: ["filePath", "nodeId"],
          },
        },
        {
          name: "get_layout_info",
          description:
            "Get layout and spacing information for a node. Returns inferred flexbox-like properties including direction, gap, padding, and alignment.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodePath: {
                type: "string",
                description: "Path to the node",
              },
            },
            required: ["filePath", "nodePath"],
          },
        },
        {
          name: "list_pages",
          description: "List all pages (canvases) in the .fig file.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_page_contents",
          description:
            "Get the contents of a specific page, including all top-level frames and their immediate children.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              pageName: {
                type: "string",
                description: "Name of the page to get contents for",
              },
            },
            required: ["filePath", "pageName"],
          },
        },
        {
          name: "get_text_content",
          description:
            "Extract all text content from the document or a specific node path.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodePath: {
                type: "string",
                description: "Optional path to limit text extraction scope",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_colors",
          description:
            "Extract all unique colors used in the document, including fills and strokes.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "list_nodes_with_fills",
          description:
            "List nodes that have fill paints, with summary of paint types and optional image references.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              includeImageRefs: {
                type: "boolean",
                description: "Include image hash references for IMAGE fills",
              },
              maxResults: {
                type: "number",
                description: "Optional cap on number of nodes returned",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_schema_info",
          description:
            "Get the kiwi schema information from the .fig file. Useful for debugging and understanding the file format.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_raw_message",
          description:
            "Get the raw decoded message from the .fig file. Warning: can be very large. Use for debugging only.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              maxSize: {
                type: "number",
                description:
                  "Maximum size in characters to return (default: 50000)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "list_archive_contents",
          description: "List all files contained in the .fig archive.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "clear_cache",
          description:
            "Clear the file cache. Useful if the .fig file has been modified.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description:
                  "Path to clear from cache (optional, clears all if not specified)",
              },
            },
          },
        },
        {
          name: "list_images",
          description:
            "List all images in the .fig file with their metadata. Returns image hashes, dimensions, and which nodes reference them.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_image",
          description:
            "Get a specific image from the .fig file as a resource. Use the hash from list_images.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              imageHash: {
                type: "string",
                description: "The 40-character hex hash of the image",
              },
            },
            required: ["filePath", "imageHash"],
          },
        },
        {
          name: "get_thumbnail",
          description:
            "Get the document thumbnail image as a resource.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "render_screen",
          description:
            "Experimental: render a node subtree to a PNG screenshot using its bounds, fills, strokes, and text. Node ID format: 'sessionID:localID' (e.g., '457:1607'). Hyphen format also accepted.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodeId: {
                type: "string",
                description: "GUID string in format 'sessionID:localID' (e.g., '457:1607') or 'sessionID-localID'",
              },
              options: {
                type: "object",
                description: "Rendering options",
                properties: {
                  maxDepth: { type: "number" },
                  includeText: { type: "boolean" },
                  includeFills: { type: "boolean" },
                  includeStrokes: { type: "boolean" },
                  includeImages: { type: "boolean" },
                  background: { type: "string" },
                  scale: { type: "number" },
                  maxWidth: { type: "number", description: "Maximum width in pixels (default: 800)" },
                  maxHeight: { type: "number", description: "Maximum height in pixels (default: 600)" },
                },
              },
            },
            required: ["filePath", "nodeId"],
          },
        },
        {
          name: "get_vector",
          description:
            "Export a vector node as SVG, PDF, PNG, or WebP. SVG returns the vector path directly. PDF returns a vector-based PDF (ideal for iOS). PNG/WebP returns a rasterized image at specified dimensions.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodeId: {
                type: "string",
                description: "GUID string in format 'sessionID:localID' (e.g., '457:1682') or 'sessionID-localID'",
              },
              format: {
                type: "string",
                enum: ["svg", "pdf", "png", "webp"],
                description: "Output format: svg (vector), pdf (vector for iOS), png/webp (raster)",
              },
              width: {
                type: "number",
                description: "Output width in pixels (required for png/webp, optional for pdf)",
              },
              height: {
                type: "number",
                description: "Output height in pixels (required for png/webp, optional for pdf)",
              },
              includeStyles: {
                type: "boolean",
                description: "Include fill/stroke styles from node (default: true)",
                default: true,
              },
            },
            required: ["filePath", "nodeId", "format"],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "parse_fig_file": {
          const { filePath, maxDepth = 10 } = args as {
            filePath: string;
            maxDepth?: number;
          };
          const result = await parseFigFileSimplified(filePath, maxDepth);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_document_summary": {
          const { filePath, maxNodes = 100, offset = 0 } = args as {
            filePath: string;
            maxNodes?: number;
            offset?: number;
          };
          const { document } = await getOrParseFigFile(filePath);
          const fullSummary = getDocumentSummary(document);
          const lines = fullSummary.split('\n');
          const totalNodes = lines.length;
          const paginatedLines = lines.slice(offset, offset + maxNodes);

          let resultText = paginatedLines.join('\n');
          if (totalNodes > maxNodes || offset > 0) {
            const start = offset + 1;
            const end = Math.min(offset + maxNodes, totalNodes);
            resultText = `Showing nodes ${start}-${end} of ${totalNodes}\n\n${resultText}`;
            if (end < totalNodes) {
              resultText += `\n\n... (${totalNodes - end} more nodes)`;
            }
          }

          return {
            content: [
              {
                type: "text",
                text: resultText,
              },
            ],
          };
        }

        case "get_tree_summary": {
          const { filePath, nodePath, depth = 2 } = args as {
            filePath: string;
            nodePath?: string;
            depth?: number;
          };
          const { document, nodePathIndex } = await getOrParseFigFile(filePath);

          // Find starting node
          let startNode = document;
          if (nodePath) {
            // Try to find node by path
            const pathParts = nodePath.split('/').filter(p => p);
            let current = document;
            for (const part of pathParts) {
              const child = current.children?.find(c => c.name === part);
              if (!child) {
                return {
                  content: [{
                    type: "text",
                    text: `Node not found at path: ${nodePath}`,
                  }],
                  isError: true,
                };
              }
              current = child;
            }
            startNode = current;
          }

          // Generate tree summary
          const generateTreeSummary = (node: FigNode, currentDepth = 0, maxDepth = 2, prefix = ""): string => {
            if (currentDepth > maxDepth) return "";

            const childCount = node.children?.length ?? 0;
            const childSuffix = childCount > 0 ? ` [${childCount} children]` : "";
            let result = `${prefix}${node.name} (${node.type})${childSuffix}\n`;

            if (currentDepth < maxDepth && node.children && node.children.length > 0) {
              const isLast = (i: number) => i === node.children!.length - 1;
              node.children.forEach((child, i) => {
                const childPrefix = prefix + (isLast(i) ? "└── " : "├── ");
                const grandchildPrefix = prefix + (isLast(i) ? "    " : "│   ");
                result += generateTreeSummary(child, currentDepth + 1, maxDepth, childPrefix);
              });
            }

            return result;
          };

          const summary = generateTreeSummary(startNode, 0, depth);
          return {
            content: [
              {
                type: "text",
                text: summary,
              },
            ],
          };
        }

        case "find_nodes": {
          const { filePath, type, name: nodeName } = args as {
            filePath: string;
            type?: string;
            name?: string;
          };
          const { document } = await getOrParseFigFile(filePath);

          let results: FigNode[] = [];
          if (type) {
            results = findNodesByType(document, type);
          }
          if (nodeName) {
            const byName = findNodesByName(document, nodeName);
            if (results.length > 0) {
              // Intersection if both type and name specified
              const nameSet = new Set(byName);
              results = results.filter((n) => nameSet.has(n));
            } else {
              results = byName;
            }
          }

          // Simplify results
          const simplified = results.map((n) => simplifyNode(n, 0, 2));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: simplified.length,
                    nodes: simplified,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_node_details": {
          const {
            filePath,
            nodePath,
            maxDepth = 1,
            includeChildren = true,
            includeStyles = true,
            includeLayout = true,
            includeImageRefs = true,
            compact = false,
          } = args as {
            filePath: string;
            nodePath: string;
            maxDepth?: number;
            includeChildren?: boolean;
            includeStyles?: boolean;
            includeLayout?: boolean;
            includeImageRefs?: boolean;
            compact?: boolean;
          };

          // Validate maxDepth
          const safeMaxDepth = Math.min(Math.max(maxDepth, 0), 10);

          const { document } = await getOrParseFigFile(filePath);

          const pathParts = nodePath.split("/").filter((p) => p.length > 0);
          let current: FigNode | undefined = document;
          const resolvedParts: string[] = [];

          for (const part of pathParts) {
            if (!current?.children) {
              current = undefined;
              break;
            }
            current = current.children.find((c) =>
              (c as FigNode).name.toLowerCase().includes(part.toLowerCase())
            ) as FigNode | undefined;
            if (current) {
              resolvedParts.push(current.name);
            }
          }

          if (!current) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node not found at path: ${nodePath}`,
                },
              ],
            };
          }

          // Pass filtering options to simplifyNode
          const simplified = simplifyNode(
            current,
            0,
            includeChildren ? safeMaxDepth : 0,
            {
              includeStyles,
              includeLayout,
            }
          );

          const resolvedPath = resolvedParts.join("/");

          // Conditionally include image refs
          const imageRefs = includeImageRefs
            ? extractImageReferences(
                current,
                resolvedPath.length > 0 ? resolvedPath : current.name
              )
            : undefined;

          const response = {
            ...simplified,
            ...(imageRefs && imageRefs.length > 0 && { imageRefs }),
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, compact ? 0 : 2),
              },
            ],
          };
        }

        case "get_node_by_id": {
          const {
            filePath,
            nodeId,
            maxDepth = 1,
            includeChildren = true,
            includeStyles = true,
            includeLayout = true,
            includeImageRefs = true,
            compact = false,
          } = args as {
            filePath: string;
            nodeId: string;
            maxDepth?: number;
            includeChildren?: boolean;
            includeStyles?: boolean;
            includeLayout?: boolean;
            includeImageRefs?: boolean;
            compact?: boolean;
          };

          // Validate maxDepth
          const safeMaxDepth = Math.min(Math.max(maxDepth, 0), 10);

          const { nodeIdIndex, nodePathIndex } = await getOrParseFigFile(filePath);

          const normalizedId = normalizeNodeId(nodeId);
          const node = nodeIdIndex.get(normalizedId);

          if (!node) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node not found for id: ${nodeId}`,
                },
              ],
              isError: true,
            };
          }

          // Pass filtering options to simplifyNode
          const simplified = simplifyNode(
            node,
            0,
            includeChildren ? safeMaxDepth : 0,
            {
              includeStyles,
              includeLayout,
            }
          );

          const nodePath = nodePathIndex.get(normalizedId) ?? node.name;

          // Conditionally include image refs
          const imageRefs = includeImageRefs
            ? extractImageReferences(node, nodePath)
            : undefined;

          const response = {
            ...simplified,
            nodePath,
            ...(imageRefs && imageRefs.length > 0 && { imageRefs }),
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, compact ? 0 : 2),
              },
            ],
          };
        }

        case "get_layout_info": {
          const { filePath, nodePath } = args as {
            filePath: string;
            nodePath: string;
          };
          const { document } = await getOrParseFigFile(filePath);

          const pathParts = nodePath.split("/").filter((p) => p.length > 0);
          let current: FigNode | undefined = document;

          for (const part of pathParts) {
            if (!current?.children) {
              current = undefined;
              break;
            }
            current = current.children.find((c) =>
              (c as FigNode).name.toLowerCase().includes(part.toLowerCase())
            ) as FigNode | undefined;
          }

          if (!current) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node not found at path: ${nodePath}`,
                },
              ],
            };
          }

          const simplified = simplifyNode(current, 0, 1);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    name: simplified?.name,
                    type: simplified?.type,
                    bounds: simplified?.bounds,
                    layout: simplified?.layout,
                    style: simplified?.style,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "list_pages": {
          const { filePath } = args as { filePath: string };
          const { document } = await getOrParseFigFile(filePath);

          const pages = document.children?.map((c) => ({
            name: (c as FigNode).name,
            type: (c as FigNode).type,
            childCount: (c as FigNode).children?.length ?? 0,
          }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ pages }, null, 2),
              },
            ],
          };
        }

        case "get_page_contents": {
          const { filePath, pageName } = args as {
            filePath: string;
            pageName: string;
          };
          const { document } = await getOrParseFigFile(filePath);

          const page = document.children?.find((c) =>
            (c as FigNode).name.toLowerCase().includes(pageName.toLowerCase())
          ) as FigNode | undefined;

          if (!page) {
            return {
              content: [
                {
                  type: "text",
                  text: `Page not found: ${pageName}`,
                },
              ],
            };
          }

          const simplified = simplifyNode(page, 0, 3);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(simplified, null, 2),
              },
            ],
          };
        }

        case "get_text_content": {
          const { filePath, nodePath } = args as {
            filePath: string;
            nodePath?: string;
          };
          const { document } = await getOrParseFigFile(filePath);

          let startNode: FigNode = document;
          if (nodePath) {
            const pathParts = nodePath.split("/").filter((p) => p.length > 0);
            for (const part of pathParts) {
              if (!startNode?.children) break;
              const found = startNode.children.find((c) =>
                (c as FigNode).name
                  .toLowerCase()
                  .includes(part.toLowerCase())
              ) as FigNode | undefined;
              if (found) startNode = found;
            }
          }

          const textNodes = findNodesByType(startNode, "TEXT");
          const texts = textNodes.map((n) => ({
            name: n.name,
            content: (n as unknown as { characters?: string }).characters,
          }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ texts }, null, 2),
              },
            ],
          };
        }

        case "get_colors": {
          const { filePath } = args as { filePath: string };
          const { document } = await getOrParseFigFile(filePath);

          const colors = new Set<string>();

          function extractColors(node: FigNode): void {
            const sceneNode = node as unknown as {
              fills?: Array<{ color?: { r: number; g: number; b: number; a: number } }>;
              strokes?: Array<{ color?: { r: number; g: number; b: number; a: number } }>;
            };

            if (sceneNode.fills) {
              for (const fill of sceneNode.fills) {
                if (fill.color) {
                  const { r, g, b, a } = fill.color;
                  colors.add(
                    `rgba(${Math.round(r * 255)}, ${Math.round(
                      g * 255
                    )}, ${Math.round(b * 255)}, ${a.toFixed(2)})`
                  );
                }
              }
            }

            if (sceneNode.strokes) {
              for (const stroke of sceneNode.strokes) {
                if (stroke.color) {
                  const { r, g, b, a } = stroke.color;
                  colors.add(
                    `rgba(${Math.round(r * 255)}, ${Math.round(
                      g * 255
                    )}, ${Math.round(b * 255)}, ${a.toFixed(2)})`
                  );
                }
              }
            }

            if (node.children) {
              for (const child of node.children) {
                extractColors(child as FigNode);
              }
            }
          }

          extractColors(document);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { colors: Array.from(colors).sort() },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_schema_info": {
          const { filePath } = args as { filePath: string };
          const result = await getFigSchema(filePath);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "list_nodes_with_fills": {
          const { filePath, includeImageRefs, maxResults } = args as {
            filePath: string;
            includeImageRefs?: boolean;
            maxResults?: number;
          };
          const { document, nodePathIndex } = await getOrParseFigFile(filePath);

          const nodes: NodeWithFills[] = [];
          collectNodesWithFills(
            document,
            nodePathIndex,
            nodes,
            includeImageRefs ?? false,
            maxResults
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: nodes.length,
                    nodes,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_raw_message": {
          const { filePath, maxSize = 50000 } = args as {
            filePath: string;
            maxSize?: number;
          };
          const result = await getFigRawMessage(filePath);
          let text = JSON.stringify(result, null, 2);
          if (text.length > maxSize) {
            text =
              text.substring(0, maxSize) +
              `\n\n... [truncated, total size: ${text.length} chars]`;
          }
          return {
            content: [
              {
                type: "text",
                text,
              },
            ],
          };
        }

        case "list_archive_contents": {
          const { filePath } = args as { filePath: string };
          const contents = await listFigContents(filePath);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ files: contents }, null, 2),
              },
            ],
          };
        }

        case "list_images": {
          const { filePath } = args as { filePath: string };
          const { document, images } = await getOrParseFigFile(filePath);

          const entries = new Map<
            string,
            {
              hash: string;
              byteLength: number;
              format: string;
              references: ImageReference[];
              dimensions: Set<string>;
            }
          >();

          for (const [hash, data] of images) {
            entries.set(hash, {
              hash,
              byteLength: data.length,
              format: detectImageFormat(data),
              references: [],
              dimensions: new Set(),
            });
          }

          const missingRefs = new Map<string, ImageReference[]>();

          function walk(node: FigNode, path: string): void {
            const nodePath = path ? `${path}/${node.name}` : node.name;
            const refs = extractImageReferences(node, nodePath);
            for (const ref of refs) {
              const entry = entries.get(ref.hash);
              if (entry) {
                entry.references.push(ref);
                if (ref.originalWidth !== undefined && ref.originalHeight !== undefined) {
                  entry.dimensions.add(`${ref.originalWidth}x${ref.originalHeight}`);
                }
              } else {
                if (!missingRefs.has(ref.hash)) {
                  missingRefs.set(ref.hash, []);
                }
                missingRefs.get(ref.hash)!.push(ref);
              }
            }
            if (node.children) {
              for (const child of node.children) {
                walk(child as FigNode, nodePath);
              }
            }
          }

          walk(document, "");

          const imagesList = Array.from(entries.values())
            .sort((a, b) => a.hash.localeCompare(b.hash))
            .map((entry) => ({
              hash: entry.hash,
              byteLength: entry.byteLength,
              format: entry.format,
              referenceCount: entry.references.length,
              dimensions: Array.from(entry.dimensions).map((dim) => {
                const [width, height] = dim.split("x").map((n) => Number(n));
                return { width, height };
              }),
              references: entry.references,
            }));

          const unresolvedReferences = Array.from(missingRefs.entries()).map(
            ([hash, references]) => ({
              hash,
              referenceCount: references.length,
              references,
            })
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: imagesList.length,
                    images: imagesList,
                    unresolvedReferences,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_image": {
          const { filePath, imageHash } = args as {
            filePath: string;
            imageHash: string;
          };
          const { images } = await getOrParseFigFile(filePath);
          const normalized = imageHash.toLowerCase();
          const data = images.get(normalized) ?? images.get(imageHash);

          if (!data) {
            return {
              content: [
                {
                  type: "text",
                  text: `Image not found for hash: ${imageHash}`,
                },
              ],
              isError: true,
            };
          }

          const format = detectImageFormat(data);
          const mimeType =
            format === "jpeg"
              ? "image/jpeg"
              : format === "png"
                ? "image/png"
                : format === "gif"
                  ? "image/gif"
                  : format === "webp"
                    ? "image/webp"
                    : "application/octet-stream";

          // Return HTTP URL instead of blob
          const httpUrl = `http://localhost:${config.httpPort}/image/${encodeURIComponent(filePath)}/${normalized}`;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  url: httpUrl,
                  hash: normalized,
                  format: mimeType,
                  size: data.length,
                }),
              },
            ],
          };
        }

        case "get_thumbnail": {
          const { filePath } = args as { filePath: string };
          const { thumbnail } = await getOrParseFigFile(filePath);
          if (!thumbnail) {
            return {
              content: [
                {
                  type: "text",
                  text: "No thumbnail.png found in the .fig file",
                },
              ],
              isError: true,
            };
          }

          // Return HTTP URL instead of blob
          const httpUrl = `http://localhost:${config.httpPort}/thumbnail/${encodeURIComponent(filePath)}`;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  url: httpUrl,
                  format: "image/png",
                  size: thumbnail.length,
                }),
              },
            ],
          };
        }

        case "render_screen": {
          const { filePath, nodeId, options } = args as {
            filePath: string;
            nodeId: string;
            options?: Record<string, unknown>;
          };
          const { nodeIdIndex, images, blobs } = await getOrParseFigFile(filePath);

          const normalizedId = normalizeNodeId(nodeId);
          const node = nodeIdIndex.get(normalizedId);

          if (!node) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node not found for id: ${nodeId}`,
                },
              ],
              isError: true,
            };
          }

          const result = renderScreen(node, images, blobs, {
            maxDepth: typeof options?.maxDepth === "number" ? options.maxDepth : undefined,
            includeText: typeof options?.includeText === "boolean" ? options.includeText : undefined,
            includeFills:
              typeof options?.includeFills === "boolean" ? options.includeFills : undefined,
            includeStrokes:
              typeof options?.includeStrokes === "boolean" ? options.includeStrokes : undefined,
            includeImages:
              typeof options?.includeImages === "boolean" ? options.includeImages : undefined,
            background: typeof options?.background === "string" ? options.background : undefined,
            scale: typeof options?.scale === "number" ? options.scale : undefined,
          });

          // Convert SVG to PNG
          const screenshot = await generateScreenshot(result.svg, {
            maxWidth: typeof options?.maxWidth === "number" ? options.maxWidth : undefined,
            maxHeight: typeof options?.maxHeight === "number" ? options.maxHeight : undefined,
          });

          return {
            content: [
              {
                type: "image",
                data: screenshot.base64,
                mimeType: screenshot.mimeType,
              },
            ],
          };
        }

        case "get_vector": {
          const {
            filePath,
            nodeId,
            format,
            width,
            height,
            includeStyles = true,
          } = args as {
            filePath: string;
            nodeId: string;
            format: VectorFormat;
            width?: number;
            height?: number;
            includeStyles?: boolean;
          };

          const { nodeIdIndex, blobs } = await getOrParseFigFile(filePath);
          const normalizedId = normalizeNodeId(nodeId);
          const node = nodeIdIndex.get(normalizedId);

          if (!node) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node not found for id: ${nodeId}`,
                },
              ],
              isError: true,
            };
          }

          // Check if node is a vector type
          if (!isVectorNode(node)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node ${nodeId} (${node.type}) is not a vector node. Vector export requires VECTOR, LINE, STAR, ELLIPSE, REGULAR_POLYGON, or BOOLEAN_OPERATION nodes, or nodes with fillGeometry/strokeGeometry.`,
                },
              ],
              isError: true,
            };
          }

          // Validate dimensions for raster formats
          if ((format === "png" || format === "webp") && (!width || !height)) {
            return {
              content: [
                {
                  type: "text",
                  text: `width and height are required for ${format} format`,
                },
              ],
              isError: true,
            };
          }

          try {
            const result = await exportVector(node, blobs, format, {
              width,
              height,
              includeStyles,
            });

            if (format === "svg") {
              // Return SVG directly as text
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      format: "svg",
                      width: result.width,
                      height: result.height,
                      mimeType: result.mimeType,
                      svg: result.data as string,
                    }, null, 2),
                  },
                ],
              };
            } else {
              // For binary formats (PDF, PNG, WebP), return as base64
              const buffer = result.data as Buffer;
              const base64 = buffer.toString("base64");

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      format: result.format,
                      width: result.width,
                      height: result.height,
                      mimeType: result.mimeType,
                      size: buffer.length,
                      data: base64,
                    }, null, 2),
                  },
                ],
              };
            }
          } catch (exportError) {
            return {
              content: [
                {
                  type: "text",
                  text: `Vector export failed: ${exportError instanceof Error ? exportError.message : String(exportError)}`,
                },
              ],
              isError: true,
            };
          }
        }

        case "clear_cache": {
          const { filePath } = args as { filePath?: string };
          if (filePath) {
            fileCache.delete(filePath);
            return {
              content: [
                {
                  type: "text",
                  text: `Cleared cache for: ${filePath}`,
                },
              ],
            };
          } else {
            fileCache.clear();
            return {
              content: [
                {
                  type: "text",
                  text: "Cleared all cached files",
                },
              ],
            };
          }
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // List resources (fig files in common locations could be listed here)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: [] };
  });

  // List resource templates
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: "fig://{filePath}/images/{imageHash}",
          name: "Fig Image",
          description:
            "Image asset from a .fig file. filePath should be URL-encoded.",
          mimeType: "image/*",
        },
        {
          uriTemplate: "fig://{filePath}/thumbnail",
          name: "Fig Thumbnail",
          description:
            "Thumbnail preview of a .fig file. filePath should be URL-encoded.",
          mimeType: "image/png",
        },
      ],
    };
  });

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    // Parse fig:// URIs
    // Format: fig://{encodedFilePath}/images/{imageHash}
    // Format: fig://{encodedFilePath}/thumbnail
    if (uri.startsWith("fig://")) {
      const path = uri.slice("fig://".length);

      // Check for thumbnail
      if (path.endsWith("/thumbnail")) {
        const encodedFilePath = path.slice(0, -"/thumbnail".length);
        const filePath = decodeURIComponent(encodedFilePath);

        const { thumbnail } = await getOrParseFigFile(filePath);
        if (!thumbnail) {
          throw new Error(`No thumbnail found in: ${filePath}`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: "image/png",
              blob: Buffer.from(thumbnail).toString("base64"),
            },
          ],
        };
      }

      // Check for image
      const imageMatch = path.match(/^(.+)\/images\/([a-fA-F0-9]{40})$/);
      if (imageMatch) {
        const [, encodedFilePath, imageHash] = imageMatch;
        const filePath = decodeURIComponent(encodedFilePath);

        const { images } = await getOrParseFigFile(filePath);
        const normalized = imageHash.toLowerCase();
        const data = images.get(normalized) ?? images.get(imageHash);

        if (!data) {
          throw new Error(`Image not found: ${imageHash} in ${filePath}`);
        }

        const format = detectImageFormat(data);
        const mimeType =
          format === "jpeg"
            ? "image/jpeg"
            : format === "png"
              ? "image/png"
              : format === "gif"
                ? "image/gif"
                : format === "webp"
                  ? "image/webp"
                  : "application/octet-stream";

        return {
          contents: [
            {
              uri,
              mimeType,
              blob: Buffer.from(data).toString("base64"),
            },
          ],
        };
      }
    }

    throw new Error(`Resource not found: ${uri}`);
  });

  return server;
}

/**
 * Start the MCP server
 */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Fig MCP server started");
}
