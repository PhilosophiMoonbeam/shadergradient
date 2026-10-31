import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['vue', '@tresjs/core', 'three', '@shadergradient/core'],
})
