import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from 'node:url';

describe("CLI Experience Layer (Smoke Tests)", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const cliPath = path.resolve(__dirname, "..", "index.js");

    it("should display help information", () => {
        const output = execSync(`node ${cliPath} --help`).toString();
        assert.ok(output.includes("ContextOS Developer Interface Layer"));
    });

    it("should have all core commands registered", () => {
        const output = execSync(`node ${cliPath} --help`).toString();
        const expectedCommands = [
            "init", "today", "status", "decide", "sync",
            "summary", "context", "search", "archive",
            "prune", "health", "extract", "tag", "validate"
        ];
        
        expectedCommands.forEach(cmd => {
            assert.ok(output.includes(cmd));
        });
    });

    it("should report version 1.0.1", () => {
        const output = execSync(`node ${cliPath} --version`).toString();
        assert.strictEqual(output.trim(), "1.0.1");
    });
});
