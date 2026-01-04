/**
 * Test the renderer on specific nodes
 */

import { readFigFile, parseFigFile } from "./parser/index.js";
import { parseCanvasFig, formatGUID, extractDocumentTree } from "./parser/kiwi-parser.js";
import { renderScreen } from "./renderer/index.js";
import type { FigNode } from "./parser/types.js";
import { writeFileSync, mkdirSync } from "fs";

const FILE_PATH = "/Users/billy/Downloads/AutoDevice (Copy).fig";
const TEST_NODES = [
  "457:1694", // Frame with 3 vector lines
  "457:1681", // Logo with rotated vectors
  "457:1695", // Simple horizontal line
];

async function testRenderer() {
  console.log("Reading .fig file...");
  const archive = await readFigFile(FILE_PATH);

  console.log("Parsing canvas.fig...");
  const parsed = parseCanvasFig(archive.canvasFig);
  const nodeChanges = parsed.message["nodeChanges"] as unknown[];
  const blobs = parsed.message["blobs"] as Array<{ bytes: Uint8Array }> | undefined;

  console.log("Building document tree...");
  const doc = extractDocumentTree(parsed.message);
  if (!doc) {
    console.log("Failed to extract document tree!");
    return;
  }

  // Build node index
  const nodeIndex = new Map<string, FigNode>();
  function indexNode(node: FigNode) {
    const key = formatGUID(node.guid);
    nodeIndex.set(key, node);
    if (node.children) {
      for (const child of node.children as FigNode[]) {
        indexNode(child);
      }
    }
  }
  indexNode(doc);

  console.log(`Indexed ${nodeIndex.size} nodes\n`);

  // Create output directory
  mkdirSync("output", { recursive: true });

  // Test each node
  for (const nodeId of TEST_NODES) {
    console.log("=".repeat(60));
    console.log(`Testing node: ${nodeId}`);
    console.log("=".repeat(60));

    const node = nodeIndex.get(nodeId);
    if (!node) {
      console.log("Node not found in tree!\n");
      continue;
    }

    console.log(`Type: ${node.type}, Name: ${node.name}`);

    const result = renderScreen(node, undefined, blobs, {
      includeFills: true,
      includeStrokes: true,
      includeText: true,
      background: "#1a1a1a",
    });

    console.log(`Result: ${result.width}x${result.height}`);
    if (result.warnings.length > 0) {
      console.log(`Warnings: ${result.warnings.join(", ")}`);
    }

    // Save SVG
    const filename = `output/render-${nodeId.replace(":", "-")}.svg`;
    writeFileSync(filename, result.svg);
    console.log(`Saved: ${filename}`);

    // Show first 500 chars of SVG for inspection
    console.log(`\nSVG preview (first 1000 chars):`);
    console.log(result.svg.slice(0, 1000));
    if (result.svg.length > 1000) console.log("...");

    console.log("\n");
  }
}

testRenderer().catch(console.error);
