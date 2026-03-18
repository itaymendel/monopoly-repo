import fs from "fs";
import path from "path";
import { git } from "./git";

export interface MoveEntry {
  path: string;
  from: {
    repo: string;
    path: string;
    head: string;
    date: string;
  };
  commits_extracted: number;
}

export interface Manifest {
  moves: MoveEntry[];
}

const MANIFEST_NAME = ".monopoly.json";

export function readManifest(repoRoot: string): Manifest | null {
  const manifestPath = path.join(repoRoot, MANIFEST_NAME);
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as Manifest;
  } catch {
    return null;
  }
}

export function hasEntryForPath(
  manifest: Manifest | null,
  targetPath: string
): boolean {
  if (!manifest) return false;
  return manifest.moves.some((m) => m.path === targetPath);
}

export function updateManifest(
  repoRoot: string,
  entry: MoveEntry
): void {
  const manifestPath = path.join(repoRoot, MANIFEST_NAME);
  let manifest: Manifest;

  const existing = readManifest(repoRoot);
  if (existing) {
    manifest = existing;
    manifest.moves.push(entry);
  } else {
    manifest = { moves: [entry] };
  }

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8"
  );

  // Stage the manifest
  git(["add", MANIFEST_NAME], repoRoot);
}
