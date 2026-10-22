/**
 * core 层聚合出口：统一日志、统一错误与数据目录解析。
 */

export * from './errors.js';
export * from './logger.js';
export { resolveDataDir, resolveDataPath } from './paths.js';
