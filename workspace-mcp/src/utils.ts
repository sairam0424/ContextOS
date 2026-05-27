export {
    findWorkspaceRoot,
    workspaceRoot,
    ALLOWED_BUCKETS,
    validatePath,
    isReadOnly,
    gitCommit
} from "@context-os/core";

import { McpErrorCode, createMcpError } from "./errors.js";

export { McpErrorCode, createMcpError } from "./errors.js";

/**
 * Classify an error into a structured McpErrorCode based on its message content.
 */
function classifyError(error: unknown): McpErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('not found') || lower.includes('enoent') || lower.includes('no such file')) {
    return McpErrorCode.NOT_FOUND;
  }
  if (lower.includes('permission') || lower.includes('read-only') || lower.includes('eacces')) {
    return McpErrorCode.PERMISSION_DENIED;
  }
  if (lower.includes('lock') || lower.includes('conflict')) {
    return McpErrorCode.LOCK_CONFLICT;
  }
  if (lower.includes('valid') || lower.includes('schema')) {
    return McpErrorCode.VALIDATION_FAILED;
  }
  if (lower.includes('rate') || lower.includes('throttl') || lower.includes('too many')) {
    return McpErrorCode.RATE_LIMITED;
  }
  if (lower.includes('invalid') || lower.includes('missing') || lower.includes('required')) {
    return McpErrorCode.INVALID_INPUT;
  }
  return McpErrorCode.INTERNAL_ERROR;
}

export function handleToolError(error: unknown, context?: string) {
  const message = error instanceof Error ? error.message : String(error);

  // Sanitize: remove absolute filesystem paths
  const sanitized = message.replace(/\/Users\/[^\s]+/g, '<workspace>');

  const code = classifyError(error);
  const prefix = context ? `[${context}] ` : '';

  return createMcpError(code, `${prefix}${sanitized}`);
}
