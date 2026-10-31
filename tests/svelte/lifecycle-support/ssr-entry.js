import { render } from 'svelte/server'
import SsrProbe, { publicRuntimeNames } from './SsrProbe.svelte'

export function runSsrProbes() {
  // Module loading is deliberately finished by the server before these traps.
  // No await is permitted here: unrelated Vite/server work must never execute
  // while request-local global descriptors or the fetch trap are installed.
  const browserNames = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLCanvasElement',
    'OffscreenCanvas',
    'WebGLRenderingContext',
    'WebGL2RenderingContext',
    'Image',
    'ImageBitmap',
    'ResizeObserver',
    'IntersectionObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]
  const descriptors = new Map()
  let assetRequests = 0
  const createdSources = new Set()

  function renderRequest(requestId, color1, uTime) {
    let observation
    const result = render(SsrProbe, {
      idPrefix: 'native-lifecycle-ssr',
      props: {
        requestId,
        color1,
        uTime,
        observe(value) {
          observation = value
          createdSources.add(value.source)
        },
      },
    })
    // body/head access performs actual synchronous SSR, including onDestroy.
    const html = result.body
    const head = result.head
    if (!observation)
      throw new Error(
        `SSR request ${requestId} did not execute the public runtime probe.`
      )
    const record = {
      ...observation,
      html,
      head,
      finalSourceState: { ...observation.source.state },
    }
    return record
  }

  try {
    for (const name of browserNames) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
      descriptors.set(name, descriptor)
      if (descriptor && !Reflect.deleteProperty(globalThis, name)) {
        throw new Error(
          `Cannot remove browser global ${name} for the synchronous SSR probe.`
        )
      }
    }
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
    descriptors.set('fetch', fetchDescriptor)
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value() {
        assetRequests += 1
        throw new Error(
          'A server-rendered gradient attempted an asset request before client mount.'
        )
      },
    })
    const browserGlobalsAbsent = browserNames.every(
      (name) => !(name in globalThis)
    )
    if (!browserGlobalsAbsent)
      throw new Error('Browser globals remain visible during the SSR probe.')

    const alpha = renderRequest('alpha', '#1122ee', 11)
    const beta = renderRequest('beta', '#ee2211', 23)
    const repeatedAlpha = renderRequest('alpha', '#1122ee', 11)
    const identicalFreshRequests =
      alpha.html === repeatedAlpha.html && alpha.head === repeatedAlpha.head
    const distinctHandles =
      alpha.source !== beta.source &&
      alpha.source !== repeatedAlpha.source &&
      beta.source !== repeatedAlpha.source
    const firstContainsSettings =
      alpha.html.includes('data-request="alpha"') &&
      alpha.html.includes('data-color="#1122ee"') &&
      alpha.html.includes('data-time="11"')
    const secondContainsSettings =
      beta.html.includes('data-request="beta"') &&
      beta.html.includes('data-color="#ee2211"') &&
      beta.html.includes('data-time="23"')
    const firstExcludesSecond =
      !alpha.html.includes('data-request="beta"') &&
      !alpha.html.includes('data-color="#ee2211"')
    const secondExcludesFirst =
      !beta.html.includes('data-request="alpha"') &&
      !beta.html.includes('data-color="#1122ee"')
    const recordEvidence = (record) => ({
      requestId: record.requestId,
      color1: record.color1,
      uTime: record.uTime,
      html: record.html,
      initialSourceState: record.initialSourceState,
      finalSourceState: record.finalSourceState,
    })
    return {
      html: alpha.html,
      identicalFreshRequests,
      browserGlobalsAbsent,
      // Deleted globals have no getter observer. Constructor counts and reads
      // are intentionally unavailable rather than fabricated zero claims.
      browserGlobalReads: null,
      assetRequests,
      canvasConstructs: null,
      publicImports: [...publicRuntimeNames],
      requestIsolation: {
        first: recordEvidence(alpha),
        second: recordEvidence(beta),
        repeated: recordEvidence(repeatedAlpha),
        distinctHandles,
        distinctHtml: alpha.html !== beta.html,
        settingsIsolated:
          firstContainsSettings &&
          secondContainsSettings &&
          firstExcludesSecond &&
          secondExcludesFirst,
      },
    }
  } finally {
    // Defensive terminal release also covers a render which threw before its
    // component's onDestroy hook could run. These are caller-owned handles.
    try {
      for (const source of createdSources) source.dispose()
    } finally {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    }
  }
}
