/**
 * Vector Renderer - Handles rendering of vector nodes to SVG
 *
 * This module contains all vector-related rendering logic including:
 * - Vector network decoding (blob and structured formats)
 * - Path command parsing and building
 * - Stroked and filled vector rendering
 */

import type { FigNode, SceneNode, Paint, VectorData, VectorPath } from "../parser/types.js";
import type { TransformMatrix, BlobEntry, RenderContext, PathCommand } from "./render-types.js";
import { transformPoint, multiplyTransforms, buildSvgPath, computeCommandBounds } from "./render-utils.js";
import { getPaints, getVisiblePaint, paintToColor } from "./paint-utils.js";

// ============================================================================
// Vector Network Types
// ============================================================================

interface DecodedVectorVertex {
  x: number;
  y: number;
}

interface DecodedVectorSegmentEndpoint {
  vertex: number;
  dx: number;
  dy: number;
}

interface DecodedVectorSegment {
  start: DecodedVectorSegmentEndpoint;
  end: DecodedVectorSegmentEndpoint;
}

interface DecodedVectorNetwork {
  vertices: DecodedVectorVertex[];
  segments: DecodedVectorSegment[];
}

// ============================================================================
// Vector Network Decoding
// ============================================================================

/**
 * Decode vectorNetworkBlob to extract vertices and segments.
 *
 * Format: [vertexCount(4), segmentCount(4), regionCount(4), ...vertexData, ...segmentData]
 * Each vertex is 12 bytes: styleID(uint32), x(float32), y(float32)
 * Each segment is 28 bytes: styleID(4), startVertex(4), startDx(4), startDy(4), endVertex(4), endDx(4), endDy(4)
 */
function decodeVectorNetworkBlob(
  blobIndex: number | undefined,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext
): DecodedVectorNetwork | null {
  if (blobIndex === undefined || !blobs?.[blobIndex]?.bytes) return null;

  const bytes = blobs[blobIndex].bytes;
  if (bytes.length < 12) return null;

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

    const vertexCount = view.getUint32(0, true);
    const segmentCount = view.getUint32(4, true);
    // regionCount at offset 8, not needed for centerline

    if (vertexCount > 1000 || segmentCount > 1000) return null;

    const vertices: DecodedVectorVertex[] = [];
    const segments: DecodedVectorSegment[] = [];

    const VERTEX_STRIDE = 12;
    let offset = 12;

    for (let i = 0; i < vertexCount && offset + VERTEX_STRIDE <= bytes.length; i++) {
      const x = view.getFloat32(offset + 4, true);
      const y = view.getFloat32(offset + 8, true);
      vertices.push({ x, y });
      offset += VERTEX_STRIDE;
    }

    const SEGMENT_STRIDE = 28;
    for (let i = 0; i < segmentCount && offset + SEGMENT_STRIDE <= bytes.length; i++) {
      const startVertex = view.getUint32(offset + 4, true);
      const startDx = view.getFloat32(offset + 8, true);
      const startDy = view.getFloat32(offset + 12, true);
      const endVertex = view.getUint32(offset + 16, true);
      const endDx = view.getFloat32(offset + 20, true);
      const endDy = view.getFloat32(offset + 24, true);

      if (startVertex < vertices.length && endVertex < vertices.length) {
        segments.push({
          start: {
            vertex: startVertex,
            dx: Number.isFinite(startDx) ? startDx : 0,
            dy: Number.isFinite(startDy) ? startDy : 0,
          },
          end: {
            vertex: endVertex,
            dx: Number.isFinite(endDx) ? endDx : 0,
            dy: Number.isFinite(endDy) ? endDy : 0,
          },
        });
      }
      offset += SEGMENT_STRIDE;
    }

    return { vertices, segments };
  } catch (e) {
    ctx.warnings.push(`Failed to decode vector network: ${e}`);
    return null;
  }
}

/**
 * Parse the structured vectorNetwork object from vectorData.
 * This is the preferred source for vector network data (not the blob).
 */
function parseStructuredVectorNetwork(vectorData: VectorData | undefined): DecodedVectorNetwork | null {
  if (!vectorData?.vectorNetwork) return null;

  const vn = vectorData.vectorNetwork as {
    vertices?: Array<{ x: number; y: number; styleID?: number }>;
    segments?: Array<{
      start: { vertex: number; dx?: number; dy?: number };
      end: { vertex: number; dx?: number; dy?: number };
      styleID?: number;
    }>;
  };

  if (!vn.vertices?.length || !vn.segments?.length) return null;

  const vertices: DecodedVectorVertex[] = vn.vertices.map((v) => ({ x: v.x, y: v.y }));

  const segments: DecodedVectorSegment[] = vn.segments.map((s) => ({
    start: {
      vertex: s.start.vertex,
      dx: s.start.dx ?? 0,
      dy: s.start.dy ?? 0,
    },
    end: {
      vertex: s.end.vertex,
      dx: s.end.dx ?? 0,
      dy: s.end.dy ?? 0,
    },
  }));

  return { vertices, segments };
}

// ============================================================================
// Path Command Decoding
// ============================================================================

/**
 * Decode path commands from a binary blob.
 */
export function decodePathCommands(
  blobIndex: number | undefined,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext
): PathCommand[] | null {
  if (blobIndex === undefined || !blobs?.[blobIndex]?.bytes) return null;

  const bytes = blobs[blobIndex].bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const cmdArgCounts: Record<number, number> = { 0: 0, 1: 2, 2: 2, 3: 4, 4: 6, 5: 4 };

  const commands: PathCommand[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const cmd = bytes[offset++];
    const argCount = cmdArgCounts[cmd];
    if (argCount === undefined) break;

    const values: number[] = [];
    for (let i = 0; i < argCount && offset + 4 <= bytes.length; i++) {
      values.push(view.getFloat32(offset, true));
      offset += 4;
    }
    commands.push({ cmd, values });
  }

  return commands.length > 0 ? commands : null;
}

/**
 * Decode path commands from an array format (alternative to blob).
 */
export function decodePathCommandsFromArray(commands: unknown[] | undefined): PathCommand[] | null {
  if (!commands?.length) return null;

  const cmdMap: Record<string, number> = { M: 1, L: 2, Q: 3, C: 4, Z: 0 };
  const argCounts: Record<number, number> = { 0: 0, 1: 2, 2: 2, 3: 4, 4: 6 };

  const result: PathCommand[] = [];
  let currentCmd: number | null = null;
  let buffer: number[] = [];

  for (const entry of commands) {
    if (typeof entry === "string") {
      const cmd = cmdMap[entry.toUpperCase()];
      if (cmd === undefined) continue;
      if (cmd === 0) {
        result.push({ cmd, values: [] });
        continue;
      }
      currentCmd = cmd;
      buffer = [];
    } else if (typeof entry === "number" && currentCmd !== null) {
      buffer.push(entry);
      const expected = argCounts[currentCmd] ?? 0;
      if (buffer.length === expected) {
        result.push({ cmd: currentCmd, values: buffer });
        buffer = [];
      }
    }
  }

  return result.length > 0 ? result : null;
}

// ============================================================================
// Centerline Generation
// ============================================================================

/**
 * Create simple centerline path for a stroked vector from normalizedSize.
 * This is a straight line from (0,0) to (width, height).
 */
function createCenterlineFromNormalizedSize(normalizedSize: { x: number; y: number }): PathCommand[] {
  return [
    { cmd: 1, values: [0, 0] },
    { cmd: 2, values: [normalizedSize.x, normalizedSize.y] },
  ];
}

/**
 * Create centerline from decoded vector network.
 * Handles bezier curves using dx/dy control points.
 */
function createCenterlineFromNetwork(
  network: DecodedVectorNetwork,
  normalizedSize?: { x: number; y: number }
): PathCommand[] | null {
  if (network.vertices.length === 0) return null;

  // Filter out degenerate segments (where start vertex == end vertex)
  const validSegments = network.segments.filter(
    (seg) => seg.start.vertex !== seg.end.vertex
  );
  if (validSegments.length === 0) return null;

  // Validate vertex coordinates against normalizedSize (with tolerance for stroke width)
  if (normalizedSize) {
    const tolerance = 2;
    for (const v of network.vertices) {
      if (
        v.x < -tolerance ||
        v.y < -tolerance ||
        v.x > normalizedSize.x + tolerance ||
        v.y > normalizedSize.y + tolerance
      ) {
        return null;
      }
    }
  }

  const commands: PathCommand[] = [];
  const usedSegments = new Set<number>();

  let currentVertex = validSegments[0].start.vertex;

  // Move to the starting vertex
  const startV = network.vertices[currentVertex];
  if (!startV) return null;
  commands.push({ cmd: 1, values: [startV.x, startV.y] });

  // Walk through segments to build the path
  while (usedSegments.size < validSegments.length) {
    let foundSegment: DecodedVectorSegment | null = null;
    let foundIdx = -1;

    for (let i = 0; i < validSegments.length; i++) {
      if (usedSegments.has(i)) continue;
      const seg = validSegments[i];
      if (seg.start.vertex === currentVertex) {
        foundSegment = seg;
        foundIdx = i;
        break;
      }
    }

    if (!foundSegment) {
      // No connected segment found, try to find any unused segment to continue
      for (let i = 0; i < validSegments.length; i++) {
        if (!usedSegments.has(i)) {
          foundSegment = validSegments[i];
          foundIdx = i;
          const v = network.vertices[foundSegment.start.vertex];
          if (v) {
            commands.push({ cmd: 1, values: [v.x, v.y] });
          }
          break;
        }
      }
    }

    if (!foundSegment || foundIdx === -1) break;

    usedSegments.add(foundIdx);

    const v0 = network.vertices[foundSegment.start.vertex];
    const v1 = network.vertices[foundSegment.end.vertex];
    if (!v0 || !v1) continue;

    const hasCurve =
      Math.abs(foundSegment.start.dx) > 0.001 ||
      Math.abs(foundSegment.start.dy) > 0.001 ||
      Math.abs(foundSegment.end.dx) > 0.001 ||
      Math.abs(foundSegment.end.dy) > 0.001;

    if (hasCurve) {
      const cp1x = v0.x + foundSegment.start.dx;
      const cp1y = v0.y + foundSegment.start.dy;
      const cp2x = v1.x + foundSegment.end.dx;
      const cp2y = v1.y + foundSegment.end.dy;
      commands.push({ cmd: 4, values: [cp1x, cp1y, cp2x, cp2y, v1.x, v1.y] });
    } else {
      commands.push({ cmd: 2, values: [v1.x, v1.y] });
    }

    currentVertex = foundSegment.end.vertex;
  }

  // Close the path if it ends where it started
  if (commands.length > 1) {
    const firstCmd = commands[0];
    const lastCmd = commands[commands.length - 1];
    if (firstCmd && lastCmd) {
      const startX = firstCmd.values[0];
      const startY = firstCmd.values[1];
      const lastVals = lastCmd.values;
      const endX = lastVals[lastVals.length - 2];
      const endY = lastVals[lastVals.length - 1];
      if (
        Math.abs((startX ?? 0) - (endX ?? 0)) < 0.01 &&
        Math.abs((startY ?? 0) - (endY ?? 0)) < 0.01
      ) {
        commands.push({ cmd: 0, values: [] });
      }
    }
  }

  return commands.length > 0 ? commands : null;
}

// ============================================================================
// Vector Type Detection
// ============================================================================

/**
 * Check if a vector node is stroked (has stroke paint, no fill paint).
 */
export function isStrokedVector(node: SceneNode): boolean {
  const fills = getPaints(node as FigNode, "fills");
  const strokes = getPaints(node as FigNode, "strokes");

  const hasVisibleFill = fills?.some((p) => p.visible !== false && p.type === "SOLID");
  const hasVisibleStroke = strokes?.some((p) => p.visible !== false && p.type === "SOLID");

  return !hasVisibleFill && hasVisibleStroke === true;
}

// ============================================================================
// Stroked Vector Rendering
// ============================================================================

/**
 * Render a stroked vector using its centerline.
 */
export function renderStrokedVector(
  node: SceneNode,
  transform: TransformMatrix,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext,
  output: string[]
): boolean {
  const strokes = getPaints(node as FigNode, "strokes");
  const strokeColor = paintToColor(getVisiblePaint(strokes));
  if (!strokeColor) return false;

  const vectorData = node.vectorData;
  const normalizedSize = vectorData?.normalizedSize;

  // Get centerline commands using priority-based approach
  let centerline: PathCommand[] | null = null;

  // PRIORITY 1: Use structured vectorNetwork data (most reliable)
  const structuredNetwork = parseStructuredVectorNetwork(vectorData);
  if (structuredNetwork && structuredNetwork.vertices.length >= 2) {
    centerline = createCenterlineFromNetwork(structuredNetwork, normalizedSize);
  }

  // PRIORITY 2: Try blob-encoded vector network
  if (!centerline && vectorData?.vectorNetworkBlob !== undefined) {
    const blobNetwork = decodeVectorNetworkBlob(vectorData.vectorNetworkBlob, blobs, ctx);
    if (blobNetwork && blobNetwork.vertices.length >= 2) {
      centerline = createCenterlineFromNetwork(blobNetwork, normalizedSize);
    }
  }

  // PRIORITY 3: Fallback to simple line from normalizedSize
  if (!centerline && normalizedSize && (normalizedSize.x > 0 || normalizedSize.y > 0)) {
    centerline = createCenterlineFromNormalizedSize(normalizedSize);
  }

  if (!centerline || centerline.length === 0) return false;

  // Get target size from node
  const targetWidth = node.size?.x ?? node.width ?? normalizedSize?.x ?? 1;
  const targetHeight = node.size?.y ?? node.height ?? normalizedSize?.y ?? 1;

  // Compute actual bounds and calculate scale
  const commandBounds = computeCommandBounds(centerline);

  const baseScaleX = normalizedSize?.x ? targetWidth / normalizedSize.x : 1;
  const baseScaleY = normalizedSize?.y ? targetHeight / normalizedSize.y : 1;

  const cmdWidth = commandBounds ? commandBounds.maxX - commandBounds.minX : 0;
  const cmdHeight = commandBounds ? commandBounds.maxY - commandBounds.minY : 0;

  const scaleX = cmdWidth > 0.001 ? targetWidth / cmdWidth : baseScaleX;
  const scaleY = cmdHeight > 0.001 ? targetHeight / cmdHeight : baseScaleY;

  const offsetX = commandBounds ? -commandBounds.minX : 0;
  const offsetY = commandBounds ? -commandBounds.minY : 0;

  // Build transform: offset -> scale -> parent transform
  const localTransform: TransformMatrix = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: offsetX * scaleX,
    f: offsetY * scaleY,
  };
  const finalTransform = multiplyTransforms(transform, localTransform);

  const pathD = buildSvgPath(centerline, finalTransform);
  if (!pathD) return false;

  // Build stroke attributes
  const strokeWeight = node.strokeWeight ?? 1;
  const attrs: string[] = [
    `d="${pathD}"`,
    `fill="none"`,
    `stroke="${strokeColor}"`,
    `stroke-width="${strokeWeight}"`,
  ];

  if (node.strokeCap) attrs.push(`stroke-linecap="${node.strokeCap.toLowerCase()}"`);
  if (node.strokeJoin) attrs.push(`stroke-linejoin="${node.strokeJoin.toLowerCase()}"`);
  if (node.strokeDashes?.length) attrs.push(`stroke-dasharray="${node.strokeDashes.join(" ")}"`);
  if (node.opacity !== undefined && node.opacity < 1) attrs.push(`opacity="${node.opacity}"`);

  output.push(`<path ${attrs.join(" ")} />`);
  return true;
}

// ============================================================================
// Filled Vector Rendering
// ============================================================================

/**
 * Render a filled vector using its fillGeometry.
 */
export function renderFilledVector(
  node: SceneNode,
  transform: TransformMatrix,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext,
  output: string[]
): boolean {
  const fills = getPaints(node as FigNode, "fills");
  const fillColor = paintToColor(getVisiblePaint(fills));
  if (!fillColor) return false;

  const fillGeometry = node.fillGeometry;
  if (!fillGeometry?.length) return false;

  const vectorData = node.vectorData;
  const normalizedSize = vectorData?.normalizedSize;

  const targetWidth = node.size?.x ?? node.width ?? normalizedSize?.x ?? 1;
  const targetHeight = node.size?.y ?? node.height ?? normalizedSize?.y ?? 1;

  const baseScaleX = normalizedSize?.x ? targetWidth / normalizedSize.x : 1;
  const baseScaleY = normalizedSize?.y ? targetHeight / normalizedSize.y : 1;

  for (const path of fillGeometry) {
    let commands: PathCommand[] | null = null;

    if (typeof path.commandsBlob === "number") {
      commands = decodePathCommands(path.commandsBlob, blobs, ctx);
    } else if (path.commands) {
      commands = decodePathCommandsFromArray(path.commands);
    }

    if (!commands) continue;

    const commandBounds = computeCommandBounds(commands);

    const cmdWidth = commandBounds ? commandBounds.maxX - commandBounds.minX : 0;
    const cmdHeight = commandBounds ? commandBounds.maxY - commandBounds.minY : 0;

    const scaleX = cmdWidth > 0.001 ? targetWidth / cmdWidth : baseScaleX;
    const scaleY = cmdHeight > 0.001 ? targetHeight / cmdHeight : baseScaleY;

    const offsetX = commandBounds ? -commandBounds.minX : 0;
    const offsetY = commandBounds ? -commandBounds.minY : 0;

    const localTransform: TransformMatrix = {
      a: scaleX,
      b: 0,
      c: 0,
      d: scaleY,
      e: offsetX * scaleX,
      f: offsetY * scaleY,
    };
    const finalTransform = multiplyTransforms(transform, localTransform);

    const pathD = buildSvgPath(commands, finalTransform);
    if (!pathD) continue;

    const windingRule = path.windingRule?.toLowerCase() === "evenodd" ? "evenodd" : "nonzero";

    const attrs: string[] = [
      `d="${pathD}"`,
      `fill="${fillColor}"`,
      `fill-rule="${windingRule}"`,
    ];

    if (node.opacity !== undefined && node.opacity < 1) attrs.push(`opacity="${node.opacity}"`);

    output.push(`<path ${attrs.join(" ")} />`);
  }

  return true;
}
