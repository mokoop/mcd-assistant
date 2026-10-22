#!/usr/bin/env node
/**
 * 将 CLI 打包为**自包含单文件**（bundle，含 zod 与 MCP SDK），
 * 输出到 `skill/scripts/mcd-meal.mjs`，供安装到各 Agent 的 Skill 目录随技能携带，
 * 使用户**无需克隆仓库或安装依赖**即可运行。
 */

import { chmod, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const OUT = join(REPO, 'skill', 'scripts', 'mcd-meal.mjs');

await mkdir(dirname(OUT), { recursive: true });
await build({
  entryPoints: [join(REPO, 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: OUT,
  logLevel: 'warning',
  // 入口自带 shebang，esbuild 会保留到首行；不额外加 banner 以免重复
});
await chmod(OUT, 0o755);
process.stdout.write(`已生成自包含 CLI：${OUT}\n`);
