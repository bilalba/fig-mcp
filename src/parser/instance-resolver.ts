/**
 * Instance Resolver - Extracts and resolves INSTANCE content from symbolOverrides
 *
 * INSTANCE nodes in .fig files reference SYMBOL (component) definitions.
 * The actual content (text, colors, sizes) is stored in symbolOverrides,
 * which use internal guidPaths that don't map directly to tree node GUIDs.
 *
 * This module provides helpers to:
 * 1. Extract meaningful content from INSTANCE overrides
 * 2. Build a resolved representation for rendering/display
 */

import type { FigNode, SceneNode, GUID, Color, Paint, DerivedTextData, TextStyle } from "./types.js";
import { formatGUID } from "./kiwi-parser.js";

/** Extracted text content from an INSTANCE override */
export interface InstanceTextContent {
  text: string;
  guidPath: string;
  fillColor?: Color;
  fontSize?: number;
  fontFamily?: string;
}

/** Extracted visual element from an INSTANCE override */
export interface InstanceVisualElement {
  type: "text" | "rectangle";
  guidPath: string;
  text?: string;
  size?: { x: number; y: number };
  fillColor?: Color;
  strokeColor?: Color;
  cornerRadius?: number;
  fontSize?: number;
  fontFamily?: string;
}

/** Resolved instance content */
export interface ResolvedInstanceContent {
  /** The original INSTANCE node */
  instance: FigNode;
  /** GUID of the referenced SYMBOL */
  symbolId: string;
  /** All text content extracted from overrides */
  textContent: InstanceTextContent[];
  /** Visual elements (rects, text) with their properties */
  elements: InstanceVisualElement[];
  /** Size information from derivedSymbolData */
  sizes: Map<string, { x: number; y: number }>;
}

type OverrideData = {
  characters?: string;
  fillPaints?: unknown[];
  strokePaints?: unknown[];
  cornerRadius?: number;
  rectangleCornerRadius?: {
    topLeft?: number;
    topRight?: number;
    bottomRight?: number;
    bottomLeft?: number;
  };
  fontSize?: number;
  fontName?: Record<string, string>;
  textAlignHorizontal?: string;
  lineHeight?: { value?: number };
  textAutoResize?: string;
  size?: { x: number; y: number };
  derivedTextData?: unknown;
  fillGeometry?: unknown;
  strokeGeometry?: unknown;
  transform?: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number };
  componentPropAssignments?: Array<{ defId: string; characters?: string; visible?: boolean; symbolId?: GUID }>;
  overrideSymbolId?: GUID;
};

/**
 * Extract Color from a paint object
 */
function extractColor(paint: unknown): Color | undefined {
  if (!paint || typeof paint !== "object") return undefined;
  const p = paint as Record<string, unknown>;
  if (p.visible === false) return undefined;
  const color = p.color as Record<string, number> | undefined;
  if (!color) return undefined;
  return {
    r: color.r ?? 0,
    g: color.g ?? 0,
    b: color.b ?? 0,
    a: color.a ?? 1,
  };
}

function guidPathToString(path: unknown): string {
  const guids = (path as Record<string, unknown>)?.guids as unknown[] | undefined;
  if (!guids) return "";
  return guids
    .map((g: unknown) => {
      const guid = g as Record<string, number>;
      return `${guid.sessionID}:${guid.localID}`;
    })
    .join(">");
}

function buildOverridePathMap(
  root: FigNode,
  rawNodeIndex: Map<string, Record<string, unknown>>,
  nodeIndex: Map<string, FigNode>,
): Map<string, string> {
  const pathMap = new Map<string, string>();
  const symbolStack = new Set<string>();

  const walk = (node: FigNode, path: string[], skipOverrideKey: boolean): void => {
    const nodeId = formatGUID(node.guid);
    const raw = rawNodeIndex.get(nodeId);
    const overrideKey = raw?.overrideKey as Record<string, number> | undefined;
    const overrideKeyString = overrideKey ? `${overrideKey.sessionID}:${overrideKey.localID}` : null;
    const nextPath = overrideKeyString && !skipOverrideKey ? [...path, overrideKeyString] : path;

    if (overrideKeyString && !skipOverrideKey) {
      const fullPath = nextPath.join(">");
      pathMap.set(fullPath, nodeId);
      if (nextPath.length > 1) {
        pathMap.set(nextPath.slice(1).join(">"), nodeId);
      }
    }

    if (
      node.type === "INSTANCE" &&
      (node as SceneNode).symbolData?.symbolID
    ) {
      const symbolId = formatGUID((node as SceneNode).symbolData!.symbolID as GUID);
      const symbolNode = nodeIndex.get(symbolId);
      if (symbolNode?.children && !symbolStack.has(symbolId)) {
        symbolStack.add(symbolId);
        for (const child of symbolNode.children) {
          walk(child as FigNode, nextPath, false);
        }
        symbolStack.delete(symbolId);
      }
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child as FigNode, nextPath, false);
      }
    }
  };

  walk(root, [], false);
  return pathMap;
}

function buildOverrideData(
  instance: FigNode,
  rawNodeChange: Record<string, unknown> | undefined,
): Map<string, OverrideData> {
  const overrides = new Map<string, OverrideData>();
  const sceneNode = instance as SceneNode;
  const rawSymbolData = rawNodeChange?.symbolData as Record<string, unknown> | undefined;
  const symbolOverrides = (rawSymbolData?.symbolOverrides || sceneNode.symbolData?.symbolOverrides || []) as unknown[];
  const derivedSymbolData = (rawNodeChange?.derivedSymbolData || []) as unknown[];

  const upsert = (path: string): OverrideData => {
    if (!overrides.has(path)) {
      overrides.set(path, {});
    }
    return overrides.get(path)!;
  };

  for (const override of symbolOverrides) {
    if (!override || typeof override !== "object") continue;
    const o = override as Record<string, unknown>;
    const path = guidPathToString(o.guidPath);
    if (!path) continue;

    const entry = upsert(path);

    if (typeof o.characters === "string") {
      entry.characters = o.characters;
    }
    if (Array.isArray(o.fillPaints)) {
      entry.fillPaints = o.fillPaints;
    }
    if (Array.isArray(o.strokePaints)) {
      entry.strokePaints = o.strokePaints;
    }
    if (typeof o.cornerRadius === "number") {
      entry.cornerRadius = o.cornerRadius;
    }
    if (o.rectangleTopLeftCornerRadius || o.rectangleTopRightCornerRadius || o.rectangleBottomRightCornerRadius || o.rectangleBottomLeftCornerRadius) {
      entry.rectangleCornerRadius = {
        topLeft: o.rectangleTopLeftCornerRadius as number | undefined,
        topRight: o.rectangleTopRightCornerRadius as number | undefined,
        bottomRight: o.rectangleBottomRightCornerRadius as number | undefined,
        bottomLeft: o.rectangleBottomLeftCornerRadius as number | undefined,
      };
    }
    if (typeof o.fontSize === "number") {
      entry.fontSize = o.fontSize;
    }
    if (o.fontName && typeof o.fontName === "object") {
      entry.fontName = o.fontName as Record<string, string>;
    }
    if (typeof o.textAlignHorizontal === "string") {
      entry.textAlignHorizontal = o.textAlignHorizontal;
    }
    if (o.lineHeight && typeof o.lineHeight === "object") {
      entry.lineHeight = o.lineHeight as { value?: number };
    }
    if (typeof o.textAutoResize === "string") {
      entry.textAutoResize = o.textAutoResize;
    }
    if (o.size && typeof o.size === "object") {
      const size = o.size as Record<string, number>;
      entry.size = { x: size.x ?? 0, y: size.y ?? 0 };
    }

    const propAssignments = o.componentPropAssignments as unknown[] | undefined;
    if (propAssignments) {
      for (const assign of propAssignments) {
        if (!assign || typeof assign !== "object") continue;
        const a = assign as Record<string, unknown>;
        const value = a.value as Record<string, unknown> | undefined;
        const textValue = value?.textValue as Record<string, unknown> | undefined;
        const characters = textValue?.characters as string | undefined;
        const boolValue = value?.boolValue as boolean | undefined;
        const guidValue = value?.guidValue as Record<string, number> | undefined;
        const def = a.defID as Record<string, number> | undefined;
        if (def) {
          if (!entry.componentPropAssignments) entry.componentPropAssignments = [];
          entry.componentPropAssignments.push({
            defId: `${def.sessionID}:${def.localID}`,
            characters: characters,
            visible: typeof boolValue === "boolean" ? boolValue : undefined,
            symbolId: guidValue ? (guidValue as GUID) : undefined,
          });
        } else if (characters) {
          entry.characters = characters;
        }
      }
    }
  }

  for (const derived of derivedSymbolData) {
    if (!derived || typeof derived !== "object") continue;
    const d = derived as Record<string, unknown>;
    const path = guidPathToString(d.guidPath);
    if (!path) continue;

    const entry = upsert(path);
    if (d.size && typeof d.size === "object") {
      const size = d.size as Record<string, number>;
      entry.size = { x: size.x ?? 0, y: size.y ?? 0 };
    }
    if (d.derivedTextData) {
      entry.derivedTextData = d.derivedTextData;
    }
    if (d.fillGeometry) {
      entry.fillGeometry = d.fillGeometry;
    }
    if (d.strokeGeometry) {
      entry.strokeGeometry = d.strokeGeometry;
    }
    if (d.transform && typeof d.transform === "object") {
      const t = d.transform as Record<string, number>;
      entry.transform = {
        m00: t.m00 ?? 1,
        m01: t.m01 ?? 0,
        m02: t.m02 ?? 0,
        m10: t.m10 ?? 0,
        m11: t.m11 ?? 1,
        m12: t.m12 ?? 0,
      };
    }
  }

  return overrides;
}

function applyOverrideToNode(node: SceneNode, override: OverrideData): void {
  if (override.characters) {
    node.characters = override.characters;
  }
  if (override.fillPaints) {
    node.fills = override.fillPaints as Paint[];
  }
  if (override.strokePaints) {
    node.strokes = override.strokePaints as Paint[];
  }
  if (override.cornerRadius !== undefined) {
    node.cornerRadius = override.cornerRadius;
  } else if (override.rectangleCornerRadius) {
    node.cornerRadius = {
      topLeft: override.rectangleCornerRadius.topLeft ?? 0,
      topRight: override.rectangleCornerRadius.topRight ?? 0,
      bottomRight: override.rectangleCornerRadius.bottomRight ?? 0,
      bottomLeft: override.rectangleCornerRadius.bottomLeft ?? 0,
    };
  }
  if (override.size) {
    node.width = override.size.x;
    node.height = override.size.y;
    node.size = { x: override.size.x, y: override.size.y };
  }
  if (override.derivedTextData) {
    node.derivedTextData = override.derivedTextData as unknown as DerivedTextData;
  }
  if (override.fillGeometry) {
    node.fillGeometry = override.fillGeometry as unknown as SceneNode["fillGeometry"];
  }
  if (override.strokeGeometry) {
    node.strokeGeometry = override.strokeGeometry as unknown as SceneNode["strokeGeometry"];
  }
  if (override.transform) {
    node.transform = override.transform;
  }
  if (override.visible !== undefined) {
    node.visible = override.visible;
  }
  if (override.overrideSymbolId) {
    if (!node.symbolData) node.symbolData = {};
    node.symbolData.symbolID = override.overrideSymbolId;
    node.children = undefined;
  }

  if (
    override.fontName ||
    override.fontSize !== undefined ||
    override.lineHeight?.value !== undefined ||
    override.textAutoResize
  ) {
    const style = { ...(node.style ?? {}) } as Record<string, unknown>;
    if (override.fontName?.family) {
      style.fontFamily = override.fontName.family;
    }
    if (override.fontSize !== undefined) {
      style.fontSize = override.fontSize;
    }
    if (override.textAlignHorizontal) {
      style.textAlignHorizontal = override.textAlignHorizontal;
    }
    if (override.lineHeight?.value !== undefined) {
      style.lineHeightPx = override.lineHeight.value;
    }
    if (override.textAutoResize) {
      style.textAutoResize = override.textAutoResize;
    }
    node.style = style as TextStyle;
  }
}

function applyComponentPropAssignments(
  instanceNodeId: string,
  assignments: Array<{ defId: string; characters?: string; visible?: boolean; symbolId?: GUID }>,
  nodeIndex: Map<string, FigNode>,
  rawNodeIndex: Map<string, Record<string, unknown>>,
  overrideByNodeId: Map<string, OverrideData>,
): void {
  const instanceNode = nodeIndex.get(instanceNodeId) as SceneNode | undefined;
  if (!instanceNode?.symbolData?.symbolID) return;

  const symbolId = formatGUID(instanceNode.symbolData.symbolID as GUID);
  const symbolNode = nodeIndex.get(symbolId);
  if (!symbolNode) return;

  const byDefId = new Map<string, { characters?: string; visible?: boolean; symbolId?: GUID }>();
  for (const assign of assignments) {
    byDefId.set(assign.defId, {
      characters: assign.characters,
      visible: assign.visible,
      symbolId: assign.symbolId,
    });
  }

  const walk = (node: FigNode): void => {
    const nodeId = formatGUID(node.guid);
    const raw = rawNodeIndex.get(nodeId);
    const refs = raw?.componentPropRefs as Array<Record<string, unknown>> | undefined;
    if (refs) {
      for (const ref of refs) {
        const def = ref.defID as Record<string, number> | undefined;
        if (!def) continue;
        const defId = `${def.sessionID}:${def.localID}`;
        const assignment = byDefId.get(defId);
        if (assignment) {
          const existing = overrideByNodeId.get(nodeId) ?? {};
          if (ref.componentPropNodeField === "TEXT_DATA" && assignment.characters) {
            overrideByNodeId.set(nodeId, { ...existing, characters: assignment.characters });
          } else if (ref.componentPropNodeField === "VISIBLE" && assignment.visible !== undefined) {
            overrideByNodeId.set(nodeId, { ...existing, visible: assignment.visible });
          } else if (ref.componentPropNodeField === "OVERRIDDEN_SYMBOL_ID" && assignment.symbolId) {
            overrideByNodeId.set(nodeId, { ...existing, overrideSymbolId: assignment.symbolId });
          }
        }
      }
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child as FigNode);
      }
    }
  };

  walk(symbolNode);
}

function cloneWithOverrides(
  node: FigNode,
  overrideByNodeId: Map<string, OverrideData>,
  nodeIndex: Map<string, FigNode>,
  symbolStack: Set<string>,
): FigNode {
  const nodeId = formatGUID(node.guid);
  const clone = { ...node } as FigNode;
  const override = overrideByNodeId.get(nodeId);
  if (override) {
    applyOverrideToNode(clone as SceneNode, override);
  }
  let children = "children" in clone ? clone.children : undefined;
  let expandedSymbolId: string | null = null;
  if (
    (!children || children.length === 0) &&
    clone.type === "INSTANCE" &&
    (clone as SceneNode).symbolData?.symbolID
  ) {
    const symbolId = formatGUID((clone as SceneNode).symbolData!.symbolID as GUID);
    const symbolNode = nodeIndex.get(symbolId);
    if (symbolNode?.children && !symbolStack.has(symbolId)) {
      symbolStack.add(symbolId);
      expandedSymbolId = symbolId;
      children = symbolNode.children as FigNode[];
    }
  }

  if (children && children.length > 0) {
    clone.children = children.map(child =>
      cloneWithOverrides(child as FigNode, overrideByNodeId, nodeIndex, symbolStack)
    );
  }
  if (expandedSymbolId) {
    symbolStack.delete(expandedSymbolId);
  }
  return clone;
}

/**
 * Resolve INSTANCE children by cloning the symbol subtree and applying overrides.
 */
export function resolveInstanceChildren(
  instance: FigNode,
  symbolNode: FigNode,
  rawNodeIndex: Map<string, Record<string, unknown>>,
  nodeIndex: Map<string, FigNode>,
): FigNode[] | null {
  const instanceRaw = rawNodeIndex.get(formatGUID(instance.guid));
  if (!instanceRaw) return null;

  const overrideData = buildOverrideData(instance, instanceRaw);
  if (overrideData.size === 0) return null;

  const pathMap = buildOverridePathMap(symbolNode, rawNodeIndex, nodeIndex);
  const overrideByNodeId = new Map<string, OverrideData>();

  for (const [path, data] of overrideData.entries()) {
    const nodeId = pathMap.get(path);
    if (!nodeId) continue;
    const existing = overrideByNodeId.get(nodeId);
    overrideByNodeId.set(nodeId, existing ? { ...existing, ...data } : data);
  }

  if (overrideByNodeId.size === 0) return null;

  const topLevelAssignmentsRaw = instanceRaw.componentPropAssignments as unknown[] | undefined;
  if (topLevelAssignmentsRaw) {
    const assignments: Array<{ defId: string; characters?: string; visible?: boolean; symbolId?: GUID }> = [];
    for (const assign of topLevelAssignmentsRaw) {
      if (!assign || typeof assign !== "object") continue;
      const a = assign as Record<string, unknown>;
      const def = a.defID as Record<string, number> | undefined;
      const value = a.value as Record<string, unknown> | undefined;
      const textValue = value?.textValue as Record<string, unknown> | undefined;
      const characters = textValue?.characters as string | undefined;
      const boolValue = value?.boolValue as boolean | undefined;
      const guidValue = value?.guidValue as Record<string, number> | undefined;
      if (def) {
        assignments.push({
          defId: `${def.sessionID}:${def.localID}`,
          characters,
          visible: typeof boolValue === "boolean" ? boolValue : undefined,
          symbolId: guidValue ? (guidValue as GUID) : undefined,
        });
      }
    }
    if (assignments.length > 0) {
      applyComponentPropAssignments(
        formatGUID(instance.guid),
        assignments,
        nodeIndex,
        rawNodeIndex,
        overrideByNodeId,
      );
    }
  }

  for (const [nodeId, data] of overrideByNodeId.entries()) {
    if (data.componentPropAssignments && data.componentPropAssignments.length > 0) {
      applyComponentPropAssignments(
        nodeId,
        data.componentPropAssignments,
        nodeIndex,
        rawNodeIndex,
        overrideByNodeId,
      );
    }
  }

  const clonedSymbol = cloneWithOverrides(symbolNode, overrideByNodeId, nodeIndex, new Set<string>());
  return clonedSymbol.children ? (clonedSymbol.children as FigNode[]) : null;
}

/**
 * Extract content from an INSTANCE node's symbolOverrides
 */
export function extractInstanceContent(
  instance: FigNode,
  rawNodeChange?: Record<string, unknown>
): ResolvedInstanceContent | null {
  const sceneNode = instance as SceneNode;
  const symbolData = sceneNode.symbolData;

  if (!symbolData?.symbolID) {
    return null;
  }

  const symbolId = formatGUID(symbolData.symbolID as GUID);
  const textContent: InstanceTextContent[] = [];
  const elements: InstanceVisualElement[] = [];
  const sizes = new Map<string, { x: number; y: number }>();

  // Get raw symbolOverrides and derivedSymbolData
  const rawSymbolData = rawNodeChange?.symbolData as Record<string, unknown> | undefined;
  const symbolOverrides = (rawSymbolData?.symbolOverrides || symbolData.symbolOverrides || []) as unknown[];
  const derivedSymbolData = (rawNodeChange?.derivedSymbolData || []) as unknown[];

  // Extract sizes from derivedSymbolData
  for (const derived of derivedSymbolData) {
    if (!derived || typeof derived !== "object") continue;
    const d = derived as Record<string, unknown>;
    const guids = (d.guidPath as Record<string, unknown>)?.guids as unknown[] | undefined;
    const size = d.size as Record<string, number> | undefined;

    if (guids && size) {
      const path = guids.map((g: unknown) => {
        const guid = g as Record<string, number>;
        return `${guid.sessionID}:${guid.localID}`;
      }).join(">");
      sizes.set(path, { x: size.x, y: size.y });
    }
  }

  // Extract content from symbolOverrides
  for (const override of symbolOverrides) {
    if (!override || typeof override !== "object") continue;
    const o = override as Record<string, unknown>;

    const guidPath = guidPathToString(o.guidPath);

    // Extract text from componentPropAssignments
    const propAssignments = o.componentPropAssignments as unknown[] | undefined;
    if (propAssignments) {
      for (const assign of propAssignments) {
        if (!assign || typeof assign !== "object") continue;
        const a = assign as Record<string, unknown>;
        const value = a.value as Record<string, unknown> | undefined;
        const textValue = value?.textValue as Record<string, unknown> | undefined;
        const characters = textValue?.characters as string | undefined;

        if (characters) {
          // Get fill color for this text if available
          const fills = o.fillPaints as unknown[] | undefined;
          const fillColor = fills?.[0] ? extractColor(fills[0]) : undefined;

          textContent.push({
            text: characters,
            guidPath,
            fillColor,
          });

          // Also add as visual element
          const size = sizes.get(guidPath);
          elements.push({
            type: "text",
            guidPath,
            text: characters,
            size,
            fillColor,
            fontSize: o.fontSize as number | undefined,
            fontFamily: (o.fontName as Record<string, string> | undefined)?.family,
          });
        }
      }
    }

    // Extract direct text override (characters field)
    if (o.characters && typeof o.characters === "string") {
      const fills = o.fillPaints as unknown[] | undefined;
      const fillColor = fills?.[0] ? extractColor(fills[0]) : undefined;

      textContent.push({
        text: o.characters as string,
        guidPath,
        fillColor,
      });
    }

    // Extract rectangle/frame overrides (fills, strokes, cornerRadius)
    const fillPaints = o.fillPaints as unknown[] | undefined;
    const strokePaints = o.strokePaints as unknown[] | undefined;
    const cornerRadius = o.cornerRadius as number | undefined;

    if ((fillPaints || strokePaints) && !propAssignments) {
      const fillColor = fillPaints?.[0] ? extractColor(fillPaints[0]) : undefined;
      const strokeColor = strokePaints?.[0] ? extractColor(strokePaints[0]) : undefined;
      const size = sizes.get(guidPath);

      if (fillColor || strokeColor) {
        elements.push({
          type: "rectangle",
          guidPath,
          size,
          fillColor,
          strokeColor,
          cornerRadius,
        });
      }
    }
  }

  // Also extract from top-level componentPropAssignments
  const topLevelAssignments = rawNodeChange?.componentPropAssignments as unknown[] | undefined;
  if (topLevelAssignments) {
    for (const assign of topLevelAssignments) {
      if (!assign || typeof assign !== "object") continue;
      const a = assign as Record<string, unknown>;
      const value = a.value as Record<string, unknown> | undefined;
      const textValue = value?.textValue as Record<string, unknown> | undefined;
      const characters = textValue?.characters as string | undefined;

      if (characters) {
        textContent.push({
          text: characters,
          guidPath: "top-level",
        });
      }
    }
  }

  return {
    instance,
    symbolId,
    textContent,
    elements,
    sizes,
  };
}

/**
 * Get a flat list of all text content in an INSTANCE
 */
export function getInstanceTextList(resolved: ResolvedInstanceContent): string[] {
  return resolved.textContent.map(t => t.text);
}

/**
 * Format instance content for display
 */
export function formatInstanceContent(resolved: ResolvedInstanceContent): string {
  const lines: string[] = [];
  lines.push(`INSTANCE of ${resolved.symbolId}`);

  if (resolved.textContent.length > 0) {
    lines.push("Text content:");
    for (const text of resolved.textContent) {
      lines.push(`  - "${text.text}"`);
    }
  }

  if (resolved.elements.length > 0) {
    lines.push("Visual elements:");
    for (const el of resolved.elements) {
      if (el.type === "text") {
        const sizeStr = el.size ? ` [${el.size.x}x${el.size.y}]` : "";
        lines.push(`  - Text: "${el.text}"${sizeStr}`);
      } else {
        const sizeStr = el.size ? ` [${el.size.x}x${el.size.y}]` : "";
        lines.push(`  - Rectangle${sizeStr}`);
      }
    }
  }

  return lines.join("\n");
}
