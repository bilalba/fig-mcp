/**
 * Render Screen - Improved vector rendering
 *
 * Key improvements:
 * 1. For stroked vectors: Use vectorNetworkBlob or normalizedSize to get centerline, NOT strokeGeometry
 * 2. strokeGeometry contains pre-outlined stroke - only use as fallback
 * 3. Proper transform composition for rotated/positioned vectors
 * 4. Better detection of stroked vs filled vectors
 * 5. Mask rendering support (isMask flag handling)
 * 6. Image embedding support
 * 7. Full text styling (font-style, letter-spacing, etc.)
 */

import type {
  FigNode,
  SceneNode,
  TextStyle,
  Paint,
  DerivedTextData,
} from "../parser/types.js";
import type {
  TransformMatrix,
  BlobEntry,
  RenderContext,
  RenderScreenOptions,
  RenderScreenResult,
} from "./render-types.js";
import { DEFAULT_RENDER_OPTIONS, IDENTITY_TRANSFORM } from "./render-types.js";
import {
  escapeXml,
  multiplyTransforms,
  getLocalTransform,
  transformPoint,
} from "./render-utils.js";
import {
  getPaints,
  getVisiblePaint,
  paintToColor,
  paintToImageHash,
  detectImageFormat,
  getMimeType,
} from "./paint-utils.js";
import {
  isStrokedVector,
  renderStrokedVector,
  renderFilledVector,
} from "./vector-renderer.js";

// Re-export types for external consumers
export type {
  RenderScreenOptions,
  RenderScreenResult,
} from "./render-types.js";

// ============================================================================
// Text Rendering
// ============================================================================

function renderText(
  node: SceneNode,
  transform: TransformMatrix,
  output: string[],
): boolean {
  const text = node.characters;
  if (!text) return false;

  const fills = getPaints(node as FigNode, "fills");
  const fillColor = paintToColor(getVisiblePaint(fills)) ?? "#000";

  const style = node.style as TextStyle | undefined;
  const fontSize = style?.fontSize ?? 14;
  const fontFamily = escapeXml(style?.fontFamily ?? "Inter");
  const fontWeight = style?.fontWeight ?? 400;
  const fontStyle = style?.fontStyle ?? "normal";
  const defaultLineHeight = style?.lineHeightPx ?? fontSize * 1.2;
  const letterSpacing = style?.letterSpacing ?? 0;

  const pos = transformPoint(0, 0, transform);

  // Handle text alignment
  const anchor = style?.textAlignHorizontal?.toLowerCase() ?? "left";
  const textAnchor =
    anchor === "center" ? "middle" : anchor === "right" ? "end" : "start";
  const width = node.width ?? 0;
  const baseX =
    textAnchor === "middle"
      ? pos.x + width / 2
      : textAnchor === "end"
        ? pos.x + width
        : pos.x;

  const attrs: string[] = [
    `x="${baseX}"`,
    `y="${pos.y}"`,
    `font-family="${fontFamily}"`,
    `font-size="${fontSize}"`,
    `font-weight="${fontWeight}"`,
    `font-style="${fontStyle}"`,
    `fill="${fillColor}"`,
    `dominant-baseline="text-before-edge"`,
    `text-anchor="${textAnchor}"`,
  ];

  if (letterSpacing !== 0) {
    attrs.push(`letter-spacing="${letterSpacing}"`);
  }

  if (node.opacity !== undefined && node.opacity < 1) {
    attrs.push(`opacity="${node.opacity}"`);
  }

  if (style?.fontPostScriptName) {
    attrs.push(`data-postscript="${escapeXml(style.fontPostScriptName)}"`);
  }

  // Use derivedTextData.baselines for wrapped text if available
  const derivedTextData = node.derivedTextData as DerivedTextData | undefined;
  let spans: string;

  if (derivedTextData?.baselines && derivedTextData.baselines.length > 0) {
    // Use baselines for proper text wrapping
    spans = derivedTextData.baselines
      .map((baseline, index) => {
        // Extract the substring for this line
        const lineText = text.substring(
          baseline.firstCharacter,
          baseline.endCharacter,
        );
        const safeLineText = escapeXml(lineText.trim()); // Trim to remove trailing spaces/newlines

        // Calculate Y position from baseline data
        // lineY gives us the offset from the top of the text block
        const lineY = baseline.lineY;

        if (index === 0) {
          return `<tspan x="${baseX}" dy="0">${safeLineText}</tspan>`;
        } else {
          // Use lineHeight for spacing between lines
          const dy = baseline.lineHeight;
          return `<tspan x="${baseX}" dy="${dy}">${safeLineText}</tspan>`;
        }
      })
      .join("");
  } else {
    // Fallback: split by newlines (for text with explicit line breaks)
    const safeText = escapeXml(text);
    const lines = safeText.split(/\r?\n/);
    spans = lines
      .map((line, index) => {
        const dy = index === 0 ? 0 : defaultLineHeight;
        return `<tspan x="${baseX}" dy="${dy}">${line}</tspan>`;
      })
      .join("");
  }

  output.push(`<text ${attrs.join(" ")}>${spans}</text>`);
  return true;
}

// ============================================================================
// Rectangle Rendering
// ============================================================================

function renderRectangle(
  node: SceneNode,
  transform: TransformMatrix,
  images: Map<string, Uint8Array> | undefined,
  includeImages: boolean,
  output: string[],
): boolean {
  const fills = getPaints(node as FigNode, "fills");
  const strokes = getPaints(node as FigNode, "strokes");
  const fillPaint = getVisiblePaint(fills);
  const fillColor = paintToColor(fillPaint);
  const strokeColor = paintToColor(getVisiblePaint(strokes));

  // Check for image fill
  let hasImageFill = false;
  if (includeImages && fillPaint?.type === "IMAGE" && images) {
    const hash = paintToImageHash(fillPaint);
    const imageData = hash ? images.get(hash) : undefined;
    if (imageData) {
      hasImageFill = true;
      const format = detectImageFormat(imageData);
      const mimeType = getMimeType(format);
      const base64 = Buffer.from(imageData).toString("base64");

      const scaleMode =
        (fillPaint as unknown as { imageScaleMode?: string }).imageScaleMode ??
        fillPaint.scaleMode;
      const preserve =
        scaleMode === "FIT"
          ? "xMidYMid meet"
          : scaleMode === "STRETCH"
            ? "none"
            : "xMidYMid slice";

      const pos = transformPoint(0, 0, transform);
      const width = node.width ?? 0;
      const height = node.height ?? 0;

      const attrs: string[] = [
        `x="${pos.x}"`,
        `y="${pos.y}"`,
        `width="${width}"`,
        `height="${height}"`,
        `preserveAspectRatio="${preserve}"`,
        `href="data:${mimeType};base64,${base64}"`,
      ];

      if (node.opacity !== undefined && node.opacity < 1) {
        attrs.push(`opacity="${node.opacity}"`);
      }

      output.push(`<image ${attrs.join(" ")} />`);
    }
  }

  if (hasImageFill) return true;
  if (!fillColor && !strokeColor) return false;

  const width = node.width ?? 0;
  const height = node.height ?? 0;

  // Transform the four corners
  const p0 = transformPoint(0, 0, transform);
  const p1 = transformPoint(width, 0, transform);
  const p2 = transformPoint(width, height, transform);
  const p3 = transformPoint(0, height, transform);

  // Check if it's still axis-aligned (no rotation)
  const isAxisAligned =
    Math.abs(p0.y - p1.y) < 0.01 && Math.abs(p1.x - p2.x) < 0.01;

  if (isAxisAligned) {
    const attrs: string[] = [
      `x="${p0.x}"`,
      `y="${p0.y}"`,
      `width="${width}"`,
      `height="${height}"`,
    ];

    if (fillColor) attrs.push(`fill="${fillColor}"`);
    else attrs.push(`fill="none"`);

    if (strokeColor) {
      attrs.push(`stroke="${strokeColor}"`);
      attrs.push(`stroke-width="${node.strokeWeight ?? 1}"`);
    }

    const cornerRadius =
      typeof node.cornerRadius === "number" ? node.cornerRadius : undefined;
    if (cornerRadius) {
      // Clamp to ensure circular arcs (not elliptical)
      // SVG clamps rx/ry independently which creates elliptical corners
      // when cornerRadius > min(width, height)/2, producing a tapered "football" shape.
      // By clamping ourselves, we ensure proper pill/stadium shapes.
      const maxRadius = Math.min(width, height) / 2;
      const clampedRadius = Math.min(cornerRadius, maxRadius);
      attrs.push(`rx="${clampedRadius}"`);
      attrs.push(`ry="${clampedRadius}"`);
    }

    if (node.opacity !== undefined && node.opacity < 1) {
      attrs.push(`opacity="${node.opacity}"`);
    }

    output.push(`<rect ${attrs.join(" ")} />`);
  } else {
    // Rotated - use path
    const pathD = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`;

    const attrs: string[] = [`d="${pathD}"`];
    if (fillColor) attrs.push(`fill="${fillColor}"`);
    else attrs.push(`fill="none"`);
    if (strokeColor) {
      attrs.push(`stroke="${strokeColor}"`);
      attrs.push(`stroke-width="${node.strokeWeight ?? 1}"`);
    }
    if (node.opacity !== undefined && node.opacity < 1) {
      attrs.push(`opacity="${node.opacity}"`);
    }

    output.push(`<path ${attrs.join(" ")} />`);
  }

  return true;
}

// ============================================================================
// Main Node Rendering
// ============================================================================

const VECTOR_TYPES = new Set([
  "VECTOR",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "ELLIPSE",
  "BOOLEAN_OPERATION",
]);
const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "COMPONENT", "INSTANCE"]);

/**
 * Render a mask node to create a clipPath definition.
 * Returns the clip path content for the mask.
 */
function renderMaskContent(
  node: SceneNode,
  transform: TransformMatrix,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext,
): string {
  const maskOutput: string[] = [];
  const width = node.width ?? 0;
  const height = node.height ?? 0;

  // Try to render the mask using vector geometry if available
  if (node.fillGeometry?.length) {
    const tempOutput: string[] = [];
    const rendered = renderFilledVector(
      node,
      transform,
      blobs,
      ctx,
      tempOutput,
    );
    if (rendered && tempOutput.length > 0) {
      // Convert fill to white for mask
      return tempOutput.join("").replace(/fill="[^"]*"/g, 'fill="white"');
    }
  }

  // Fallback to simple rectangle
  const pos = transformPoint(0, 0, transform);
  return `<rect x="${pos.x}" y="${pos.y}" width="${width}" height="${height}" fill="white" />`;
}

function renderNode(
  node: FigNode,
  parentTransform: TransformMatrix,
  depth: number,
  options: Required<RenderScreenOptions>,
  images: Map<string, Uint8Array> | undefined,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext,
  output: string[],
): void {
  if (depth > options.maxDepth) return;
  if (node.visible === false) return;

  const sceneNode = node as SceneNode;
  const localTransform = getLocalTransform(sceneNode);
  const worldTransform = multiplyTransforms(parentTransform, localTransform);

  let rendered = false;

  // Handle different node types
  if (node.type === "TEXT" && options.includeText) {
    rendered = renderText(sceneNode, worldTransform, output);
  } else if (VECTOR_TYPES.has(node.type ?? "")) {
    if (options.includeStrokes && isStrokedVector(sceneNode)) {
      rendered = renderStrokedVector(
        sceneNode,
        worldTransform,
        blobs,
        ctx,
        output,
      );
    }
    if (!rendered && options.includeFills) {
      rendered = renderFilledVector(
        sceneNode,
        worldTransform,
        blobs,
        ctx,
        output,
      );
    }
  } else if (node.type === "RECTANGLE") {
    if (
      options.includeFills ||
      options.includeStrokes ||
      options.includeImages
    ) {
      rendered = renderRectangle(
        sceneNode,
        worldTransform,
        images,
        options.includeImages,
        output,
      );
    }
  } else if (CONTAINER_TYPES.has(node.type ?? "")) {
    if (options.includeFills || options.includeImages) {
      const fills = getPaints(node, "fills");
      const fillPaint = getVisiblePaint(fills);
      const fillColor = paintToColor(fillPaint);
      const hasImageFill = fillPaint?.type === "IMAGE";
      if (
        (fillColor || (options.includeImages && hasImageFill)) &&
        sceneNode.width &&
        sceneNode.height
      ) {
        rendered = renderRectangle(
          sceneNode,
          worldTransform,
          images,
          options.includeImages,
          output,
        );
      }
    }
  }

  // Render children with mask support
  if (node.children) {
    const children = node.children as FigNode[];
    const childOutput: string[] = [];
    const targetOutput = sceneNode.clipsContent ? childOutput : output;

    let index = 0;
    while (index < children.length) {
      const child = children[index] as FigNode;
      const childScene = child as SceneNode;

      // Handle mask nodes
      if (childScene.isMask) {
        const maskId = `mask-${ctx.clipCounter++}`;
        const childTransform = multiplyTransforms(
          worldTransform,
          getLocalTransform(childScene),
        );

        // Create mask clipPath
        const maskContent = renderMaskContent(
          childScene,
          childTransform,
          blobs,
          ctx,
        );
        ctx.defs.push(
          `<clipPath id="${maskId}" clipPathUnits="userSpaceOnUse">${maskContent}</clipPath>`,
        );

        // Collect all siblings until the next mask
        const groupOutput: string[] = [];
        index += 1;
        while (index < children.length) {
          const sibling = children[index] as FigNode;
          const siblingScene = sibling as SceneNode;
          if (siblingScene.isMask) break;
          renderNode(
            sibling,
            worldTransform,
            depth + 1,
            options,
            images,
            blobs,
            ctx,
            groupOutput,
          );
          index += 1;
        }

        // Wrap masked content in a group with the clip-path
        targetOutput.push(
          `<g clip-path="url(#${maskId})">${groupOutput.join("")}</g>`,
        );
        continue;
      }

      renderNode(
        child,
        worldTransform,
        depth + 1,
        options,
        images,
        blobs,
        ctx,
        targetOutput,
      );
      index += 1;
    }

    // Handle clipping - wrap childOutput in clip-path if needed
    if (sceneNode.clipsContent && sceneNode.width && sceneNode.height) {
      const clipId = `clip-${ctx.clipCounter++}`;
      const p0 = transformPoint(0, 0, worldTransform);
      ctx.defs.push(
        `<clipPath id="${clipId}"><rect x="${p0.x}" y="${p0.y}" width="${sceneNode.width}" height="${sceneNode.height}" /></clipPath>`,
      );
      output.push(`<g clip-path="url(#${clipId})">${childOutput.join("")}</g>`);
    }
  }
}

// ============================================================================
// Bounds Calculation
// ============================================================================

function collectBounds(
  node: FigNode,
  parentTransform: TransformMatrix,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (node.visible === false) return null;

  const sceneNode = node as SceneNode;
  const localTransform = getLocalTransform(sceneNode);
  const worldTransform = multiplyTransforms(parentTransform, localTransform);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  // Skip CANVAS/DOCUMENT bounds - they represent pages, not visual content
  // Only include actual content node bounds
  const isPageNode = node.type === "CANVAS" || node.type === "DOCUMENT";

  if (
    !isPageNode &&
    sceneNode.width !== undefined &&
    sceneNode.height !== undefined
  ) {
    const corners = [
      transformPoint(0, 0, worldTransform),
      transformPoint(sceneNode.width, 0, worldTransform),
      transformPoint(sceneNode.width, sceneNode.height, worldTransform),
      transformPoint(0, sceneNode.height, worldTransform),
    ];
    for (const p of corners) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  // Include children bounds
  if (node.children) {
    for (const child of node.children as FigNode[]) {
      const childBounds = collectBounds(child, worldTransform);
      if (childBounds) {
        minX = Math.min(minX, childBounds.minX);
        minY = Math.min(minY, childBounds.minY);
        maxX = Math.max(maxX, childBounds.maxX);
        maxY = Math.max(maxY, childBounds.maxY);
      }
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Render a node subtree to SVG.
 *
 * @param node - The root node to render
 * @param images - Optional map of image hash -> image data for embedding
 * @param blobs - Optional array of blob data for vector paths
 * @param options - Rendering options
 * @returns The rendered SVG and metadata
 */
export function renderScreen(
  node: FigNode,
  images?: Map<string, Uint8Array>,
  blobs?: BlobEntry[],
  options: RenderScreenOptions = {},
): RenderScreenResult {
  const resolved = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const ctx: RenderContext = { defs: [], clipCounter: 0, warnings: [] };

  // Calculate bounds
  const bounds = collectBounds(node, IDENTITY_TRANSFORM);

  if (!bounds) {
    ctx.warnings.push("No bounds found for node subtree");
    return { svg: "", width: 0, height: 0, warnings: ctx.warnings };
  }

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  // Offset transform to bring content to origin
  const offsetTransform: TransformMatrix = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: -bounds.minX,
    f: -bounds.minY,
  };

  // Render
  const output: string[] = [];
  if (resolved.background) {
    output.push(
      `<rect width="100%" height="100%" fill="${resolved.background}" />`,
    );
  }

  renderNode(node, offsetTransform, 0, resolved, images, blobs, ctx, output);

  // Build SVG
  const defs = ctx.defs.length > 0 ? `<defs>${ctx.defs.join("")}</defs>` : "";
  const scaledWidth = width * resolved.scale;
  const scaledHeight = height * resolved.scale;

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scaledWidth}" height="${scaledHeight}" viewBox="0 0 ${width} ${height}">` +
    `${defs}${output.join("")}</svg>`;

  return { svg, width, height, warnings: ctx.warnings };
}
