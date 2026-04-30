import assert from 'node:assert';
import { getSharedDatabase } from '../services/database.js';

describe('LockingService (Database Layer)', () => {
    const db = getSharedDatabase();
    const testPath = 'test-lock-' + Date.now() + '.md';

    afterEach(() => {
        db.releaseLock(testPath, 'agent-a');
        db.releaseLock(testPath, 'agent-b');
    });

    it('should acquire a lock on an uncontested path', () => {
        const result = db.acquireLock(testPath, 'agent-a', 5000);
        assert.ok(result.changes > 0, 'Lock should be acquired');
        const lock = db.getLock(testPath);
        assert.strictEqual(lock?.agent_id, 'agent-a');
    });

    it('should not let a second agent steal an active lock', () => {
        db.acquireLock(testPath, 'agent-a', 60000);
        db.acquireLock(testPath, 'agent-b', 60000);
        const lock = db.getLock(testPath);
        assert.strictEqual(lock?.agent_id, 'agent-a', 'Original agent should retain the lock');
    });

    it('should allow the same agent to refresh its lock', () => {
        db.acquireLock(testPath, 'agent-a', 1000);
        db.acquireLock(testPath, 'agent-a', 60000);
        const lock = db.getLock(testPath);
        assert.strictEqual(lock?.agent_id, 'agent-a');
        assert.ok(lock.expires_at > Date.now() + 50000, 'Lock should be refreshed');
    });

    it('should release a lock when requested by the owner', () => {
        db.acquireLock(testPath, 'agent-a', 60000);
        db.releaseLock(testPath, 'agent-a');
        const lock = db.getLock(testPath);
        assert.strictEqual(lock, undefined, 'Lock should be released');
    });

    it('should auto-expire stale locks', async () => {
        db.acquireLock(testPath, 'agent-a', 50);
        await new Promise(resolve => setTimeout(resolve, 100));
        const lock = db.getLock(testPath);
        assert.strictEqual(lock, undefined, 'Expired lock should return undefined');
    });
});
