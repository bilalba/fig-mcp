#!/usr/bin/env node
/**
 * Fig Inspector - Command-line tool to inspect .fig files
 *
 * Usage:
 *   npx tsx src/inspect-fig.ts <file.fig> [command]
 *
 * Commands:
 *   list     - List archive contents
 *   schema   - Show kiwi schema info
 *   summary  - Show document structure summary
 *   raw      - Show raw message (truncated)
 *   json     - Output simplified JSON
 */

import { readFile } from "fs/promises";
import {
  readFigFile,
  listFigContents,
  parseCanvasFig,
  getSchemaInfo,
  extractDocumentTree,
  getDocumentSummary,
  simplifyNode,
  countNodesByType,
} from "./parser/index.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Fig Inspector - Inspect .fig files

Usage:
  npx tsx src/inspect-fig.ts <file.fig> [command]

Commands:
  list     - List archive contents
  schema   - Show kiwi schema info
  summary  - Show document structure summary (default)
  raw      - Show raw message (truncated)
  json     - Output simplified JSON
  stats    - Show node type statistics
`);
    process.exit(0);
  }

  const filePath = args[0]!;
  const command = args[1] ?? "summary";

  try {
    switch (command) {
      case "list": {
        const contents = await listFigContents(filePath);
        console.log("Archive contents:");
        for (const file of contents) {
          console.log(`  ${file}`);
        }
        break;
      }

      case "schema": {
        const archive = await readFigFile(filePath);
        const parsed = parseCanvasFig(archive.canvasFig);
        const schemaInfo = getSchemaInfo(parsed.schema);
        console.log(`Version: ${parsed.version}`);
        console.log(`\nSchema definitions (${schemaInfo.definitionCount}):\n`);
        for (const def of schemaInfo.definitions) {
          console.log(`${def.kind} ${def.name} {`);
          for (const field of def.fields) {
            const arrayMark = field.isArray ? "[]" : "";
            console.log(`  ${field.name}: ${field.type}${arrayMark}`);
          }
          console.log(`}\n`);
        }
        break;
      }

      case "summary": {
        const archive = await readFigFile(filePath);
        console.log(`Meta: ${JSON.stringify(archive.meta, null, 2)}`);
        console.log(`\nImages: ${archive.images.size}`);

        const parsed = parseCanvasFig(archive.canvasFig);
        console.log(`Version: ${parsed.version}`);

        const document = extractDocumentTree(parsed.message);
        if (document) {
          console.log(`\nDocument Structure:`);
          console.log(getDocumentSummary(document));
        } else {
          console.log("\nCould not extract document tree");
          console.log("Raw message keys:", Object.keys(parsed.message));
        }
        break;
      }

      case "raw": {
        const archive = await readFigFile(filePath);
        const parsed = parseCanvasFig(archive.canvasFig);
        let json = JSON.stringify(parsed.message, null, 2);
        if (json.length > 50000) {
          json = json.substring(0, 50000) + "\n\n... [truncated]";
        }
        console.log(json);
        break;
      }

      case "json": {
        const archive = await readFigFile(filePath);
        const parsed = parseCanvasFig(archive.canvasFig);
        const document = extractDocumentTree(parsed.message);
        if (document) {
          const simplified = simplifyNode(document);
          console.log(JSON.stringify(simplified, null, 2));
        } else {
          console.error("Could not extract document tree");
          process.exit(1);
        }
        break;
      }

      case "stats": {
        const archive = await readFigFile(filePath);
        const parsed = parseCanvasFig(archive.canvasFig);
        const document = extractDocumentTree(parsed.message);
        if (document) {
          const counts = countNodesByType(document);
          console.log("Node type counts:");
          const sorted = Object.entries(counts).sort(
            ([, a], [, b]) => b - a
          );
          for (const [type, count] of sorted) {
            console.log(`  ${type}: ${count}`);
          }
          console.log(`\nTotal: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
        } else {
          console.error("Could not extract document tree");
          process.exit(1);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
