/**
 * Compare renderScreen outputs to debug transform/positioning issues
 */
import { readFigFile } from "./parser/index.js";
import { parseCanvasFig, formatGUID, extractDocumentTree } from "./parser/kiwi-parser.js";
import { renderScreen } from "./experimental/render-screen.js";
import type { FigNode } from "./parser/types.js";
import { writeFileSync } from "fs";

const FILE_PATH = "/Users/billy/Downloads/AutoDevice (Copy).fig";
const NODE_ID = process.argv[2] || "457:1681";

async function compare() {
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

  const node = nodeIndex.get(NODE_ID);
  if (!node) {
    console.log("Node not found:", NODE_ID);
    return;
  }

  console.log("Node:", formatGUID(node.guid));
  console.log("Type:", node.type);
  console.log("Name:", node.name);
  console.log("Children:", node.children?.length || 0);

  const options = {
    includeFills: true,
    includeStrokes: true,
    includeText: true,
    background: "#1a1a1a",
  };

  // Render two passes to compare outputs
  console.log("\n--- Render A (renderScreen) ---");
  const firstResult = renderScreen(node, undefined, blobs, options);
  console.log("Render A Size:", firstResult.width, "x", firstResult.height);
  if (firstResult.warnings.length) console.log("Render A Warnings:", firstResult.warnings);

  console.log("\n--- Render B (renderScreen) ---");
  const secondResult = renderScreen(node, undefined, blobs, options);
  console.log("Render B Size:", secondResult.width, "x", secondResult.height);
  if (secondResult.warnings.length) console.log("Render B Warnings:", secondResult.warnings);

  // Save both
  writeFileSync("output/compare-a.svg", firstResult.svg);
  writeFileSync("output/compare-b.svg", secondResult.svg);
  console.log("\nSaved: output/compare-a.svg");
  console.log("Saved: output/compare-b.svg");

  // Create comparison HTML
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Renderer Comparison - ${NODE_ID}</title>
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
  </style>
</head>
<body>
  <h1>Renderer Comparison: ${NODE_ID}</h1>
  <p class="info">Node: ${node.name} (${node.type})</p>

  <div class="container">
    <div class="preview bad">
      <h2>Render A - ${firstResult.width.toFixed(1)} x ${firstResult.height.toFixed(1)}</h2>
      <div class="scaled">${firstResult.svg.replace('<?xml version="1.0" encoding="UTF-8"?>', '')}</div>
    </div>

    <div class="preview good">
      <h2>Render B - ${secondResult.width.toFixed(1)} x ${secondResult.height.toFixed(1)}</h2>
      <div class="scaled">${secondResult.svg.replace('<?xml version="1.0" encoding="UTF-8"?>', '')}</div>
    </div>
  </div>

  <h2 style="margin-top: 40px;">Raw SVG Comparison</h2>
  <div class="container">
    <div class="preview">
      <h2>Render A SVG</h2>
      <pre style="font-size: 10px; max-height: 300px; overflow: auto; background: #111; padding: 10px;">${firstResult.svg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
    <div class="preview">
      <h2>Render B SVG</h2>
      <pre style="font-size: 10px; max-height: 300px; overflow: auto; background: #111; padding: 10px;">${secondResult.svg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
  </div>
</body>
</html>`;

  writeFileSync("output/compare.html", html);
  console.log("Saved: output/compare.html");
}

compare().catch(console.error);
