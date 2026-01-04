/**
 * Compare get_vector (nodeToSvg) vs renderScreen
 */
import { readFigFile, buildNodeIdIndex } from "./parser/index.js";
import { parseCanvasFig, extractDocumentTree, formatGUID } from "./parser/kiwi-parser.js";
import { nodeToSvg } from "./vector-export.js";
import { renderScreen } from "./renderer/index.js";
import type { FigNode } from "./parser/types.js";
import { writeFileSync } from "fs";

const FILE_PATH = "/Users/billy/Downloads/AutoDevice (Copy).fig";
const NODE_ID = process.argv[2] || "457:1681";

function normalizeNodeId(nodeId: string): string {
  let normalized = nodeId.trim();
  if (/^\d+-\d+$/.test(normalized)) {
    normalized = normalized.replace('-', ':');
  }
  return normalized;
}

async function compare() {
  const normalizedId = normalizeNodeId(NODE_ID);
  console.log("Node ID:", normalizedId);

  // Parse the file
  const archive = await readFigFile(FILE_PATH);
  const parsed = parseCanvasFig(archive.canvasFig);
  const doc = extractDocumentTree(parsed.message);

  if (!doc) {
    console.log("Failed to extract document");
    return;
  }

  const blobs = parsed.message["blobs"] as Array<{ bytes: Uint8Array }> | undefined;

  // Build node index
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

  const node = nodeIndex.get(normalizedId);
  if (!node) {
    console.log("Node not found:", normalizedId);
    return;
  }

  const sceneNode = node as any;
  console.log("\n=== NODE INFO ===");
  console.log("Name:", node.name);
  console.log("Type:", node.type);
  console.log("x:", sceneNode.x);
  console.log("y:", sceneNode.y);
  console.log("width:", sceneNode.width);
  console.log("height:", sceneNode.height);
  console.log("Children:", node.children?.length || 0);

  // === get_vector path (nodeToSvg) ===
  console.log("\n=== get_vector (nodeToSvg) ===");
  const vectorResult = nodeToSvg(node, blobs, { includeStyles: true });
  console.log("Size:", vectorResult.width, "x", vectorResult.height);
  console.log("ViewBox:", vectorResult.viewBox);

  // === renderScreen path ===
  console.log("\n=== renderScreen ===");
  const screenResult = renderScreen(node, undefined, blobs, {
    includeFills: true,
    includeStrokes: true,
    includeText: true,
    background: "#1a1a1a",
  });
  console.log("Size:", screenResult.width, "x", screenResult.height);

  // Save outputs
  writeFileSync("output/get-vector-output.svg", vectorResult.svgString);
  writeFileSync("output/render-output.svg", screenResult.svg);

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>get_vector vs renderScreen - ${NODE_ID}</title>
  <style>
    body { margin: 0; padding: 40px; background: #0d0d0d; color: #fff; font-family: sans-serif; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .info { color: #888; font-size: 14px; margin-bottom: 24px; }
    .container { display: flex; gap: 40px; flex-wrap: wrap; }
    .preview { background: #1a1a1a; border-radius: 12px; padding: 40px; }
    .preview h2 { font-size: 14px; color: #666; margin-bottom: 20px; }
    .preview.good h2 { color: #4f4; }
    .preview.bad h2 { color: #f44; }
    .scaled svg { width: 200px; height: auto; }
    pre { font-size: 10px; background: #111; padding: 10px; overflow: auto; max-height: 400px; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <h1>get_vector vs renderScreen: ${NODE_ID}</h1>
  <p class="info">Node: ${node.name} (${node.type}) | x=${sceneNode.x} y=${sceneNode.y} w=${sceneNode.width} h=${sceneNode.height}</p>

  <div class="container">
    <div class="preview bad">
      <h2>get_vector (nodeToSvg) - ${vectorResult.width.toFixed(1)} x ${vectorResult.height.toFixed(1)}</h2>
      <div class="scaled">${vectorResult.svgString}</div>
    </div>

    <div class="preview good">
      <h2>renderScreen - ${screenResult.width.toFixed(1)} x ${screenResult.height.toFixed(1)}</h2>
      <div class="scaled">${screenResult.svg.replace('<?xml version="1.0" encoding="UTF-8"?>', '')}</div>
    </div>
  </div>

  <h2 style="margin-top: 40px;">Raw SVG</h2>
  <div class="container">
    <div class="preview" style="max-width: 45%;">
      <h2>get_vector SVG</h2>
      <pre>${vectorResult.svgString.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
    <div class="preview" style="max-width: 45%;">
      <h2>renderScreen SVG</h2>
      <pre>${screenResult.svg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
  </div>
</body>
</html>`;

  writeFileSync("output/compare.html", html);
  console.log("\nSaved: output/get-vector-output.svg");
  console.log("Saved: output/render-output.svg");
  console.log("Saved: output/compare.html");
}

compare().catch(console.error);
