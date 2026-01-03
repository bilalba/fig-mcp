/**
 * Inspect frame 457:1694 and its vector children
 */
import { readFigFile } from "./parser/index.js";
import { parseCanvasFig, formatGUID, extractDocumentTree } from "./parser/kiwi-parser.js";
import type { FigNode } from "./parser/types.js";

const FILE_PATH = "/Users/billy/Downloads/AutoDevice (Copy).fig";

async function inspect() {
  const archive = await readFigFile(FILE_PATH);
  const parsed = parseCanvasFig(archive.canvasFig);
  const doc = extractDocumentTree(parsed.message);
  if (!doc) {
    console.log("Failed to extract document tree");
    return;
  }

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

  // Get frame 457:1694 and its children
  const rawFrame = nodeIndex.get("457:1694");
  if (!rawFrame) {
    console.log("Frame not found");
    return;
  }
  const frame = rawFrame as unknown as Record<string, unknown>;

  console.log("Frame 457:1694:", frame.name);
  console.log("Children:", (frame.children as unknown[])?.length);

  const blobs = parsed.message["blobs"] as Array<{ bytes: Uint8Array }> | undefined;

  for (const child of (frame.children as FigNode[]) || []) {
    const raw = child as unknown as Record<string, unknown>;
    const id = formatGUID(child.guid);
    console.log("\n" + "=".repeat(60));
    console.log("Child:", id, "| Name:", child.name, "| Type:", child.type);
    console.log("Size:", raw.size);
    console.log("Transform:", raw.transform);
    console.log("strokeWeight:", raw.strokeWeight);
    console.log("strokeCap:", raw.strokeCap);
    console.log("strokeJoin:", raw.strokeJoin);

    const vectorData = raw.vectorData as Record<string, unknown> | undefined;
    if (vectorData) {
      console.log("\nvectorData.normalizedSize:", vectorData.normalizedSize);
      console.log("vectorData.vectorNetworkBlob:", vectorData.vectorNetworkBlob);

      // Decode the vector network blob
      if (typeof vectorData.vectorNetworkBlob === "number" && blobs) {
        const blobIndex = vectorData.vectorNetworkBlob;
        const bytes = blobs[blobIndex]?.bytes;
        if (bytes) {
          console.log("\n  Blob bytes length:", bytes.length);
          console.log("  Full blob (hex):", Buffer.from(bytes).toString("hex"));

          // Parse header
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
          const vertexCount = view.getUint32(0, true);
          const segmentCount = view.getUint32(4, true);
          const regionCount = view.getUint32(8, true);
          console.log(`  Header: vertices=${vertexCount}, segments=${segmentCount}, regions=${regionCount}`);

          // Parse vertices (16 bytes each)
          console.log("\n  Vertices:");
          const VERTEX_STRIDE = 16;
          let offset = 12;
          for (let i = 0; i < vertexCount && offset + 16 <= bytes.length; i++) {
            const x = view.getFloat32(offset, true);
            const y = view.getFloat32(offset + 4, true);
            const flags = view.getUint32(offset + 8, true);
            const extra = view.getUint32(offset + 12, true);
            console.log(`    [${i}] x=${x.toFixed(4)}, y=${y.toFixed(4)}, flags=${flags}, extra=${extra}`);
            offset += VERTEX_STRIDE;
          }

          // Parse segments (24 bytes each: startIdx(4), cp1 data(12), endIdx(4), cp2 data(4))
          console.log("\n  Segments (end at offset +16):");
          const SEGMENT_STRIDE = 24;
          for (let i = 0; i < segmentCount && offset + SEGMENT_STRIDE <= bytes.length; i++) {
            const start = view.getUint32(offset, true);
            const end = view.getUint32(offset + 16, true);
            console.log(`    [${i}] ${start} -> ${end}`);
            offset += SEGMENT_STRIDE;
          }
        }
      }
    }
  }
}

inspect().catch(console.error);
