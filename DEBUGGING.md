# Debugging Notes

This file captures the renderer debugging workflow used so far for the experimental screen renderer. The goal is to make it easy to reproduce the same diagnosis steps and keep iteration fast.

## Core workflow

1) Identify the exact node in the .fig (GUID) that looks wrong.
2) Inspect raw node fields directly from canvas.fig (not just parsed nodes).
3) Confirm parsed values match raw data for the fields involved.
4) Re-render a single node in isolation and iterate.

## Useful one-off inspections

### Inspect a single node (parsed tree)
- Scripted via `parseFigFile` and a GUID index walk.
- Used to verify `x`, `y`, `width`, `height`, `fills`, `strokes`, `characters`, `transform`.

Example:
- Inspect `457:1684` to confirm size + transform.
- Inspect `457:1708` to confirm image fill.

### Inspect a single node (raw message)
- Scripted via `readFigFile` + `parseCanvasFig` and scanning `message.nodeChanges`.
- Used to confirm fields that weren’t being preserved (e.g., `transform`, `strokeCap`, `strokeJoin`, `strokePaints`, `fillGeometry.commands`).

### Inspect path command geometry
- For vector nodes, checked `fillGeometry.commandsBlob` or `fillGeometry.commands` to understand actual geometry.
- Computed command bounds to compare with node `size` and `vectorData.normalizedSize`.

### Check ordering / clipping
- Used `parentIndex.position` to understand draw order issues when backgrounds cover children.
- For `457:1707`, found a white fill using `blendMode: SATURATION` that was incorrectly rendered as opaque white.

### Extract image fills
- Search for IMAGE paint nodes to verify the PNG exists in the archive.
- Confirm image hash exists in the archive `images` map.

## Common issues found

1) Missing `transform`
- Fix: preserve `transform` in `convertToFigNode()`.

2) Vector geometry decoding
- Some nodes use `fillGeometry.commands` (array tokens) instead of `commandsBlob`.
- Fix: decode both forms.

3) Rotation / scale misalignment
- Cause: mixing world bounds with local geometry.
- Fix: use command bounds for scaling and compose local transforms with parent transforms.

4) Stroke thickness mismatch
- Cause: not preserving `strokeCap`/`strokeJoin` or using wrong scale.
- Fix: preserve stroke cap/join and scale by command bounds where needed.

5) PNG visibility
- Cause: image clipped/covered by background blends.
- Fix: skip non-NORMAL blendMode fills; fix clip path units; verify clip path coords.

## Quick re-render paths

- Render a single node in isolation:
  - `output/render-457-1680.svg`
- Render the full screen:
  - `output/render-457-1607.svg`

## Next debugging checks

- If an image is missing but present in SVG source:
  - Confirm `href` has non-empty data.
  - Confirm `clip-path` path coordinates overlap the image.
  - Check viewer support for `href` vs `xlink:href`.

- If a vector is offset/scaled wrong:
  - Compare `commandBounds` size to node `size` and `vectorData.normalizedSize`.
  - Verify the transform matrix composition for parent + child.
