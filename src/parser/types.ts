/**
 * Core types for .fig file parsing
 * These types represent the structure of .fig documents
 */

// GUID structure used throughout .fig files
export interface GUID {
  sessionID: number;
  localID: number;
}

// Node types in .fig documents
export type NodeType =
  | "DOCUMENT"
  | "CANVAS"
  | "FRAME"
  | "GROUP"
  | "VECTOR"
  | "BOOLEAN_OPERATION"
  | "STAR"
  | "LINE"
  | "ELLIPSE"
  | "REGULAR_POLYGON"
  | "RECTANGLE"
  | "TEXT"
  | "SLICE"
  | "COMPONENT"
  | "COMPONENT_SET"
  | "INSTANCE"
  | "STICKY"
  | "SHAPE_WITH_TEXT"
  | "CONNECTOR"
  | "SECTION"
  | "TABLE"
  | "TABLE_CELL"
  | "WIDGET"
  | "STAMP"
  | "HIGHLIGHT"
  | "WASHI_TAPE"
  | "EMBED"
  | "LINK_UNFURL"
  | "MEDIA"
  | "CODE_BLOCK";

// Color structure
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Vector/Point
export interface Vector {
  x: number;
  y: number;
}

export interface VectorPath {
  windingRule?: string;
  commandsBlob?: number;
  commands?: Array<string | number>;
  styleID?: number;
}

export interface VectorNetworkVertex {
  x: number;
  y: number;
  styleID?: number;
}

export interface VectorNetworkSegmentEndpoint {
  vertex: number;
  dx?: number;
  dy?: number;
}

export interface VectorNetworkSegment {
  start: VectorNetworkSegmentEndpoint;
  end: VectorNetworkSegmentEndpoint;
  styleID?: number;
}

export interface VectorNetwork {
  vertices?: VectorNetworkVertex[];
  segments?: VectorNetworkSegment[];
}

export interface VectorData {
  vectorNetworkBlob?: number;
  vectorNetwork?: VectorNetwork;
  normalizedSize?: Vector;
  styleOverrideTable?: unknown[];
}

// Transform matrix (2D affine transformation)
export interface Transform {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

// Rectangle bounds
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Layout constraints
export interface LayoutConstraint {
  vertical: "TOP" | "BOTTOM" | "CENTER" | "TOP_BOTTOM" | "SCALE";
  horizontal: "LEFT" | "RIGHT" | "CENTER" | "LEFT_RIGHT" | "SCALE";
}

// Auto layout properties
export interface LayoutMode {
  mode: "NONE" | "HORIZONTAL" | "VERTICAL";
  primaryAxisSizingMode: "FIXED" | "AUTO";
  counterAxisSizingMode: "FIXED" | "AUTO";
  primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems: "MIN" | "CENTER" | "MAX" | "BASELINE";
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  itemSpacing: number;
  counterAxisSpacing?: number;
  layoutWrap?: "NO_WRAP" | "WRAP";
}

// Paint/Fill types
export type PaintType =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE"
  | "EMOJI"
  | "VIDEO";

export interface GradientStop {
  position: number;
  color: Color;
}

export interface Paint {
  type: PaintType;
  visible?: boolean;
  opacity?: number;
  color?: Color;
  gradientStops?: GradientStop[];
  gradientTransform?: Transform;
  scaleMode?: "FILL" | "FIT" | "TILE" | "STRETCH";
  imageRef?: string;
  blendMode?: BlendMode;
}

// Effect types
export type EffectType =
  | "DROP_SHADOW"
  | "INNER_SHADOW"
  | "LAYER_BLUR"
  | "BACKGROUND_BLUR";

export interface Effect {
  type: EffectType;
  visible?: boolean;
  radius: number;
  color?: Color;
  offset?: Vector;
  spread?: number;
  blendMode?: BlendMode;
}

// Blend modes
export type BlendMode =
  | "PASS_THROUGH"
  | "NORMAL"
  | "DARKEN"
  | "MULTIPLY"
  | "LINEAR_BURN"
  | "COLOR_BURN"
  | "LIGHTEN"
  | "SCREEN"
  | "LINEAR_DODGE"
  | "COLOR_DODGE"
  | "OVERLAY"
  | "SOFT_LIGHT"
  | "HARD_LIGHT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

// Stroke properties
export interface StrokeWeights {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type StrokeAlign = "INSIDE" | "OUTSIDE" | "CENTER";
export type StrokeCap = "NONE" | "ROUND" | "SQUARE" | "LINE_ARROW" | "TRIANGLE_ARROW";
export type StrokeJoin = "MITER" | "BEVEL" | "ROUND";

// Corner radius
export interface CornerRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

// Text properties
export interface TextStyle {
  fontFamily: string;
  fontPostScriptName?: string;
  fontStyle?: "normal" | "italic" | "oblique";
  fontWeight: number;
  fontSize: number;
  textAlignHorizontal: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical: "TOP" | "CENTER" | "BOTTOM";
  letterSpacing: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightUnit: "PIXELS" | "FONT_SIZE_%" | "INTRINSIC_%";
  paragraphSpacing?: number;
  paragraphIndent?: number;
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textAutoResize?: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE";
}

// Derived text data - computed layout info for text wrapping
export interface TextBaseline {
  position: Vector;           // Position of baseline start
  width: number;              // Width of text on this line
  lineY: number;              // Y offset from start of text block
  lineHeight: number;         // Height of this line
  lineAscent: number;         // Ascent from baseline
  firstCharacter: number;     // Index of first character on this line
  endCharacter: number;       // Index after last character on this line
}

export interface DerivedTextData {
  layoutSize: Vector;         // Total size of the text block
  baselines: TextBaseline[];  // Per-line layout info for text wrapping
}

// Base node properties that all nodes share
export interface BaseNode {
  guid: GUID;
  type: NodeType;
  name: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  children?: FigNode[];
}

// Document-specific properties
export interface DocumentNode extends BaseNode {
  type: "DOCUMENT";
  children: CanvasNode[];
}

// Canvas/Page-specific properties
export interface CanvasNode extends BaseNode {
  type: "CANVAS";
  backgroundColor?: Color;
  children: SceneNode[];
}

// Scene node (anything on a canvas)
export interface SceneNode extends BaseNode {
  // Position and size
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  size?: Vector;  // Original size from fig data (x=width, y=height)
  rotation?: number;
  transform?: Transform;

  // Constraints and layout
  constraints?: LayoutConstraint;
  layoutMode?: LayoutMode;
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  layoutGrow?: number;
  layoutAlign?: "STRETCH" | "INHERIT";

  // Visual properties
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeWeights?: StrokeWeights;
  strokeAlign?: StrokeAlign;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  strokeDashes?: number[];
  cornerRadius?: number | CornerRadius;
  effects?: Effect[];
  isMask?: boolean;
  clipsContent?: boolean;

  // Text properties (for TEXT nodes)
  characters?: string;
  style?: TextStyle;
  derivedTextData?: DerivedTextData;

  // Component properties
  componentId?: GUID;
  mainComponent?: GUID;
  overrides?: Record<string, unknown>;

  // Vector properties
  vectorNetwork?: unknown;
  vectorPaths?: unknown;
  vectorData?: VectorData;
  fillGeometry?: VectorPath[];
  strokeGeometry?: VectorPath[];

  // Export settings
  exportSettings?: unknown[];
}

// Union type for all node types
export type FigNode = DocumentNode | CanvasNode | SceneNode;

// Parsed fig file structure
export interface ParsedFigFile {
  version: number;
  schema: unknown;
  document: DocumentNode;
  images: Map<string, Uint8Array>;
  thumbnail?: Uint8Array;
  blobs?: Array<{ bytes: Uint8Array }>;
  meta: FigMeta;
  rawMessage?: Record<string, unknown>;
}

// Meta.json structure
export interface FigMeta {
  name?: string;
  lastModified?: string;
  thumbnailUrl?: string;
  version?: string;
  [key: string]: unknown;
}

// Layout inference helpers
export interface InferredLayout {
  // Spacing
  gap?: number;
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  // Alignment
  horizontalAlign?: "left" | "center" | "right" | "space-between" | "space-around";
  verticalAlign?: "top" | "center" | "bottom" | "space-between" | "space-around";

  // Direction
  direction?: "row" | "column";
  wrap?: boolean;

  // Sizing
  widthMode?: "fixed" | "hug" | "fill";
  heightMode?: "fixed" | "hug" | "fill";
}

// Simplified effect representation for MCP responses
export interface SimplifiedEffect {
  type: EffectType;
  visible: boolean;
  color?: string;
  offset?: { x: number; y: number };
  radius: number;
  spread?: number;
  blendMode?: BlendMode;
}

// For MCP responses - simplified node representation
export interface SimplifiedNode {
  id: string;
  type: NodeType;
  name: string;
  bounds?: Rect;
  layout?: InferredLayout;
  style?: {
    backgroundColor?: string;
    borderRadius?: number | CornerRadius;
    borderWidth?: number;
    borderColor?: string;
    opacity?: number;
    shadow?: string;
    blur?: string;
  };
  effects?: SimplifiedEffect[];
  text?: {
    content: string;
    font: string;
    size: number;
    weight: number;
    color?: string;
    align?: string;
  };
  children?: SimplifiedNode[];
}
