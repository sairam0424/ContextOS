import pino from 'pino';

const level = process.env.CONTEXTOS_LOG_LEVEL || 'info';

export const logger = pino({
  name: 'context-os',
  level,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino/file', options: { destination: 1 } }
    : undefined,
});

export function createChildLogger(module: string) {
  return logger.child({ module });
}
