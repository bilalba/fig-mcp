/**
 * Compare MCP server's render_screen logic vs direct renderScreen call
 */
import { readFigFile, buildNodeIdIndex } from "./parser/index.js";
import { parseCanvasFig, extractDocumentTree } from "./parser/kiwi-parser.js";
import { renderScreen } from "./renderer/index.js";
import type { FigNode } from "./parser/types.js";
import { writeFileSync } from "fs";

const FILE_PATH = "/Users/billy/Downloads/AutoDevice (Copy).fig";
const NODE_ID = process.argv[2] || "457:1681";

// Simulate MCP server's getOrParseFigFile
async function mcpParse(filePath: string) {
  const { parseFigFile } = await import("./parser/index.js");
  const parsed = await parseFigFile(filePath);
  const nodeIdIndex = buildNodeIdIndex(parsed.document);
  return {
    document: parsed.document,
    images: parsed.images,
    blobs: parsed.blobs,
    nodeIdIndex,
  };
}

// Direct parse like render-single.ts
async function directParse(filePath: string) {
  const archive = await readFigFile(filePath);
  const parsed = parseCanvasFig(archive.canvasFig);
  const doc = extractDocumentTree(parsed.message);
  const blobs = parsed.message["blobs"] as Array<{ bytes: Uint8Array }> | undefined;
  return { doc, blobs };
}

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

  // === MCP SERVER PATH ===
  console.log("\n=== MCP SERVER PATH ===");
  const mcpData = await mcpParse(FILE_PATH);
  const mcpNode = mcpData.nodeIdIndex.get(normalizedId);

  if (!mcpNode) {
    console.log("MCP: Node not found");
    return;
  }
  console.log("MCP Node found:", mcpNode.name, mcpNode.type);
  console.log("MCP blobs count:", mcpData.blobs?.length || 0);
  console.log("MCP images count:", mcpData.images?.size || 0);

  // MCP render_screen call (line 1608 in server.ts)
  const mcpResult = renderScreen(mcpNode, mcpData.images, mcpData.blobs, {
    includeFills: true,
    includeStrokes: true,
    includeText: true,
    background: "#1a1a1a",
  });
  console.log("MCP Result size:", mcpResult.width, "x", mcpResult.height);
  console.log("MCP Warnings:", mcpResult.warnings);

  // === DIRECT PATH (render-single.ts) ===
  console.log("\n=== DIRECT PATH (render-single.ts) ===");
  const directData = await directParse(FILE_PATH);

  if (!directData.doc) {
    console.log("Direct: Failed to extract document");
    return;
  }

  // Build index like render-single.ts does
  const { formatGUID } = await import("./parser/kiwi-parser.js");
  const directIndex = new Map<string, FigNode>();
  function indexNode(node: FigNode) {
    directIndex.set(formatGUID(node.guid), node);
    if (node.children) {
      for (const child of node.children as FigNode[]) {
        indexNode(child);
      }
    }
  }
  indexNode(directData.doc);

  const directNode = directIndex.get(normalizedId);
  if (!directNode) {
    console.log("Direct: Node not found");
    return;
  }
  console.log("Direct Node found:", directNode.name, directNode.type);
  console.log("Direct blobs count:", directData.blobs?.length || 0);

  // Direct renderScreen call (like render-single.ts line 46)
  const directResult = renderScreen(directNode, undefined, directData.blobs, {
    includeFills: true,
    includeStrokes: true,
    includeText: true,
    background: "#1a1a1a",
  });
  console.log("Direct Result size:", directResult.width, "x", directResult.height);
  console.log("Direct Warnings:", directResult.warnings);

  // === Compare nodes ===
  console.log("\n=== NODE COMPARISON ===");
  console.log("Same node?", mcpNode === directNode);
  console.log("MCP node guid:", (mcpNode as any).guid);
  console.log("Direct node guid:", (directNode as any).guid);
  console.log("MCP node children:", mcpNode.children?.length || 0);
  console.log("Direct node children:", directNode.children?.length || 0);

  // Check if node data is the same
  const mcpScene = mcpNode as any;
  const directScene = directNode as any;
  console.log("\nMCP node x/y/w/h:", mcpScene.x, mcpScene.y, mcpScene.width, mcpScene.height);
  console.log("Direct node x/y/w/h:", directScene.x, directScene.y, directScene.width, directScene.height);

  // === KEY DIFFERENCE: Check blobs ===
  console.log("\n=== BLOB COMPARISON ===");
  if (mcpData.blobs && directData.blobs) {
    console.log("MCP blobs length:", mcpData.blobs.length);
    console.log("Direct blobs length:", directData.blobs.length);
    console.log("Same blob array?", mcpData.blobs === directData.blobs);

    // Check first few blobs
    for (let i = 0; i < Math.min(3, mcpData.blobs.length); i++) {
      const mcpBlob = mcpData.blobs[i];
      const directBlob = directData.blobs[i];
      console.log(`Blob ${i}: MCP bytes=${mcpBlob?.bytes?.length}, Direct bytes=${directBlob?.bytes?.length}`);
    }
  }

  // Save outputs
  writeFileSync("output/mcp-output.svg", mcpResult.svg);
  writeFileSync("output/direct-output.svg", directResult.svg);

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>MCP vs Direct Comparison - ${NODE_ID}</title>
  <style>
    body { margin: 0; padding: 40px; background: #0d0d0d; color: #fff; font-family: sans-serif; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .container { display: flex; gap: 40px; flex-wrap: wrap; }
    .preview { background: #1a1a1a; border-radius: 12px; padding: 40px; }
    .preview h2 { font-size: 14px; color: #666; margin-bottom: 20px; }
    .preview.good h2 { color: #4f4; }
    .preview.bad h2 { color: #f44; }
    .scaled svg { width: 200px; height: auto; }
    pre { font-size: 10px; background: #111; padding: 10px; overflow: auto; max-height: 400px; }
  </style>
</head>
<body>
  <h1>MCP vs Direct Comparison: ${NODE_ID}</h1>

  <div class="container">
    <div class="preview bad">
      <h2>MCP (renderScreen) - ${mcpResult.width.toFixed(1)} x ${mcpResult.height.toFixed(1)}</h2>
      <div class="scaled">${mcpResult.svg.replace('<?xml version="1.0" encoding="UTF-8"?>', '')}</div>
    </div>

    <div class="preview good">
      <h2>Direct (renderScreen) - ${directResult.width.toFixed(1)} x ${directResult.height.toFixed(1)}</h2>
      <div class="scaled">${directResult.svg.replace('<?xml version="1.0" encoding="UTF-8"?>', '')}</div>
    </div>
  </div>

  <h2 style="margin-top: 40px;">Raw SVG</h2>
  <div class="container">
    <div class="preview">
      <h2>MCP SVG</h2>
      <pre>${mcpResult.svg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
    <div class="preview">
      <h2>Direct SVG</h2>
      <pre>${directResult.svg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
  </div>
</body>
</html>`;

  writeFileSync("output/mcp-vs-direct.html", html);
  console.log("\nSaved: output/mcp-output.svg");
  console.log("Saved: output/direct-output.svg");
  console.log("Saved: output/mcp-vs-direct.html");
}

compare().catch(console.error);
