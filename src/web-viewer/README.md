# Fig Web Viewer

A local web-based viewer for `.fig` files. Browse the document tree, preview nodes visually, and copy node IDs for use with the MCP server.

## Quick Start

```bash
# Start with a .fig file
npm run viewer /path/to/design.fig

# Or start without a file (use UI to open)
npm run viewer

# Dev mode (watch for client changes)
npm run viewer:dev
```

Then open `http://localhost:3000`

## Architecture

```
Browser                          Local Server (Node.js)
┌─────────────────────┐          ┌─────────────────────────┐
│                     │          │                         │
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
│                     │          │                         │
└─────────────────────┘          └─────────────────────────┘
```

## Features

### Tree Navigation
- Collapsible node tree with type icons
- Color-coded by node type (FRAME, TEXT, VECTOR, etc.)
- Search/filter nodes by name, type, or ID
- Auto-expands first 2 levels

### SVG Preview
- Server-side rendering using existing `renderScreen()`
- Renders frames, text, vectors, rectangles, images
- Proper transform composition for nested/rotated elements
- Zoom controls: +/- buttons, scroll wheel (Ctrl+scroll), keyboard (+/-/0)
- Fit-to-view button

### Node Details Panel
- Node ID with one-click copy (for MCP tool calls)
- Type and name display
- Bounding box (x, y, width, height)
- Text content preview (for TEXT nodes)
- Full JSON dump of node properties

### Image Handling
- Images served on-demand via `/api/images/:hash`
- Browser handles lazy loading via `<image href="...">` in SVG
- Automatic format detection (PNG, JPEG, WebP)
- Long cache headers for efficiency

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Check if a file is loaded |
| `/api/open` | POST | Load a .fig file `{ filePath: "..." }` |
| `/api/tree` | GET | Get full document tree as JSON |
| `/api/node/:id` | GET | Get detailed properties for a node |
| `/api/render/:id` | GET | Render node subtree as SVG |
| `/api/images/:hash` | GET | Get image blob by hash |

## File Structure

```
src/web-viewer/
├── server.ts           # HTTP server (wraps existing parser/renderer)
├── build-client.ts     # esbuild bundler for client code
├── README.md           # This file
└── client/
    ├── index.html      # Main UI shell
    ├── styles.css      # Dark theme styling
    ├── viewer.ts       # Client-side logic
    └── dist/
        └── viewer.js   # Bundled output (~7KB)
```

## Usage with MCP

1. Open your .fig file in the viewer
2. Navigate the tree to find the node you want
3. Click a node to see its preview and details
4. Click "Copy" next to the node ID
5. Use the ID with MCP tools like `render_screen` or `get_node_by_id`

Example MCP tool call:
```json
{
  "tool": "render_screen",
  "arguments": {
    "filePath": "/path/to/design.fig",
    "nodeId": "457:1607"
  }
}
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Fit to view |
| `Ctrl+Scroll` | Zoom with mouse wheel |

## Dependencies

Uses existing fig-mcp infrastructure:
- `parseFigFile()` - Parse .fig archives
- `buildNodeIdIndex()` - Index nodes by GUID
- `renderScreen()` - SVG rendering
- `formatGUID()` - Node ID formatting

No additional runtime dependencies beyond what fig-mcp already uses.
