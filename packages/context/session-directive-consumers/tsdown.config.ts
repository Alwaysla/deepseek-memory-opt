import { defineConfig } from 'tsdown'

/** Build public Host, agent-tool, and invariant entries independently. */
export default defineConfig([
  ...['index', 'tools'].map(entry => ({
    entry: [`lib/types/${entry}.js`],
    outDir: 'lib',
    format: ['esm' as const],
    platform: 'node' as const,
    target: 'es2024' as const,
    fixedExtension: false,
    dts: false,
    clean: false,
  })),
  {
    entry: ['lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
