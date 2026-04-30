import assert from "node:assert";
import { validatePath, findWorkspaceRoot, ALLOWED_BUCKETS, isReadOnly } from "../index.js";
import path from "node:path";

describe("Core Security Engine", () => {
  const workspaceRoot = findWorkspaceRoot();

  it("should discover the workspace root (contains root/soul.md)", () => {
    assert.strictEqual(typeof workspaceRoot, "string");
    assert.notStrictEqual(workspaceRoot, "/");
  });

  it("should allow paths within projects directory", () => {
    const validPath = path.join(workspaceRoot, "projects", "TestProject", "memory.md");
    assert.doesNotThrow(() => validatePath(validPath));
  });

  it("should block directory traversal attacks (..)", () => {
    const maliciousPath = path.join(workspaceRoot, "projects", "..", "..", "package.json");
    assert.throws(() => validatePath(maliciousPath), /Security violation/);
  });

  it("should block access to root config files (package.json)", () => {
    const rootConfig = path.join(workspaceRoot, "package.json");
    assert.throws(() => validatePath(rootConfig), /Security violation/);
  });

  it("should report knowledge, schemas, and root as read-only", () => {
    assert.strictEqual(isReadOnly("knowledge/domains/ai.md"), true);
    assert.strictEqual(isReadOnly("schemas/project.json"), true);
    assert.strictEqual(isReadOnly("root/soul.md"), true);
    assert.strictEqual(isReadOnly("projects/ContextOS/memory.md"), false);
  });

  it("should have a fixed list of allowed security buckets", () => {
    assert.ok(ALLOWED_BUCKETS.includes("projects"));
    assert.ok(ALLOWED_BUCKETS.includes("knowledge"));
    assert.ok(ALLOWED_BUCKETS.includes("schemas"));
  });
});
