// Lightweight environment-aware logger
// Levels: error (0), warn (1), info (2), debug (3)

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Detect environment both in browser and node
function getEnv(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w: any = (typeof window !== 'undefined') ? window : {};
  // Prefer window.ENV if provided by server
  const fromWindow = w.ENV && (w.ENV.NODE_ENV as string);
  if (fromWindow) return fromWindow;
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) return process.env.NODE_ENV;
  return 'production';
}

function getLevel(): LogLevel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w: any = (typeof window !== 'undefined') ? window : {};
  const env = getEnv();
  const fromWindow = (w.ENV && (w.ENV.LOG_LEVEL as LogLevel)) || undefined;
  if (fromWindow) return fromWindow;
  return env === 'production' ? 'warn' : 'debug';
}

function shouldLog(target: LogLevel): boolean {
  const configured = getLevel();
  return LOG_LEVELS[target] <= LOG_LEVELS[configured];
}

export const logger = {
  info: (...args: unknown[]) => shouldLog('info') && console.info('[INFO]', ...args),
  warn: (...args: unknown[]) => shouldLog('warn') && console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => shouldLog('error') && console.error('[ERROR]', ...args),
  debug: (...args: unknown[]) => shouldLog('debug') && console.debug('[DEBUG]', ...args),
} as const;
