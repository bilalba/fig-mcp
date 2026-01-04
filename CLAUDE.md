# Fig MCP Server

## Project Overview

An MCP (Model Context Protocol) server for parsing `.fig` files. This enables AI assistants to understand and extract design information from the `.fig` file format for implementation guidance.

## Architecture

### Core Components

1. **Parser** (`src/parser/`)
   - `fig-reader.ts` - ZIP archive extraction using Central Directory (handles data descriptors)
   - `kiwi-parser.ts` - Binary kiwi format parsing with deflate + zstd decompression
   - `layout-inference.ts` - Converts raw node data to structured layout information
   - `types.ts` - TypeScript type definitions for `.fig` document structure

2. **MCP Server** (`src/mcp/`)
   - `server.ts` - MCP server implementation with tools for querying fig files

3. **Utilities**
   - `inspect-fig.ts` - CLI tool for inspecting fig files during development
   - `test-parser.ts` - Local tool-flow test harness for image tools

4. **Renderer** (`src/renderer/`)
   - `render-screen.ts` - Main SVG renderer for node subtrees
   - `render-types.ts` - TypeScript types for rendering
   - `render-utils.ts` - Transform, path building, and XML utilities
   - `paint-utils.ts` - Paint/fill/stroke handling
   - `vector-renderer.ts` - Vector path decoding and rendering
   - `screenshot.ts` - SVG to PNG conversion via resvg
   - `index.ts` - Public exports for the renderer module

5. **Web Viewer** (`src/web-viewer/`)
   - `server.ts` - HTTP server wrapping existing parser/renderer
   - `build-client.ts` - esbuild bundler for client code
   - `client/` - Browser-based UI (index.html, styles.css, viewer.ts)

## File Format Details

### .fig Archive Structure
`.fig` files are ZIP archives. **Important**: They use data descriptors (flag bit 3), so sizes must be read from Central Directory, not local headers.

Contents:
- `canvas.fig` - Main document data (kiwi binary format, compressed)
- `meta.json` - File metadata (name, background color, etc.)
- `thumbnail.png` - Preview image
- `images/` - Image assets (hash-named files)
- `videos/` - Video assets (if any)

### canvas.fig Binary Format
```
[header: "fig-kiwi" (8 bytes)]
[version: uint32 LE (4 bytes)]
[schema_compressed_length: uint32 LE (4 bytes)]
[schema_compressed: deflate-raw compressed binary kiwi schema]
[data_compressed_length: uint32 LE (4 bytes)]
[data_compressed: zstd compressed document data]
```

**Compression:**
- Schema chunk: deflate-raw (use `pako.inflateRaw`)
- Data chunk: zstd (use `fzstd.decompress`) - detected by magic `0xFD2FB528`

### Kiwi Schema (v101)

The schema has **530 definitions** including:

**Key Enums:**
- `NodeType`: DOCUMENT, CANVAS, FRAME, GROUP, TEXT, RECTANGLE, ELLIPSE, VECTOR, COMPONENT, INSTANCE, etc.
- `BlendMode`: NORMAL, MULTIPLY, SCREEN, OVERLAY, etc.
- `PaintType`: SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL, IMAGE, VIDEO, etc.

**Key Messages:**
- `Message`: Root message with `nodeChanges: NodeChange[]`
- `NodeChange`: Contains ALL node properties (guid, type, name, size, transform, fills, strokes, effects, text data, layout, etc.)

### Image Storage

Images are stored in the `images/` folder with SHA-1 hash filenames (40 hex chars).

**fillPaints with type "IMAGE":**
```typescript
{
  type: "IMAGE",
  image: {
    hash: { "0": 225, "1": 2, ..., "19": 90 },  // 20 bytes = SHA-1
    name: "image"
  },
  imageThumbnail: {
    hash: { "0": 35, "1": 57, ..., "19": 191 },  // Thumbnail version
    name: "image"
  },
  originalImageWidth: 993,
  originalImageHeight: 4096,
  imageScaleMode: "FILL",  // or "FIT", "TILE", etc.
  scale: 0.5,
  rotation: 0
}
```

**Hash to filename conversion:**
```typescript
function hashBytesToHex(hash: Record<string, number>): string {
  const bytes = [];
  for (let i = 0; i < 20; i++) bytes.push(hash[String(i)]);
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}
// Result: "e10220e0eb8a423d480ad3937e0efa004848af5a"
```

### Parsing Details

**Fixed Issues:**
1. Root type detection - Was finding "NodeChange" before "Message" in schema definitions. Fixed by searching for specific types ("Message", "Document", etc.) in priority order.
2. Tree reconstruction - NodeChanges is a flat array. Each node has a `parentIndex.guid` that references its parent. Implemented `buildTreeFromNodeChanges()` to rebuild the tree hierarchy.

## Key Commands

```bash
# Development
npm run dev        # Start MCP server in watch mode
npm run build      # Build TypeScript to dist/

# Web Viewer
npm run viewer /path/to/design.fig    # Start viewer with a file
npm run viewer                         # Start viewer (open file via UI)
npm run viewer:dev                     # Dev mode (watch for client changes)
# Then open http://localhost:3000

# Testing/Inspection
npm test                                # Image tool checks (skips if files missing)
npx tsx src/inspect-fig.ts <file.fig> list      # Archive contents
npx tsx src/inspect-fig.ts <file.fig> schema    # Kiwi schema (530 defs)
npx tsx src/inspect-fig.ts <file.fig> summary   # Document structure
npx tsx src/inspect-fig.ts <file.fig> raw       # Raw decoded message
npx tsx src/inspect-fig.ts <file.fig> stats     # Node type counts
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `parse_fig_file` | Parse fig file and return simplified document structure |
| `get_document_summary` | Text tree of document structure |
| `find_nodes` | Find nodes by type or name |
| `get_node_details` | Get details for a specific node path |
| `get_layout_info` | Get inferred layout properties |
| `list_pages` | List all pages in document |
| `get_page_contents` | Get contents of a specific page |
| `get_text_content` | Extract all text content |
| `get_colors` | Extract color palette |
| `get_schema_info` | Kiwi schema debugging info |
| `get_raw_message` | Raw decoded message (debugging) |
| `list_archive_contents` | List files in fig archive |
| `list_images` | List all image hashes with metadata |
| `get_image` | Return base64-encoded image data |
| `get_thumbnail` | Return document thumbnail.png |
| `render_screen` | Render node subtree as PNG screenshot |
| `get_vector` | Export vector node as SVG, PDF, PNG, or WebP |

## Dependencies

- `kiwi-schema` - Evan Wallace's kiwi binary format library
- `pako` - zlib/deflate decompression
- `fzstd` - zstd decompression (data chunks use this)
- `@modelcontextprotocol/sdk` - MCP server SDK
- `@resvg/resvg-js` - SVG to PNG rasterization (for get_vector PNG output)
- `pdfkit` + `svg-to-pdfkit` - Vector PDF generation (for get_vector PDF output)

## Test Files

Tested with:
- `AutoDevice (Copy).fig` - 128MB, 166 images, version 101
- Schema parsed successfully with 530 definitions
- Data decompresses from 3.3MB compressed to larger (zstd)
- `npm test` uses `/Users/billy/Downloads/AutoDevice (Copy).fig` and `/Users/billy/Downloads/Duolingo Onboarding Screen Mascot Animation (Community).fig` when present

## References

- [Kiwi Format](https://github.com/evanw/kiwi) - Binary format (cloned to `./kiwi/`)
- [fig-kiwi npm](https://www.npmjs.com/package/fig-kiwi) - Reference implementation
- Fig file analysis (Korean)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Next Steps

1. **Improve layout inference**
   - Validate with real design data
   - Detect flex/grid layouts
   - Infer spacing patterns

2. **Better type mappings**
   - Handle more node types (COMPONENT, INSTANCE, etc.)
   - Extract component/instance relationships

3. **Enhanced effect rendering**
   - Support multiple shadows per node (currently renders first only)
   - Combine drop shadows and inner shadows together
   - Layer blur and background blur support in renderer

## Screen Renderer

SVG renderer for node subtrees.

- Code: `src/renderer/render-screen.ts`
- MCP tool: `render_screen` in `src/mcp/server.ts`
- Debugging docs: `DEBUGGING.md`
- Renderer docs: `RENDERER.md`

### Implementation notes:
- Modular architecture with separate files for paint, vector, and utility functions
- Preserves `transform`, `strokeCap`, `strokeJoin`, `strokeAlign`, `fillGeometry`, `strokeGeometry`, `vectorData`
- Vector paths decode from both `commandsBlob` and `commands` arrays
- Uses vectorNetworkBlob or normalizedSize for stroked vector centerlines (not strokeGeometry)
- Parent + child transforms are composed for rotation/position
- Masks (`isMask` flag) and `clipsContent` are emitted as SVG clip paths
- Images are embedded as base64 with proper scale mode handling
- Full text styling support (font-style, letter-spacing, multi-line, alignment)
- **Shadow rendering**: DROP_SHADOW and INNER_SHADOW effects are rendered using SVG filters
  - `feDropShadow` for simple shadows without spread
  - `feMorphology` + `feGaussianBlur` + `feOffset` for shadows with spread
  - Inner shadows use inverted alpha + composite clipping
  - Shadows are applied to entire node subtrees (node + children)
  - Enabled by default via `includeShadows: true` option

### Effect Support in MCP:
- `get_node_details` and `get_node_by_id` return an `effects` array with structured data:
  ```json
  {
    "effects": [
      {
        "type": "DROP_SHADOW",
        "visible": true,
        "color": "rgba(13, 197, 124, 1.000)",
        "offset": { "x": 6, "y": 6 },
        "radius": 0,
        "spread": 0,
        "blendMode": "NORMAL"
      }
    ]
  }
  ```
- Use `includeEffects: false` to exclude effects from the response

### Testing:
```bash
npx tsx src/render-single.ts "457:1607"
```

## Vector Export Tool

The `get_vector` MCP tool exports individual vector nodes in multiple formats:

### Usage

```typescript
// Get SVG (returns inline SVG string)
get_vector({ filePath: "/path/to.fig", nodeId: "457:1682", format: "svg" })

// Get PDF (returns base64-encoded vector PDF, ideal for iOS)
get_vector({ filePath: "/path/to.fig", nodeId: "457:1682", format: "pdf" })

// Get PNG (requires width/height, returns base64-encoded raster)
get_vector({ filePath: "/path/to.fig", nodeId: "457:1682", format: "png", width: 100, height: 100 })
```

### Supported Formats

| Format | Output | Use Case |
|--------|--------|----------|
| `svg` | Inline SVG string | Web, general vector graphics |
| `pdf` | Base64 vector PDF | iOS apps (CAShapeLayer), print |
| `png` | Base64 raster image | Rasterized icons, thumbnails |
| `webp` | Base64 raster image | Requires `sharp` package |

### Parameters

- `filePath` (required): Path to the .fig file
- `nodeId` (required): Node GUID (e.g., "457:1682")
- `format` (required): "svg", "pdf", "png", or "webp"
- `width` (required for png/webp): Output width in pixels
- `height` (required for png/webp): Output height in pixels
- `includeStyles` (optional, default: true): Include fill/stroke from node

### Supported Node Types

- VECTOR, LINE, STAR, ELLIPSE, REGULAR_POLYGON, BOOLEAN_OPERATION
- Any node with `fillGeometry` or `strokeGeometry`

### Implementation

- Code: `src/vector-export.ts`
- Uses existing vector decoding from `src/renderer/vector-renderer.ts`
- PDF generation: `pdfkit` + `svg-to-pdfkit`
- PNG rasterization: `@resvg/resvg-js`

## Web Viewer

A local web-based viewer for `.fig` files. Browse the document tree, preview nodes visually, and copy node IDs for use with MCP tools.

### Architecture

```
Browser                          Local Server (Node.js)
┌─────────────────────┐          ┌─────────────────────────┐
│  Tree View          │◄────────►│  GET /api/tree          │
│  (collapsible)      │  JSON    │  (parsed node tree)     │
│                     │          │                         │
│  SVG Preview        │◄────────►│  GET /api/render/:id    │
│  (pan/zoom)         │  SVG     │  (renderScreen output)  │
│                     │          │                         │
│  Details Panel      │◄────────►│  GET /api/node/:id      │
│  (properties/JSON)  │  JSON    │  (full node details)    │
│                     │          │                         │
│  <image> elements   │◄────────►│  GET /api/images/:hash  │
│  (lazy loaded)      │  binary  │  (image blobs on demand)│
└─────────────────────┘          └─────────────────────────┘
```

### Features

- **Tree Navigation**: Collapsible node tree with type icons, color-coded by node type (FRAME, TEXT, VECTOR, etc.), search/filter by name/type/ID
- **SVG Preview**: Server-side rendering via `renderScreen()`, zoom controls (+/- buttons, Ctrl+scroll, keyboard +/-/0), fit-to-view
- **Node Details Panel**: One-click copy of node ID (for MCP tool calls), bounding box, text content preview, full JSON dump
- **Image Handling**: Images served on-demand via `/api/images/:hash`, lazy loading, automatic format detection

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Check if a file is loaded |
| `/api/open` | POST | Load a .fig file `{ filePath: "..." }` |
| `/api/tree` | GET | Get full document tree as JSON |
| `/api/node/:id` | GET | Get detailed properties for a node |
| `/api/render/:id` | GET | Render node subtree as SVG |
| `/api/images/:hash` | GET | Get image blob by hash |

### Usage with MCP

1. Open your .fig file in the viewer
2. Navigate the tree to find the node you want
3. Click a node to see its preview and details
4. Click "Copy" next to the node ID
5. Use the ID with MCP tools like `render_screen` or `get_node_by_id`

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Fit to view |
| `Ctrl+Scroll` | Zoom with mouse wheel |
