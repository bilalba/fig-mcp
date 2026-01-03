# Fig MCP Server

An MCP (Model Context Protocol) server for parsing Figma `.fig` files. This enables AI assistants to understand and extract design information from Figma's native file format.

## Features

- Parse `.fig` files without Figma API access
- Extract document structure, nodes, and hierarchy
- Infer layout properties (flexbox-like direction, gap, padding, alignment)
- Extract colors, text content, and styling information
- Find nodes by type or name
- Get detailed node information for implementation

## Installation

```bash
npm install
npm run build
```

## Usage

### As MCP Server

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "fig-mcp": {
      "command": "node",
      "args": ["/path/to/fig-mcp/dist/index.js"]
    }
  }
}
```

### CLI Inspector

```bash
# Show document structure
npx tsx src/inspect-fig.ts design.fig summary

# Show kiwi schema
npx tsx src/inspect-fig.ts design.fig schema

# Output simplified JSON
npx tsx src/inspect-fig.ts design.fig json

# Show node statistics
npx tsx src/inspect-fig.ts design.fig stats

# List archive contents
npx tsx src/inspect-fig.ts design.fig list
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `parse_fig_file` | Parse and return simplified document structure |
| `get_document_summary` | Text tree of document structure |
| `find_nodes` | Find nodes by type or name |
| `get_node_details` | Get details for a node path |
| `get_layout_info` | Get inferred layout properties |
| `list_pages` | List all pages |
| `get_page_contents` | Get contents of a page |
| `get_text_content` | Extract text content |
| `get_colors` | Extract color palette |

## How It Works

1. `.fig` files are ZIP archives containing `canvas.fig` (binary data), `meta.json`, and images
2. The `canvas.fig` uses Evan Wallace's [kiwi](https://github.com/evanw/kiwi) binary format
3. The kiwi schema is embedded in each file and extracted at parse time
4. Document data is decoded using the compiled schema
5. Layout properties are inferred from node positions and auto-layout settings

## Project Structure

```
fig-mcp/
├── src/
│   ├── parser/           # Fig file parsing
│   │   ├── fig-reader.ts    # ZIP extraction
│   │   ├── kiwi-parser.ts   # Binary parsing
│   │   ├── layout-inference.ts
│   │   └── types.ts
│   ├── mcp/
│   │   └── server.ts     # MCP server
│   ├── index.ts          # Entry point
│   └── inspect-fig.ts    # CLI tool
├── kiwi/                 # Cloned kiwi library
├── CLAUDE.md            # Development guide
└── TODO.md              # Project roadmap
```

## Limitations

- The `.fig` format is undocumented and may change
- Some complex properties (vector networks, gradients) may not be fully parsed
- Blob data (embedded images in fills) is not decoded
- This is for local `.fig` files only (use Figma API for cloud files)

## License

MIT

## Credits

- [Kiwi](https://github.com/evanw/kiwi) by Evan Wallace - Binary format library
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Protocol implementation
# fig-mcp
