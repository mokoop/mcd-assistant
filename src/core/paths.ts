/**
 * 数据目录解析（v1.3.0）——把本地状态（画像 / 提醒）锚定到**技能/仓库根目录**，而非当前工作目录（CWD）。
 *
 * 背景：技能是**自包含**的（`scripts/mcd-meal.mjs`），但宿主执行时的 CWD 由宿主决定；
 * 若以 `data/` 相对 CWD 解析，数据会散落到不确定位置、甚至只读目录导致持久化静默失败。
 *
 * 规则：
 * 1. `MCD_DATA_DIR` 优先（相对路径按 `resolve()` 归一化为绝对路径）；
 * 2. 否则**仅当入口脚本是我们的 CLI**（`process.argv[1]` 文件名为 `mcd-meal.mjs` / `cli.js`）时，
 *    以其所在目录为技能/仓库根；若该目录名为 `scripts` / `dist`，则再上溯一级：
 *    - `<skillDir>/scripts/mcd-meal.mjs` → `<skillDir>/data`
 *    - `<repo>/dist/cli.js` → `<repo>/data`
 *    - `<agentDir>/mcd-meal/mcd-meal.mjs` → `<agentDir>/mcd-meal/data`（codex/opencode 布局）
 * 3. 其他入口（被库方式 import、`node_modules/.bin` 符号链接、`node .` 目录入口等）**回退 CWD/data**。
 *
 * 该识别策略避免把数据误写到 `node_modules/`、`/` 或宿主任意目录，同时与 v1.2.0 源码运行位置（`<repo>/data`）兼容。
 */

import { basename, dirname, join, resolve } from 'node:path';

/** 视为「本技能 CLI」的入口文件名 */
const OWN_ENTRIES = new Set(['mcd-meal.mjs', 'cli.js']);
/** 需要上溯一级的包裹目录名 */
const WRAPPER_DIRS = new Set(['scripts', 'dist']);

/**
 * 运行根目录：仅当入口为本技能 CLI 时返回其技能/仓库根；否则返回 undefined（交由调用方回退 CWD）。
 */
function entryRoot(): string | undefined {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry.length === 0) {
    return undefined;
  }
  if (!OWN_ENTRIES.has(basename(entry))) {
    return undefined;
  }
  const dir = dirname(resolve(entry));
  return WRAPPER_DIRS.has(basename(dir)) ? dirname(dir) : dir;
}

/** 解析默认数据目录（`MCD_DATA_DIR` 优先；否则 <运行根>/data；再否则 CWD/data） */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.MCD_DATA_DIR?.trim();
  if (raw && raw.length > 0) {
    return resolve(raw);
  }
  const root = entryRoot();
  return root ? join(root, 'data') : join(process.cwd(), 'data');
}

/** 解析数据文件路径（默认数据目录下的给定文件名） */
export function resolveDataPath(fileName: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), fileName);
}
