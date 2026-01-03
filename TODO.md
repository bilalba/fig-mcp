# TODO - Fig MCP Server

## Phase 1: Core Parsing (Complete)

- [x] Set up project structure with TypeScript
- [x] Clone kiwi library for reference
- [x] Implement ZIP archive extraction for .fig files (using Central Directory for data descriptor support)
- [x] Implement kiwi binary parsing with deflate + zstd decompression
- [x] Create type definitions for node types
- [x] Implement basic MCP server with tools

## Phase 2: Testing & Refinement (Complete)

### Current Status
Successfully parsing both test files:
- `Duolingo Onboarding Screen Mascot Animation (Community).fig` - 860KB, version 25
- `AutoDevice (Copy).fig` - 128MB, 166 images, version 101 (13,292 nodes)

**Working:**
- ZIP extraction with Central Directory parsing
- Schema decompression (deflate) and parsing
- Data decompression (zstd for newer files, deflate for older)
- Schema parsing (252-530 definitions depending on version)
- Message decoding with proper root type detection
- Tree reconstruction from flat nodeChanges array using parentIndex
- Image tool checks via `npm test` (skips if test files missing)

**Fixed Issues:**
- [x] Root type detection was finding "NodeChange" before "Message" - fixed by searching for specific types in priority order
- [x] Tree building from flat nodeChanges - implemented `buildTreeFromNodeChanges()` that uses parentIndex.guid to reconstruct hierarchy

### Remaining Tasks
- [ ] While most of the vectors are rendering quite well in our renderer, the 457-1680 which contains a group of vectors are not rendered to the right scale. Rotation also looks correct. This is how size is specified for one of the vector in fig file: size: { x: 12.623249053955078, y: 7.349093914031982 }. Make sure you're adjusting the for the size field.
- [ ] Fix TypeScript build errors: unsafe casts in `src/debug-stroke-geom.ts`, `src/debug-vertex.ts`, `src/inspect-frame.ts`, and missing `vectorNetwork` field usage in `src/experimental/render-screen.ts`.
- [ ] Handle edge cases in node type mapping
- [ ] Add support for more node properties (size, transform, fills, strokes, etc.)
- [ ] Validate layout inference with real data

## Phase 3: Layout Intelligence

- [ ] Improve spacing inference accuracy
- [ ] Add grid/table layout detection
- [ ] Infer responsive breakpoints from frame variants
- [ ] Detect design patterns (cards, lists, headers, etc.)
- [ ] Generate CSS-ready layout suggestions

## Phase 4: Node Indexing & Fast Lookups

- [x] Create persistent GUID index (Map<string, FigNode>) during parsing
- [ ] Create name index (Map<string, FigNode[]>) for name-based searches
- [x] Add `get_node_by_id` MCP tool for O(1) GUID lookups
- [ ] Enable component instance → main component resolution via GUID
- [x] Preserve nodeIndex in cache alongside document tree

## Phase 5: Image Asset Access

### Research Complete ✅

**Image Storage Format:**
- Image filenames in `images/` folder are SHA-1 hashes (40 hex chars, 20 bytes)
- `fillPaints` with `type: "IMAGE"` contain:
  - `image.hash`: Object with keys "0"-"19" containing SHA-1 bytes
  - `imageThumbnail.hash`: Same format for thumbnail version
  - `originalImageWidth/Height`: Original image dimensions
  - `imageScaleMode`: "FILL", "FIT", etc.
- Converting 20 bytes to hex gives exact filename: `bytes.map(b => b.toString(16).padStart(2, '0')).join('')`
- Images are JPEG or PNG format (detected by magic bytes)
- Tested: 316 hashes matched 100% to filenames in archive

**Implementation Tasks:**
- [x] Add `hashBytesToHex()` utility to kiwi-parser.ts
- [x] Add `list_images` MCP tool - list all image hashes with metadata
- [x] Add `get_image` MCP tool - return base64-encoded image data
- [x] Add `get_thumbnail` MCP tool - return document thumbnail.png
- [ ] Enhance node details to include resolved image references

## Phase 6: Visual AI Support

- [ ] Expose thumbnail.png for document-level preview
- [ ] Return image references in simplified node output
- [ ] Consider adding image dimensions/format metadata
- [ ] Document workflow: get_node_details → get_image for visual context

## Phase 7: Enhanced Features

- [ ] Component/instance relationship tracking
- [ ] Style extraction (text styles, effect styles)
- [ ] Design token extraction
- [ ] Accessibility hints extraction

## Phase 8: Performance & Reliability

- [ ] Streaming for large files
- [ ] Better error messages with line context
- [ ] Schema version detection and compatibility
- [ ] Memory optimization for large documents

## Known Issues

- [x] Message decode returns minimal data - FIXED (was root type detection issue)
- [x] Image fills (fillPaints with image/imageHash) - RESEARCHED (SHA-1 hash → filename mapping confirmed)
- [ ] Vector networks not fully parsed

## Test Files

- `/Users/billy/Downloads/AutoDevice (Copy).fig` - 128MB, 166 images, version 101
- `/Users/billy/Downloads/Duolingo Onboarding Screen Mascot Animation (Community).fig` - 860KB
