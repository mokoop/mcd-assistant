import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts', 'install-skill.mjs');
const AGENTS = ['codebuddy', 'workbuddy', 'codex', 'opencode', 'qoder'];

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function run(args: string[], env: Record<string, string> = {}): string {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'mcd-install-'));
  tempDirs.push(home);
  return home;
}

// 安装器会把自包含 CLI 复制进技能目录；先确保已构建（否则安装器会自行构建）
beforeAll(() => {
  execFileSync('node', [join(ROOT, 'scripts', 'build-skill.mjs')], { stdio: 'ignore' });
});

describe('install-skill 安装器', () => {
  it('--list 列出全部支持的 agent', () => {
    const output = run(['--list']);
    for (const agent of AGENTS) {
      expect(output).toContain(agent);
    }
  });

  it('project 级别 dry-run 规划出各 agent 目标路径与 CLI 复制（不写文件）', () => {
    const output = run(['--agent', 'all', '--scope', 'project', '--dry-run']);
    expect(output).toContain(join('.codebuddy', 'skills', 'mcd-meal-recommender', 'SKILL.md'));
    expect(output).toContain(join('.workbuddy', 'skills', 'mcd-meal-recommender', 'SKILL.md'));
    expect(output).toContain(join('.opencode', 'commands', 'mcd-meal.md'));
    expect(output).toContain(join('.qoder', 'skills', 'mcd-meal-recommender', 'SKILL.md'));
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('复制 CLI');
    expect(output).toContain('未写入任何文件');
  });

  it('user 级别 dry-run 指向用户目录与 opencode 全局命令目录', () => {
    const output = run(['--agent', 'all', '--scope', 'user', '--dry-run'], { HOME: newHome() });
    expect(output).toContain(join('.codex', 'AGENTS.md'));
    expect(output).toContain(join('.config', 'opencode', 'commands', 'mcd-meal.md'));
    expect(output).toContain(join('.qoder', 'mcp.json'));
  });

  it('未知 agent → 退出码 2', () => {
    let status = 0;
    try {
      run(['--agent', 'nope']);
    } catch (error) {
      status = (error as { status?: number }).status ?? 0;
    }
    expect(status).toBe(2);
  });

  it('未指定 --agent → 拒绝执行（退出码 2，避免误装）', () => {
    let status = 0;
    try {
      run([]);
    } catch (error) {
      status = (error as { status?: number }).status ?? 0;
    }
    expect(status).toBe(2);
  });

  it('真实安装：Codex 幂等合并，且 AGENTS 段指向随附 CLI', () => {
    const home = newHome();
    run(['--agent', 'codex', '--scope', 'user'], { HOME: home });
    run(['--agent', 'codex', '--scope', 'user'], { HOME: home });

    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    const agentsMd = readFileSync(join(home, '.codex', 'AGENTS.md'), 'utf8');
    expect(toml.match(/mcd-meal-recommender:start/g)).toHaveLength(1);
    expect(toml).toContain('[mcp_servers.mcd-mcp]');
    expect(agentsMd.match(/mcd-meal-recommender:start/g)).toHaveLength(1);
    expect(agentsMd).toContain(join('.codex', 'mcd-meal', 'mcd-meal.mjs'));
    expect(existsSync(join(home, '.codex', 'mcd-meal', 'mcd-meal.mjs'))).toBe(true);
  });

  it('真实安装：CodeBuddy 技能自包含（SKILL.md + references + scripts/CLI）', () => {
    const home = newHome();
    run(['--agent', 'codebuddy', '--scope', 'user'], { HOME: home });

    const skillRoot = join(home, '.codebuddy', 'skills', 'mcd-meal-recommender');
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill).toContain('name: mcd-meal-recommender');
    expect(skill).toContain('allowed-tools: Bash(node:*), mcp__mcd-mcp');
    // 自包含：指令指向随技能打包的 CLI，而非仓库 dist/
    expect(skill).toContain(join('scripts', 'mcd-meal.mjs'));
    expect(skill).not.toContain('dist/cli.js');

    const cli = join(skillRoot, 'scripts', 'mcd-meal.mjs');
    expect(existsSync(cli)).toBe(true);
    accessSync(cli, constants.X_OK); // 具备可执行权限

    const mcp = JSON.parse(readFileSync(join(home, '.codebuddy', '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { url: string }>;
    };
    expect(mcp.mcpServers['mcd-mcp'].url).toBe('https://mcp.mcd.cn');
  });

  it('随附 CLI 可脱离仓库独立运行（离线模式）', () => {
    const home = newHome();
    run(['--agent', 'codebuddy', '--scope', 'user'], { HOME: home });
    const cli = join(home, '.codebuddy', 'skills', 'mcd-meal-recommender', 'scripts', 'mcd-meal.mjs');

    const output = execFileSync('node', [cli, 'recommend', '--meal-type', 'lunch'], {
      encoding: 'utf8',
      env: { ...process.env, MCD_OFFLINE: '1', LOG_LEVEL: 'error', MCD_PROFILE_PATH: join(home, 'profile.json') },
    });
    expect(output).toContain('推荐');
    expect(output).toMatch(/券后价/);
  });
});
