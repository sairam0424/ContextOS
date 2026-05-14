/**
 * Input validation guards for ContextOS v2-architecture modules.
 * Pure functions — no external dependencies. Throws descriptive errors on failure.
 */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;
const INTENT_REGEX = /^[a-zA-Z0-9.\-]+$/;

/**
 * System-level sender identifiers that are not agent UUIDs.
 * Used by internal services (e.g., scheduler) as the `from` field in messages.
 */
const SYSTEM_IDENTIFIERS = new Set(['scheduler', 'system']);

/**
 * Validates that a string is a valid UUIDv4 format.
 * Accepts the special broadcast wildcard '*' used by MessageBus.
 * Accepts system identifiers for internal service-to-agent messages.
 */
export function validateAgentId(id: string): string {
  if (typeof id !== 'string') {
    throw new Error('Agent ID must be a string');
  }
  if (id === '*' || SYSTEM_IDENTIFIERS.has(id)) {
    return id;
  }
  if (!UUID_V4_REGEX.test(id)) {
    throw new Error(
      `Agent ID "${id}" is not a valid UUIDv4. Expected format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`
    );
  }
  return id;
}

/**
 * Validates a name string.
 * - Must not be empty
 * - Must not contain control characters
 * - Must not exceed maxLength (default 128)
 */
export function validateName(name: string, maxLength: number = 128): string {
  if (typeof name !== 'string') {
    throw new Error('Name must be a string');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Name must not be empty');
  }
  if (trimmed.length > maxLength) {
    throw new Error(
      `Name exceeds maximum length of ${maxLength} characters (got ${trimmed.length})`
    );
  }
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    throw new Error('Name must not contain control characters');
  }
  return trimmed;
}

/**
 * Validates a payload by serializing to JSON and checking byte size.
 * - Must be JSON-serializable
 * - Serialized form must not exceed maxBytes (default 65536 = 64KB)
 * Returns the JSON string representation.
 */
export function validatePayload(payload: unknown, maxBytes: number = 65536): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (err) {
    throw new Error(
      `Payload is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(
      `Payload exceeds maximum size of ${maxBytes} bytes (got ${byteLength} bytes)`
    );
  }
  return serialized;
}

/**
 * Validates an intent string.
 * - Must not be empty
 * - Must only contain alphanumeric characters, dots, and hyphens
 * - Must not exceed 256 characters
 */
export function validateIntent(intent: string): string {
  if (typeof intent !== 'string') {
    throw new Error('Intent must be a string');
  }
  const trimmed = intent.trim();
  if (trimmed.length === 0) {
    throw new Error('Intent must not be empty');
  }
  if (trimmed.length > 256) {
    throw new Error(
      `Intent exceeds maximum length of 256 characters (got ${trimmed.length})`
    );
  }
  if (!INTENT_REGEX.test(trimmed)) {
    throw new Error(
      `Intent "${trimmed}" contains invalid characters. Only alphanumeric, dots (.), and hyphens (-) are allowed`
    );
  }
  return trimmed;
}

/**
 * Validates an array of capability strings.
 * - Must not exceed maxItems (default 20)
 * - Each capability must not exceed maxItemLength (default 64)
 * - Each capability must not be empty or contain control characters
 */
export function validateCapabilities(
  caps: string[],
  maxItems: number = 20,
  maxItemLength: number = 64
): string[] {
  if (!Array.isArray(caps)) {
    throw new Error('Capabilities must be an array');
  }
  if (caps.length > maxItems) {
    throw new Error(
      `Capabilities array exceeds maximum of ${maxItems} items (got ${caps.length})`
    );
  }
  return caps.map((cap, index) => {
    if (typeof cap !== 'string') {
      throw new Error(`Capability at index ${index} must be a string`);
    }
    const trimmed = cap.trim();
    if (trimmed.length === 0) {
      throw new Error(`Capability at index ${index} must not be empty`);
    }
    if (trimmed.length > maxItemLength) {
      throw new Error(
        `Capability at index ${index} exceeds maximum length of ${maxItemLength} characters (got ${trimmed.length})`
      );
    }
    if (CONTROL_CHAR_REGEX.test(trimmed)) {
      throw new Error(`Capability at index ${index} must not contain control characters`);
    }
    return trimmed;
  });
}
