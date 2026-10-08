import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The shared tsconfig sets `jsx: preserve` for Next, which leaves esbuild on
  // the classic runtime and every component throws "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
