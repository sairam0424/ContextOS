export enum McpErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  LOCK_CONFLICT = 'LOCK_CONFLICT',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_INPUT = 'INVALID_INPUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface McpStructuredError {
  code: McpErrorCode;
  message: string;
  detail?: string;
}

export function createMcpError(code: McpErrorCode, message: string, detail?: string) {
  const error: McpStructuredError = { code, message, ...(detail !== undefined && { detail }) };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(error) }],
    isError: true,
  };
}
