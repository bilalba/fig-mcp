/**
 * Shared utility functions for SVG rendering
 */

import type { SceneNode } from "../parser/types.js";
import type { TransformMatrix, PathCommand } from "./render-types.js";

/**
 * Escape special characters for XML/SVG content.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Multiply two transform matrices.
 */
export function multiplyTransforms(parent: TransformMatrix, child: TransformMatrix): TransformMatrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

/**
 * Get the local transform matrix from a scene node.
 */
export function getLocalTransform(node: SceneNode): TransformMatrix {
  if (node.transform) {
    return {
      a: node.transform.m00,
      b: node.transform.m10,
      c: node.transform.m01,
      d: node.transform.m11,
      e: node.transform.m02,
      f: node.transform.m12,
    };
  }
  return { a: 1, b: 0, c: 0, d: 1, e: node.x ?? 0, f: node.y ?? 0 };
}

/**
 * Transform a point using a transform matrix.
 */
export function transformPoint(x: number, y: number, t: TransformMatrix): { x: number; y: number } {
  return {
    x: t.a * x + t.c * y + t.e,
    y: t.b * x + t.d * y + t.f,
  };
}

/**
 * Compute bounding box of path commands (in local coordinates, before transform).
 */
export function computeCommandBounds(
  commands: PathCommand[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const update = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const { cmd, values } of commands) {
    switch (cmd) {
      case 1: // Move
      case 2: // Line
        update(values[0] ?? 0, values[1] ?? 0);
        break;
      case 3: // Quad
      case 5:
        update(values[0] ?? 0, values[1] ?? 0);
        update(values[2] ?? 0, values[3] ?? 0);
        break;
      case 4: // Cubic
        update(values[0] ?? 0, values[1] ?? 0);
        update(values[2] ?? 0, values[3] ?? 0);
        update(values[4] ?? 0, values[5] ?? 0);
        break;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Build SVG path string from commands, applying transform.
 */
export function buildSvgPath(commands: PathCommand[], transform: TransformMatrix): string {
  const parts: string[] = [];

  for (const { cmd, values } of commands) {
    switch (cmd) {
      case 0: // Close
        parts.push("Z");
        break;
      case 1: {
        // Move
        const p = transformPoint(values[0] ?? 0, values[1] ?? 0, transform);
        parts.push(`M ${p.x} ${p.y}`);
        break;
      }
      case 2: {
        // Line
        const p = transformPoint(values[0] ?? 0, values[1] ?? 0, transform);
        parts.push(`L ${p.x} ${p.y}`);
        break;
      }
      case 3: // Quad
      case 5: {
        const p1 = transformPoint(values[0] ?? 0, values[1] ?? 0, transform);
        const p2 = transformPoint(values[2] ?? 0, values[3] ?? 0, transform);
        parts.push(`Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`);
        break;
      }
      case 4: {
        // Cubic
        const p1 = transformPoint(values[0] ?? 0, values[1] ?? 0, transform);
        const p2 = transformPoint(values[2] ?? 0, values[3] ?? 0, transform);
        const p3 = transformPoint(values[4] ?? 0, values[5] ?? 0, transform);
        parts.push(`C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`);
        break;
      }
    }
  }

  return parts.join(" ");
}
