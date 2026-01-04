/**
 * Vector Export - Export vector nodes as SVG, PDF, PNG, or WebP
 *
 * This module provides functions to export vector nodes in various formats.
 */

import { Resvg } from "@resvg/resvg-js";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import type { FigNode, SceneNode, VectorData, VectorPath } from "./parser/types.js";
import type { TransformMatrix, BlobEntry, PathCommand } from "./renderer/render-types.js";
import {
  buildSvgPath,
  computeCommandBounds,
  getPaints,
  getVisiblePaint,
  paintToColor,
  renderScreen,
} from "./renderer/index.js";

// ============================================================================
// Types
// ============================================================================

export interface SvgResult {
  svgString: string;
  width: number;
  height: number;
  viewBox: string;
  pathD: string; // Raw path data for further processing
}

export interface VectorExportOptions {
  includeStyles?: boolean;
}

// ============================================================================
// Vector Network Types & Decoding
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

/**
 * Decode vectorNetworkBlob to extract vertices and segments.
 */
function decodeVectorNetworkBlob(
  blobIndex: number | undefined,
  blobs: BlobEntry[] | undefined
): DecodedVectorNetwork | null {
  if (blobIndex === undefined || !blobs?.[blobIndex]?.bytes) return null;

  const bytes = blobs[blobIndex].bytes;
  if (bytes.length < 12) return null;

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

    const vertexCount = view.getUint32(0, true);
    const segmentCount = view.getUint32(4, true);

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
  } catch {
    return null;
  }
}

/**
 * Parse structured vectorNetwork object from vectorData.
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
function decodePathCommands(
  blobIndex: number | undefined,
  blobs: BlobEntry[] | undefined
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
 * Decode path commands from an array format.
 */
function decodePathCommandsFromArray(commands: unknown[] | undefined): PathCommand[] | null {
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
// Centerline Generation from Vector Network
// ============================================================================

function createCenterlineFromNetwork(
  network: DecodedVectorNetwork,
  normalizedSize?: { x: number; y: number }
): PathCommand[] | null {
  if (network.vertices.length === 0) return null;

  const validSegments = network.segments.filter(
    (seg) => seg.start.vertex !== seg.end.vertex
  );
  if (validSegments.length === 0) return null;

  // Validate vertex coordinates
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
  const startV = network.vertices[currentVertex];
  if (!startV) return null;
  commands.push({ cmd: 1, values: [startV.x, startV.y] });

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

  // Close path if ends where it started
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

const VECTOR_NODE_TYPES = ["VECTOR", "LINE", "REGULAR_POLYGON", "STAR", "ELLIPSE", "BOOLEAN_OPERATION"];
const CONTAINER_NODE_TYPES = ["FRAME", "GROUP", "COMPONENT", "INSTANCE"];

/**
 * Check if a single node (not its children) is a vector.
 */
function isSingleVectorNode(node: FigNode): boolean {
  const sceneNode = node as SceneNode;
  return (
    VECTOR_NODE_TYPES.includes(sceneNode.type) ||
    (sceneNode.fillGeometry?.length ?? 0) > 0 ||
    (sceneNode.strokeGeometry?.length ?? 0) > 0 ||
    sceneNode.vectorData?.vectorNetwork != null ||
    sceneNode.vectorData?.vectorNetworkBlob != null
  );
}

/**
 * Check if a node has any vector children (recursive).
 */
function hasVectorChildren(node: FigNode): boolean {
  if (!node.children?.length) return false;

  for (const child of node.children) {
    if (isSingleVectorNode(child)) return true;
    if (hasVectorChildren(child)) return true;
  }
  return false;
}

/**
 * Check if a node can be exported as a vector.
 * Returns true for direct vector nodes OR container nodes with vector children.
 */
export function isVectorNode(node: FigNode): boolean {
  // Check if it's a direct vector node
  if (isSingleVectorNode(node)) return true;

  // Check if it's a container with vector children
  const sceneNode = node as SceneNode;
  if (CONTAINER_NODE_TYPES.includes(sceneNode.type)) {
    return hasVectorChildren(node);
  }

  return false;
}

/**
 * Check if a vector node has stroke (no fill).
 */
function isStrokedVector(node: SceneNode): boolean {
  const fills = getPaints(node as FigNode, "fills");
  const strokes = getPaints(node as FigNode, "strokes");

  const hasVisibleFill = fills?.some((p) => p.visible !== false && p.type === "SOLID");
  const hasVisibleStroke = strokes?.some((p) => p.visible !== false && p.type === "SOLID");

  return !hasVisibleFill && hasVisibleStroke === true;
}

// ============================================================================
// SVG Export
// ============================================================================

/**
 * Collect vector children recursively, with their accumulated positions.
 * Uses the same positioning approach as render-screen.ts - positions accumulate through the tree.
 */
interface ChildVectorInfo {
  node: FigNode;
  offsetX: number;
  offsetY: number;
}

function collectVectorChildren(
  node: FigNode,
  offsetX: number,
  offsetY: number
): ChildVectorInfo[] {
  const results: ChildVectorInfo[] = [];
  const sceneNode = node as SceneNode;

  // Get this node's local position and add to accumulated offset
  const localX = sceneNode.x ?? 0;
  const localY = sceneNode.y ?? 0;
  const nodeOffsetX = offsetX + localX;
  const nodeOffsetY = offsetY + localY;

  // If this node is a vector, add it with accumulated offset
  if (isSingleVectorNode(node)) {
    results.push({ node, offsetX: nodeOffsetX, offsetY: nodeOffsetY });
  }

  // Recurse into children, passing accumulated offset
  if (node.children?.length) {
    for (const child of node.children) {
      results.push(...collectVectorChildren(child, nodeOffsetX, nodeOffsetY));
    }
  }

  return results;
}

/**
 * Calculate bounding box of collected vectors including their rendered paths.
 */
interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function calculateVectorBounds(vectors: ChildVectorInfo[]): BoundingBox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const { node, offsetX, offsetY } of vectors) {
    const sceneNode = node as SceneNode;
    const width = sceneNode.size?.x ?? sceneNode.width ?? 0;
    const height = sceneNode.size?.y ?? sceneNode.height ?? 0;

    minX = Math.min(minX, offsetX);
    minY = Math.min(minY, offsetY);
    maxX = Math.max(maxX, offsetX + width);
    maxY = Math.max(maxY, offsetY + height);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Generate SVG path element for a single vector node.
 */
function generatePathElement(
  node: FigNode,
  blobs: BlobEntry[] | undefined,
  offsetX: number,
  offsetY: number,
  includeStyles: boolean
): string | null {
  const sceneNode = node as SceneNode;

  // Get node dimensions
  const width = sceneNode.size?.x ?? sceneNode.width ?? 100;
  const height = sceneNode.size?.y ?? sceneNode.height ?? 100;

  const vectorData = sceneNode.vectorData;
  const normalizedSize = vectorData?.normalizedSize;

  // Calculate scales
  const baseScaleX = normalizedSize?.x ? width / normalizedSize.x : 1;
  const baseScaleY = normalizedSize?.y ? height / normalizedSize.y : 1;

  // Try stroked vector first if applicable
  if (isStrokedVector(sceneNode)) {
    let centerline: PathCommand[] | null = null;

    const structuredNetwork = parseStructuredVectorNetwork(vectorData);
    if (structuredNetwork && structuredNetwork.vertices.length >= 2) {
      centerline = createCenterlineFromNetwork(structuredNetwork, normalizedSize);
    }

    if (!centerline && vectorData?.vectorNetworkBlob !== undefined) {
      const blobNetwork = decodeVectorNetworkBlob(vectorData.vectorNetworkBlob, blobs);
      if (blobNetwork && blobNetwork.vertices.length >= 2) {
        centerline = createCenterlineFromNetwork(blobNetwork, normalizedSize);
      }
    }

    if (!centerline && normalizedSize && (normalizedSize.x > 0 || normalizedSize.y > 0)) {
      centerline = [
        { cmd: 1, values: [0, 0] },
        { cmd: 2, values: [normalizedSize.x, normalizedSize.y] },
      ];
    }

    if (centerline && centerline.length > 0) {
      const commandBounds = computeCommandBounds(centerline);
      const cmdWidth = commandBounds ? commandBounds.maxX - commandBounds.minX : 0;
      const cmdHeight = commandBounds ? commandBounds.maxY - commandBounds.minY : 0;

      const scaleX = cmdWidth > 0.001 ? width / cmdWidth : baseScaleX;
      const scaleY = cmdHeight > 0.001 ? height / cmdHeight : baseScaleY;

      const cmdOffsetX = commandBounds ? -commandBounds.minX : 0;
      const cmdOffsetY = commandBounds ? -commandBounds.minY : 0;

      const transform: TransformMatrix = {
        a: scaleX,
        b: 0,
        c: 0,
        d: scaleY,
        e: cmdOffsetX * scaleX + offsetX,
        f: cmdOffsetY * scaleY + offsetY,
      };

      const pathD = buildSvgPath(centerline, transform);
      if (pathD) {
        const attrs: string[] = [`d="${pathD}"`];

        if (includeStyles) {
          const strokes = getPaints(node, "strokes");
          const strokeColor = paintToColor(getVisiblePaint(strokes)) ?? "currentColor";
          const strokeWeight = sceneNode.strokeWeight ?? 1;

          attrs.push(`fill="none"`);
          attrs.push(`stroke="${strokeColor}"`);
          attrs.push(`stroke-width="${strokeWeight}"`);

          if (sceneNode.strokeCap) attrs.push(`stroke-linecap="${sceneNode.strokeCap.toLowerCase()}"`);
          if (sceneNode.strokeJoin) attrs.push(`stroke-linejoin="${sceneNode.strokeJoin.toLowerCase()}"`);
          if (sceneNode.strokeDashes?.length) attrs.push(`stroke-dasharray="${sceneNode.strokeDashes.join(" ")}"`);
          if (sceneNode.opacity !== undefined && sceneNode.opacity < 1) attrs.push(`opacity="${sceneNode.opacity}"`);
        } else {
          attrs.push(`fill="none"`);
          attrs.push(`stroke="currentColor"`);
        }

        return `<path ${attrs.join(" ")} />`;
      }
    }
  }

  // Try filled geometry
  if (sceneNode.fillGeometry?.length) {
    for (const path of sceneNode.fillGeometry) {
      let commands: PathCommand[] | null = null;

      if (typeof path.commandsBlob === "number") {
        commands = decodePathCommands(path.commandsBlob, blobs);
      } else if (path.commands) {
        commands = decodePathCommandsFromArray(path.commands);
      }

      if (!commands) continue;

      const commandBounds = computeCommandBounds(commands);
      const cmdWidth = commandBounds ? commandBounds.maxX - commandBounds.minX : 0;
      const cmdHeight = commandBounds ? commandBounds.maxY - commandBounds.minY : 0;

      const scaleX = cmdWidth > 0.001 ? width / cmdWidth : baseScaleX;
      const scaleY = cmdHeight > 0.001 ? height / cmdHeight : baseScaleY;

      const cmdOffsetX = commandBounds ? -commandBounds.minX : 0;
      const cmdOffsetY = commandBounds ? -commandBounds.minY : 0;

      const transform: TransformMatrix = {
        a: scaleX,
        b: 0,
        c: 0,
        d: scaleY,
        e: cmdOffsetX * scaleX + offsetX,
        f: cmdOffsetY * scaleY + offsetY,
      };

      const pathD = buildSvgPath(commands, transform);
      if (!pathD) continue;

      const windingRule = path.windingRule?.toLowerCase() === "evenodd" ? "evenodd" : "nonzero";
      const attrs: string[] = [`d="${pathD}"`];

      if (includeStyles) {
        const fills = getPaints(node, "fills");
        const fillColor = paintToColor(getVisiblePaint(fills)) ?? "currentColor";
        attrs.push(`fill="${fillColor}"`);
        attrs.push(`fill-rule="${windingRule}"`);
        if (sceneNode.opacity !== undefined && sceneNode.opacity < 1) attrs.push(`opacity="${sceneNode.opacity}"`);
      } else {
        attrs.push(`fill="currentColor"`);
        attrs.push(`fill-rule="${windingRule}"`);
      }

      return `<path ${attrs.join(" ")} />`;
    }
  }

  // Fallback: try strokeGeometry as filled paths
  if (sceneNode.strokeGeometry?.length) {
    for (const path of sceneNode.strokeGeometry) {
      let commands: PathCommand[] | null = null;

      if (typeof path.commandsBlob === "number") {
        commands = decodePathCommands(path.commandsBlob, blobs);
      } else if (path.commands) {
        commands = decodePathCommandsFromArray(path.commands);
      }

      if (!commands) continue;

      const commandBounds = computeCommandBounds(commands);
      const cmdWidth = commandBounds ? commandBounds.maxX - commandBounds.minX : 0;
      const cmdHeight = commandBounds ? commandBounds.maxY - commandBounds.minY : 0;

      const scaleX = cmdWidth > 0.001 ? width / cmdWidth : baseScaleX;
      const scaleY = cmdHeight > 0.001 ? height / cmdHeight : baseScaleY;

      const cmdOffsetX = commandBounds ? -commandBounds.minX : 0;
      const cmdOffsetY = commandBounds ? -commandBounds.minY : 0;

      const transform: TransformMatrix = {
        a: scaleX,
        b: 0,
        c: 0,
        d: scaleY,
        e: cmdOffsetX * scaleX + offsetX,
        f: cmdOffsetY * scaleY + offsetY,
      };

      const pathD = buildSvgPath(commands, transform);
      if (!pathD) continue;

      const windingRule = path.windingRule?.toLowerCase() === "evenodd" ? "evenodd" : "nonzero";
      const attrs: string[] = [`d="${pathD}"`, `fill="currentColor"`, `fill-rule="${windingRule}"`];

      return `<path ${attrs.join(" ")} />`;
    }
  }

  return null;
}

/**
 * Convert a node to SVG.
 * Uses renderScreen for proper transform handling.
 */
export function nodeToSvg(
  node: FigNode,
  blobs: BlobEntry[] | undefined,
  options: VectorExportOptions = {}
): SvgResult {
  const { includeStyles = true } = options;

  // Use renderScreen which handles transforms correctly
  const result = renderScreen(node, undefined, blobs, {
    includeFills: includeStyles,
    includeStrokes: includeStyles,
    includeText: false,
    background: "", // No background for vector export
  });

  // Extract path d from the SVG for the pathD field
  let rawPathD = "";
  const pathMatch = result.svg.match(/d="([^"]+)"/);
  if (pathMatch) {
    rawPathD = pathMatch[1];
  }

  const viewBox = `0 0 ${result.width} ${result.height}`;

  // Clean up the SVG - remove XML declaration if present
  let svgString = result.svg.replace('<?xml version="1.0" encoding="UTF-8"?>', '').trim();

  return {
    svgString,
    width: result.width,
    height: result.height,
    viewBox,
    pathD: rawPathD,
  };
}

// ============================================================================
// PDF Export
// ============================================================================

/**
 * Convert SVG to vector PDF.
 */
export async function svgToPdf(
  svg: string,
  width: number,
  height: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [width, height],
      margin: 0,
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      SVGtoPDF(doc, svg, 0, 0, { width, height });
    } catch (err) {
      reject(err);
      return;
    }

    doc.end();
  });
}

// ============================================================================
// Raster Export (PNG/WebP)
// ============================================================================

/**
 * Convert SVG to PNG or WebP.
 */
export async function svgToRaster(
  svg: string,
  format: "png" | "webp",
  width: number,
  height: number
): Promise<Buffer> {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: width,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = Buffer.from(pngData.asPng());

  if (format === "webp") {
    // resvg outputs PNG; for WebP we need sharp
    // WebP support is optional - will throw if sharp not installed
    throw new Error(
      "WebP format requires 'sharp' package which is not installed. " +
      "Install with: npm install sharp. Or use 'png' format instead."
    );
  }

  return pngBuffer;
}

// ============================================================================
// Combined Export Function
// ============================================================================

export type VectorFormat = "svg" | "pdf" | "png" | "webp";

export interface VectorExportResult {
  format: VectorFormat;
  width: number;
  height: number;
  data: string | Buffer;
  mimeType: string;
}

/**
 * Export a vector node to the specified format.
 */
export async function exportVector(
  node: FigNode,
  blobs: BlobEntry[] | undefined,
  format: VectorFormat,
  options: {
    width?: number;
    height?: number;
    includeStyles?: boolean;
  } = {}
): Promise<VectorExportResult> {
  const svgResult = nodeToSvg(node, blobs, { includeStyles: options.includeStyles });

  const outputWidth = options.width ?? svgResult.width;
  const outputHeight = options.height ?? svgResult.height;

  // If output size differs from SVG size, update viewBox
  let svg = svgResult.svgString;
  if (outputWidth !== svgResult.width || outputHeight !== svgResult.height) {
    svg = svg.replace(
      /width="[^"]*" height="[^"]*"/,
      `width="${outputWidth}" height="${outputHeight}"`
    );
  }

  switch (format) {
    case "svg":
      return {
        format: "svg",
        width: outputWidth,
        height: outputHeight,
        data: svg,
        mimeType: "image/svg+xml",
      };

    case "pdf": {
      const pdfBuffer = await svgToPdf(svg, outputWidth, outputHeight);
      return {
        format: "pdf",
        width: outputWidth,
        height: outputHeight,
        data: pdfBuffer,
        mimeType: "application/pdf",
      };
    }

    case "png": {
      const pngBuffer = await svgToRaster(svg, "png", outputWidth, outputHeight);
      return {
        format: "png",
        width: outputWidth,
        height: outputHeight,
        data: pngBuffer,
        mimeType: "image/png",
      };
    }

    case "webp": {
      const webpBuffer = await svgToRaster(svg, "webp", outputWidth, outputHeight);
      return {
        format: "webp",
        width: outputWidth,
        height: outputHeight,
        data: webpBuffer,
        mimeType: "image/webp",
      };
    }
  }
}
