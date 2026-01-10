/**
 * Render a single node by ID
 */
import { readFigFile, buildRawNodeIndex } from "./parser/index.js";
import { parseCanvasFig, formatGUID, extractDocumentTree } from "./parser/kiwi-parser.js";
import { renderScreen } from "./renderer/index.js";
import type { FigNode } from "./parser/types.js";
import { writeFileSync } from "fs";

const FILE_PATH = "/Users/billy/repo/fig-mcp/Autodevice.fig";
const NODE_ID = process.argv[2] || "457:1607";

async function render() {
  const archive = await readFigFile(FILE_PATH);
  const parsed = parseCanvasFig(archive.canvasFig);
  const doc = extractDocumentTree(parsed.message);
  if (!doc) {
    console.log("Failed to extract document");
    return;
  }

  const blobs = parsed.message["blobs"] as Array<{ bytes: Uint8Array }> | undefined;

  const nodeIndex = new Map<string, FigNode>();
  function indexNode(node: FigNode) {
    nodeIndex.set(formatGUID(node.guid), node);
    if (node.children) {
      for (const child of node.children as FigNode[]) {
        indexNode(child);
      }
    }
  }
  indexNode(doc);

  // Build raw node index for INSTANCE content resolution
  const rawNodeIndex = buildRawNodeIndex(parsed.message);

  const node = nodeIndex.get(NODE_ID);
  if (!node) {
    console.log("Node not found:", NODE_ID);
    return;
  }

  console.log("Node:", formatGUID(node.guid));
  console.log("Type:", node.type);
  console.log("Name:", node.name);
  console.log("Children:", node.children?.length || 0);

  const result = renderScreen(node, undefined, blobs, {
    includeFills: true,
    includeStrokes: true,
    includeText: true,
    background: "#1a1a1a",
    nodeIndex,
    rawNodeIndex,
  });

  console.log("Result:", result.width, "x", result.height);
  if (result.warnings.length) console.log("Warnings:", result.warnings);

  const filename = `output/render-${NODE_ID.replace(":", "-")}.svg`;
  writeFileSync(filename, result.svg);
  console.log("Saved:", filename);
  console.log("\nSVG:\n" + result.svg);
}

render().catch(console.error);
