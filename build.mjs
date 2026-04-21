import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: {
    bgScript: "src/bgScript/bgScript.js",
    contentScript: "src/contentScript/contentScript.js",
  },
  bundle: true,
  outdir: "public",
  format: "iife",
  target: ["chrome110"],
  platform: "browser",
  logLevel: "info",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("esbuild: watching for changes...");
} else {
  await esbuild.build(options);
}
