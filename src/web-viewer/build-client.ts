/**
 * Build script for the web viewer client.
 * Bundles viewer.ts into a browser-compatible JavaScript file.
 * Also copies static assets to dist/ for npm package.
 */

import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcClientDir = path.join(__dirname, "client");
const distClientDir = path.join(__dirname, "../../dist/web-viewer/client");

function copyStaticFiles() {
  // Ensure dist directories exist
  fs.mkdirSync(path.join(distClientDir, "dist"), { recursive: true });

  // Copy static files to dist
  const staticFiles = ["index.html", "styles.css"];
  for (const file of staticFiles) {
    const src = path.join(srcClientDir, file);
    const dest = path.join(distClientDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`Copied ${file} to dist/`);
    }
  }
}

async function build() {
  const watch = process.argv.includes("--watch");

  // Build to src for dev, build to dist for production
  const srcOptions: esbuild.BuildOptions = {
    entryPoints: [path.join(srcClientDir, "viewer.ts")],
    outfile: path.join(srcClientDir, "dist/viewer.js"),
    bundle: true,
    minify: !watch,
    sourcemap: watch,
    target: ["chrome100", "firefox100", "safari15"],
    format: "iife",
    platform: "browser",
    logLevel: "info",
  };

  if (watch) {
    const ctx = await esbuild.context(srcOptions);
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    // Build to src/client/dist (for dev)
    await esbuild.build(srcOptions);

    // Also build to dist/web-viewer/client/dist (for npm package)
    copyStaticFiles();
    await esbuild.build({
      ...srcOptions,
      outfile: path.join(distClientDir, "dist/viewer.js"),
      sourcemap: false,
    });
    console.log("Build complete!");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
