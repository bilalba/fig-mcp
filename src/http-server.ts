/**
 * HTTP Server for serving images from .fig files
 *
 * Runs alongside the MCP server to serve images via HTTP URLs
 * instead of base64 blobs through MCP.
 */

import http from "http";
import { getOrParseFigFile, detectImageFormat, normalizeImageHash } from "./mcp/server.js";
import { config } from "./shared-config.js";

const DEFAULT_PORT = 3847;
const MAX_PORT_ATTEMPTS = 10;

export function startHttpServer(): void {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${config.httpPort}`);
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      // GET /image/:encodedFilePath/:hash
      if (parts[0] === "image" && parts.length >= 3) {
        const filePath = decodeURIComponent(parts[1]);
        const hash = parts[2].toLowerCase();

        const { images } = await getOrParseFigFile(filePath);
        const normalized = normalizeImageHash(hash);
        const data = images.get(normalized ?? hash) ?? images.get(hash);

        if (!data) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end(`Image not found: ${hash}`);
          return;
        }

        const format = detectImageFormat(data);
        const mimeType =
          format === "jpeg"
            ? "image/jpeg"
            : format === "png"
              ? "image/png"
              : format === "gif"
                ? "image/gif"
                : format === "webp"
                  ? "image/webp"
                  : "application/octet-stream";

        res.writeHead(200, {
          "Content-Type": mimeType,
          "Content-Length": data.length,
          "Cache-Control": "public, max-age=31536000", // Images are content-addressed, cache forever
        });
        res.end(Buffer.from(data));
        return;
      }

      // GET /thumbnail/:encodedFilePath
      if (parts[0] === "thumbnail" && parts.length >= 2) {
        const filePath = decodeURIComponent(parts[1]);

        const { thumbnail } = await getOrParseFigFile(filePath);

        if (!thumbnail) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Thumbnail not found");
          return;
        }

        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": thumbnail.length,
          "Cache-Control": "public, max-age=3600", // Cache thumbnails for 1 hour
        });
        res.end(Buffer.from(thumbnail));
        return;
      }

      // Not found
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (error) {
      console.error("HTTP server error:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  function tryListen(port: number, attempt: number): void {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && attempt < MAX_PORT_ATTEMPTS) {
        // Port is busy, try the next one
        const nextPort = port + 1;
        console.error(`Port ${port} in use, trying ${nextPort}...`);
        tryListen(nextPort, attempt + 1);
      } else {
        // Give up after max attempts or on other errors
        console.error(`HTTP server error: ${err.message}`);
        // Don't exit - let MCP server continue without HTTP image serving
      }
    });

    server.listen(port, () => {
      config.httpPort = port;
      console.error(`HTTP image server running on http://localhost:${port}`);
    });
  }

  tryListen(DEFAULT_PORT, 1);
}
