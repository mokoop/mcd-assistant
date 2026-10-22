import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'data/**',
      '.idea/**',
      'skill/scripts/**',
      'dist-skill/**',
      // 本地 Agent 安装产物（含打包 CLI）
      '.codebuddy/skills/**',
      '.workbuddy/**',
      '.codex/**',
      '.opencode/**',
      '.qoder/**',
    ],
  },
  {
    // 脚本类 .mjs 运行在 Node 环境，声明 Node 全局
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      // 类型安全：禁止 any，必要时用 unknown + 类型收窄（dev_spec §4.5.1）
      '@typescript-eslint/no-explicit-any': 'error',
      // 导出的公共 API 显式标注类型
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // 禁止空 catch 吞异常（dev_spec §4.5.1）
      'no-empty': ['error', { allowEmptyCatch: false }],
      // 除 Skill 交互输出外禁止直接 console.*（日志统一走 src/core/logger）
      'no-console': 'error',
      // 导入顺序：内置 → 第三方 → 项目内部（@/ 别名），组间空行
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
          pathGroups: [{ pattern: '@/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/newline-after-import': 'error',
    },
  },
  prettier,
);
