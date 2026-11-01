import { readFileSync } from 'node:fs'
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import { chromiumLaunchOptions } from './tests/browser/chromium.mjs'

const useDevServers = process.env.E2E_USE_DEV_SERVERS === '1'
const scope = process.env.E2E_SCOPE ?? 'all'
const nativeSpecs = /svelte-(?:features|lifecycle|mirrors)\.spec\.ts$/
const legacySpecs = /(?:gradient|coverage)\.spec\.ts$/
const demoStudioSpecs = /demo-studio\.spec\.ts$/
const apps = [
  {
    name: 'vue-library',
    port: 3105,
    integrationServer: 'vue-dev',
    testMatch: legacySpecs,
  },
  {
    name: 'vue-dev',
    port: 3105,
    integrationServer: 'vue-dev',
    testMatch: legacySpecs,
  },
  {
    name: 'nuxt-dev',
    port: 3106,
    integrationServer: 'nuxt-dev',
    testMatch: legacySpecs,
  },
  {
    name: 'vue-standalone',
    port: 3107,
    integrationServer: 'vue-standalone',
    testMatch: legacySpecs,
  },
  {
    name: 'nuxt-standalone',
    port: 3108,
    integrationServer: 'nuxt-standalone',
    testMatch: legacySpecs,
  },
  {
    name: 'react-studio',
    port: 3109,
    integrationServer: 'react-studio',
    testMatch: demoStudioSpecs,
  },
]

// The root supervisor runs compiler fixtures, packs/installs and F26 runtime
// verification once, then owns all server groups through finally. Playwright
// must not launch a second preparation or silently attach to an unknown port.
if (
  process.env.E2E_MANAGED_SERVERS !== '1' &&
  !(useDevServers && scope === 'legacy')
) {
  throw new Error(
    'Use pnpm test:e2e (or test:e2e:native/test:e2e:legacy); append Playwright arguments after --. Explicit legacy external servers require E2E_USE_DEV_SERVERS=1 E2E_SCOPE=legacy.'
  )
}
const projects: NonNullable<PlaywrightTestConfig['projects']> = []
if (scope !== 'native') {
  projects.push(
    ...apps.flatMap(({ name, port, integrationServer, testMatch }) => [
      {
        name,
        testMatch,
        testIgnore: nativeSpecs,
        metadata: { integrationServer },
        use: {
          browserName: 'chromium' as const,
          launchOptions: chromiumLaunchOptions,
          baseURL: `http://localhost:${useDevServers ? port - 100 : port}`,
          viewport: { width: 1280, height: 900 },
        },
      },
      {
        name: `${name}-mobile`,
        testMatch,
        testIgnore: nativeSpecs,
        metadata: { integrationServer },
        use: {
          browserName: 'chromium' as const,
          launchOptions: chromiumLaunchOptions,
          baseURL: `http://localhost:${useDevServers ? port - 100 : port}`,
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        },
      },
    ])
  )
}

if (scope !== 'legacy') {
  const manifestPath = process.env.E2E_NATIVE_MANIFEST
  if (!manifestPath)
    throw new Error(
      'Native projects require the actual F26 prepared manifest from pnpm test:e2e'
    )
  const prepared = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (
    prepared.schemaVersion !== 1 ||
    prepared.manifestPath !== manifestPath ||
    !prepared.candidate?.fingerprint
  ) {
    throw new Error(
      'Native projects require the unchanged disk-backed preparation identity'
    )
  }
  const packed = (id: string, kind: 'plain' | 'kit') => {
    const cell = prepared.consumers.find(
      (item: { id: string }) => item.id === id
    )
    if (
      !cell ||
      cell.kind !== kind ||
      cell.mode !== 'production' ||
      cell.launch.cwd !== cell.root
    ) {
      throw new Error(`Missing actual prepared production ${id} consumer`)
    }
    return {
      name: `packed-${kind}`,
      kind,
      mode: 'production' as const,
      baseURL: cell.baseURL,
      integrationServer: `native-packed-${id}`,
      packed: {
        manifest: manifestPath,
        id,
        candidateFingerprint: prepared.candidate.fingerprint,
        coreSHA256: prepared.packages.core.sha256,
        nativeSHA256: prepared.packages.native.sha256,
        compiledSSREvidence: process.env.E2E_NATIVE_RUNTIME_REPORT,
      },
    }
  }
  const endpoints = [
    {
      name: 'plain',
      kind: 'plain' as const,
      mode: 'development' as const,
      baseURL: 'http://127.0.0.1:3110',
      integrationServer: 'native-plain',
      packed: undefined,
    },
    {
      name: 'kit',
      kind: 'kit' as const,
      mode: 'production' as const,
      baseURL: 'http://127.0.0.1:3111',
      integrationServer: 'native-kit',
      packed: undefined,
    },
    packed('plain-current', 'plain'),
    packed('kit-current', 'kit'),
  ]
  // Headless Firefox on the qualified Linux software backend has no WebGL2.
  // The supervisor records its *natural* capability/fallback separately, without
  // dropping required rendered Firefox cases. Never hardcode a retired DISPLAY.
  const firefoxLaunch = {
    env: Object.fromEntries(
      Object.entries({ ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    ),
    firefoxUserPrefs: {
      'webgl.force-enabled': true,
      'webgl.disabled': false,
      'webgl.enable-webgl2': true,
    },
  }
  for (const endpoint of endpoints) {
    const metadata = {
      nativeSvelte: true,
      integrationServer: endpoint.integrationServer,
      nativePacked: endpoint.packed,
      integrationReport: process.env.E2E_INTEGRATION_REPORT,
      nativeLifecycle: {
        kind: endpoint.kind,
        mode: endpoint.mode,
        supportURL: 'http://127.0.0.1:3114',
        hmrURL: 'http://127.0.0.1:3114/hmr',
      },
      supportSSREvidence:
        'Workspace public-import probe only; installed plain compiled SSR and Kit HTTP SSR are in the F26 runtime report.',
    }
    for (const browserName of ['chromium', 'firefox', 'webkit'] as const) {
      projects.push({
        name: `native-${endpoint.name}-${browserName}`,
        testMatch: nativeSpecs,
        testIgnore: legacySpecs,
        timeout: 90000,
        metadata,
        use: {
          browserName,
          baseURL: endpoint.baseURL,
          viewport: { width: 1280, height: 900 },
          ...(browserName === 'chromium'
            ? { launchOptions: chromiumLaunchOptions }
            : {}),
          ...(browserName === 'firefox'
            ? { headless: false, launchOptions: firefoxLaunch }
            : {}),
        },
      })
      projects.push({
        name: `native-${endpoint.name}-${browserName}-${
          browserName === 'firefox' ? 'touch-viewport' : 'touch'
        }`,
        // F23's actual touch matrix exercises taps/keyboard on all engines;
        // CDP trusted movement is a separate Chromium-only protocol case.
        testMatch: /svelte-features\.spec\.ts$/,
        testIgnore: legacySpecs,
        timeout: 90000,
        metadata,
        use: {
          browserName,
          baseURL: endpoint.baseURL,
          viewport: { width: 820, height: 1180 },
          deviceScaleFactor: 1.5,
          hasTouch: true,
          isMobile: browserName !== 'firefox',
          ...(browserName === 'chromium'
            ? { launchOptions: chromiumLaunchOptions }
            : {}),
          ...(browserName === 'firefox'
            ? { headless: false, launchOptions: firefoxLaunch }
            : {}),
        },
      })
    }
  }
}

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60000,
  globalTimeout: 5 * 60 * 60 * 1000,
  expect: { timeout: 15000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  metadata: {
    integrationReport: process.env.E2E_INTEGRATION_REPORT,
    nativeManifest: process.env.E2E_NATIVE_MANIFEST,
    nativeInstalledSSREvidence: process.env.E2E_NATIVE_RUNTIME_REPORT,
    chromiumLaunchOptions,
    qualificationLimits:
      'Actual engine/backend probes are retained by the supervisor. No native suite-level capability skips. F02 known 22 product failures + 24 unexercised editor/Next limits are not suppressed.',
  },
  projects,
  webServer: [],
})
