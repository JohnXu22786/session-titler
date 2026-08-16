import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * The `@deepseek-ai/dsh-*` runtime packages are provided by the harness at
 * load time (peer dependencies of the bundle) and their npm chain is not
 * installable standalone (one transitive package is unpublished). Two paths
 * make the plugin testable without the harness:
 *
 * - `tsc` resolves the packages through thin forwarding packages under
 *   `node_modules/@deepseek-ai/` whose type entry re-exports the stubs in
 *   `stubs/`, mirroring the published API surface.
 * - `vitest` aliases the packages straight to the stub sources so they are
 *   transformed like ordinary source files.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@deepseek-ai/dsh-session/types', replacement: fileURLToPath(new URL('./stubs/dsh-session-types.ts', import.meta.url)) },
      { find: '@deepseek-ai/dsh-llm', replacement: fileURLToPath(new URL('./stubs/dsh-llm.ts', import.meta.url)) },
      { find: '@deepseek-ai/dsh-session', replacement: fileURLToPath(new URL('./stubs/dsh-session.ts', import.meta.url)) },
      { find: '@deepseek-ai/dsh-session-title', replacement: fileURLToPath(new URL('./stubs/dsh-session-title.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
