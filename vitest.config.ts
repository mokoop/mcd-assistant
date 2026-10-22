import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Wave0 尚无测试用例，允许无测试文件时通过
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/**/*.d.ts', 'src/**/types.ts', 'src/mcp-client/index.ts'],
    },
  },
});
