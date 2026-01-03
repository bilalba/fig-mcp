#!/usr/bin/env node
/**
 * Fig MCP Server - Main entry point
 *
 * An MCP server for parsing .fig files and providing
 * structured design information for implementation.
 */

import { startServer } from "./mcp/server.js";
import { startHttpServer } from "./http-server.js";

// Start HTTP server for image serving
startHttpServer();

// Start MCP server
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
