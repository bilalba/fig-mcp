/**
 * Inspect specific nodes from a .fig file to understand vector data structure
 */

import { readFigFile, parseFigFile } from "./parser/index.js";
import { parseCanvasFig, formatGUID } from "./parser/kiwi-parser.js";
import type { FigNode, SceneNode } from "./parser/types.js";

const FILE_PATH = "/Users/billy/Downloads/AutoDevice (Copy).fig";
// Original frames and their vector children
const NODE_IDS = [
  "457:1694", // Frame containing vectors
  "457:1695", // Vector child
  "457:1696", // Vector child
  "457:1697", // Vector child
  "457:1610", // Frame containing vectors
  "457:1611", // Vector child
  "457:1612", // Vector child
  "457:1681", // Logo frame
  "457:1682", // Vector child (rotated)
  "457:1683", // Vector child (rotated)
  "457:1684", // Vector child (rotated)
];

async function inspectNodes() {
  console.log("Reading .fig file...");
  const archive = await readFigFile(FILE_PATH);

  console.log("Parsing canvas.fig...");
  const canvasData = archive.canvasFig;
  if (!canvasData) {
    throw new Error("No canvas.fig found");
  }

  const parsed = parseCanvasFig(canvasData);
  const nodeChanges = parsed.message["nodeChanges"] as unknown[];
  const blobs = parsed.message["blobs"] as Array<{ bytes: Uint8Array }> | undefined;

  console.log(`Found ${nodeChanges?.length ?? 0} nodeChanges`);
  console.log(`Found ${blobs?.length ?? 0} blobs\n`);

  // Build a map of nodes by GUID
  const nodeMap = new Map<string, Record<string, unknown>>();
  for (const change of nodeChanges) {
    if (!change || typeof change !== "object") continue;
    const obj = change as Record<string, unknown>;
    const guid = obj["guid"] as { sessionID?: number; localID?: number } | undefined;
    if (guid) {
      const key = `${guid.sessionID}:${guid.localID}`;
      nodeMap.set(key, obj);
    }
  }

  // Inspect each requested node
  for (const nodeId of NODE_IDS) {
    console.log("=".repeat(80));
    console.log(`NODE: ${nodeId}`);
    console.log("=".repeat(80));

    const node = nodeMap.get(nodeId);
    if (!node) {
      console.log("NOT FOUND\n");
      continue;
    }

    // Basic info
    console.log(`Type: ${node["type"]}`);
    console.log(`Name: ${node["name"]}`);
    console.log(`Visible: ${node["visible"]}`);

    // Size and transform
    const size = node["size"] as { x?: number; y?: number } | undefined;
    console.log(`\nSize: ${size ? `${size.x} x ${size.y}` : "N/A"}`);

    const transform = node["transform"] as Record<string, number> | undefined;
    if (transform) {
      console.log(`Transform:`);
      console.log(`  m00=${transform.m00?.toFixed(4)}, m01=${transform.m01?.toFixed(4)}, m02=${transform.m02?.toFixed(4)}`);
      console.log(`  m10=${transform.m10?.toFixed(4)}, m11=${transform.m11?.toFixed(4)}, m12=${transform.m12?.toFixed(4)}`);
    }

    // Fills and strokes
    const fillPaints = node["fillPaints"] as unknown[] | undefined;
    const strokePaints = node["strokePaints"] as unknown[] | undefined;
    console.log(`\nFillPaints: ${fillPaints?.length ?? 0}`);
    if (fillPaints && fillPaints.length > 0) {
      for (let i = 0; i < Math.min(fillPaints.length, 3); i++) {
        const paint = fillPaints[i] as Record<string, unknown>;
        console.log(`  [${i}] type=${paint?.type}, visible=${paint?.visible}, blendMode=${paint?.blendMode}`);
        if (paint?.color) {
          const c = paint.color as { r?: number; g?: number; b?: number; a?: number };
          console.log(`      color: rgba(${(c.r ?? 0) * 255}, ${(c.g ?? 0) * 255}, ${(c.b ?? 0) * 255}, ${c.a ?? 1})`);
        }
      }
    }

    console.log(`StrokePaints: ${strokePaints?.length ?? 0}`);
    if (strokePaints && strokePaints.length > 0) {
      for (let i = 0; i < Math.min(strokePaints.length, 3); i++) {
        const paint = strokePaints[i] as Record<string, unknown>;
        console.log(`  [${i}] type=${paint?.type}, visible=${paint?.visible}, blendMode=${paint?.blendMode}`);
        if (paint?.color) {
          const c = paint.color as { r?: number; g?: number; b?: number; a?: number };
          console.log(`      color: rgba(${(c.r ?? 0) * 255}, ${(c.g ?? 0) * 255}, ${(c.b ?? 0) * 255}, ${c.a ?? 1})`);
        }
      }
    }

    // Stroke properties
    console.log(`\nStroke Properties:`);
    console.log(`  strokeWeight: ${node["strokeWeight"]}`);
    console.log(`  strokeCap: ${node["strokeCap"]}`);
    console.log(`  strokeJoin: ${node["strokeJoin"]}`);
    console.log(`  strokeAlign: ${node["strokeAlign"]}`);
    console.log(`  miterLimit: ${node["miterLimit"]}`);
    console.log(`  strokeDashes: ${JSON.stringify(node["strokeDashes"])}`);

    // Vector geometry
    const fillGeometry = node["fillGeometry"] as unknown[] | undefined;
    const strokeGeometry = node["strokeGeometry"] as unknown[] | undefined;

    console.log(`\nFillGeometry: ${fillGeometry?.length ?? 0} paths`);
    if (fillGeometry && fillGeometry.length > 0) {
      for (let i = 0; i < Math.min(fillGeometry.length, 3); i++) {
        const path = fillGeometry[i] as Record<string, unknown>;
        console.log(`  [${i}] commandsBlob=${path?.commandsBlob}, windingRule=${path?.windingRule}`);
        if (path?.commands) {
          const cmds = path.commands as unknown[];
          console.log(`      commands array: ${cmds.length} entries`);
          console.log(`      first few: ${JSON.stringify(cmds.slice(0, 10))}`);
        }
        if (typeof path?.commandsBlob === "number" && blobs) {
          const blobData = blobs[path.commandsBlob];
          console.log(`      blob size: ${blobData?.bytes?.length ?? 0} bytes`);
        }
      }
    }

    console.log(`StrokeGeometry: ${strokeGeometry?.length ?? 0} paths`);
    if (strokeGeometry && strokeGeometry.length > 0) {
      for (let i = 0; i < Math.min(strokeGeometry.length, 3); i++) {
        const path = strokeGeometry[i] as Record<string, unknown>;
        console.log(`  [${i}] commandsBlob=${path?.commandsBlob}, windingRule=${path?.windingRule}`);
        if (path?.commands) {
          const cmds = path.commands as unknown[];
          console.log(`      commands array: ${cmds.length} entries`);
          console.log(`      first few: ${JSON.stringify(cmds.slice(0, 10))}`);
        }
        if (typeof path?.commandsBlob === "number" && blobs) {
          const blobData = blobs[path.commandsBlob];
          console.log(`      blob size: ${blobData?.bytes?.length ?? 0} bytes`);
        }
      }
    }

    // Vector data
    const vectorData = node["vectorData"] as Record<string, unknown> | undefined;
    console.log(`\nVectorData:`);
    if (vectorData) {
      console.log(`  vectorNetworkBlob: ${vectorData.vectorNetworkBlob}`);
      console.log(`  normalizedSize: ${JSON.stringify(vectorData.normalizedSize)}`);
      if (typeof vectorData.vectorNetworkBlob === "number" && blobs) {
        const blobData = blobs[vectorData.vectorNetworkBlob];
        console.log(`  blob size: ${blobData?.bytes?.length ?? 0} bytes`);
        // Show first few bytes
        if (blobData?.bytes) {
          const first20 = Array.from(blobData.bytes.slice(0, 20));
          console.log(`  first 20 bytes: [${first20.join(", ")}]`);
        }
      }
    } else {
      console.log("  N/A");
    }

    // Children
    const parentIndex = node["parentIndex"] as { guid?: unknown; position?: string } | undefined;
    console.log(`\nParent: ${parentIndex?.guid ? formatGUID(parentIndex.guid as any) : "N/A"}`);

    // Find children
    const children: string[] = [];
    for (const [key, n] of nodeMap) {
      const pi = (n as Record<string, unknown>)["parentIndex"] as { guid?: { sessionID?: number; localID?: number } } | undefined;
      if (pi?.guid) {
        const parentKey = `${pi.guid.sessionID}:${pi.guid.localID}`;
        if (parentKey === nodeId) {
          children.push(key);
        }
      }
    }
    console.log(`Children: ${children.length}`);
    if (children.length > 0 && children.length <= 10) {
      for (const childId of children) {
        const child = nodeMap.get(childId);
        console.log(`  ${childId}: ${child?.["type"]} - "${child?.["name"]}"`);
      }
    }

    // Other interesting fields
    console.log(`\nOther Fields:`);
    const interestingFields = [
      "opacity", "blendMode", "isMask", "clipsContent",
      "cornerRadius", "rectangleCornerRadii",
      "handleMirroring", "rotation"
    ];
    for (const field of interestingFields) {
      if (node[field] !== undefined) {
        console.log(`  ${field}: ${JSON.stringify(node[field])}`);
      }
    }

    console.log("\n");
  }
}

inspectNodes().catch(console.error);
