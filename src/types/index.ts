/**
 * 公共类型聚合出口。
 *
 * 说明：统一错误类型 `AppError` 与错误码枚举 `ErrorCode` 属于含运行时行为的核心设施，
 * 按团队约定置于 `@/core/errors`（本文件不重复导出，避免 types → core 的反向依赖）。
 */

export * from './profile.js';
export * from './reminder.js';
export * from './recommendation.js';
export * from './mcp.js';
