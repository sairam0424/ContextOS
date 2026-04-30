import assert from "node:assert";
import { intelligenceService, validationService, workspaceService } from "../index.js";
import { getWorkspaceRoot } from "../context.js";
import path from "node:path";
import fs from "fs-extra";

describe("Core Domain Services Layer", () => {
    const workspaceRoot = getWorkspaceRoot();

    describe("ValidationService", () => {
        it("should validate correctly formatted project memory", async () => {
            const memoryPath = path.join(workspaceRoot, "projects", "ContextOS", "memory.md");
            if (await fs.pathExists(memoryPath)) {
                const result = await validationService.validateFile(memoryPath);
                assert.strictEqual(result.valid, true, `Expected ${memoryPath} to be valid`);
            }
        });

        it("should extract metadata from valid markdown", async () => {
            const personalityPath = path.join(workspaceRoot, "root", "personality.md");
            const content = await fs.readFile(personalityPath, "utf-8");
            const metadata = await validationService.extractMetadata(content);
            assert.ok(metadata.title, "Metadata should have a title");
            assert.ok(metadata["Response Preferences"], "Metadata should have 'Response Preferences' section");
        });
    });

    describe("IntelligenceService", () => {
        it("should find results for a known query (e.g., 'ContextOS')", async () => {
            const results = await intelligenceService.search("ContextOS");
            assert.ok(results.length > 0, "Should find at least one result for 'ContextOS'");
            assert.ok(results.some(r => r.type === 'hybrid' || r.type === 'deep'), "Should identify search results");
        });

        it("should fall back to grep for unindexed patterns", async function() {
            this.timeout(5000); 
            // Use a unique string that exists in personality.md or similar
            const results = await intelligenceService.search("syco"); 
            assert.ok(results.length > 0, "Grep fallback should find 'syco' in Hard Rules");
        });
    });

    describe("WorkspaceService", () => {
        it("should perform an incremental sync without error", async () => {
            const result = await workspaceService.sync();
            assert.strictEqual(result.success, true);
            assert.ok(result.message.includes("incremental"));
        });

        it("should perform a forced sync when requested", async () => {
            const result = await workspaceService.sync(undefined, { force: true });
            assert.strictEqual(result.success, true);
            assert.ok(result.message.includes("full re-scan"));
        });
    });
});
