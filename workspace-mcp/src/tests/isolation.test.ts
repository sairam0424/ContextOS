import { expect } from "chai";
import { validatePath } from "../utils.js";
import path from "path";

describe("Security Isolation Tests", () => {
  const workspaceRoot = process.cwd();

  it("should allow paths within projects directory", () => {
    const validPath = path.join(workspaceRoot, "projects", "ContextOS", "memory.md");
    expect(() => validatePath(validPath)).to.not.throw();
  });

  it("should block directory traversal attacks (..)", () => {
    const maliciousPath = path.join(workspaceRoot, "projects", "ContextOS", "..", "..", "package.json");
    expect(() => validatePath(maliciousPath)).to.throw(/Security violation/);
  });

  it("should block access to root config files when in project context", () => {
    const rootConfig = path.join(workspaceRoot, "package.json");
    // Since validatePath doesn't know the intended 'base', we might need to enhance it
    // for enterprise hardening to accept a 'baseDir' parameter.
    expect(() => validatePath(rootConfig)).to.throw(/Security violation/);
  });

  it("should allow access to specific allowed root files (knowledge, schemas)", () => {
    const knowledgePath = path.join(workspaceRoot, "knowledge", "domains", "ai-agents.md");
    expect(() => validatePath(knowledgePath)).to.not.throw();
  });
});
