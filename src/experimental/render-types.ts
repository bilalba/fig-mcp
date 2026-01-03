/**
 * Shared types for the SVG renderer modules
 */

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
  background?: string;
  scale?: number;
};

export type RenderScreenResult = {
  svg: string;
  width: number;
  height: number;
  warnings: string[];
};

export const DEFAULT_RENDER_OPTIONS: Required<RenderScreenOptions> = {
  maxDepth: 200,
  includeText: true,
  includeFills: true,
  includeStrokes: true,
  includeImages: false,
  background: "",
  scale: 1,
};

export const IDENTITY_TRANSFORM: TransformMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};
