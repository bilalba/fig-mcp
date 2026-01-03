/**
 * Build script for the web viewer client.
 * Bundles viewer.ts into a browser-compatible JavaScript file.
 */

import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  const watch = process.argv.includes("--watch");

  const options: esbuild.BuildOptions = {
    entryPoints: [path.join(__dirname, "client/viewer.ts")],
    outfile: path.join(__dirname, "client/dist/viewer.js"),
    bundle: true,
    minify: !watch,
    sourcemap: watch,
    target: ["chrome100", "firefox100", "safari15"],
    format: "iife",
    platform: "browser",
    logLevel: "info",
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    await esbuild.build(options);
    console.log("Build complete!");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
