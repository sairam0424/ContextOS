import pino from 'pino';

const level = process.env.CONTEXTOS_LOG_LEVEL || 'info';

export const logger = pino({
  name: 'context-os',
  level,
  // Diagnostic logs go to stderr (fd 2), never stdout (fd 1) — stdout is the
  // CLI's machine-readable data channel (e.g. `context-os --version`), and
  // leaking log lines there corrupts piped/parsed output.
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino/file', options: { destination: 2 } }
    : undefined,
});

export function createChildLogger(module: string) {
  return logger.child({ module });
}
