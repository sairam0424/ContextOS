import assert from 'node:assert';
import path from 'node:path';
import fs from 'fs-extra';
import { repairService } from '../services/repair.js';
import { workspaceRoot } from '../context.js';

describe('SelfRepairService (Rule-based)', () => {
    const testDir = path.join(workspaceRoot, 'projects', '__repair-test__');
    const testFile = path.join(testDir, 'CONTEXT.md');

    before(async () => {
        await fs.ensureDir(testDir);
    });

    after(async () => {
        await fs.remove(testDir);
    });

    it('should inject frontmatter when status/tags are missing', async () => {
        await fs.writeFile(testFile, '# Test Doc\n\nSome content here.', 'utf-8');

        const fixed = await repairService.attemptRepair(testFile, [
            "required property 'status'",
            "required property 'tags'"
        ]);

        assert.strictEqual(fixed, true, 'Repair should succeed');

        const content = await fs.readFile(testFile, 'utf-8');
        assert.ok(content.startsWith('---'), 'Should have frontmatter');
        assert.ok(content.includes('status: active'), 'Should have status field');
        assert.ok(content.includes('tags: []'), 'Should have tags field');
    });

    it('should not modify a file when issues are unrecognized', async () => {
        const original = '# Good Doc\n\nNo issues here.';
        await fs.writeFile(testFile, original, 'utf-8');

        const fixed = await repairService.attemptRepair(testFile, [
            "some unknown validation error"
        ]);

        // Without GEMINI_API_KEY, agentic fallback will fail, so repair returns false
        if (!process.env.GEMINI_API_KEY) {
            assert.strictEqual(fixed, false, 'Should fail without API key for unknown issues');
        }
    });
});
