/**
 * Paint handling utilities for SVG rendering
 */

import type { FigNode, Paint } from "../parser/types.js";
import { colorToCSS } from "../parser/layout-inference.js";

/**
 * Get paints array from a node (handles both 'fills'/'strokes' and 'fillPaints'/'strokePaints').
 */
export function getPaints(node: FigNode, key: "fills" | "strokes"): Paint[] | undefined {
  const record = node as unknown as Record<string, unknown>;
  const paints = record[key] ?? record[key === "fills" ? "fillPaints" : "strokePaints"];
  return Array.isArray(paints) ? (paints as Paint[]) : undefined;
}

/**
 * Get the first visible paint from an array.
 */
export function getVisiblePaint(paints: Paint[] | undefined): Paint | undefined {
  if (!paints) return undefined;
  return paints.find((p) => p.visible !== false);
}

/**
 * Convert a paint to a CSS color string.
 * Returns undefined if the paint is not visible or not a solid color.
 */
export function paintToColor(paint: Paint | undefined): string | undefined {
  if (!paint || paint.visible === false || paint.type !== "SOLID" || !paint.color) {
    return undefined;
  }
  const opacity = paint.opacity ?? 1;
  const color = { ...paint.color, a: paint.color.a * opacity };
  return colorToCSS(color);
}

/**
 * Normalize an image hash from various formats to a hex string.
 * Handles: string, array of bytes, object with hash property, or object with numeric keys.
 */
export function normalizeImageHash(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.toLowerCase();

  if (Array.isArray(value) && value.length === 20) {
    const bytes = value.filter((b) => typeof b === "number") as number[];
    if (bytes.length === 20) {
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj["hash"] && typeof obj["hash"] === "object") {
      const bytes = obj["hash"] as Record<string, number>;
      return Object.keys(bytes)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => bytes[key].toString(16).padStart(2, "0"))
        .join("");
    }

    const hasByteKeys = Object.keys(obj).some((key) => /^\d+$/.test(key));
    if (hasByteKeys) {
      const bytes = obj as Record<string, number>;
      return Object.keys(bytes)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => bytes[key].toString(16).padStart(2, "0"))
        .join("");
    }
  }

  return null;
}

/**
 * Extract image hash from a paint object.
 */
export function paintToImageHash(paint: Paint | undefined): string | null {
  if (!paint) return null;
  const record = paint as unknown as Record<string, unknown>;
  return normalizeImageHash(record["image"]) ?? normalizeImageHash(record["imageHash"]);
}

/**
 * Detect image format from binary data.
 */
export function detectImageFormat(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xd8) return "jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "gif";
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return "webp";
  return "unknown";
}

/**
 * Get MIME type for image format.
 */
export function getMimeType(format: string): string {
  switch (format) {
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    default: return "application/octet-stream";
  }
}
