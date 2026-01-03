# Screen Renderer (Experimental)

This file documents the experimental SVG renderer used to visualize .fig node subtrees.

## Purpose

The renderer is a rough, deterministic SVG output of a node subtree. It is not a perfect renderer, but is useful for quick visual inspection, debugging, and extracting approximate layout/visual structure.

## Implementation

- Source: `src/experimental/render-screen.ts`
- Uses `vectorNetworkBlob` for centerline extraction when available
- Renders strokes as true SVG strokes (not filled outlines)
- Better handling of simple line vectors

## Entry points

- Renderer source: `src/experimental/render-screen.ts`
- MCP tool: `render_screen` in `src/mcp/server.ts`
- Test script: `src/render-single.ts` (renders single node by ID)

## Render pipeline

1) Collect subtree bounds to set SVG viewBox.
2) Walk the node tree in paint order.
3) For each node:
   - Extract bounds.
   - Render fills/strokes/text/images if present.
   - Render vector geometry when available.
4) Emit SVG `<defs>` for clip paths.

## Supported features

- Rects (fills, strokes, corner radius)
- Text (font family, size, weight, style, letter spacing)
- Images (IMAGE paints with `image.hash` in archive)
- Vectors (fill/stroke geometry from `commandsBlob` or `commands` array)
- Blend mode handling (currently skips non-NORMAL SOLID fills)
- Clip paths for `clipsContent` and `isMask`
- Transform matrices (compose parent + child transforms)

## Vector handling details

- `fillGeometry`/`strokeGeometry` path commands decoded from:
  - `commandsBlob` (binary in `message.blobs`)
  - `commands` (array tokens)
- Scale is derived from command bounds (preferred) or `vectorData.normalizedSize`.
- Path coordinates are transformed using the node's `transform` matrix.
- Stroke caps/joins preserved; `strokeAlign=INSIDE` uses clip path.

### Stroked vectors
The renderer uses a separate path for stroked vectors:

1. **Centerline from vectorNetworkBlob**: Decodes the actual path vertices from the binary blob
2. **Fallback to normalizedSize**: For simple lines, creates path from (0,0) to (normalizedSize.x, normalizedSize.y)
3. **SVG stroke attributes**: Uses `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin` instead of filled outlines

#### vectorNetworkBlob format
```
Header (12 bytes):
  - vertexCount (uint32 LE)
  - segmentCount (uint32 LE)
  - regionCount (uint32 LE)

Vertex data (16 bytes each):
  - x (float32 LE)
  - y (float32 LE)
  - handle/flags data (8 bytes)

Segment data (24 bytes each):
  - startIndex (uint32 LE) at offset +0
  - control point 1 data (12 bytes)
  - endIndex (uint32 LE) at offset +16
  - control point 2 data (4 bytes)
```

#### Validation
- Filters degenerate segments (start == end)
- Validates vertex bounds against normalizedSize
- Falls back to normalizedSize diagonal when parsing produces invalid results

## Image handling details

- IMAGE paints use `image.hash` to fetch asset from `images/` in the archive.
- Images are embedded in SVG as base64 data.
- Clipping uses the vector path (if present) or node bounds.

## Known limitations

- No blend mode compositing (non-NORMAL fills are skipped).
- No vector boolean ops (BOOLEAN_OPERATION not fully merged).
- Some layout constraints not represented.
- Image transforms beyond basic scale/fit not fully supported.
- Complex multi-segment paths with curved control points not fully decoded.
- Segment format varies for shapes with regions vs without.
- Falls back to diagonal line (normalizedSize) for complex shapes with invalid vertex data.

## Debugging helpers

- See `DEBUGGING.md` for the live debugging workflow.
- Isolated renders are written to `output/` during debugging:
  - `output/render-457-1680.svg`
  - `output/render-457-1607.svg`

## MCP tool

Tool name: `render_screen`

Input:
- `filePath` (string)
- `nodeId` (GUID string)
- `options` (object)
  - `maxDepth`, `includeText`, `includeFills`, `includeStrokes`, `includeImages`, `background`, `scale`

Output:
- `{ svg, width, height, warnings }`

## Files touched (renderer)

### Core files
- `src/experimental/render-screen.ts`
- `src/parser/kiwi-parser.ts`
- `src/parser/types.ts`
- `src/parser/index.ts`
- `src/mcp/server.ts`

### Test/debug files
- `src/test-render.ts` - Test renderer on specific nodes
- `src/render-single.ts` - Render single node by ID
- `src/inspect-frame.ts` - Inspect frame children and vector data
- `src/debug-vertex.ts` - Debug vertex parsing
- `src/debug-stroke-geom.ts` - Debug strokeGeometry data
