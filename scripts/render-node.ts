#!/usr/bin/env tsx
import { writeFile } from "fs/promises";
import { parseFigFile, formatGUID } from "../src/parser/index.js";
import { renderScreen } from "../src/renderer/index.js";

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/render-node.ts <filePath> <nodeId> [outputPath] [includeImages]",
      "",
      "Examples:",
      "  npx tsx scripts/render-node.ts /path/to/design.fig 457:1607",
      "  npx tsx scripts/render-node.ts /path/to/design.fig 457:1607 output.svg true",
    ].join("\n")
  );
}

const [, , filePath, nodeId, outputPathArg, includeImagesArg] = process.argv;

if (!filePath || !nodeId) {
  printUsage();
  process.exit(1);
}

const outputPath = outputPathArg || "output/render-node.svg";
const includeImages = includeImagesArg ? includeImagesArg === "true" : true;

const run = async () => {
  const parsed = await parseFigFile(filePath);
  const idx = new Map<string, unknown>();
  const walk = (n: any) => {
    idx.set(formatGUID(n.guid), n);
    if (n.children) n.children.forEach(walk);
  };
  walk(parsed.document);

  const target = idx.get(nodeId);
  if (!target) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const result = renderScreen(target as any, parsed.images, parsed.blobs, {
    includeImages,
  });

  await writeFile(outputPath, result.svg);
  console.log(`Wrote ${outputPath}`);
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
