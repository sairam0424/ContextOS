#!/usr/bin/env node
// Fails when a workspace package depends on another workspace package at a version the repo does
// not have. This is the mistake behind @context-os/cli@1.13.2 and @context-os/mcp@1.13.2, which
// pinned @context-os/core@1.13.1: a version that was never published, so `npm install` failed
// with ETARGET.
//
// Usage:  node scripts/check-internal-deps.js [rootDir]
// Fix:    node scripts/sync-versions.js <version>   (it updates every manifest and the core pin)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
// Specs the package manager resolves to the local workspace, so there is no version to compare.
const LOCAL_SPEC = /^(workspace|file|link):/;

/**
 * @param {{ file: string, pkg: object }[]} manifests the root manifest and every workspace manifest
 * @returns {{ file: string, field: string, dependency: string, pinned: string, actual: string }[]}
 */
export function findMismatches(manifests) {
  const versions = new Map(manifests.map(({ pkg }) => [pkg.name, pkg.version]));
  const mismatches = [];
  for (const { file, pkg } of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependency, pinned] of Object.entries(pkg[field] ?? {})) {
        if (!versions.has(dependency) || LOCAL_SPEC.test(pinned)) continue;
        if (pinned !== versions.get(dependency)) {
          mismatches.push({
            file,
            field,
            dependency,
            pinned,
            actual: versions.get(dependency),
          });
        }
      }
    }
  }
  return mismatches;
}

/** The root manifest plus the manifest of every workspace the root package.json lists. */
export function loadManifests(root) {
  const read = (file) => ({
    file,
    pkg: JSON.parse(readFileSync(resolve(root, file), "utf8")),
  });
  const rootManifest = read("package.json");
  const workspaces = rootManifest.pkg.workspaces ?? [];
  for (const workspace of workspaces) {
    if (workspace.includes("*")) {
      throw new Error(
        `workspace "${workspace}" is a glob; list workspaces explicitly or extend this check`,
      );
    }
  }
  return [
    rootManifest,
    ...workspaces.map((workspace) => read(`${workspace}/package.json`)),
  ];
}

function main(argv) {
  const root = resolve(
    argv[2] ?? fileURLToPath(new URL("..", import.meta.url)),
  );
  const mismatches = findMismatches(loadManifests(root));
  if (mismatches.length === 0) {
    console.log("Internal dependency pins match the workspace versions.");
    return 0;
  }
  for (const { file, field, dependency, pinned, actual } of mismatches) {
    console.error(
      `${file}: ${field}["${dependency}"] is "${pinned}" but the workspace is at ${actual}`,
    );
  }
  const [{ actual }] = mismatches;
  console.error(`Fix: node scripts/sync-versions.js ${actual}`);
  return 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv);
}
