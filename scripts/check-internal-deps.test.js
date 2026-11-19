import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findMismatches, loadManifests } from "./check-internal-deps.js";

const SCRIPT = fileURLToPath(
  new URL("./check-internal-deps.js", import.meta.url),
);

const core = (version) => ({
  file: "packages/core/package.json",
  pkg: { name: "@context-os/core", version },
});
const cli = (pins, field = "dependencies") => ({
  file: "workspace-cli/package.json",
  pkg: { name: "@context-os/cli", version: "1.13.2", [field]: pins },
});

test("matching pins are fine", () => {
  assert.deepEqual(
    findMismatches([core("1.13.2"), cli({ "@context-os/core": "1.13.2" })]),
    [],
  );
});

test("the 1.13.2 mistake: cli pins a core version the repo does not have", () => {
  const problems = findMismatches([
    core("1.13.2"),
    cli({ "@context-os/core": "1.13.1" }),
  ]);
  assert.deepEqual(problems, [
    {
      file: "workspace-cli/package.json",
      field: "dependencies",
      dependency: "@context-os/core",
      pinned: "1.13.1",
      actual: "1.13.2",
    },
  ]);
});

test("every dependency field is checked", () => {
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const problems = findMismatches([
      core("1.13.2"),
      cli({ "@context-os/core": "1.0.0" }, field),
    ]);
    assert.equal(problems.length, 1, field);
    assert.equal(problems[0].field, field);
  }
});

test("a range is not an exact pin and is reported", () => {
  const problems = findMismatches([
    core("1.13.2"),
    cli({ "@context-os/core": "^1.13.2" }),
  ]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].pinned, "^1.13.2");
});

test("third-party packages and workspace-resolved specs are ignored", () => {
  const pins = {
    chalk: "^5.3.0",
    "@context-os/core": "workspace:*",
    "@context-os/other": "file:../other",
  };
  assert.deepEqual(findMismatches([core("1.13.2"), cli(pins)]), []);
});

test("a package that depends on a workspace missing from the list is not guessed at", () => {
  assert.deepEqual(findMismatches([cli({ "@context-os/core": "1.13.1" })]), []);
});

test("every mismatch is reported, not only the first", () => {
  const manifests = [
    core("2.0.0"),
    cli({ "@context-os/core": "1.9.0" }),
    {
      file: "workspace-mcp/package.json",
      pkg: {
        name: "@context-os/mcp",
        version: "2.0.0",
        dependencies: { "@context-os/core": "1.9.0" },
      },
    },
  ];
  assert.equal(findMismatches(manifests).length, 2);
});

function makeRepo(corePin) {
  const root = mkdtempSync(join(tmpdir(), "ctxos-deps-"));
  const write = (dir, pkg) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify(pkg));
  };
  write(".", {
    name: "context-os",
    version: "1.0.0",
    workspaces: ["packages/core", "workspace-cli"],
  });
  write("packages/core", { name: "@context-os/core", version: "1.13.2" });
  write("workspace-cli", {
    name: "@context-os/cli",
    version: "1.13.2",
    dependencies: { "@context-os/core": corePin },
  });
  return root;
}

test("manifests are the root plus every workspace listed in the root package.json", () => {
  const files = loadManifests(makeRepo("1.13.2")).map((m) => m.file);
  assert.deepEqual(files, [
    "package.json",
    "packages/core/package.json",
    "workspace-cli/package.json",
  ]);
});

test("a glob workspace is refused instead of silently skipped", () => {
  const root = makeRepo("1.13.2");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "x", version: "1", workspaces: ["packages/*"] }),
  );
  assert.throws(() => loadManifests(root), /glob/i);
});

test("the command line exits 1 with a fix hint on a stale pin, and 0 when fixed", () => {
  const stale = spawnSync(process.execPath, [SCRIPT, makeRepo("1.13.1")], {
    encoding: "utf8",
  });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /workspace-cli\/package\.json/);
  assert.match(stale.stderr, /@context-os\/core/);
  assert.match(stale.stderr, /1\.13\.1/);
  assert.match(stale.stderr, /sync-versions\.js 1\.13\.2/);

  const fine = spawnSync(process.execPath, [SCRIPT, makeRepo("1.13.2")], {
    encoding: "utf8",
  });
  assert.equal(fine.status, 0);
  assert.equal(fine.stderr, "");
});
