/**
 * Layout Inference - Convert raw node data to structured layout information
 *
 * This module analyzes nodes and infers:
 * - Spacing patterns (gaps, padding, margins)
 * - Alignment (horizontal/vertical)
 * - Layout direction (row/column)
 * - Sizing modes (fixed/hug/fill)
 */

import type {
  FigNode,
  SceneNode,
  InferredLayout,
  SimplifiedNode,
  Rect,
  Color,
  Paint,
  Effect,
  CornerRadius,
} from "./types.js";
import { formatGUID } from "./kiwi-parser.js";

/**
 * Convert RGBA color to CSS string
 */
export function colorToCSS(color: Color | undefined): string | undefined {
  if (!color) return undefined;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a;
  if (a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}

/**
 * Extract primary fill color from paints array
 */
export function getPrimaryFillColor(fills: Paint[] | undefined): string | undefined {
  if (!fills || fills.length === 0) return undefined;

  for (const fill of fills) {
    if (fill.visible !== false && fill.type === "SOLID" && fill.color) {
      const opacity = fill.opacity ?? 1;
      const color = { ...fill.color, a: fill.color.a * opacity };
      return colorToCSS(color);
    }
  }
  return undefined;
}

/**
 * Extract primary stroke color from paints array
 */
export function getPrimaryStrokeColor(strokes: Paint[] | undefined): string | undefined {
  if (!strokes || strokes.length === 0) return undefined;

  for (const stroke of strokes) {
    if (stroke.visible !== false && stroke.type === "SOLID" && stroke.color) {
      return colorToCSS(stroke.color);
    }
  }
  return undefined;
}

/**
 * Convert effect to CSS-like description
 */
export function effectToDescription(effect: Effect): string {
  if (!effect.visible) return "";

  switch (effect.type) {
    case "DROP_SHADOW": {
      const x = effect.offset?.x ?? 0;
      const y = effect.offset?.y ?? 0;
      const blur = effect.radius;
      const spread = effect.spread ?? 0;
      const color = colorToCSS(effect.color) ?? "rgba(0,0,0,0.25)";
      return `drop-shadow(${x}px ${y}px ${blur}px ${spread}px ${color})`;
    }
    case "INNER_SHADOW": {
      const x = effect.offset?.x ?? 0;
      const y = effect.offset?.y ?? 0;
      const blur = effect.radius;
      const color = colorToCSS(effect.color) ?? "rgba(0,0,0,0.25)";
      return `inner-shadow(${x}px ${y}px ${blur}px ${color})`;
    }
    case "LAYER_BLUR":
      return `blur(${effect.radius}px)`;
    case "BACKGROUND_BLUR":
      return `backdrop-blur(${effect.radius}px)`;
    default:
      return "";
  }
}

/**
 * Get bounds of a node
 */
export function getNodeBounds(node: SceneNode): Rect | undefined {
  if (
    node.x !== undefined &&
    node.y !== undefined &&
    node.width !== undefined &&
    node.height !== undefined
  ) {
    return {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }
  return undefined;
}

/**
 * Infer layout from auto-layout properties
 */
export function inferLayoutFromAutoLayout(node: SceneNode): InferredLayout | undefined {
  const layoutMode = node.layoutMode;
  if (!layoutMode || layoutMode.mode === "NONE") {
    return undefined;
  }

  const layout: InferredLayout = {
    direction: layoutMode.mode === "HORIZONTAL" ? "row" : "column",
    gap: layoutMode.itemSpacing,
    padding: {
      top: layoutMode.paddingTop,
      right: layoutMode.paddingRight,
      bottom: layoutMode.paddingBottom,
      left: layoutMode.paddingLeft,
    },
    wrap: layoutMode.layoutWrap === "WRAP",
  };

  // Primary axis alignment
  switch (layoutMode.primaryAxisAlignItems) {
    case "MIN":
      layout.horizontalAlign = layoutMode.mode === "HORIZONTAL" ? "left" : undefined;
      layout.verticalAlign = layoutMode.mode === "VERTICAL" ? "top" : undefined;
      break;
    case "CENTER":
      if (layoutMode.mode === "HORIZONTAL") {
        layout.horizontalAlign = "center";
      } else {
        layout.verticalAlign = "center";
      }
      break;
    case "MAX":
      layout.horizontalAlign = layoutMode.mode === "HORIZONTAL" ? "right" : undefined;
      layout.verticalAlign = layoutMode.mode === "VERTICAL" ? "bottom" : undefined;
      break;
    case "SPACE_BETWEEN":
      if (layoutMode.mode === "HORIZONTAL") {
        layout.horizontalAlign = "space-between";
      } else {
        layout.verticalAlign = "space-between";
      }
      break;
  }

  // Counter axis alignment
  switch (layoutMode.counterAxisAlignItems) {
    case "MIN":
      if (layoutMode.mode === "HORIZONTAL") {
        layout.verticalAlign = "top";
      } else {
        layout.horizontalAlign = "left";
      }
      break;
    case "CENTER":
      if (layoutMode.mode === "HORIZONTAL") {
        layout.verticalAlign = "center";
      } else {
        layout.horizontalAlign = "center";
      }
      break;
    case "MAX":
      if (layoutMode.mode === "HORIZONTAL") {
        layout.verticalAlign = "bottom";
      } else {
        layout.horizontalAlign = "right";
      }
      break;
  }

  // Sizing modes
  layout.widthMode =
    layoutMode.mode === "HORIZONTAL"
      ? layoutMode.primaryAxisSizingMode === "AUTO"
        ? "hug"
        : "fixed"
      : layoutMode.counterAxisSizingMode === "AUTO"
      ? "hug"
      : "fixed";

  layout.heightMode =
    layoutMode.mode === "VERTICAL"
      ? layoutMode.primaryAxisSizingMode === "AUTO"
        ? "hug"
        : "fixed"
      : layoutMode.counterAxisSizingMode === "AUTO"
      ? "hug"
      : "fixed";

  return layout;
}

/**
 * Infer layout from child positions (for non-auto-layout frames)
 */
export function inferLayoutFromChildren(children: SceneNode[]): InferredLayout | undefined {
  if (children.length < 2) return undefined;

  // Get all child bounds
  const bounds = children
    .map((c) => getNodeBounds(c))
    .filter((b): b is Rect => b !== undefined);

  if (bounds.length < 2) return undefined;

  // Sort by position
  const sortedByX = [...bounds].sort((a, b) => a.x - b.x);
  const sortedByY = [...bounds].sort((a, b) => a.y - b.y);

  // Calculate horizontal gaps
  const horizontalGaps: number[] = [];
  for (let i = 1; i < sortedByX.length; i++) {
    const prev = sortedByX[i - 1]!;
    const curr = sortedByX[i]!;
    const gap = curr.x - (prev.x + prev.width);
    if (gap > 0) {
      horizontalGaps.push(gap);
    }
  }

  // Calculate vertical gaps
  const verticalGaps: number[] = [];
  for (let i = 1; i < sortedByY.length; i++) {
    const prev = sortedByY[i - 1]!;
    const curr = sortedByY[i]!;
    const gap = curr.y - (prev.y + prev.height);
    if (gap > 0) {
      verticalGaps.push(gap);
    }
  }

  // Determine if primarily horizontal or vertical layout
  const avgHorizontalGap = horizontalGaps.length > 0
    ? horizontalGaps.reduce((a, b) => a + b, 0) / horizontalGaps.length
    : Infinity;
  const avgVerticalGap = verticalGaps.length > 0
    ? verticalGaps.reduce((a, b) => a + b, 0) / verticalGaps.length
    : Infinity;

  // Check if items are stacked horizontally or vertically
  const isHorizontal = avgHorizontalGap < avgVerticalGap || horizontalGaps.length > verticalGaps.length;

  // Check for consistent gaps
  const gaps = isHorizontal ? horizontalGaps : verticalGaps;
  const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const gapVariance = gaps.length > 0
    ? gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length
    : 0;
  const isConsistentGap = gapVariance < 4; // Allow 2px variance

  if (!isConsistentGap && gaps.length > 0) {
    return undefined; // Random positioning, not a structured layout
  }

  return {
    direction: isHorizontal ? "row" : "column",
    gap: Math.round(avgGap),
  };
}

/**
 * Simplify a node for MCP output
 */
export function simplifyNode(
  node: FigNode,
  depth = 0,
  maxDepth = 10,
  options: {
    includeStyles?: boolean;
    includeLayout?: boolean;
  } = {}
): SimplifiedNode | null {
  if (depth > maxDepth) return null;

  const { includeStyles = true, includeLayout = true } = options;

  const sceneNode = node as SceneNode;
  const bounds = getNodeBounds(sceneNode);

  // Infer layout
  let layout: InferredLayout | undefined;
  if (includeLayout) {
    if (sceneNode.layoutMode) {
      layout = inferLayoutFromAutoLayout(sceneNode);
    } else if (sceneNode.children && sceneNode.children.length >= 2) {
      layout = inferLayoutFromChildren(sceneNode.children as SceneNode[]);
    }
  }

  // Build style object
  let style: SimplifiedNode["style"] | undefined;
  if (includeStyles) {
    const styleObj: SimplifiedNode["style"] = {};

    // Background color
    const bgColor = getPrimaryFillColor(sceneNode.fills);
    if (bgColor) {
      styleObj.backgroundColor = bgColor;
    }

    // Border
    const borderColor = getPrimaryStrokeColor(sceneNode.strokes);
    if (borderColor && sceneNode.strokeWeight) {
      styleObj.borderColor = borderColor;
      styleObj.borderWidth = sceneNode.strokeWeight;
    }

    // Corner radius
    if (sceneNode.cornerRadius) {
      styleObj.borderRadius = sceneNode.cornerRadius;
    }

    // Opacity
    if (sceneNode.opacity !== undefined && sceneNode.opacity < 1) {
      styleObj.opacity = sceneNode.opacity;
    }

    // Effects
    if (sceneNode.effects && sceneNode.effects.length > 0) {
      const shadowEffects = sceneNode.effects
        .filter((e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
        .map(effectToDescription)
        .filter((e) => e.length > 0);
      const blurEffects = sceneNode.effects
        .filter((e) => e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR")
        .map(effectToDescription)
        .filter((e) => e.length > 0);

      if (shadowEffects.length > 0) {
        styleObj.shadow = shadowEffects.join(", ");
      }
      if (blurEffects.length > 0) {
        styleObj.blur = blurEffects.join(", ");
      }
    }

    if (Object.keys(styleObj).length > 0) {
      style = styleObj;
    }
  }

  // Build text info for TEXT nodes
  let text: SimplifiedNode["text"];
  if (node.type === "TEXT" && sceneNode.characters) {
    text = {
      content: sceneNode.characters,
      font: sceneNode.style?.fontFamily ?? "Inter",
      size: sceneNode.style?.fontSize ?? 14,
      weight: sceneNode.style?.fontWeight ?? 400,
      color: includeStyles ? getPrimaryFillColor(sceneNode.fills) : undefined,
      align: sceneNode.style?.textAlignHorizontal?.toLowerCase(),
    };
  }

  // Process children
  let children: SimplifiedNode[] | undefined;
  if (node.children && node.children.length > 0) {
    children = node.children
      .map((c) => simplifyNode(c as FigNode, depth + 1, maxDepth, options))
      .filter((c): c is SimplifiedNode => c !== null);
  }

  const simplified: SimplifiedNode = {
    id: formatGUID(node.guid),
    type: node.type,
    name: node.name,
  };

  if (bounds) simplified.bounds = bounds;
  if (layout) simplified.layout = layout;
  if (style) simplified.style = style;
  if (text) simplified.text = text;
  if (children && children.length > 0) simplified.children = children;

  return simplified;
}

/**
 * Get a summary of the document structure
 */
export function getDocumentSummary(node: FigNode): string {
  const lines: string[] = [];

  function walk(n: FigNode, indent: number): void {
    const prefix = "  ".repeat(indent);
    const bounds = getNodeBounds(n as SceneNode);
    const boundsStr = bounds
      ? ` [${Math.round(bounds.width)}x${Math.round(bounds.height)}]`
      : "";
    lines.push(`${prefix}${n.type}: "${n.name}"${boundsStr}`);

    if (n.children) {
      for (const child of n.children) {
        walk(child as FigNode, indent + 1);
      }
    }
  }

  walk(node, 0);
  return lines.join("\n");
}

/**
 * Find nodes by type
 */
export function findNodesByType(node: FigNode, type: string): FigNode[] {
  const results: FigNode[] = [];

  function walk(n: FigNode): void {
    if (n.type === type) {
      results.push(n);
    }
    if (n.children) {
      for (const child of n.children) {
        walk(child as FigNode);
      }
    }
  }

  walk(node);
  return results;
}

/**
 * Find node by name (partial match)
 */
export function findNodesByName(node: FigNode, name: string): FigNode[] {
  const results: FigNode[] = [];
  const lowerName = name.toLowerCase();

  function walk(n: FigNode): void {
    if (n.name.toLowerCase().includes(lowerName)) {
      results.push(n);
    }
    if (n.children) {
      for (const child of n.children) {
        walk(child as FigNode);
      }
    }
  }

  walk(node);
  return results;
}

/**
 * Count nodes by type
 */
export function countNodesByType(node: FigNode): Record<string, number> {
  const counts: Record<string, number> = {};

  function walk(n: FigNode): void {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
    if (n.children) {
      for (const child of n.children) {
        walk(child as FigNode);
      }
    }
  }

  walk(node);
  return counts;
}
