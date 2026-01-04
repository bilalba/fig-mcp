/**
 * Renderer module - SVG rendering for .fig nodes
 *
 * This module provides functionality to render .fig document nodes to SVG format,
 * with support for vector paths, text, images, shadows, and other visual effects.
 */

// Main render function
export { renderScreen } from "./render-screen.js";
export type { RenderScreenOptions, RenderScreenResult } from "./render-screen.js";

// Screenshot generation
export { generateScreenshot } from "./screenshot.js";
export type { ScreenshotOptions } from "./screenshot.js";

// Types
export type {
  TransformMatrix,
  BlobEntry,
  RenderContext,
  PathCommand,
} from "./render-types.js";
export { DEFAULT_RENDER_OPTIONS, IDENTITY_TRANSFORM } from "./render-types.js";

// Utilities (for advanced use cases like vector-export)
export {
  escapeXml,
  multiplyTransforms,
  getLocalTransform,
  transformPoint,
  computeCommandBounds,
  buildSvgPath,
} from "./render-utils.js";

// Paint utilities
export {
  getPaints,
  getVisiblePaint,
  paintToColor,
  normalizeImageHash,
  paintToImageHash,
  detectImageFormat,
  getMimeType,
} from "./paint-utils.js";

// Vector rendering
export {
  isStrokedVector,
  renderStrokedVector,
  renderFilledVector,
  decodePathCommands,
  decodePathCommandsFromArray,
} from "./vector-renderer.js";
