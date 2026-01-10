/**
 * Shared types for the SVG renderer modules
 */

import type { FigNode } from "../parser/types.js";

export type TransformMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type BlobEntry = {
  bytes: Uint8Array;
};

export type RenderContext = {
  defs: string[];
  clipCounter: number;
  shadowCounter: number;
  warnings: string[];
};

export type PathCommand = {
  cmd: number;
  values: number[];
};

export type RenderScreenOptions = {
  maxDepth?: number;
  includeText?: boolean;
  includeFills?: boolean;
  includeStrokes?: boolean;
  includeImages?: boolean;
  includeShadows?: boolean;
  background?: string;
  scale?: number;
  /** Node index for resolving INSTANCE references. Required to render INSTANCE children. */
  nodeIndex?: Map<string, FigNode>;
  /** Raw node index for accessing symbolOverrides data. Required for INSTANCE content resolution. */
  rawNodeIndex?: Map<string, Record<string, unknown>>;
};

export type RenderScreenResult = {
  svg: string;
  width: number;
  height: number;
  warnings: string[];
};

export const DEFAULT_RENDER_OPTIONS: Required<Omit<RenderScreenOptions, 'nodeIndex' | 'rawNodeIndex'>> & Pick<RenderScreenOptions, 'nodeIndex' | 'rawNodeIndex'> = {
  maxDepth: 200,
  includeText: true,
  includeFills: true,
  includeStrokes: true,
  includeImages: false,
  includeShadows: true,
  background: "",
  scale: 1,
  nodeIndex: undefined,
  rawNodeIndex: undefined,
};

export const IDENTITY_TRANSFORM: TransformMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};
