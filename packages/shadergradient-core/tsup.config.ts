import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2021',
  platform: 'neutral',
  loader: { '.glsl': 'text' },
})
