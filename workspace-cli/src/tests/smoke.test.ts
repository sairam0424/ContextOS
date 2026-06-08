import assert from "node:assert";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from 'node:url';

describe("CLI Experience Layer (Smoke Tests)", function () {
    // Each test shells out to a full CLI process via execSync; a real workspace
    // `sync` indexes the whole repo and routinely runs 2-3s, exceeding mocha's
    // 2000ms default. Give the subprocess-driven smoke suite generous headroom.
    this.timeout(30000);

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

    it("should report the current version", () => {
        const pkgPath = path.resolve(__dirname, "../../package.json");
        const { version } = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const output = execSync(`node ${cliPath} --version`).toString();
        assert.strictEqual(output.trim(), version);
    });

    describe("Functional Commands", () => {
        it("should perform a workspace sync", () => {
            const output = execSync(`node ${cliPath} sync 2>&1`).toString();
            assert.ok(output.includes("Workspace indexed"), "Output should contain success message");
        });

        it("should search for indexed content", () => {
            const output = execSync(`node ${cliPath} search "ContextOS" 2>&1`).toString();
            assert.ok(output.includes("Found"), "Output should list search results");
            assert.ok(output.includes("ContextOS"), "Output should contain 'ContextOS'");
        });

        it("should validate the workspace root", () => {
            const output = execSync(`node ${cliPath} validate 2>&1`).toString();
            assert.ok(output.includes("successful"), "Output should contain validation report");
        });
    });
});
