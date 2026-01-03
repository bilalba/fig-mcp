#!/usr/bin/env npx tsx
/**
 * Explore image references in .fig files
 *
 * This script traces how images are referenced in fillPaints and
 * how those references map to files in the images/ folder.
 */

import { readFigFile } from "./parser/fig-reader.js";
import { parseCanvasFig, formatGUID } from "./parser/kiwi-parser.js";

interface ImageReference {
  nodeName: string;
  nodeGuid: string;
  nodeType: string;
  paintIndex: number;
  paintType: string;
  image?: unknown;
  imageHash?: unknown;
  imageThumbnail?: unknown;
  rawPaint: Record<string, unknown>;
}

async function exploreImages(filePath: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Exploring images in: ${filePath}`);
  console.log("=".repeat(60));

  // Read the archive
  const archive = await readFigFile(filePath);

  console.log(`\n📁 Images in archive (${archive.images.size} files):`);
  const imageNames = Array.from(archive.images.keys()).sort();
  for (const name of imageNames.slice(0, 20)) {
    const data = archive.images.get(name)!;
    console.log(`  - ${name} (${data.length} bytes)`);
  }
  if (imageNames.length > 20) {
    console.log(`  ... and ${imageNames.length - 20} more`);
  }

  // Check if image names look like hashes
  console.log(`\n🔍 Analyzing image filenames:`);
  const hexPattern = /^[0-9a-f]+$/i;
  const hashLike = imageNames.filter(n => hexPattern.test(n));
  console.log(`  - Hash-like names: ${hashLike.length}/${imageNames.length}`);
  if (hashLike.length > 0) {
    console.log(`  - Sample: ${hashLike.slice(0, 3).join(", ")}`);
    console.log(`  - Length: ${hashLike[0]?.length} chars`);
  }

  // Parse the canvas
  const parsed = parseCanvasFig(archive.canvasFig);
  const nodeChanges = parsed.message["nodeChanges"] as unknown[];

  if (!Array.isArray(nodeChanges)) {
    console.log("No nodeChanges array found");
    return;
  }

  console.log(`\n🌳 Scanning ${nodeChanges.length} nodes for image references...`);

  const imageRefs: ImageReference[] = [];
  const allPaintTypes = new Set<string>();
  const imageRelatedFields = new Set<string>();

  // Scan all nodes
  for (const change of nodeChanges) {
    if (!change || typeof change !== "object") continue;
    const node = change as Record<string, unknown>;

    const nodeName = String(node["name"] || "Unnamed");
    const nodeType = String(node["type"] || "UNKNOWN");
    const guid = node["guid"] as { sessionID?: number; localID?: number } | undefined;
    const nodeGuid = guid ? `${guid.sessionID}:${guid.localID}` : "?:?";

    // Check fillPaints
    const fillPaints = node["fillPaints"] as unknown[];
    if (Array.isArray(fillPaints)) {
      for (let i = 0; i < fillPaints.length; i++) {
        const paint = fillPaints[i] as Record<string, unknown>;
        if (!paint || typeof paint !== "object") continue;

        const paintType = String(paint["type"] || "UNKNOWN");
        allPaintTypes.add(paintType);

        // Track all fields in paints that might be image-related
        for (const key of Object.keys(paint)) {
          if (key.toLowerCase().includes("image") ||
              key.toLowerCase().includes("hash") ||
              key.toLowerCase().includes("thumb") ||
              key.toLowerCase().includes("blob")) {
            imageRelatedFields.add(key);
          }
        }

        // Look for image-related properties
        if (paint["image"] !== undefined ||
            paint["imageHash"] !== undefined ||
            paint["imageThumbnail"] !== undefined ||
            paintType === "IMAGE") {
          imageRefs.push({
            nodeName,
            nodeGuid,
            nodeType,
            paintIndex: i,
            paintType,
            image: paint["image"],
            imageHash: paint["imageHash"],
            imageThumbnail: paint["imageThumbnail"],
            rawPaint: paint,
          });
        }
      }
    }

    // Also check for other image-related fields at node level
    for (const key of Object.keys(node)) {
      if (key.toLowerCase().includes("image") ||
          key.toLowerCase().includes("hash") ||
          key.toLowerCase().includes("thumb")) {
        if (node[key] !== undefined && node[key] !== null) {
          imageRelatedFields.add(`node.${key}`);
        }
      }
    }
  }

  console.log(`\n🎨 Paint types found: ${Array.from(allPaintTypes).join(", ")}`);
  console.log(`\n🖼️  Image-related fields found: ${Array.from(imageRelatedFields).join(", ")}`);

  console.log(`\n📷 Found ${imageRefs.length} image references in paints:`);

  // Show detailed info for first few
  for (const ref of imageRefs.slice(0, 10)) {
    console.log(`\n  Node: "${ref.nodeName}" (${ref.nodeType}) [${ref.nodeGuid}]`);
    console.log(`    Paint type: ${ref.paintType}`);

    if (ref.image !== undefined) {
      console.log(`    image: ${JSON.stringify(ref.image)}`);
    }
    if (ref.imageHash !== undefined) {
      console.log(`    imageHash: ${JSON.stringify(ref.imageHash)}`);
    }
    if (ref.imageThumbnail !== undefined) {
      console.log(`    imageThumbnail: ${JSON.stringify(ref.imageThumbnail)}`);
    }

    // Show all paint fields for debugging
    console.log(`    All paint fields: ${Object.keys(ref.rawPaint).join(", ")}`);
  }

  if (imageRefs.length > 10) {
    console.log(`\n  ... and ${imageRefs.length - 10} more image references`);
  }

  // Try to correlate hashes to filenames
  console.log(`\n🔗 Attempting to correlate image references to files...`);

  // Extract unique image/hash values
  const uniqueImageValues = new Set<string>();
  for (const ref of imageRefs) {
    if (ref.image) {
      const imgVal = typeof ref.image === "object"
        ? JSON.stringify(ref.image)
        : String(ref.image);
      uniqueImageValues.add(imgVal);
    }
    if (ref.imageHash) {
      const hashVal = typeof ref.imageHash === "object"
        ? JSON.stringify(ref.imageHash)
        : String(ref.imageHash);
      uniqueImageValues.add(hashVal);
    }
  }

  console.log(`  Unique image/hash values: ${uniqueImageValues.size}`);
  for (const val of Array.from(uniqueImageValues).slice(0, 5)) {
    console.log(`    - ${val}`);

    // Check if it matches any filename
    const parsed = tryParseImageRef(val);
    if (parsed) {
      const matchingFile = imageNames.find(n =>
        n === parsed ||
        n.includes(parsed) ||
        parsed.includes(n)
      );
      if (matchingFile) {
        console.log(`      ✓ MATCHES FILE: ${matchingFile}`);
      }
    }
  }

  // Dump a complete sample node with IMAGE paint
  if (imageRefs.length > 0) {
    console.log(`\n📋 Complete raw paint data for first IMAGE reference:`);
    console.log(JSON.stringify(imageRefs[0]?.rawPaint, null, 2));
  }
}

function tryParseImageRef(val: string): string | null {
  try {
    const obj = JSON.parse(val);
    // If it's an object with specific fields, try to extract the hash
    if (obj && typeof obj === "object") {
      // Check common hash field names
      for (const key of ["hash", "id", "guid", "ref"]) {
        if (obj[key]) return String(obj[key]);
      }
    }
    return null;
  } catch {
    // Not JSON, maybe it's already a hash string
    return val;
  }
}

/**
 * Convert the hash byte object {0: byte, 1: byte, ...} to hex string
 */
function hashBytesToHex(hashObj: Record<string, number>): string {
  const bytes: number[] = [];
  for (let i = 0; i < 20; i++) {
    if (hashObj[String(i)] !== undefined) {
      bytes.push(hashObj[String(i)]!);
    }
  }
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyHashCorrelation(filePath: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`VERIFYING HASH → FILENAME CORRELATION`);
  console.log("=".repeat(60));

  const archive = await readFigFile(filePath);
  const parsed = parseCanvasFig(archive.canvasFig);
  const nodeChanges = parsed.message["nodeChanges"] as unknown[];

  const imageNames = new Set(Array.from(archive.images.keys()));
  let matched = 0;
  let unmatched = 0;
  const unmatchedHashes: string[] = [];

  for (const change of nodeChanges) {
    if (!change || typeof change !== "object") continue;
    const node = change as Record<string, unknown>;

    const fillPaints = node["fillPaints"] as unknown[];
    if (!Array.isArray(fillPaints)) continue;

    for (const paint of fillPaints) {
      if (!paint || typeof paint !== "object") continue;
      const p = paint as Record<string, unknown>;

      // Check image field
      const image = p["image"] as { hash?: Record<string, number> } | undefined;
      if (image?.hash) {
        const hexHash = hashBytesToHex(image.hash);
        if (imageNames.has(hexHash)) {
          matched++;
        } else {
          unmatched++;
          if (unmatchedHashes.length < 5) {
            unmatchedHashes.push(hexHash);
          }
        }
      }

      // Check imageThumbnail field
      const thumb = p["imageThumbnail"] as { hash?: Record<string, number> } | undefined;
      if (thumb?.hash) {
        const hexHash = hashBytesToHex(thumb.hash);
        if (imageNames.has(hexHash)) {
          matched++;
        } else {
          unmatched++;
          if (unmatchedHashes.length < 5) {
            unmatchedHashes.push(`thumb:${hexHash}`);
          }
        }
      }
    }
  }

  console.log(`\n✅ Matched hashes: ${matched}`);
  console.log(`❌ Unmatched hashes: ${unmatched}`);

  if (unmatchedHashes.length > 0) {
    console.log(`\nUnmatched samples:`);
    for (const h of unmatchedHashes) {
      console.log(`  - ${h}`);
    }
  }

  // Show a few successful correlations
  console.log(`\n📋 Sample correlations (first 5):`);
  let shown = 0;
  for (const change of nodeChanges) {
    if (shown >= 5) break;
    if (!change || typeof change !== "object") continue;
    const node = change as Record<string, unknown>;

    const fillPaints = node["fillPaints"] as unknown[];
    if (!Array.isArray(fillPaints)) continue;

    for (const paint of fillPaints) {
      if (shown >= 5) break;
      if (!paint || typeof paint !== "object") continue;
      const p = paint as Record<string, unknown>;

      const image = p["image"] as { hash?: Record<string, number> } | undefined;
      if (image?.hash) {
        const hexHash = hashBytesToHex(image.hash);
        if (imageNames.has(hexHash)) {
          const imageData = archive.images.get(hexHash)!;
          const nodeName = String(node["name"] || "Unnamed");
          const dims = `${p["originalImageWidth"]}x${p["originalImageHeight"]}`;
          console.log(`  "${nodeName}" → ${hexHash} (${imageData.length} bytes, ${dims})`);
          shown++;
        }
      }
    }
  }

  // Detect image format by magic bytes
  console.log(`\n🔍 Image format detection (first 5):`);
  let formatShown = 0;
  for (const [name, data] of archive.images) {
    if (formatShown >= 5) break;
    let format = "unknown";
    if (data[0] === 0xFF && data[1] === 0xD8) format = "JPEG";
    else if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) format = "PNG";
    else if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) format = "GIF";
    else if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) format = "WebP";
    console.log(`  ${name.slice(0, 12)}... → ${format} (${data.length} bytes)`);
    formatShown++;
  }
}

// Main
const filePath = process.argv[2] || "/Users/billy/Downloads/AutoDevice (Copy).fig";
exploreImages(filePath)
  .then(() => verifyHashCorrelation(filePath))
  .catch(console.error);
