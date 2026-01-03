You are an expert TypeScript engineer working in the repo /Users/billy/repo/fig-mcp.

Goal: complete the TODO items in TODO.md related to vector scaling in the renderer and TypeScript build errors.

Required tasks (in order):
1) Fix vector scaling in the renderer for node 457-1680: vectors render at the wrong scale, rotation is correct. The fig data includes a size field like:
   size: { x: 12.623249053955078, y: 7.349093914031982 }
   Ensure the renderer adjusts for the size field. Locate where the vector path bounds or transform are applied in src/experimental/render-screen.ts and update so the rendered vector size matches the size field when present.
2) Fix TypeScript build errors:
   - unsafe casts in src/debug-stroke-geom.ts
   - unsafe casts in src/debug-vertex.ts
   - unsafe casts in src/inspect-frame.ts
   - missing vectorNetwork field usage in src/experimental/render-screen.ts

Constraints:
- Keep changes minimal and focused on the tasks above.
- Prefer type-safe parsing and explicit checks over unsafe casts.
- Preserve existing behavior outside the specified issues.

Workflow:
- Start by reading TODO.md and CLAUDE.md for project context.
- Identify the current vector scaling logic and how size/transform/bounds are used.
- Apply a fix that respects size.x/size.y when rendering vectors (only where appropriate).
- Resolve the TypeScript errors with explicit types/guards.
- Run npm run build (or describe why you couldn’t run it) and note any remaining errors.

Deliverables:
- Code changes that fix vector scaling and TypeScript build errors.
- A short summary of what changed and why.
- If tests/build were not run, explain what to run.
