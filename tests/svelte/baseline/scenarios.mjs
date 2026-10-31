// Characterization inputs, version 1. Never edit these to accommodate F04 output.
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
export const policy = freeze({
  version: 1,
  viewport: { width: 800, height: 600 },
  canvas: { width: 480, height: 320 },
  settleMs: 1200,
  sampleMs: 700,
  timeoutMs: 45000,
  pixelComparison: { channelThreshold: 8, maximumChangedFraction: 0.005 },
  minimumSampledColors: 20,
})
export const baseProps = freeze({
  control: 'props', animate: 'off', grain: 'off', lightType: '3d',
  shader: 'defaults', type: 'plane', uTime: 2, enableTransition: false,
})
const presets = ['halo', 'pensive', 'mint', 'interstella', 'nightyNight',
  'violaOrientalis', 'universe', 'sunset', 'mandarin', 'cottonCandy']
const matrix = ['defaults', 'positionMix', 'cosmic', 'glass'].flatMap((shader) =>
  ['plane', 'waterPlane', 'sphere'].map((type) => ({
    id: `matrix-${shader}-${type}`, kind: 'visual', props: { shader, type, cameraZoom: 8 },
  })))
export const scenarios = freeze([
  ...matrix,
  ...presets.map((preset) => ({ id: `preset-${preset}`, kind: 'visual', preset,
    // Pause only; do not replace preset lighting, grain, camera or shader values.
    exactPreset: true, props: { animate: 'off', enableTransition: false } })),
  { id: 'query-props', kind: 'visual', props: { color1: '#123456', uStrength: 2.5 } },
  { id: 'query-full', kind: 'visual', queryFromProps: true,
    props: { color1: '#123456', uStrength: 2.5 } },
  { id: 'query-partial', kind: 'visual', props: { color1: '#123456', uStrength: 2.5,
    control: 'query', urlString: '?color1=%23abcdef&uTime=2' } },
  { id: 'query-invalid', kind: 'visual', props: { control: 'query',
    urlString: '?shader=invalid&type=invalid&uTime=NaN&wireframe=maybe&unknown=1' } },
  { id: 'query-repeated-fragment', kind: 'visual', props: { control: 'query',
    urlString: 'https://fixture.invalid/?color1=%23123456&color1=%23abcdef&uTime=2#uTime=99' } },
  { id: 'camera-payload', kind: 'camera', props: { cAzimuthAngle: 47.2,
    cPolarAngle: 63.7, cDistance: 5.12345, cameraZoom: 1.23456 } },
  { id: 'camera-mouse', kind: 'mouse', props: {} },
  { id: 'camera-touch', kind: 'touch', props: {} },
  { id: 'camera-zoomout', kind: 'visual', props: { zoomOut: true } },
  { id: 'time-paused', kind: 'paused', props: { uTime: 2 } },
  { id: 'time-resume', kind: 'resume', props: { animate: 'on', uTime: 2 } },
  { id: 'time-range', kind: 'time', props: { animate: 'on', range: 'enabled',
    rangeStart: 1, rangeEnd: 1.25 } },
  { id: 'time-loop', kind: 'time', props: { animate: 'on', loop: 'on', loopDuration: 0.25 } },
  { id: 'time-loop-over-range', kind: 'time', props: { animate: 'on', loop: 'on',
    loopDuration: 0.25, range: 'enabled', rangeStart: 4, rangeEnd: 5 } },
  { id: 'time-seek-negative', kind: 'seek', props: { uTime: -2 } },
  { id: 'grain-off', kind: 'visual', props: { grain: 'off' } },
  { id: 'grain-on', kind: 'visual', props: { grain: 'on' } },
  { id: 'grain-blend-zero', kind: 'visual', props: { grain: 'on', grainBlending: 0 } },
  { id: 'grain-blend-one', kind: 'visual', props: { grain: 'on', grainBlending: 1 } },
  { id: 'wireframe-off', kind: 'visual', props: { wireframe: false } },
  { id: 'wireframe-declared', kind: 'visual', props: { wireframe: true } },
  ...['city', 'dawn', 'lobby'].map((envPreset) => ({ id: `hdr-${envPreset}`,
    kind: 'hdr', hdrMode: 'fixture', props: { lightType: 'env', envPreset } })),
  { id: 'hdr-failure', kind: 'hdr', hdrMode: 'failure', props: { lightType: 'env', envPreset: 'dawn' } },
  { id: 'hdr-live', kind: 'hdr', hdrMode: 'live', props: { lightType: 'env', envPreset: 'city' } },
  { id: 'package-exports', kind: 'exports', props: {} },
])
export const adapters = freeze(['react', 'vue'])
export const commandScenarios = freeze([
  { id: 'build-react', argv: ['pnpm', '--filter', '@shadergradient/react', 'build'] },
  { id: 'build-vue-typecheck', argv: ['pnpm', '--filter', '@shadergradient/vue', 'typecheck'] },
  { id: 'build-vue', argv: ['pnpm', '--filter', '@shadergradient/vue', 'build'] },
  { id: 'build-framer-bundle', argv: ['pnpm', '--filter', '@shadergradient/react', 'build:framer'] },
  { id: 'build-next-workspace', argv: ['pnpm', '--filter', 'example-nextjs-dev', 'build'] },
  { id: 'build-vue-tres-workspace', argv: ['pnpm', '--filter', 'example-vue-dev', 'build'] },
  { id: 'build-nuxt-workspace', argv: ['pnpm', '--filter', 'example-nuxtjs-dev', 'build'] },
  { id: 'build-react-vite-standalone', argv: ['pnpm', '--dir', 'apps/examples/example-vite-react', 'build'] },
  { id: 'build-next-standalone', argv: ['pnpm', '--dir', 'apps/examples/example-nextjs', 'build'] },
  { id: 'build-vue-vite-standalone', argv: ['pnpm', '--dir', 'apps/examples/example-vite-vue', 'build'] },
  { id: 'build-nuxt-standalone', argv: ['pnpm', '--dir', 'apps/examples/example-nuxtjs', 'build'] },
  { id: 'build-framer-plugin', argv: ['pnpm', '--filter', '@shadergradient/framer-plugin', 'build'] },
  { id: 'build-figma-plugin', argv: ['pnpm', '--filter', '@shadergradient/figma-plugin', 'plugin:build'] },
  { id: 'existing-e2e-prepare', argv: ['pnpm', 'prepare:e2e'] },
  { id: 'existing-e2e', argv: ['pnpm', 'exec', 'playwright', 'test'] },
])
export const consumerScenarios = freeze([
  { id: 'consumer-next-workspace', adapter: 'react', route: '/', root: 'apps/example-nextjs-dev' },
  { id: 'consumer-react-vite-standalone', adapter: 'react', route: '/', root: 'apps/examples/example-vite-react' },
  { id: 'consumer-next-standalone', adapter: 'react', route: '/', root: 'apps/examples/example-nextjs' },
  { id: 'consumer-vue-tres-workspace', adapter: 'vue', route: '/', root: 'apps/example-vue-dev' },
  { id: 'consumer-nuxt-workspace', adapter: 'vue', route: '/', root: 'apps/example-nuxtjs-dev', navigation: true },
  { id: 'consumer-vue-vite-standalone', adapter: 'vue', route: '/', root: 'apps/examples/example-vite-vue' },
  { id: 'consumer-nuxt-standalone', adapter: 'vue', route: '/', root: 'apps/examples/example-nuxtjs', navigation: true },
  { id: 'host-framer', adapter: 'react', hostOnly: true },
  { id: 'host-figma', adapter: 'react', hostOnly: true },
])
