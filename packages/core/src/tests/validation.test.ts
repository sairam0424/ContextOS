import assert from 'node:assert';
import {
  validateAgentId,
  validateName,
  validatePayload,
  validateIntent,
  validateCapabilities,
} from '../validation.js';

describe('validateAgentId', () => {
  it('accepts a valid UUIDv4', () => {
    const id = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    assert.strictEqual(validateAgentId(id), id);
  });

  it('accepts uppercase UUIDv4', () => {
    const id = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';
    assert.strictEqual(validateAgentId(id), id);
  });

  it('accepts the broadcast wildcard "*"', () => {
    assert.strictEqual(validateAgentId('*'), '*');
  });

  it('rejects a UUIDv1 (wrong version nibble)', () => {
    assert.throws(
      () => validateAgentId('a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d'),
      /not a valid UUIDv4/
    );
  });

  it('rejects an empty string', () => {
    assert.throws(() => validateAgentId(''), /not a valid UUIDv4/);
  });

  it('rejects a random string', () => {
    assert.throws(() => validateAgentId('not-a-uuid'), /not a valid UUIDv4/);
  });

  it('rejects a UUID with invalid variant bits', () => {
    // variant nibble must be [89ab], using 'c' here
    assert.throws(
      () => validateAgentId('a1b2c3d4-e5f6-4a7b-cc9d-0e1f2a3b4c5d'),
      /not a valid UUIDv4/
    );
  });
});

describe('validateName', () => {
  it('accepts a valid name', () => {
    assert.strictEqual(validateName('code-reviewer'), 'code-reviewer');
  });

  it('trims whitespace', () => {
    assert.strictEqual(validateName('  hello  '), 'hello');
  });

  it('accepts name at max length boundary', () => {
    const name = 'a'.repeat(128);
    assert.strictEqual(validateName(name), name);
  });

  it('accepts custom max length', () => {
    const name = 'a'.repeat(256);
    assert.strictEqual(validateName(name, 256), name);
  });

  it('rejects empty string', () => {
    assert.throws(() => validateName(''), /must not be empty/);
  });

  it('rejects whitespace-only string', () => {
    assert.throws(() => validateName('   '), /must not be empty/);
  });

  it('rejects name exceeding default max length', () => {
    const name = 'a'.repeat(129);
    assert.throws(() => validateName(name), /exceeds maximum length of 128/);
  });

  it('rejects name exceeding custom max length', () => {
    const name = 'a'.repeat(257);
    assert.throws(() => validateName(name, 256), /exceeds maximum length of 256/);
  });

  it('rejects name containing null byte', () => {
    assert.throws(() => validateName('hello\x00world'), /control characters/);
  });

  it('rejects name containing newline', () => {
    assert.throws(() => validateName('hello\nworld'), /control characters/);
  });

  it('rejects name containing tab', () => {
    assert.throws(() => validateName('hello\tworld'), /control characters/);
  });
});

describe('validatePayload', () => {
  it('accepts a simple object', () => {
    const result = validatePayload({ key: 'value' });
    assert.strictEqual(result, '{"key":"value"}');
  });

  it('accepts null', () => {
    assert.strictEqual(validatePayload(null), 'null');
  });

  it('accepts an empty object', () => {
    assert.strictEqual(validatePayload({}), '{}');
  });

  it('accepts a nested object within size limit', () => {
    const payload = { nested: { deep: { data: 'hello' } } };
    const result = validatePayload(payload);
    assert.strictEqual(result, JSON.stringify(payload));
  });

  it('accepts payload exactly at size boundary', () => {
    // Create a payload that fits within 100 bytes
    const small = { x: 'a'.repeat(90) };
    const serialized = JSON.stringify(small);
    const result = validatePayload(small, Buffer.byteLength(serialized, 'utf8'));
    assert.strictEqual(result, serialized);
  });

  it('rejects payload exceeding max bytes', () => {
    const large = { data: 'x'.repeat(100) };
    assert.throws(() => validatePayload(large, 10), /exceeds maximum size/);
  });

  it('rejects payload exceeding default 64KB', () => {
    const huge = { data: 'x'.repeat(65536) };
    assert.throws(() => validatePayload(huge), /exceeds maximum size/);
  });

  it('rejects non-serializable values (circular reference)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(() => validatePayload(circular), /not JSON-serializable/);
  });
});

describe('validateIntent', () => {
  it('accepts simple alphanumeric intent', () => {
    assert.strictEqual(validateIntent('review'), 'review');
  });

  it('accepts dotted intent', () => {
    assert.strictEqual(validateIntent('task.complete'), 'task.complete');
  });

  it('accepts hyphenated intent', () => {
    assert.strictEqual(validateIntent('code-review'), 'code-review');
  });

  it('accepts complex intent with dots and hyphens', () => {
    assert.strictEqual(validateIntent('agent.task-run.v2'), 'agent.task-run.v2');
  });

  it('trims whitespace', () => {
    assert.strictEqual(validateIntent('  review  '), 'review');
  });

  it('accepts intent at max length (256)', () => {
    const intent = 'a'.repeat(256);
    assert.strictEqual(validateIntent(intent), intent);
  });

  it('rejects empty string', () => {
    assert.throws(() => validateIntent(''), /must not be empty/);
  });

  it('rejects intent exceeding 256 characters', () => {
    const long = 'a'.repeat(257);
    assert.throws(() => validateIntent(long), /exceeds maximum length of 256/);
  });

  it('rejects intent with spaces', () => {
    assert.throws(() => validateIntent('task run'), /invalid characters/);
  });

  it('rejects intent with special characters', () => {
    assert.throws(() => validateIntent('task@run'), /invalid characters/);
  });

  it('rejects intent with underscores', () => {
    assert.throws(() => validateIntent('task_run'), /invalid characters/);
  });

  it('rejects intent with slashes', () => {
    assert.throws(() => validateIntent('task/run'), /invalid characters/);
  });
});

describe('validateCapabilities', () => {
  it('accepts a valid array', () => {
    const caps = ['review', 'lint', 'test'];
    assert.deepStrictEqual(validateCapabilities(caps), caps);
  });

  it('trims whitespace from each capability', () => {
    assert.deepStrictEqual(
      validateCapabilities(['  review  ', ' lint ']),
      ['review', 'lint']
    );
  });

  it('accepts empty array', () => {
    assert.deepStrictEqual(validateCapabilities([]), []);
  });

  it('accepts array at max items boundary (20)', () => {
    const caps = Array.from({ length: 20 }, (_, i) => `cap-${i}`);
    assert.strictEqual(validateCapabilities(caps).length, 20);
  });

  it('accepts capability at max length boundary (64)', () => {
    const cap = 'a'.repeat(64);
    assert.deepStrictEqual(validateCapabilities([cap]), [cap]);
  });

  it('rejects array exceeding max items', () => {
    const caps = Array.from({ length: 21 }, (_, i) => `cap-${i}`);
    assert.throws(() => validateCapabilities(caps), /exceeds maximum of 20 items/);
  });

  it('rejects array exceeding custom max items', () => {
    const caps = Array.from({ length: 6 }, (_, i) => `cap-${i}`);
    assert.throws(() => validateCapabilities(caps, 5), /exceeds maximum of 5 items/);
  });

  it('rejects capability exceeding max length', () => {
    const long = 'a'.repeat(65);
    assert.throws(() => validateCapabilities([long]), /exceeds maximum length of 64/);
  });

  it('rejects empty capability string', () => {
    assert.throws(() => validateCapabilities(['']), /must not be empty/);
  });

  it('rejects capability with control characters', () => {
    assert.throws(
      () => validateCapabilities(['review\x00']),
      /control characters/
    );
  });

  it('rejects non-array input', () => {
    assert.throws(
      () => validateCapabilities('not-an-array' as unknown as string[]),
      /must be an array/
    );
  });

  it('rejects non-string items in array', () => {
    assert.throws(
      () => validateCapabilities([123 as unknown as string]),
      /must be a string/
    );
  });
});
