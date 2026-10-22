#!/usr/bin/env node
/**
 * 多 Agent Skill 安装器。
 *
 * 把 `skill/SKILL.md`（规范源）与**自包含 CLI**（`skill/scripts/mcd-meal.mjs`）
 * 按目标 Agent 的约定安装到其 Skill/命令目录，并合并 MCP 配置。
 * 默认 `--scope project`；`--scope user` 写入用户全局目录。
 *
 * 用法：
 *   node scripts/install-skill.mjs --agent <a[,b]> [--scope project|user] [--dry-run] [--pack]
 *   node scripts/install-skill.mjs --list
 *
 * 支持的 agent：codebuddy、workbuddy、codex、opencode、qoder。
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SKILL_DIR = join(REPO, 'skill');
const BUNDLE_SRC = join(SKILL_DIR, 'scripts', 'mcd-meal.mjs');
const HOME = homedir();
const CWD = process.cwd();
const SKILL_NAME = 'mcd-meal-recommender';

const MCP_URL = 'https://mcp.mcd.cn';

// ── 参数解析 ────────────────────────────────────────────────────────────────
function parseCliArgs(argv) {
  const opts = { agents: [], scope: 'project', dryRun: false, pack: false, list: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      // 容错：pnpm/npm 透传的分隔符
      continue;
    }
    switch (arg) {
      case '--agent': {
        const value = argv[i + 1];
        if (!value) throw new Error('--agent 缺少取值');
        opts.agents.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
        i += 1;
        break;
      }
      case '--scope': {
        const value = argv[i + 1];
        if (value !== 'project' && value !== 'user') throw new Error('--scope 只能是 project 或 user');
        opts.scope = value;
        i += 1;
        break;
      }
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--pack':
        opts.pack = true;
        break;
      case '--list':
        opts.list = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  return opts;
}

// ── Skill 源渲染 ────────────────────────────────────────────────────────────
async function loadCanonical() {
  const raw = await readFile(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const frontmatter = match ? match[1] : '';
  const body = match ? raw.slice(match[0].length) : raw;
  const descLine = frontmatter.split('\n').find((line) => line.startsWith('description:'));
  const description = descLine ? descLine.slice('description:'.length).trim() : '麦当劳套餐推荐助手';
  return { raw, body, description };
}

/** 组装可执行 CLI 命令（绝对路径，带引号以支持含空格路径） */
function cliCommand(scriptPath) {
  return `node ${JSON.stringify(scriptPath)}`;
}

function substitute(text, cli) {
  return text.split('{{CLI}}').join(cli).split('{{REPO}}').join(REPO);
}

function render(raw, { extraFrontmatter = '', cli }) {
  const withFm = raw.replace('{{EXTRA_FRONTMATTER}}\n', extraFrontmatter ? `${extraFrontmatter}\n` : '');
  return substitute(withFm, cli);
}

async function loadRefTemplates() {
  return {
    usage: await readFile(join(SKILL_DIR, 'references', 'usage.md'), 'utf8'),
    mcp: await readFile(join(SKILL_DIR, 'references', 'mcp.md'), 'utf8'),
  };
}

/** 确保自包含 CLI 已构建；缺失则调用 build-skill 脚本 */
function ensureBundle() {
  if (existsSync(BUNDLE_SRC)) return;
  process.stdout.write('未找到打包 CLI，正在构建（scripts/build-skill.mjs）...\n');
  try {
    execFileSync('node', [join(HERE, 'build-skill.mjs')], { stdio: 'inherit' });
  } catch {
    throw new Error('构建打包 CLI 失败。请先执行 `pnpm install && pnpm build:skill`。');
  }
}

// ── MCP 配置片段 ────────────────────────────────────────────────────────────
const MCP = {
  codebuddy: () => ({
    mcpServers: {
      'mcd-mcp': {
        type: 'streamablehttp',
        url: MCP_URL,
        headers: { Authorization: 'Bearer ${MCD_MCP_TOKEN}' },
        description: 'MCD',
      },
    },
  }),
  opencode: () => ({
    mcp: {
      'mcd-mcp': {
        type: 'remote',
        url: MCP_URL,
        enabled: true,
        oauth: false,
        headers: { Authorization: 'Bearer {env:MCD_MCP_TOKEN}' },
      },
    },
  }),
  qoder: () => ({
    mcpServers: {
      'mcd-mcp': { url: MCP_URL, headers: { Authorization: 'Bearer ${MCD_MCP_TOKEN}' } },
    },
  }),
};

const CODEX_TOML_BLOCK = [
  '[mcp_servers.mcd-mcp]',
  `url = "${MCP_URL}"`,
  'bearer_token_env_var = "MCD_MCP_TOKEN"',
].join('\n');

/** 生成「Skill 目录型」三件套：SKILL.md + references + 自包含 CLI */
function skillDirOps(skillRoot, canonical, refTemplates, extraFrontmatter) {
  const scriptPath = join(skillRoot, 'scripts', 'mcd-meal.mjs');
  const cli = cliCommand(scriptPath);
  return {
    scriptPath,
    ops: [
      { type: 'write', path: join(skillRoot, 'SKILL.md'), content: render(canonical.raw, { extraFrontmatter, cli }) },
      { type: 'write', path: join(skillRoot, 'references', 'usage.md'), content: substitute(refTemplates.usage, cli) },
      { type: 'write', path: join(skillRoot, 'references', 'mcp.md'), content: substitute(refTemplates.mcp, cli) },
      { type: 'copy', from: BUNDLE_SRC, to: scriptPath },
    ],
  };
}

// ── 适配器注册表 ────────────────────────────────────────────────────────────
// 每个适配器返回 { ops, notes }。ctx = { scope, base, canonical, refs }。
const ADAPTERS = {
  codebuddy: {
    label: 'CodeBuddy Code',
    build: async (ctx) => {
      const skillRoot = join(ctx.base, '.codebuddy', 'skills', SKILL_NAME);
      const mcpPath = ctx.scope === 'project' ? join(CWD, '.mcp.json') : join(HOME, '.codebuddy', '.mcp.json');
      const { ops } = skillDirOps(skillRoot, ctx.canonical, ctx.refTemplates, 'allowed-tools: Bash(node:*), mcp__mcd-mcp');
      return {
        ops: [...ops, { type: 'merge-json', path: mcpPath, patch: MCP.codebuddy() }],
        notes: [`在 CodeBuddy Code 中运行 /skills 应能看到 ${SKILL_NAME}（含自包含 CLI）。`, `MCP 配置已合并到 ${mcpPath}。`],
      };
    },
  },
  workbuddy: {
    label: 'WorkBuddy',
    build: async (ctx) => {
      const skillRoot = join(ctx.base, '.workbuddy', 'skills', SKILL_NAME);
      const { ops } = skillDirOps(skillRoot, ctx.canonical, ctx.refTemplates, '');
      return {
        ops,
        notes: [
          'WorkBuddy 主要在「技能」页通过“上传技能”安装：上传该文件夹（已含 scripts/），或用 `pnpm skill:pack` 生成的 zip。',
          'MCP 需在 WorkBuddy 界面配置（见 skill/mcp/workbuddy.md）。',
        ],
      };
    },
  },
  codex: {
    label: 'Codex CLI',
    build: async (ctx) => {
      const codexDir = ctx.scope === 'project' ? join(CWD, '.codex') : join(HOME, '.codex');
      const agentsPath = ctx.scope === 'project' ? join(CWD, 'AGENTS.md') : join(codexDir, 'AGENTS.md');
      const tomlPath = join(codexDir, 'config.toml');
      const scriptPath = join(codexDir, 'mcd-meal', 'mcd-meal.mjs');
      const cli = cliCommand(scriptPath);
      const block = [
        '## 套餐推荐助手（mcd-meal）',
        '当用户想「吃什么 / 推荐午餐晚餐 / 到点提醒 / 查看口味偏好 / 领券」时，运行随附 CLI 并把输出呈现给用户：',
        `- 推荐：\`MCD_OFFLINE=1 ${cli} recommend --meal-type lunch\``,
        `- 提醒：\`${cli} set-reminder --meal-type lunch --time 12:00\``,
        `- 画像：\`${cli} show-profile\``,
        `- 领券（须用户确认后加 --confirmed）：\`${cli} bind-coupons\``,
      ].join('\n');
      return {
        ops: [
          { type: 'copy', from: BUNDLE_SRC, to: scriptPath },
          { type: 'upsert-md', path: agentsPath, marker: 'mcd-meal-recommender', block },
          { type: 'upsert-toml', path: tomlPath, marker: 'mcd-meal-recommender', block: CODEX_TOML_BLOCK },
        ],
        notes: [
          `已写入 ${agentsPath} 的说明段；自包含 CLI 位于 ${scriptPath}。`,
          `MCP 已写入 ${tomlPath}（[mcp_servers.mcd-mcp]）。重启 Codex 后生效。`,
        ],
      };
    },
  },
  opencode: {
    label: 'opencode',
    build: async (ctx) => {
      const ocDir = ctx.scope === 'project' ? join(CWD, '.opencode') : join(HOME, '.config', 'opencode');
      const cmdPath = join(ocDir, 'commands', 'mcd-meal.md');
      const scriptPath = join(ocDir, 'mcd-meal', 'mcd-meal.mjs');
      const cli = cliCommand(scriptPath);
      const cmd = `---\ndescription: ${ctx.canonical.description}\n---\n\n${substitute(ctx.canonical.body, cli)}`;
      const cfgPath = ctx.scope === 'project' ? join(CWD, 'opencode.json') : join(ocDir, 'opencode.json');
      return {
        ops: [
          { type: 'copy', from: BUNDLE_SRC, to: scriptPath },
          { type: 'write', path: cmdPath, content: cmd },
          { type: 'merge-json', path: cfgPath, patch: MCP.opencode() },
        ],
        notes: [
          `在 opencode 中通过 /mcd-meal 触发（命令文件：${cmdPath}）；自包含 CLI 位于 ${scriptPath}。`,
          `MCP 已合并到 ${cfgPath}；重启 opencode 后生效。`,
        ],
      };
    },
  },
  qoder: {
    label: 'Qoder',
    build: async (ctx) => {
      const skillRoot = join(ctx.base, '.qoder', 'skills', SKILL_NAME);
      const mcpPath = ctx.scope === 'project' ? join(CWD, '.qoder', 'mcp.json') : join(HOME, '.qoder', 'mcp.json');
      const { ops } = skillDirOps(skillRoot, ctx.canonical, ctx.refTemplates, '');
      return {
        ops: [...ops, { type: 'merge-json', path: mcpPath, patch: MCP.qoder() }],
        notes: [`Qoder 从 ${skillRoot} 加载该项目 Skill（含自包含 CLI）。`, `MCP 已合并到 ${mcpPath}。`],
      };
    },
  },
};

// ── 文本/JSON 合并 ──────────────────────────────────────────────────────────
function upsertBlock(existing, marker, block, comment = (m) => `<!-- ${m}:start -->`) {
  const start = comment(marker);
  const end = comment(marker).replace(':start', ':end');
  const wrapped = `${start}\n${block}\n${end}`;
  const si = existing.indexOf(start);
  const ei = existing.indexOf(end);
  if (si !== -1 && ei !== -1 && ei > si) {
    return existing.slice(0, si) + wrapped + existing.slice(ei + end.length);
  }
  const base = existing.trimEnd();
  return base.length > 0 ? `${base}\n\n${wrapped}\n` : `${wrapped}\n`;
}

function deepMerge(target, patch) {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key];
    if (prev && typeof prev === 'object' && !Array.isArray(prev) && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(prev, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

// ── 执行 ────────────────────────────────────────────────────────────────────
async function applyOp(op, { dryRun }) {
  if (op.type === 'write') {
    const existing = await readIfExists(op.path);
    if (dryRun) return `  写文件: ${op.path}${existsSync(op.path) ? ' (覆盖)' : ' (新建)'}`;
    await mkdir(dirname(op.path), { recursive: true });
    await writeFile(op.path, op.content, 'utf8');
    return `  ${existing !== undefined ? '已覆盖' : '已创建'}: ${op.path}`;
  }
  if (op.type === 'copy') {
    if (dryRun) return `  复制 CLI: ${op.to}${existsSync(op.to) ? ' (覆盖)' : ' (新建)'}`;
    const buffer = await readFile(op.from);
    await mkdir(dirname(op.to), { recursive: true });
    await writeFile(op.to, buffer);
    await chmod(op.to, 0o755);
    return `  ${existsSync(op.to) ? '已复制' : '已创建'} CLI: ${op.to}`;
  }
  if (op.type === 'merge-json') {
    const existing = await readIfExists(op.path);
    let parsedExisting;
    try {
      parsedExisting = existing ? JSON.parse(existing) : {};
    } catch (error) {
      throw new Error(`无法解析既有 JSON（${op.path}）：${error.message}`);
    }
    const merged = deepMerge(parsedExisting, op.patch);
    if (existing !== undefined && JSON.stringify(merged) === JSON.stringify(parsedExisting)) {
      return `  未变化（跳过）: ${op.path}`;
    }
    const content = `${JSON.stringify(merged, null, 2)}\n`;
    if (dryRun) return `  合并 JSON: ${op.path}`;
    await mkdir(dirname(op.path), { recursive: true });
    await writeFile(op.path, content, 'utf8');
    return `  已合并 JSON: ${op.path}`;
  }
  if (op.type === 'upsert-md') {
    const existing = (await readIfExists(op.path)) ?? '';
    const content = upsertBlock(existing, op.marker, op.block);
    if (dryRun) return `  合并 Markdown 段: ${op.path}`;
    await mkdir(dirname(op.path), { recursive: true });
    await writeFile(op.path, content, 'utf8');
    return `  已合并 Markdown 段: ${op.path}`;
  }
  if (op.type === 'upsert-toml') {
    const existing = (await readIfExists(op.path)) ?? '';
    const content = upsertBlock(existing, op.marker, op.block, (m) => `# ${m}:start`);
    if (dryRun) return `  合并 TOML 段: ${op.path}`;
    await mkdir(dirname(op.path), { recursive: true });
    await writeFile(op.path, content, 'utf8');
    return `  已合并 TOML 段: ${op.path}`;
  }
  throw new Error(`未知操作类型：${op.type}`);
}

function packWorkBuddy() {
  const skillsDir = join(HOME, '.workbuddy', 'skills');
  const src = join(skillsDir, SKILL_NAME);
  const outDir = join(REPO, 'dist-skill');
  const zipPath = join(outDir, `${SKILL_NAME}.zip`);
  if (!existsSync(src)) {
    return `  ⚠ 未找到 ${src}，请先以 --scope user 安装再打包。`;
  }
  try {
    execFileSync('mkdir', ['-p', outDir]);
    execFileSync('zip', ['-r', '-q', zipPath, SKILL_NAME], { cwd: skillsDir });
    return `  已打包: ${zipPath}`;
  } catch {
    return `  ⚠ 未能自动打包（缺少 zip 命令）。请手动压缩目录：${src}`;
  }
}

function help() {
  return `多 Agent Skill 安装器

用法:
  node scripts/install-skill.mjs --agent <a[,b]> [--scope project|user] [--dry-run] [--pack]
  node scripts/install-skill.mjs --list

agent: ${Object.keys(ADAPTERS).join(', ')}
scope: project（默认，写入当前仓库/工作目录）| user（写入用户主目录 ~）

说明: 每个技能均随附**自包含 CLI**（scripts/mcd-meal.mjs），用户无需克隆仓库或安装依赖。

示例:
  node scripts/install-skill.mjs --agent codebuddy --scope project
  node scripts/install-skill.mjs --agent codex,opencode,qoder --scope user
  node scripts/install-skill.mjs --agent all --dry-run
  pnpm skill:pack
`;
}

async function main() {
  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`错误：${error.message}\n\n${help()}`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    process.stdout.write(help());
    return;
  }
  if (opts.list) {
    process.stdout.write(`支持的 agent：\n${Object.entries(ADAPTERS).map(([id, a]) => `  ${id.padEnd(10)} ${a.label}`).join('\n')}\n`);
    return;
  }

  const all = Object.keys(ADAPTERS);
  if (opts.agents.length === 0) {
    process.stderr.write(`请用 --agent 指定目标（${all.join(', ')} 或 all）。例如：\n  node scripts/install-skill.mjs --agent codebuddy --scope project\n\n`);
    process.exitCode = 2;
    return;
  }
  const agents = opts.agents.includes('all') ? all : opts.agents;
  for (const id of agents) {
    if (!ADAPTERS[id]) {
      process.stderr.write(`错误：未知 agent「${id}」。可用：${all.join(', ')}\n`);
      process.exitCode = 2;
      return;
    }
  }

  if (!opts.dryRun) {
    ensureBundle();
  } else if (!existsSync(BUNDLE_SRC)) {
    process.stdout.write('提示：尚未构建打包 CLI（安装时会自动执行 pnpm build:skill）。\n\n');
  }

  const canonical = await loadCanonical();
  const refTemplates = await loadRefTemplates();
  const base = opts.scope === 'project' ? CWD : HOME;

  process.stdout.write(`安装目标：${agents.join(', ')} ｜ scope=${opts.scope} ｜ base=${base}${opts.dryRun ? ' ｜ DRY-RUN' : ''}\n\n`);

  for (const id of agents) {
    const adapter = ADAPTERS[id];
    process.stdout.write(`▶ ${id}（${adapter.label}）\n`);
    const { ops, notes } = await adapter.build({ scope: opts.scope, base, canonical, refTemplates });
    for (const op of ops) {
      const line = await applyOp(op, { dryRun: opts.dryRun });
      process.stdout.write(`${line}\n`);
    }
    for (const note of notes) {
      process.stdout.write(`  ℹ ${note}\n`);
    }
    if (opts.pack && id === 'workbuddy') {
      process.stdout.write(`${opts.dryRun ? '  [dry-run] 跳过打包' : packWorkBuddy()}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(opts.dryRun ? '（dry-run：未写入任何文件）\n' : '安装完成。\n');
}

export { parseCliArgs, deepMerge, upsertBlock, ADAPTERS };

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
