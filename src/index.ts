#!/usr/bin/env node
/**
 * Fig MCP Server - Main entry point
 *
 * An MCP server for parsing .fig files and providing
 * structured design information for implementation.
 */

import open from "open";
import { startServer } from "./mcp/server.js";
import { startHttpServer } from "./http-server.js";
import { createServer as createViewerServer } from "./web-viewer/server.js";
import { runInspect } from "./inspect-fig.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const args = process.argv.slice(2);
const command = args[0];

// Get package.json for version
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

if (command === "--version" || command === "-v") {
  console.log(pkg.version);
  process.exit(0);
}

if (command === "--help" || command === "-h" || command === "help") {
  console.log(`
fig-mcp v${pkg.version} - MCP server for parsing .fig files

Usage:
  fig-mcp                           Start MCP server (for AI assistants)
  fig-mcp viewer <file> [port]      Start web viewer for a .fig file
  fig-mcp inspect <file> [command]  Inspect a .fig file

Viewer:
  Opens a local web UI to browse and preview .fig file contents.
  Default port: 3000

Inspect commands:
  list     - List archive contents
  schema   - Show kiwi schema info
  summary  - Show document structure (default)
  raw      - Show raw message (truncated)
  json     - Output simplified JSON
  stats    - Show node type statistics

Options:
  --help, -h      Show this help
  --version, -v   Show version

Examples:
  fig-mcp viewer design.fig           # Open viewer on port 3000
  fig-mcp viewer design.fig 8080      # Open viewer on port 8080
  fig-mcp inspect design.fig summary  # Show document structure
  fig-mcp inspect design.fig stats    # Show node type counts
`);
  process.exit(0);
}

if (command === "viewer") {
  const figFile = args[1];
  const port = parseInt(args[2] || "3000", 10);

  if (!figFile) {
    console.error("Usage: fig-mcp viewer /path/to/file.fig [port]");
    process.exit(1);
  }

  const viewerServer = createViewerServer({ figFile, port });
  viewerServer.start((url) => {
    void open(url);
  });
} else if (command === "inspect") {
  await runInspect(args.slice(1));
} else if (!command) {
  // Start HTTP server for image serving
  startHttpServer();

  // Exit when stdin closes (MCP client disconnected)
  process.stdin.on("close", () => {
    process.exit(0);
  });

  // Start MCP server
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Run 'fig-mcp --help' for usage information.");
  process.exit(1);
}
