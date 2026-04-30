import assert from 'node:assert';
import { capabilityService } from '../services/capability.js';

describe('CapabilityService', () => {
    it('should return default capabilities when no config file exists', () => {
        const caps = capabilityService.getCapabilities();
        assert.ok(caps.length > 0, 'Should have at least one capability');
        assert.strictEqual(caps[0].id, 'core-architect');
    });

    it('should match wildcard capability for unknown intents', () => {
        const match = capabilityService.match('something totally random');
        assert.ok(match, 'Should return a match');
        assert.strictEqual(match.role, 'General Architect');
    });

    it('should match based on expertise keywords', () => {
        const match = capabilityService.match('security audit needed');
        assert.ok(match, 'Should return a match');
    });

    it('should reload capabilities without error', async () => {
        await capabilityService.reload();
        const caps = capabilityService.getCapabilities();
        assert.ok(caps.length > 0, 'Should have capabilities after reload');
    });
});
