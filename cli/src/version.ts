// Stamped at build time from package.json via Bun's `define` (see
// scripts/build-npm.ts). Falls back to "dev" for local `bun run`.
export const VERSION = process.env.MONOPOLY_VERSION ?? "dev";
