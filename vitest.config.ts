import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Resolve `./foo.js` import specifiers in TS source back to `./foo.ts`
// so vitest can run tests directly against `src/**/*.ts` without a build step.
const srcRoot = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^(\.{1,2}\/[^'"]+)\.js$/,
        replacement: '$1.ts',
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
