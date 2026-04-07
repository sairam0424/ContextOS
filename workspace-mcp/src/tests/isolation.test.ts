import assert from "node:assert";
import { validatePath, findWorkspaceRoot } from "../utils.js";
import path from "node:path";
import fs from "node:fs";

describe("Security Isolation Tests", () => {
  const workspaceRoot = findWorkspaceRoot();

  it("should allow paths within projects directory", () => {
    const validPath = path.join(workspaceRoot, "projects", "ContextOS", "memory.md");
    assert.doesNotThrow(() => validatePath(validPath));
  });

  it("should block directory traversal attacks (..)", () => {
    const maliciousPath = path.join(workspaceRoot, "projects", "ContextOS", "..", "..", "package.json");
    assert.throws(() => validatePath(maliciousPath), /Security violation/);
  });

  it("should block access to root config files when in project context", () => {
    const rootConfig = path.join(workspaceRoot, "package.json");
    assert.throws(() => validatePath(rootConfig), /Security violation/);
  });

  it("should allow access to specific allowed root files (knowledge, schemas)", () => {
    const knowledgePath = path.join(workspaceRoot, "knowledge", "domains", "ai-agents.md");
    assert.doesNotThrow(() => validatePath(knowledgePath));
  });
});
