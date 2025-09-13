"use strict";
// Lightweight environment-aware logger
// Levels: error (0), warn (1), info (2), debug (3)
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};
// Detect environment both in browser and node
function getEnv() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (typeof window !== 'undefined') ? window : {};
    // Prefer window.ENV if provided by server
    const fromWindow = w.ENV && w.ENV.NODE_ENV;
    if (fromWindow)
        return fromWindow;
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV)
        return process.env.NODE_ENV;
    return 'production';
}
function getLevel() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (typeof window !== 'undefined') ? window : {};
    const env = getEnv();
    const fromWindow = (w.ENV && w.ENV.LOG_LEVEL) || undefined;
    if (fromWindow)
        return fromWindow;
    return env === 'production' ? 'warn' : 'debug';
}
function shouldLog(target) {
    const configured = getLevel();
    return LOG_LEVELS[target] <= LOG_LEVELS[configured];
}
exports.logger = {
    info: (...args) => shouldLog('info') && console.info('[INFO]', ...args),
    warn: (...args) => shouldLog('warn') && console.warn('[WARN]', ...args),
    error: (...args) => shouldLog('error') && console.error('[ERROR]', ...args),
    debug: (...args) => shouldLog('debug') && console.debug('[DEBUG]', ...args),
};
