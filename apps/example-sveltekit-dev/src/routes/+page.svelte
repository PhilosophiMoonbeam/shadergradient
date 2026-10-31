<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { Canvas } from '@threlte/core'
  import {
    ShaderGradient,
    ShaderGradientCanvas,
    ShaderGradientSource,
    ShaderGradientView,
    createGradientSource,
    presets,
    type GradientError,
    type GradientSettingsInput,
    type GradientSourceHandle,
    type PresetName,
  } from '@shadergradient/svelte'
  import type { PageData } from './$types'
  import SceneProbe from '../lib/SceneProbe.svelte'
  import HostScene from '../lib/HostScene.svelte'
  import { createFixtureObserver } from '../lib/fixture'
  import type {
    FixtureCanvasConfig,
    FixtureExternalConfig,
    GradientFixture,
  } from '../lib/fixture-types'
  import BindingRegression from '../lib/BindingRegression.svelte'
  import { bindingMode, type BindingMode } from '../lib/binding-probe'
  let selectedBindingMode = $state<BindingMode | null>(null)
  // Explicit handles belong to this component/request, never a module registry.
  type MirrorSourceId = 'A' | 'B' | 'C'
  type MirrorTreeId = 'main' | 'independent'
  type MirrorViewId = 'square' | 'wide' | 'tall' | 'independent'
  type MirrorError = { code: string; message: string }
  interface MirrorSourceConfig {
    mounted: boolean
    source: MirrorSourceId
    gradient: GradientSettingsInput
    width: number
    height: number
    pixelDensity: number
    maxDimension: number
    canvas: {
      fov?: number
      envBasePath?: string
      respectReducedMotion?: boolean
      preserveDrawingBuffer?: boolean
      powerPreference?: WebGLPowerPreference
    }
  }
  interface MirrorViewConfig {
    mounted: boolean
    source: MirrorSourceId
    visible: boolean
    width: number
    height: number
    pixelDensity: number
    maxDimension: number
  }
  interface MirrorCopy {
    source: MirrorSourceId
    generation: number
    sourceWidth: number
    sourceHeight: number
    crop: number[]
    width: number
    height: number
  }
  interface MirrorViewRecord {
    canvas: HTMLCanvasElement | null
    context: CanvasRenderingContext2D | null
    copies: number
    clears: number
    lastCopy: MirrorCopy | null
    oracle: {
      differingBytes: number
      maxChannelError: number
      width: number
      height: number
    } | null
    error: MirrorError | null
  }
  const mirrorFixtureEnabled =
    import.meta.env.DEV || import.meta.env.VITE_GRADIENT_FIXTURE === '1'
  const mirrorSourceIds: MirrorSourceId[] = ['A', 'B', 'C']
  const mirrorViewIds: MirrorViewId[] = [
    'square',
    'wide',
    'tall',
    'independent',
  ]
  const mirrorTreeIds: MirrorTreeId[] = ['main', 'independent']
  const mirrorHandles: Record<MirrorSourceId, GradientSourceHandle> = {
    A: createGradientSource({ label: 'Main mirrors A' }),
    B: createGradientSource({ label: 'Independent mirrors B' }),
    C: createGradientSource({ label: 'Main rebind C' }),
  }
  let mirrorTrees = $state.raw<Record<MirrorTreeId, MirrorSourceConfig>>({
    main: {
      mounted: false,
      source: 'A',
      width: 480,
      height: 320,
      pixelDensity: 1,
      maxDimension: 2048,
      gradient: {
        ...presets.halo.props,
        control: 'props',
        urlString: '',
        lightType: '3d',
        animate: 'off',
        uTime: 2,
        grain: 'on',
        enableTransition: false,
        zoomOut: false,
      },
      canvas: { fov: 45, respectReducedMotion: true },
    },
    independent: {
      mounted: true,
      source: 'B',
      width: 320,
      height: 240,
      pixelDensity: 1,
      maxDimension: 2048,
      gradient: {
        ...presets.sunset.props,
        control: 'props',
        urlString: '',
        lightType: '3d',
        animate: 'off',
        uTime: 7,
        grain: 'off',
        enableTransition: false,
        zoomOut: false,
      },
      canvas: { fov: 45, respectReducedMotion: true },
    },
  })
  let mirrorViews = $state.raw<Record<MirrorViewId, MirrorViewConfig>>({
    square: {
      mounted: true,
      source: 'A',
      visible: true,
      width: 180,
      height: 180,
      pixelDensity: 1,
      maxDimension: 2048,
    },
    wide: {
      mounted: true,
      source: 'A',
      visible: true,
      width: 300,
      height: 108,
      pixelDensity: 1,
      maxDimension: 2048,
    },
    tall: {
      mounted: true,
      source: 'A',
      visible: true,
      width: 108,
      height: 216,
      pixelDensity: 1,
      maxDimension: 2048,
    },
    independent: {
      mounted: true,
      source: 'B',
      visible: true,
      width: 180,
      height: 135,
      pixelDensity: 1,
      maxDimension: 2048,
    },
  })
  let mirrorDuplicate = $state(false)
  let mirrorDuplicateErrors = $state.raw<MirrorError[]>([])
  const mirrorErrors: MirrorError[] = []
  const mirrorRecords = Object.fromEntries(
    mirrorViewIds.map((id) => [
      id,
      {
        canvas: null,
        context: null,
        copies: 0,
        clears: 0,
        lastCopy: null,
        oracle: null,
        error: null,
      },
    ])
  ) as Record<MirrorViewId, MirrorViewRecord>
  const mirrorFrameRecords = Object.fromEntries(
    mirrorSourceIds.map((id) => [
      id,
      {
        frames: 0,
        lastFrame: null as null | {
          sequence: number
          generation: number
          width: number
          height: number
          contextIdentity: number | null
          preserveDrawingBuffer: boolean | null
        },
      },
    ])
  ) as Record<
    MirrorSourceId,
    {
      frames: number
      lastFrame: null | {
        sequence: number
        generation: number
        width: number
        height: number
        contextIdentity: number | null
        preserveDrawingBuffer: boolean | null
      }
    }
  >
  // Identities are weak; only the latest context per handle is retained for loss proof.
  const mirrorContexts = new WeakMap<WebGL2RenderingContext, number>()
  let mirrorObservedContexts = 0
  const mirrorLatestContexts: Partial<
    Record<MirrorSourceId, WebGL2RenderingContext>
  > = {}
  const mirrorFrameStops: (() => void)[] = []
  const mirrorWrapperStops = new Map<MirrorViewId, () => void>()
  const mirrorPendingRequests = new Set<() => void>()
  let mirrorOracleEnabled = false
  let mirrorAlive = true

  function mirrorError(cause: unknown, code: string): MirrorError {
    const value = cause as { code?: unknown; message?: unknown } | null
    return {
      code: typeof value?.code === 'string' ? value.code : code,
      message:
        typeof value?.message === 'string' ? value.message : String(cause),
    }
  }
  function recordMirrorError(error: GradientError) {
    mirrorErrors.push({ code: error.code, message: error.message })
  }
  function createMirrorDuplicateAttempt() {
    // Each actual boundary mount gets a fresh capture, including main remounts.
    // Preserve the typed callback before a framework can sanitize the thrown cause.
    let captured: MirrorError | undefined
    function capture(error: MirrorError) {
      if (captured) return
      captured = error
      mirrorDuplicateErrors = [...mirrorDuplicateErrors, error]
    }
    return {
      onError(error: GradientError) {
        capture({ code: error.code, message: error.message })
      },
      boundary(cause: unknown) {
        if (!captured) capture(mirrorError(cause, 'mirror-duplicate-boundary'))
      },
      failure(cause: unknown) {
        return captured ?? mirrorError(cause, 'mirror-duplicate-boundary')
      },
    }
  }
  function assertMirrorAlive() {
    if (!mirrorAlive)
      throw Object.assign(
        new Error(
          'This mirror fixture was torn down; navigate back for a fresh tree.'
        ),
        { code: 'mirror-fixture-disposed' }
      )
  }
  function mirrorPixels(record: MirrorViewRecord) {
    const canvas = record.canvas
    if (!canvas || !record.context || canvas.width === 0 || canvas.height === 0)
      return null
    try {
      const bytes = record.context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      ).data
      let hash = 2166136261
      let nonzeroAlpha = 0
      for (let index = 0; index < bytes.length; index += 1) {
        hash = Math.imul(hash ^ bytes[index], 16777619) >>> 0
        if (index % 4 === 3 && bytes[index] !== 0) nonzeroAlpha += 1
      }
      return { hash, nonzeroAlpha }
    } catch (cause) {
      record.error = mirrorError(cause, 'mirror-pixel-read')
      return null
    }
  }
  function mirrorState(id: MirrorSourceId) {
    const state = mirrorHandles[id].state
    return {
      status: state.status,
      generation: state.generation,
      ...(state.error
        ? { error: { code: state.error.code, message: state.error.message } }
        : {}),
    }
  }
  function mirrorSnapshot() {
    const entries: { identity: number; lost: boolean }[] = []
    for (const id of mirrorSourceIds) {
      const context = mirrorLatestContexts[id]
      if (!context) continue
      const identity = mirrorContexts.get(context)!
      if (entries.some((entry) => entry.identity === identity)) continue
      entries.push({ identity, lost: context.isContextLost() })
    }
    const snapshot = {
      version: 1,
      sources: Object.fromEntries(
        mirrorSourceIds.map((id) => [
          id,
          {
            state: mirrorState(id),
            demand: mirrorHandles[id].demand,
            ...mirrorFrameRecords[id],
            contextIdentity: mirrorLatestContexts[id]
              ? (mirrorContexts.get(mirrorLatestContexts[id]!) ?? null)
              : null,
          },
        ])
      ),
      trees: mirrorTrees,
      views: Object.fromEntries(
        mirrorViewIds.map((id) => {
          const record = mirrorRecords[id]
          return [
            id,
            {
              config: mirrorViews[id],
              attached: record.canvas !== null,
              copies: record.copies,
              clears: record.clears,
              buffer: record.canvas
                ? { width: record.canvas.width, height: record.canvas.height }
                : null,
              pixels: mirrorPixels(record),
              lastCopy: record.lastCopy,
              oracle: record.oracle,
              error: record.error,
            },
          ]
        })
      ),
      contexts: {
        observed: mirrorObservedContexts,
        live: entries.filter((entry) => !entry.lost).length,
        lost: entries.filter((entry) => entry.lost).length,
        entries,
      },
      resources: {
        rendererCreations: null,
        rendererDisposals: null,
        geometryDisposals: null,
        materialDisposals: null,
        textureDisposals: null,
        passDisposals: null,
        targetDisposals: null,
      },
      duplicate: { enabled: mirrorDuplicate, errors: mirrorDuplicateErrors },
      errors: mirrorErrors,
      instrumentation: {
        frameSubscriptions: mirrorFrameStops.length,
        viewWrappers: mirrorWrapperStops.size,
        pendingRequests: mirrorPendingRequests.size,
        oracleEnabled: mirrorOracleEnabled,
      },
    }
    return JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
  }
  const mirrorApi = {
    version: 1,
    snapshot: mirrorSnapshot,
    async configureSource(
      tree: MirrorTreeId,
      patch: Partial<MirrorSourceConfig>
    ) {
      assertMirrorAlive()
      const current = mirrorTrees[tree]
      mirrorTrees = {
        ...mirrorTrees,
        [tree]: {
          ...current,
          ...patch,
          gradient: { ...current.gradient, ...patch.gradient },
          canvas: { ...current.canvas, ...patch.canvas },
        },
      }
      await tick()
      return mirrorSnapshot()
    },
    async configureView(id: MirrorViewId, patch: Partial<MirrorViewConfig>) {
      assertMirrorAlive()
      mirrorViews = { ...mirrorViews, [id]: { ...mirrorViews[id], ...patch } }
      await tick()
      return mirrorSnapshot()
    },
    async setDuplicate(enabled: boolean) {
      assertMirrorAlive()
      mirrorDuplicate = enabled
      await tick()
      return mirrorSnapshot()
    },
    async setOracle(enabled: boolean) {
      assertMirrorAlive()
      mirrorOracleEnabled = enabled
      for (const id of mirrorViewIds) mirrorRecords[id].oracle = null
      await tick()
      return mirrorSnapshot()
    },
    async disposeHandle(id: MirrorSourceId) {
      assertMirrorAlive()
      mirrorHandles[id].dispose()
      await tick()
      return mirrorSnapshot()
    },
    context(id: MirrorSourceId) {
      return mirrorLatestContexts[id] ?? null
    },
    requestFrame(
      id: MirrorSourceId
    ): Promise<ReturnType<typeof mirrorSnapshot>> {
      assertMirrorAlive()
      return new Promise((resolve, reject) => {
        let stop: (() => void) | undefined
        let lease: ReturnType<GradientSourceHandle['requestFrame']> | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let settled = false
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          stop?.()
          clearTimeout(timer)
          mirrorPendingRequests.delete(cancel)
          if (error) {
            lease?.release()
            reject(error)
          } else {
            // Let publishFrame finish every synchronous consumer before releasing
            // the one-shot lease (zero demand can immediately destroy the GPU).
            void tick().then(() => {
              lease?.release()
              try {
                assertMirrorAlive()
                resolve(mirrorSnapshot())
              } catch (cause) {
                reject(cause)
              }
            })
          }
        }
        const cancel = () =>
          finish(
            Object.assign(
              new Error('Mirror caller teardown canceled this frame request.'),
              { code: 'mirror-fixture-disposed' }
            )
          )
        mirrorPendingRequests.add(cancel)
        try {
          stop = mirrorHandles[id].subscribeFrames(() => finish())
          timer = setTimeout(
            () =>
              finish(
                Object.assign(
                  new Error(
                    `No completed frame from ${id} within 10000ms; check producer mount, state and demand.`
                  ),
                  { code: 'mirror-frame-timeout' }
                )
              ),
            10000
          )
          lease = mirrorHandles[id].requestFrame()
        } catch (cause) {
          finish(cause instanceof Error ? cause : new Error(String(cause)))
        }
      })
    },
  }

  // Instance-only wrappers observe real View work. No prototype/global interception.
  function observeMirror(node: HTMLElement, id: MirrorViewId) {
    if (!mirrorFixtureEnabled) return
    const record = mirrorRecords[id]
    let restore: (() => void) | undefined
    let oracleCanvas: HTMLCanvasElement | undefined
    let oracleContext: CanvasRenderingContext2D | null = null
    let live = true
    function install() {
      const canvas = node.querySelector('canvas')
      if (!live || !canvas || record.canvas === canvas) return
      restore?.()
      record.canvas = canvas
      try {
        record.context = canvas.getContext('2d')
      } catch (cause) {
        record.context = null
        record.error = mirrorError(cause, 'mirror-2d-unavailable')
        return
      }
      const context = record.context
      if (!context) {
        record.error = {
          code: 'mirror-2d-unavailable',
          message: 'The real mirror canvas has no 2D context.',
        }
        return
      }
      const originalDraw = context.drawImage
      const originalClear = context.clearRect
      const wrappedDraw = function (
        this: CanvasRenderingContext2D,
        image: CanvasImageSource,
        sx: number,
        sy: number,
        sw?: number,
        sh?: number,
        dx?: number,
        dy?: number,
        dw?: number,
        dh?: number
      ) {
        // Native Views use the nine-argument overload: keep that hot path free
        // of rest-array allocation while preserving other real draw overloads.
        if (arguments.length === 9)
          originalDraw.call(this, image, sx, sy, sw!, sh!, dx!, dy!, dw!, dh!)
        else Reflect.apply(originalDraw, this, arguments)
        record.copies += 1
        if (!(image instanceof HTMLCanvasElement)) return
        let source: MirrorSourceId | undefined
        for (const candidate of mirrorSourceIds) {
          if (mirrorLatestContexts[candidate]?.canvas === image) {
            source = candidate
            break
          }
        }
        if (source === undefined) {
          record.lastCopy = null
          record.error = {
            code: 'mirror-copy-source-unobserved',
            message:
              'This actual copy source has not appeared in the public completed-frame subscription.',
          }
          return
        }
        if (!record.lastCopy)
          record.lastCopy = {
            source,
            generation: 0,
            sourceWidth: 0,
            sourceHeight: 0,
            crop: [],
            width: 0,
            height: 0,
          }
        const copy = record.lastCopy
        copy.source = source
        copy.generation = mirrorFrameRecords[source].lastFrame!.generation
        copy.sourceWidth = image.width
        copy.sourceHeight = image.height
        copy.width = canvas.width
        copy.height = canvas.height
        copy.crop[0] = sx
        copy.crop[1] = sy
        copy.crop[2] = Number(sw)
        copy.crop[3] = Number(sh)
        copy.crop[4] = Number(dx)
        copy.crop[5] = Number(dy)
        copy.crop[6] = Number(dw)
        copy.crop[7] = Number(dh)
        copy.crop.length = arguments.length - 1
        record.error = null
        if (!mirrorOracleEnabled) return
        try {
          oracleCanvas ??= document.createElement('canvas')
          if (oracleCanvas.width !== canvas.width)
            oracleCanvas.width = canvas.width
          if (oracleCanvas.height !== canvas.height)
            oracleCanvas.height = canvas.height
          oracleContext ??= oracleCanvas.getContext('2d')
          if (!oracleContext)
            throw new Error(
              'A real 2D context is required for the final-frame oracle.'
            )
          oracleContext.imageSmoothingEnabled = context.imageSmoothingEnabled
          oracleContext.imageSmoothingQuality = context.imageSmoothingQuality
          const scale = Math.max(
            canvas.width / image.width,
            canvas.height / image.height
          )
          const width = canvas.width / scale
          const height = canvas.height / scale
          oracleContext.clearRect(0, 0, canvas.width, canvas.height)
          // Borrow the actual final-render source only for this synchronous copy.
          oracleContext.drawImage(
            image,
            (image.width - width) / 2,
            (image.height - height) / 2,
            width,
            height,
            0,
            0,
            canvas.width,
            canvas.height
          )
          const expected = oracleContext.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          ).data
          const actual = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          ).data
          let differingBytes = 0
          let maxChannelError = 0
          for (let index = 0; index < expected.length; index += 1) {
            const difference = Math.abs(expected[index] - actual[index])
            if (difference !== 0) differingBytes += 1
            if (difference > maxChannelError) maxChannelError = difference
          }
          record.oracle ??= {
            differingBytes: 0,
            maxChannelError: 0,
            width: 0,
            height: 0,
          }
          record.oracle.differingBytes = differingBytes
          record.oracle.maxChannelError = maxChannelError
          record.oracle.width = canvas.width
          record.oracle.height = canvas.height
        } catch (cause) {
          record.oracle = null
          record.error = mirrorError(cause, 'mirror-oracle-read')
        }
      } as typeof context.drawImage
      const wrappedClear: typeof context.clearRect = function (
        this: CanvasRenderingContext2D,
        x,
        y,
        width,
        height
      ) {
        originalClear.call(this, x, y, width, height)
        record.clears += 1
      }
      context.drawImage = wrappedDraw
      context.clearRect = wrappedClear
      restore = () => {
        if (context.drawImage === wrappedDraw) context.drawImage = originalDraw
        if (context.clearRect === wrappedClear)
          context.clearRect = originalClear
        if (record.canvas === canvas) {
          record.canvas = null
          record.context = null
        }
      }
    }
    install()
    const observer = new MutationObserver(install)
    observer.observe(node, { childList: true, subtree: true })
    const destroy = () => {
      if (!live) return
      live = false
      observer.disconnect()
      restore?.()
      record.canvas = null
      record.context = null
      oracleCanvas = undefined
      oracleContext = null
      mirrorWrapperStops.delete(id)
    }
    mirrorWrapperStops.set(id, destroy)
    return destroy
  }
  // Register before child Views: provenance comes from actual public frames, not
  // the requested View configuration. SSR registers callbacks but never renders.
  if (mirrorFixtureEnabled) {
    for (const id of mirrorSourceIds) {
      mirrorFrameStops.push(
        mirrorHandles[id].subscribeFrames((frame, token) => {
          const record = mirrorFrameRecords[id]
          record.frames += 1
          // This canvas already rendered WebGL2; asking for its existing context
          // observes identity, and never constructs another canvas or renderer.
          const previous = mirrorLatestContexts[id]
          const context =
            previous?.canvas === frame.canvas
              ? previous
              : frame.canvas.getContext('webgl2')
          let contextIdentity: number | null = null
          if (context) {
            if (!mirrorContexts.has(context))
              mirrorContexts.set(context, ++mirrorObservedContexts)
            contextIdentity = mirrorContexts.get(context)!
            mirrorLatestContexts[id] = context
          }
          record.lastFrame ??= {
            sequence: 0,
            generation: 0,
            width: 0,
            height: 0,
            contextIdentity: null,
            preserveDrawingBuffer: null,
          }
          const last = record.lastFrame
          last.sequence = frame.sequence
          last.generation = token.generation
          last.width = frame.width
          last.height = frame.height
          if (last.contextIdentity !== contextIdentity) {
            last.preserveDrawingBuffer =
              context?.getContextAttributes()?.preserveDrawingBuffer ?? null
          }
          last.contextIdentity = contextIdentity
        })
      )
    }
  }
  onMount(() => {
    if (!mirrorFixtureEnabled) return
    // The original fixture object and its v1 methods retain their identities.
    Object.assign(fixture, { mirrors: mirrorApi })
  })
  onDestroy(() => {
    mirrorAlive = false
    for (const cancel of mirrorPendingRequests) cancel()
    for (const stop of mirrorFrameStops) stop()
    mirrorFrameStops.length = 0
    for (const stop of mirrorWrapperStops.values()) stop()
    if (fixture.mirrors === mirrorApi) delete fixture.mirrors
    for (const id of mirrorSourceIds) {
      mirrorHandles[id].dispose()
      delete mirrorLatestContexts[id]
    }
  })

  let { data }: { data: PageData } = $props()
  let settings = $state.raw<GradientSettingsInput>(
    untrack(() => ({ ...data.initialSettings }))
  )
  let canvasConfig = $state.raw<FixtureCanvasConfig>({ pointerEvents: 'auto' })
  let mounted = $state(true)
  let clientMounted = $state(false)
  let placedVisible = $state(true)
  let wrapper = $state.raw<HTMLDivElement>()
  let external = $state.raw<FixtureExternalConfig>({
    enabled: false,
    gradients: [],
  })
  let secondColor = $state('#36bfa8')
  let secondMounted = $state(true)
  let uiError = $state('')
  let nativeError = $state('')
  const observer = createFixtureObserver({
    mounted: () => mounted,
    wrapper: () => wrapper,
    respectReducedMotion: () => canvasConfig.respectReducedMotion ?? true,
    lazyLoad: () => canvasConfig.lazyLoad ?? true,
    density: () =>
      Number.isFinite(canvasConfig.pixelDensity) &&
      canvasConfig.pixelDensity! > 0
        ? canvasConfig.pixelDensity!
        : 1,
    fov: () =>
      Number.isFinite(canvasConfig.fov) &&
      canvasConfig.fov! > 0 &&
      canvasConfig.fov! < 180
        ? canvasConfig.fov!
        : 45,
  })
  function reportNativeError(error: GradientError) {
    nativeError = `${error.code}: ${error.message}`
    observer.error(error)
  }
  $effect(() => {
    settings = { ...data.initialSettings }
  })
  const fixture: GradientFixture = {
    version: 1,
    update(patch) {
      return observer.operation(() => {
        settings = {
          ...settings,
          ...Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined)
          ),
        }
      })
    },
    configureCanvas(patch) {
      return observer.operation(() => {
        canvasConfig = {
          ...canvasConfig,
          ...Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined)
          ),
        }
      })
    },
    snapshot: observer.snapshot,
    lifecycle: {
      setMounted(value) {
        return observer.operation(
          () => {
            mounted = value
          },
          'native',
          !value
        )
      },
      async setIndependentMounted(value) {
        secondMounted = value
        await tick()
      },
      setVisible(value) {
        return observer.operation(
          () => {
            placedVisible = value
          },
          'native',
          false,
          value
        )
      },
      requestFrame() {
        return observer.operation(() => {})
      },
    },
    externalHost: {
      configure(config) {
        return observer.operation(
          () => {
            external = {
              enabled: config.enabled,
              gradients: config.gradients.map((gradient) => ({ ...gradient })),
            }
          },
          'host',
          !config.enabled
        )
      },
      clear() {
        return observer.operation(
          () => {
            external = { ...external, gradients: [] }
          },
          'host',
          !external.enabled
        )
      },
    },
  }
  async function apply(operation: Promise<unknown>) {
    uiError = ''
    try {
      await operation
    } catch (error) {
      uiError = error instanceof Error ? error.message : String(error)
    }
  }
  function selectPreset(name: PresetName) {
    void apply(
      fixture.update({
        ...presets[name].props,
        control: 'props',
        urlString: '',
      })
    )
  }
  onMount(() => {
    selectedBindingMode = bindingMode(window.location.search)
    clientMounted = true
    window.gradientFixture = fixture
    return () => {
      mounted = false
      observer.dispose()
      if (window.gradientFixture === fixture) delete window.gradientFixture
    }
  })
  $effect(() => {
    if (!wrapper) return
    return observer.observeVisibility(wrapper, {
      threshold: canvasConfig.threshold ?? 0,
      rootMargin: canvasConfig.rootMargin ?? '0px',
    })
  })
</script>

<svelte:head>
  <title>Native ShaderGradient · SvelteKit SSR</title>
  <meta
    name="description"
    content="A request-isolated, server-rendered SvelteKit consumer of native ShaderGradient with accessible live controls and real navigation teardown."
  />
</svelte:head>

<main>
  {#if selectedBindingMode}
    <BindingRegression mode={selectedBindingMode} />
  {:else}
    <header>
      <p class="eyebrow">Native Svelte + Threlte · SvelteKit 3.1</p>
      <h1>ShaderGradient, with the page intact</h1>
      <p data-testid="ssr-content">
        This article, navigation and controls are server rendered. Only the
        dimensioned gradient scenes wait for browser mount and WebGL.
      </p>
      <p
        data-testid="request-settings"
        data-request={data.requestLabel}
        data-color1={data.initialSettings.color1}
      >
        Request: <strong>{data.requestLabel}</strong> · Initial color:
        <code>{data.initialSettings.color1}</code>
      </p>
      <nav aria-label="Examples">
        <a href="/away" data-testid="away-link">Visit the away route</a>
        <a href="/?request=coral&color1=%23ff7044">Coral request</a>
        <a href="/?request=ocean&color1=%232280cc">Ocean request</a>
      </nav>
    </header>

    <section aria-labelledby="managed-heading">
      <h2 id="managed-heading">Live managed scene</h2>
      <div class="controls">
        <label
          >Preset <select
            aria-label="Preset"
            onchange={(event) =>
              selectPreset(event.currentTarget.value as PresetName)}
          >
            {#each Object.keys(presets) as name (name)}<option value={name}
                >{name}</option
              >{/each}
          </select></label
        >
        <label
          >Shader <select
            aria-label="Shader"
            value={settings.shader ?? 'defaults'}
            onchange={(event) =>
              apply(
                fixture.update({
                  control: 'props',
                  shader: event.currentTarget.value as
                    'defaults' | 'positionMix' | 'cosmic' | 'glass',
                })
              )}
          >
            <option>defaults</option><option>positionMix</option><option
              >cosmic</option
            ><option>glass</option>
          </select></label
        >
        <label
          >Geometry <select
            aria-label="Geometry"
            value={settings.type ?? 'plane'}
            onchange={(event) =>
              apply(
                fixture.update({
                  control: 'props',
                  type: event.currentTarget.value as
                    'plane' | 'sphere' | 'waterPlane',
                })
              )}
          >
            <option>plane</option><option>sphere</option><option
              >waterPlane</option
            >
          </select></label
        >
        <label
          >First color <input
            aria-label="First color"
            type="color"
            value={settings.color1 ?? '#ff5005'}
            oninput={(event) =>
              apply(
                fixture.update({
                  control: 'props',
                  color1: event.currentTarget.value,
                })
              )}
          /></label
        >
        <label
          >Noise strength <input
            aria-label="Noise strength"
            type="range"
            min="0"
            max="10"
            step="0.1"
            value={settings.uStrength ?? 4}
            oninput={(event) =>
              apply(
                fixture.update({
                  control: 'props',
                  uStrength: Number(event.currentTarget.value),
                })
              )}
          /></label
        >
        <label
          >Animate <input
            type="checkbox"
            checked={settings.animate !== 'off'}
            onchange={(event) =>
              apply(
                fixture.update({
                  control: 'props',
                  animate: event.currentTarget.checked ? 'on' : 'off',
                })
              )}
          /></label
        >
        <label
          >Grain <input
            type="checkbox"
            checked={settings.grain !== 'off'}
            onchange={(event) =>
              apply(
                fixture.update({
                  control: 'props',
                  grain: event.currentTarget.checked ? 'on' : 'off',
                })
              )}
          /></label
        >
        <button onclick={() => apply(fixture.lifecycle.setMounted(!mounted))}
          >{mounted ? 'Unmount' : 'Mount'} managed scene</button
        >
        <button
          onclick={() => apply(fixture.lifecycle.setVisible(!placedVisible))}
          >{placedVisible ? 'Move scene offscreen' : 'Bring scene back'}</button
        >
        <button onclick={() => apply(fixture.lifecycle.requestFrame())}
          >Request a completed frame</button
        >
      </div>
      <p>
        Drag the scene to orbit; scroll or pinch to zoom. Reduced motion follows
        your browser preference.
      </p>
      <div
        bind:this={wrapper}
        class="managed-placement"
        class:offscreen={!placedVisible}
        data-testid="managed-placement"
      >
        {#if mounted}
          <ShaderGradientCanvas
            {...canvasConfig}
            class="managed-gradient"
            style="width:100%;height:360px"
            aria-hidden={false}
            role="img"
            aria-label="Interactive shader gradient"
            onError={reportNativeError}
          >
            <SceneProbe {observer} />
            <ShaderGradient
              {...settings}
              onCameraUpdate={observer.cameraUpdate}
              onError={reportNativeError}
            />
            {#snippet fallback(state)}
              <div
                class="fallback"
                data-native-fallback={state.status}
                data-testid="native-fallback"
              >
                <strong>Gradient preview</strong><span
                  >{state.status === 'deferred'
                    ? 'The interactive gradient starts in your browser when visible.'
                    : state.status === 'loading'
                      ? 'Preparing the first rendered frame…'
                      : state.error.message}</span
                >
              </div>
            {/snippet}
          </ShaderGradientCanvas>
        {:else}<div class="empty-scene">
            The managed scene has been unmounted.
          </div>{/if}
      </div>
      {#if uiError}<p role="alert">{uiError}</p>{/if}
    </section>

    <section aria-labelledby="independent-heading">
      <h2 id="independent-heading">An independent instance</h2>
      <p>
        Changing or removing this scene does not change the managed scene above.
      </p>
      <label
        >Independent color <input
          aria-label="Independent color"
          type="color"
          bind:value={secondColor}
        /></label
      >
      <button
        data-testid="independent-canvases-toggle"
        aria-pressed={secondMounted}
        onclick={() => (secondMounted = !secondMounted)}
        >{secondMounted ? 'Remove' : 'Restore'} independent instance</button
      >
      {#if secondMounted}
        <div data-testid="independent-a">
          <ShaderGradientCanvas
            style="width:100%;height:220px"
            class="independent-gradient"
            aria-hidden={false}
            role="img"
            aria-label="Independent teal gradient"
          >
            <ShaderGradient
              color1={secondColor}
              color2="#3647d6"
              color3="#eee2fa"
              animate="off"
              grain="off"
            />
            {#snippet fallback(state)}<div
                class="fallback"
                data-independent-fallback={state.status}
              >
                Independent gradient · {state.status}
              </div>{/snippet}
          </ShaderGradientCanvas>
        </div>
      {/if}
    </section>

    <section aria-labelledby="host-heading">
      <h2 id="host-heading">Compose inside a host-owned Canvas</h2>
      <p>
        The host supplies its own camera, environment and white cube. Clearing
        external gradients leaves these host objects and their renderer intact.
      </p>
      <div class="controls">
        <button
          onclick={() =>
            apply(
              fixture.externalHost.configure({
                enabled: true,
                gradients: [
                  {
                    shader: 'defaults',
                    type: 'plane',
                    animate: 'off',
                    positionX: -2,
                    rotationZ: 0,
                    color1: '#fd7454',
                  },
                  {
                    shader: 'cosmic',
                    type: 'sphere',
                    animate: 'off',
                    positionX: 2,
                    rotationZ: 0,
                    color1: '#65c4ff',
                  },
                ],
              })
            )}>Mount two external gradients</button
        >
        <button onclick={() => apply(fixture.externalHost.clear())}
          >Clear external gradients, retain host</button
        >
        <button
          onclick={() =>
            apply(
              fixture.externalHost.configure({ enabled: false, gradients: [] })
            )}>Destroy host Canvas</button
        >
      </div>
      {#if clientMounted && external.enabled}
        <svelte:boundary
          onerror={(error) =>
            observer.error(
              {
                code: 'renderer',
                message: error instanceof Error ? error.message : String(error),
                cause: error,
              },
              'host'
            )}
        >
          <div class="host-canvas" data-testid="external-host">
            <Canvas renderMode="on-demand"
              ><HostScene {observer} gradients={external.gradients} /></Canvas
            >
          </div>
          {#snippet failed(error)}<p role="alert">
              The host Canvas could not start: {error instanceof Error
                ? error.message
                : String(error)}
            </p>{/snippet}
        </svelte:boundary>
      {/if}
    </section>

    <section aria-labelledby="fallback-heading">
      <h2 id="fallback-heading">Errors remain visible</h2>
      <p>
        Fallbacks preserve useful content when WebGL is unavailable. This button
        deliberately points the native environment loader at a nonexistent local
        asset directory, so its real typed error can be observed without
        replacing the page.
      </p>
      <button
        onclick={() =>
          apply(
            fixture
              .configureCanvas({ envBasePath: '/missing-fixture-hdr/' })
              .then(() =>
                fixture.update({ control: 'props', lightType: 'env' })
              )
          )}>Demonstrate HDR asset failure</button
      >
      <button
        onclick={() =>
          apply(fixture.update({ control: 'props', lightType: '3d' }))}
        >Return to ambient lighting</button
      >
      {#if nativeError}<p role="alert" data-testid="native-error">
          {nativeError}
        </p>{/if}
      <p>
        Resource counters observe only attached resources; unobservable pass,
        target and mirror-copy metrics are reported as null, never assumed zero.
        They do not certify GPU-memory release.
      </p>
    </section>
    <section aria-labelledby="mirror-heading" data-testid="mirror-demo">
      <h2 id="mirror-heading">One producer, three aspect-ratio mirrors</h2>
      <p>
        Views mount first. Add the producer to show its final frame, including
        grain, through three centered-cover 2D copies. These decorative,
        noninteractive mirrors share one camera, not three independent scenes.
        The fourth view has its own independent handle and producer. Last
        visible consumer release frees the source GPU; reentry creates a fresh
        generation with the configured time.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin:1rem 0">
        <button
          data-testid="mirror-toggle-source"
          onclick={() =>
            mirrorApi.configureSource('main', {
              mounted: !mirrorTrees.main.mounted,
            })}
        >
          {mirrorTrees.main.mounted ? 'Remove' : 'Add late'} mirror producer
        </button>
        <button
          onclick={() =>
            mirrorApi.configureSource('main', {
              gradient: {
                animate:
                  mirrorTrees.main.gradient.animate === 'on' ? 'off' : 'on',
              },
            })}
        >
          {mirrorTrees.main.gradient.animate === 'on' ? 'Pause' : 'Animate'} mirror
          source
        </button>
        <button
          onclick={() => {
            for (const id of ['square', 'wide', 'tall'] as MirrorViewId[])
              void mirrorApi.configureView(id, { visible: false })
          }}>Move main mirrors offscreen</button
        >
        <button
          onclick={() => {
            for (const id of ['square', 'wide', 'tall'] as MirrorViewId[])
              void mirrorApi.configureView(id, { visible: true })
          }}>Return main mirrors</button
        >
        <button
          disabled={!mirrorTrees.main.mounted}
          onclick={() => mirrorApi.setDuplicate(!mirrorDuplicate)}
        >
          {mirrorDuplicate ? 'Remove' : 'Attempt'} duplicate producer
        </button>
      </div>
      <div
        style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;min-height:216px"
      >
        {#each mirrorViewIds as id (id)}
          {@const config = mirrorViews[id]}
          {#if config.mounted}
            <div
              data-testid={`mirror-view-${id}`}
              {@attach (node) => observeMirror(node, id)}
              style={`width:${config.width}px;height:${config.height}px;flex:none;background:#283044;${config.visible ? '' : 'position:fixed;right:calc(100vw + 1px);top:0;'}`}
            >
              <ShaderGradientView
                source={mirrorHandles[config.source]}
                pixelDensity={config.pixelDensity}
                maxDimension={config.maxDimension}
                style="width:100%;height:100%"
                onError={recordMirrorError}
              >
                {#snippet fallback(state)}
                  <span style="display:block;padding:0.5rem"
                    >{id} · {state.status}</span
                  >
                {/snippet}
              </ShaderGradientView>
            </div>
          {/if}
        {/each}
      </div>
      <p data-testid="mirror-source-status">
        {#each mirrorSourceIds as id (id)}
          {@const state = mirrorHandles[id].state}
          <span
            >{id}: {state.status} · generation {state.generation}
            {#if state.error}<span role="alert">
                · {state.error.code}: {state.error.message}</span
              >{/if}
          </span>
        {/each}
      </p>
      {#each mirrorTreeIds as tree (tree)}
        {@const config = mirrorTrees[tree]}
        {#if config.mounted}
          <svelte:boundary
            onerror={(cause) =>
              mirrorErrors.push(mirrorError(cause, 'mirror-source-boundary'))}
          >
            <ShaderGradientSource
              data-testid={`mirror-source-${tree}`}
              source={mirrorHandles[config.source]}
              gradient={config.gradient}
              canvas={config.canvas}
              width={config.width}
              height={config.height}
              pixelDensity={config.pixelDensity}
              maxDimension={config.maxDimension}
              onError={recordMirrorError}
            />
            {#snippet failed(error)}
              <p role="alert">
                Mirror {tree} producer: {mirrorError(
                  error,
                  'mirror-source-boundary'
                ).code} · {mirrorError(error, 'mirror-source-boundary').message}
              </p>
            {/snippet}
          </svelte:boundary>
        {/if}
      {/each}
      {#if mirrorDuplicate && mirrorTrees.main.mounted}
        {@const attempt = createMirrorDuplicateAttempt()}
        <svelte:boundary onerror={attempt.boundary}>
          <ShaderGradientSource
            data-testid="mirror-duplicate"
            source={mirrorHandles[mirrorTrees.main.source]}
            gradient={mirrorTrees.main.gradient}
            onError={attempt.onError}
          />
          {#snippet failed(error)}
            {@const failure = attempt.failure(error)}
            <p role="alert" data-testid="mirror-duplicate-error">
              {failure.code}: {failure.message}
              The original producer and independent tree remain owned by their callers.
            </p>
          {/snippet}
        </svelte:boundary>
      {/if}
      <details>
        <summary>Mirror source, rebind, resolution and view controls</summary>
        <div
          style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start;margin-top:1rem"
        >
          {#each mirrorTreeIds as tree (tree)}
            {@const config = mirrorTrees[tree]}
            <fieldset style="display:grid;gap:0.5rem;max-width:22rem">
              <legend>Mirror {tree} source</legend>
              <label
                ><input
                  type="checkbox"
                  checked={config.mounted}
                  onchange={(event) =>
                    mirrorApi.configureSource(tree, {
                      mounted: event.currentTarget.checked,
                    })}
                /> Mounted</label
              >
              <label
                >Mirror {tree} producer handle
                <select
                  value={config.source}
                  onchange={(event) =>
                    mirrorApi.configureSource(tree, {
                      source: event.currentTarget.value as MirrorSourceId,
                    })}
                >
                  {#each mirrorSourceIds as id (id)}<option value={id}
                      >{id}</option
                    >{/each}
                </select>
              </label>
              <label
                >Mirror {tree} preset
                <select
                  onchange={(event) =>
                    mirrorApi.configureSource(tree, {
                      gradient: {
                        ...presets[event.currentTarget.value as PresetName]
                          .props,
                        control: 'props',
                        urlString: '',
                        lightType: '3d',
                        animate: 'off',
                        enableTransition: false,
                        zoomOut: false,
                      },
                    })}
                >
                  {#each Object.keys(presets) as name (name)}<option
                      value={name}
                      selected={name === (tree === 'main' ? 'halo' : 'sunset')}
                      >{name}</option
                    >{/each}
                </select>
              </label>
              <label
                >Mirror {tree} color<input
                  type="color"
                  value={config.gradient.color1}
                  oninput={(event) =>
                    mirrorApi.configureSource(tree, {
                      gradient: { color1: event.currentTarget.value },
                    })}
                /></label
              >
              <label
                >Mirror {tree} time<input
                  type="number"
                  step="0.5"
                  value={config.gradient.uTime}
                  oninput={(event) =>
                    mirrorApi.configureSource(tree, {
                      gradient: { uTime: event.currentTarget.valueAsNumber },
                    })}
                /></label
              >
              <label
                >Mirror {tree} grain<select
                  value={config.gradient.grain}
                  onchange={(event) =>
                    mirrorApi.configureSource(tree, {
                      gradient: {
                        grain: event.currentTarget.value as 'on' | 'off',
                      },
                    })}><option>on</option><option>off</option></select
                ></label
              >
              <label
                >Mirror {tree} lighting<select
                  value={config.gradient.lightType}
                  onchange={(event) =>
                    mirrorApi.configureSource(tree, {
                      gradient: {
                        lightType: event.currentTarget.value as '3d' | 'env',
                      },
                    })}><option>3d</option><option>env</option></select
                ></label
              >
              <label
                >Mirror {tree} HDR base<input
                  value={config.canvas.envBasePath ?? ''}
                  placeholder="Default remote HDR manifest"
                  onchange={(event) =>
                    mirrorApi.configureSource(tree, {
                      canvas: {
                        envBasePath: event.currentTarget.value || undefined,
                      },
                    })}
                /></label
              >
              <label
                >Mirror {tree} field of view<input
                  type="number"
                  value={config.canvas.fov}
                  oninput={(event) =>
                    mirrorApi.configureSource(tree, {
                      canvas: { fov: event.currentTarget.valueAsNumber },
                    })}
                /></label
              >
              {#each ['width', 'height', 'pixelDensity', 'maxDimension'] as field (field)}
                <label
                  >Mirror {tree}
                  {field}<input
                    type="number"
                    step="any"
                    value={config[field as 'width']}
                    oninput={(event) =>
                      mirrorApi.configureSource(tree, {
                        [field]: event.currentTarget.valueAsNumber,
                      })}
                  /></label
                >
              {/each}
            </fieldset>
          {/each}
          {#each mirrorViewIds as id (id)}
            {@const config = mirrorViews[id]}
            <fieldset style="display:grid;gap:0.5rem;max-width:22rem">
              <legend>Mirror {id} view</legend>
              <label
                ><input
                  type="checkbox"
                  checked={config.mounted}
                  onchange={(event) =>
                    mirrorApi.configureView(id, {
                      mounted: event.currentTarget.checked,
                    })}
                /> Mounted</label
              >
              <label
                ><input
                  type="checkbox"
                  checked={config.visible}
                  onchange={(event) =>
                    mirrorApi.configureView(id, {
                      visible: event.currentTarget.checked,
                    })}
                /> Place in document (not offscreen)</label
              >
              <label
                >Mirror {id} view handle<select
                  value={config.source}
                  onchange={(event) =>
                    mirrorApi.configureView(id, {
                      source: event.currentTarget.value as MirrorSourceId,
                    })}
                >
                  {#each mirrorSourceIds as source (source)}<option
                      value={source}>{source}</option
                    >{/each}
                </select></label
              >
              {#each ['width', 'height', 'pixelDensity', 'maxDimension'] as field (field)}
                <label
                  >Mirror {id}
                  {field}<input
                    type="number"
                    step="any"
                    value={config[field as 'width']}
                    oninput={(event) =>
                      mirrorApi.configureView(id, {
                        [field]: event.currentTarget.valueAsNumber,
                      })}
                  /></label
                >
              {/each}
            </fieldset>
          {/each}
        </div>
      </details>
      <p>
        Frame, copy and pixel observations are pull-only development fixtures,
        not per-frame UI. Unobservable GPU allocation/disposal metrics stay
        null; observed WebGL identities and actual context-loss status are not
        GPU-memory certificates.
      </p>
    </section>
    <footer>
      <p>
        Native package imports only. No request-global settings, server graphics
        construction, or page-wide client-only replacement.
      </p>
    </footer>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font:
      16px/1.6 system-ui,
      sans-serif;
    background: #111521;
    color: #eff2ff;
  }
  :global(*) {
    box-sizing: border-box;
  }
  main {
    max-width: 72rem;
    margin: auto;
    padding: 2rem 1.25rem 4rem;
  }
  h1 {
    font-size: clamp(2rem, 4vw, 3.5rem);
    line-height: 1.15;
  }
  h2 {
    line-height: 1.25;
  }
  .eyebrow {
    color: #b5bfff;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.8rem;
  }
  nav,
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    align-items: center;
  }
  a {
    color: #adcaff;
  }
  section {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid #333b53;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  button,
  select,
  input {
    font: inherit;
  }
  button,
  select {
    padding: 0.4rem 0.65rem;
    border-radius: 0.4rem;
    border: 1px solid #8590b5;
    background: #252d44;
    color: #fff;
  }
  button {
    cursor: pointer;
  }
  :global(:focus-visible) {
    outline: 3px solid #ffd17e;
    outline-offset: 3px;
  }
  .managed-placement {
    width: 100%;
    height: 360px;
    margin-top: 1rem;
  }
  .managed-placement.offscreen {
    position: fixed;
    left: -200vw;
    top: 0;
    width: 600px;
  }
  .fallback,
  .empty-scene {
    width: 100%;
    height: 100%;
    min-height: 220px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
    text-align: center;
    background: linear-gradient(125deg, #623449, #29304c 55%, #274b54);
  }
  .host-canvas {
    width: 100%;
    height: 300px;
    background: #20283d;
    margin-top: 1rem;
  }
  footer {
    margin-top: 3rem;
    color: #c3cae3;
  }
</style>
