export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  NOT_FOUND: 2,
  PERMISSION_DENIED: 3,
  VALIDATION_FAILED: 4,
  NETWORK_ERROR: 5,
  WORKSPACE_NOT_INITIALIZED: 6,
} as const;

export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];

export function exitWithCode(code: ExitCode, message?: string): never {
  if (message) {
    console.error(message);
  }
  process.exit(code);
}
