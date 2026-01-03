#!/usr/bin/env tsx
import { existsSync } from "fs";
import { createServer } from "./mcp/server.js";

type ToolCallResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

type ParsedToolResponse = {
  raw: string;
  json: unknown;
  isError: boolean;
};

function parseToolResponse(result: ToolCallResult): ParsedToolResponse {
  const raw = result.content?.[0]?.text ?? "";
  let json: unknown = raw;
  try {
    json = raw ? JSON.parse(raw) : raw;
  } catch {
    // Keep raw text for error messages.
  }
  return { raw, json, isError: Boolean(result.isError) };
}

async function callTool(
  handler: (request: { method: string; params: Record<string, unknown> }) => Promise<ToolCallResult>,
  name: string,
  args: Record<string, unknown>
): Promise<ParsedToolResponse> {
  const result = await handler({
    method: "tools/call",
    params: { name, arguments: args },
  });
  return parseToolResponse(result);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const files = [
    "/Users/billy/Downloads/Duolingo Onboarding Screen Mascot Animation (Community).fig",
    "/Users/billy/Downloads/AutoDevice (Copy).fig",
  ];

  const existingFiles = files.filter((file) => existsSync(file));
  if (existingFiles.length === 0) {
    console.log("No test .fig files found. Skipping image tool checks.");
    return;
  }

  const server = createServer();
  const handler = (server as unknown as { _requestHandlers: Map<string, unknown> })
    ._requestHandlers.get("tools/call") as
    | ((request: { method: string; params: Record<string, unknown> }) => Promise<ToolCallResult>)
    | undefined;

  assert(handler, "tools/call handler not found");

  for (const filePath of existingFiles) {
    const list = await callTool(handler, "list_images", { filePath });
    assert(!list.isError, `list_images failed: ${list.raw}`);
    const listJson = list.json as {
      count: number;
      images: Array<{ hash: string }>;
      unresolvedReferences?: unknown[];
    };

    assert(typeof listJson.count === "number", "list_images missing count");
    assert(Array.isArray(listJson.images), "list_images missing images");
    assert(
      listJson.images.length === listJson.count,
      "list_images count does not match images length"
    );
    assert(
      Array.isArray(listJson.unresolvedReferences ?? []),
      "list_images unresolvedReferences should be an array"
    );

    if (listJson.images.length > 0) {
      const imageHash = listJson.images[0]?.hash;
      assert(typeof imageHash === "string", "list_images returned invalid hash");

      const image = await callTool(handler, "get_image", { filePath, imageHash });
      assert(!image.isError, `get_image failed: ${image.raw}`);
      const imageJson = image.json as { url?: string; size?: number };
      assert(typeof imageJson.url === "string", "get_image missing url");
      assert(
        typeof imageJson.size === "number" && imageJson.size > 0,
        "get_image missing size"
      );
    }

    const thumbnail = await callTool(handler, "get_thumbnail", { filePath });
    if (!thumbnail.isError) {
      const thumbJson = thumbnail.json as { url?: string; size?: number };
      assert(typeof thumbJson.url === "string", "get_thumbnail missing url");
      assert(
        typeof thumbJson.size === "number" && thumbJson.size > 0,
        "get_thumbnail missing size"
      );
    } else if (!thumbnail.raw.includes("No thumbnail.png")) {
      throw new Error(`get_thumbnail failed: ${thumbnail.raw}`);
    }

    console.log(`✅ Image tools ok: ${filePath}`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
