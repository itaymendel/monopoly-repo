/**
 * Bundles src/main.ts into a single Node-compatible JS file with a shebang,
 * ready for npm publishing and `npx` usage.
 */
import fs from "fs";

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: "dist",
  target: "node",
  naming: "cli.js",
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const output = "dist/cli.js";
const content = fs.readFileSync(output, "utf-8");
fs.writeFileSync(output, `#!/usr/bin/env node\n${content}`);
fs.chmodSync(output, 0o755);

console.log(`Built ${output} (${(fs.statSync(output).size / 1024).toFixed(1)} KB)`);
