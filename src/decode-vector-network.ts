/**
 * Decode and inspect vectorNetworkBlob format
 */

import { readFigFile } from "./parser/index.js";
import { parseCanvasFig } from "./parser/kiwi-parser.js";

const FILE_PATH = "/Users/billy/Downloads/AutoDevice (Copy).fig";

// Test with different vectors:
// Simple horizontal line (2 vertices, 1 segment)
const SIMPLE_LINE_NODE = "457:1695"; // Size: 10 x 0
// Complex polygon (8+ vertices)
const COMPLEX_SHAPE_NODE = "457:1697"; // Size: 18 x 12
// Rotated filled shape
const ROTATED_NODE = "457:1682";

async function decodeVectorNetwork() {
  console.log("Reading .fig file...");
  const archive = await readFigFile(FILE_PATH);
  const parsed = parseCanvasFig(archive.canvasFig);
  const nodeChanges = parsed.message["nodeChanges"] as unknown[];
  const blobs = parsed.message["blobs"] as Array<{ bytes: Uint8Array }> | undefined;

  if (!blobs) {
    console.log("No blobs found!");
    return;
  }

  // Build node map
  const nodeMap = new Map<string, Record<string, unknown>>();
  for (const change of nodeChanges) {
    if (!change || typeof change !== "object") continue;
    const obj = change as Record<string, unknown>;
    const guid = obj["guid"] as { sessionID?: number; localID?: number } | undefined;
    if (guid) {
      nodeMap.set(`${guid.sessionID}:${guid.localID}`, obj);
    }
  }

  for (const nodeId of [SIMPLE_LINE_NODE, COMPLEX_SHAPE_NODE, ROTATED_NODE]) {
    console.log("\n" + "=".repeat(80));
    console.log(`Decoding vectorNetwork for: ${nodeId}`);
    console.log("=".repeat(80));

    const node = nodeMap.get(nodeId);
    if (!node) {
      console.log("Node not found!");
      continue;
    }

    console.log(`Type: ${node["type"]}, Name: ${node["name"]}`);
    const size = node["size"] as { x?: number; y?: number } | undefined;
    console.log(`Size: ${size?.x} x ${size?.y}`);

    const vectorData = node["vectorData"] as { vectorNetworkBlob?: number; normalizedSize?: { x: number; y: number } } | undefined;
    if (!vectorData || vectorData.vectorNetworkBlob === undefined) {
      console.log("No vectorData.vectorNetworkBlob!");
      continue;
    }

    console.log(`NormalizedSize: ${JSON.stringify(vectorData.normalizedSize)}`);

    const blobIndex = vectorData.vectorNetworkBlob;
    const blob = blobs[blobIndex];
    if (!blob?.bytes) {
      console.log("Blob not found!");
      continue;
    }

    const bytes = blob.bytes;
    console.log(`\nBlob size: ${bytes.length} bytes`);
    console.log(`Raw bytes: [${Array.from(bytes.slice(0, 60)).join(", ")}...]`);

    // Try to decode the structure
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let offset = 0;

    // Read counts (appears to be 4-byte little-endian integers)
    const count1 = view.getUint32(offset, true); offset += 4;
    const count2 = view.getUint32(offset, true); offset += 4;
    const count3 = view.getUint32(offset, true); offset += 4;

    console.log(`\nStructure (assuming uint32 counts):`);
    console.log(`  Count1 (vertices?): ${count1}`);
    console.log(`  Count2 (segments?): ${count2}`);
    console.log(`  Count3 (regions?): ${count3}`);

    // For simple lines (2 vertices, 1 segment), try to read vertex data
    if (count1 === 2 && count2 === 1) {
      console.log(`\nSimple line detected! Attempting to read vertex positions...`);

      // After the 3 counts (12 bytes), we should have vertex data
      // Each vertex likely has: x (float), y (float), and possibly handle data
      console.log(`\nRemaining bytes after counts: ${bytes.length - 12}`);

      // Try reading as floats
      console.log(`\nAttempting to read as floats starting at offset 12:`);
      for (let i = 0; i < Math.min(8, (bytes.length - 12) / 4); i++) {
        const f = view.getFloat32(12 + i * 4, true);
        console.log(`  float[${i}] @ offset ${12 + i * 4}: ${f}`);
      }
    }

    // For more complex shapes, try different interpretations
    if (count1 > 2) {
      console.log(`\nComplex shape with ${count1} vertices and ${count2} segments`);

      // Try to find vertex positions
      console.log(`\nAttempting to read vertex positions as floats:`);
      const vertexStart = 12; // After the 3 counts

      // Each vertex might be: x (4), y (4) = 8 bytes minimum
      // Or with handles: x (4), y (4), handleMode (4), handleIn (8), handleOut (8) = 28+ bytes

      const bytesPerVertex = (bytes.length - 12) / count1;
      console.log(`Estimated bytes per vertex: ${bytesPerVertex.toFixed(1)}`);

      // Read first few vertices assuming just x,y floats
      console.log(`\nFirst 4 vertices (assuming x,y floats):`);
      for (let v = 0; v < Math.min(4, count1); v++) {
        const vOffset = vertexStart + v * 8;
        if (vOffset + 8 <= bytes.length) {
          const x = view.getFloat32(vOffset, true);
          const y = view.getFloat32(vOffset + 4, true);
          console.log(`  Vertex ${v}: (${x.toFixed(4)}, ${y.toFixed(4)})`);
        }
      }
    }

    // Also decode the strokeGeometry/fillGeometry path commands for comparison
    const strokeGeometry = node["strokeGeometry"] as Array<{ commandsBlob?: number }> | undefined;
    const fillGeometry = node["fillGeometry"] as Array<{ commandsBlob?: number }> | undefined;

    const geom = strokeGeometry?.[0] || fillGeometry?.[0];
    if (geom?.commandsBlob !== undefined) {
      const pathBlob = blobs[geom.commandsBlob];
      if (pathBlob?.bytes) {
        console.log(`\nPath commands blob (${pathBlob.bytes.length} bytes):`);
        decodePathCommands(pathBlob.bytes);
      }
    }
  }
}

function decodePathCommands(bytes: Uint8Array) {
  const cmdNames: Record<number, string> = {
    0: "CLOSE",
    1: "MOVE",
    2: "LINE",
    3: "QUAD",
    4: "CUBIC",
  };
  const cmdArgCounts: Record<number, number> = {
    0: 0, 1: 2, 2: 2, 3: 4, 4: 6,
  };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let offset = 0;
  let cmdIndex = 0;

  while (offset < bytes.length && cmdIndex < 20) {
    const cmd = bytes[offset++];
    const cmdName = cmdNames[cmd] || `UNKNOWN(${cmd})`;
    const argCount = cmdArgCounts[cmd] ?? 0;

    const args: number[] = [];
    for (let i = 0; i < argCount && offset + 4 <= bytes.length; i++) {
      args.push(view.getFloat32(offset, true));
      offset += 4;
    }

    if (args.length > 0) {
      const argStr = args.map(a => a.toFixed(4)).join(", ");
      console.log(`  [${cmdIndex}] ${cmdName}: ${argStr}`);
    } else {
      console.log(`  [${cmdIndex}] ${cmdName}`);
    }
    cmdIndex++;
  }

  if (offset < bytes.length) {
    console.log(`  ... (${bytes.length - offset} more bytes)`);
  }
}

decodeVectorNetwork().catch(console.error);
