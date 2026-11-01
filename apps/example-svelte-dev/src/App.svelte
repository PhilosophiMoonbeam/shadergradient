<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { Canvas } from '@threlte/core'
  import { Mesh, MeshPhysicalMaterial } from 'three'
  import {
    ShaderGradient,
    ShaderGradientCanvas,
    ShaderGradientSource,
    ShaderGradientView,
    createGradientSource,
    presets,
  } from '@shadergradient/svelte'
  import type {
    CameraUpdate,
    GradientError,
    GradientSettingsInput,
    GradientSourceHandle,
    PresetName,
  } from '@shadergradient/svelte'
  import type {
    FixtureCanvasConfig,
    FixtureExternalConfig,
  } from './fixture-types'
  import { createFixture } from './fixture'
  import SceneProbe from './SceneProbe.svelte'
  import ExternalScene from './ExternalScene.svelte'
  import Fallback from './Fallback.svelte'
  import BindingRegression from './BindingRegression.svelte'
  import { bindingMode } from './binding-probe'
  import GlassStudyScene from './GlassStudyScene.svelte'
  import { demoSearchParams, patchDemoSearchParams } from '../../demo-query'
  const selectedBindingMode =
    typeof window === 'undefined' ? null : bindingMode(window.location.search)
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
    Object.assign(controller.api, { mirrors: mirrorApi })
  })
  onDestroy(() => {
    mirrorAlive = false
    for (const cancel of mirrorPendingRequests) cancel()
    for (const stop of mirrorFrameStops) stop()
    mirrorFrameStops.length = 0
    for (const stop of mirrorWrapperStops.values()) stop()
    if (controller.api.mirrors === mirrorApi) delete controller.api.mirrors
    for (const id of mirrorSourceIds) {
      mirrorHandles[id].dispose()
      delete mirrorLatestContexts[id]
    }
  })

  let settings = $state<GradientSettingsInput>({
    ...presets.halo.props,
    smoothTime: 0.25,
    enableTransition: false,
    zoomOut: false,
    loop: 'off',
    loopDuration: 5,
    toggleAxis: false,
    grainBlending: 0.5,
    control: 'props',
    urlString: '',
  })
  let canvasConfig = $state<FixtureCanvasConfig>({
    pixelDensity: 1,
    fov: 45,
    lazyLoad: true,
    threshold: 0,
    rootMargin: '0px',
    pointerEvents: 'none',
    respectReducedMotion: true,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
  })
  let mounted = $state(true)
  let independentMounted = $state(true)
  let visiblePlacement = $state(true)
  let wrapper = $state.raw<HTMLElement>()
  let selectedPreset = $state<PresetName | 'glass-study'>('halo')
  let cameraOutput = $state.raw<CameraUpdate>()
  let errorOutput = $state('')
  let prefersReducedMotion = $state(false)
  const effectiveAnimate = $derived.by(() => {
    if (settings.control === 'query') {
      const animate = demoSearchParams(settings.urlString).get('animate')
      if (animate === 'on' || animate === 'off') return animate
    }
    return settings.animate === 'off' ? 'off' : 'on'
  })
  const motionPaused = $derived(
    effectiveAnimate === 'off' ||
      (canvasConfig.respectReducedMotion !== false && prefersReducedMotion)
  )
  let external = $state.raw<FixtureExternalConfig>({
    enabled: true,
    gradients: [
      {
        type: 'sphere',
        shader: 'defaults',
        positionX: -1.6,
        animate: 'off',
        uTime: 1,
        color1: '#ff5005',
        color2: '#dbba95',
        color3: '#d0bce1',
      },
      {
        type: 'sphere',
        shader: 'cosmic',
        positionX: 1.6,
        animate: 'off',
        uTime: 3,
        color1: '#5f27cd',
        color2: '#00d2d3',
        color3: '#ff9ff3',
      },
    ],
  })
  let hostAngle = $state(0)
  let independentColor = $state('#35e3b1')
  let independentTime = $state(2)
  let observer: IntersectionObserver | undefined
  const controller = createFixture({
    wrapper: () => wrapper,
    config: () => canvasConfig,
    mounted: () => mounted,
    external: () => external,
    update: (patch) => {
      settings = {
        ...settings,
        ...Object.fromEntries(
          Object.entries(patch).filter(([, value]) => value !== undefined)
        ),
      }
    },
    configure: (patch) => {
      canvasConfig = {
        ...canvasConfig,
        ...Object.fromEntries(
          Object.entries(patch).filter(([, value]) => value !== undefined)
        ),
      }
    },
    setMounted: (value) => {
      mounted = value
      if (!value) controller.setFallback(null)
    },
    setIndependentMounted: (value) => {
      independentMounted = value
    },
    setVisible: (value) => {
      visiblePlacement = value
    },
    setExternal: (value) => {
      external = value
    },
  })
  let presentationProbe: Parameters<typeof controller.attach>[1] | undefined
  let presentationAlive = true
  let effectiveVariant = $state<string | null>(null)
  const effectiveShader = $derived(effectiveVariant?.split(':')[0])
  // Observe the actual resolved material through the existing probe boundary.
  // No query parser, polling, render task or per-frame snapshot allocation.
  const presentationController: typeof controller = {
    ...controller,
    attach(channel, probe) {
      if (presentationAlive && channel === 'main') {
        presentationProbe = probe
        effectiveVariant = null
      }
      const release = controller.attach(channel, probe)
      return () => {
        if (presentationAlive && presentationProbe === probe) {
          presentationProbe = undefined
          effectiveVariant = null
        }
        release()
      }
    },
    notify() {
      const mesh = presentationAlive
        ? presentationProbe?.scene.getObjectByName('shadergradient-mesh')
        : undefined
      if (
        mesh instanceof Mesh &&
        mesh.material instanceof MeshPhysicalMaterial
      ) {
        const variant = mesh.material.customProgramCacheKey()
        if (variant !== effectiveVariant) effectiveVariant = variant
      }
      controller.notify()
    },
  }
  onDestroy(() => {
    presentationAlive = false
    presentationProbe = undefined
  })
  const numericGroups: {
    title: string
    fields: {
      key: keyof GradientSettingsInput
      label: string
      min?: number
      max?: number
      step: number
    }[]
  }[] = [
    {
      title: 'Noise and surface',
      fields: [
        { key: 'uStrength', label: 'Noise strength', step: 0.1 },
        { key: 'uDensity', label: 'Noise density', step: 0.1 },
        { key: 'uFrequency', label: 'Frequency', step: 0.1 },
        { key: 'uAmplitude', label: 'Amplitude', step: 0.1 },
        { key: 'reflection', label: 'Reflection', min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      title: 'Transforms (degrees)',
      fields: [
        { key: 'positionX', label: 'Position X', step: 0.1 },
        { key: 'positionY', label: 'Position Y', step: 0.1 },
        { key: 'positionZ', label: 'Position Z', step: 0.1 },
        { key: 'rotationX', label: 'Rotation X', step: 5 },
        { key: 'rotationY', label: 'Rotation Y', step: 5 },
        { key: 'rotationZ', label: 'Rotation Z', step: 5 },
      ],
    },
    {
      title: 'Temporal controls',
      fields: [
        { key: 'uTime', label: 'Seek time (negative allowed)', step: 0.1 },
        { key: 'uSpeed', label: 'Animation speed', step: 0.1 },
        { key: 'rangeStart', label: 'Range start', step: 0.5 },
        { key: 'rangeEnd', label: 'Range end', step: 0.5 },
        { key: 'loopDuration', label: 'Loop duration', step: 0.5 },
      ],
    },
    {
      title: 'Camera pose',
      fields: [
        { key: 'cAzimuthAngle', label: 'Azimuth angle', step: 5 },
        { key: 'cPolarAngle', label: 'Polar angle', step: 5 },
        { key: 'cDistance', label: 'Camera distance', min: 0.1, step: 0.1 },
        { key: 'cameraZoom', label: 'Camera zoom', min: 0.1, step: 0.1 },
        {
          key: 'smoothTime',
          label: 'Transition smooth time',
          min: 0,
          step: 0.05,
        },
      ],
    },
  ]
  function update(patch: GradientSettingsInput) {
    settings = { ...settings, ...patch }
  }
  function applyPreset(name: PresetName) {
    selectedPreset = name
    settings = {
      ...presets.halo.props,
      ...presets[name].props,
      control: 'props',
      urlString: '',
      loop: 'off',
      loopDuration: 5,
      smoothTime: 0.25,
      enableTransition: false,
      zoomOut: false,
      toggleAxis: false,
      grainBlending: 0.5,
    }
    canvasConfig = {
      ...canvasConfig,
      pixelDensity: presets[name].props.pixelDensity,
      fov: presets[name].props.fov,
    }
  }
  function applyGlassStudy() {
    applyPreset('halo')
    selectedPreset = 'glass-study'
    update({
      shader: 'glass',
      type: 'sphere',
      lightType: 'env',
      envPreset: 'city',
      animate: 'off',
      grain: 'off',
      uTime: 2,
      uStrength: 0.18,
      uDensity: 1.1,
      uFrequency: 2,
      uAmplitude: 0.2,
      reflection: 0.94,
      brightness: 1.2,
      color1: '#f5fbff',
      color2: '#e3f0ff',
      color3: '#fff2e6',
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      cAzimuthAngle: 0,
      cPolarAngle: 90,
      cDistance: 4.8,
      cameraZoom: 1,
    })
    canvasConfig.fov = 45
  }
  function reportError(error: GradientError) {
    errorOutput = `${error.code}: ${error.message}`
    controller.error(error)
  }
  function cameraUpdate(update: CameraUpdate) {
    cameraOutput = update
    controller.cameraUpdate(update)
  }
  // This observer measures real viewport entry/exit; fixture visibility moves the
  // actual wrapper instead of overriding the native visibility/motion lifecycle.
  $effect(() => {
    const element = wrapper
    const threshold = canvasConfig.threshold ?? 0
    const rootMargin = canvasConfig.rootMargin ?? '0px'
    // Placement changes remeasure the observer-unavailable fallback after DOM update.
    visiblePlacement
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      const measure = () => {
        const rect = element.getBoundingClientRect()
        controller.setIntersection(
          rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
        )
      }
      measure()
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    observer = new IntersectionObserver(
      ([entry]) => {
        const rect = entry.boundingClientRect
        controller.setIntersection(
          entry.isIntersecting && rect.width > 0 && rect.height > 0
        )
      },
      {
        threshold:
          Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
            ? threshold
            : 0,
        rootMargin,
      }
    )
    observer.observe(element)
    return () => {
      observer?.disconnect()
      observer = undefined
    }
  })
  $effect(() => {
    controller.setReducedMotion(
      canvasConfig.respectReducedMotion !== false && prefersReducedMotion
    )
  })
  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const motion = () => {
      prefersReducedMotion = media.matches
    }
    media.addEventListener('change', motion)
    motion()
    const fixtureEnabled =
      import.meta.env.DEV || import.meta.env.VITE_GRADIENT_FIXTURE === '1'
    if (fixtureEnabled) window.gradientFixture = controller.api
    return () => {
      media.removeEventListener('change', motion)
      if (window.gradientFixture === controller.api)
        delete window.gradientFixture
      controller.dispose()
    }
  })
</script>

<svelte:head>
  <title>Native Composition Studio · ShaderGradient / Svelte</title>
  <meta
    name="description"
    content="Explore native Svelte gradients, independent Threlte scenes, host ownership and completed-frame Source/View composition."
  />
</svelte:head>
<main class="demo-studio studio-shell native-studio">
  {#if selectedBindingMode}
    <BindingRegression mode={selectedBindingMode} />
  {:else}
    <header class="studio-header">
      <a class="studio-brand" href="#composition"
        >ShaderGradient <span>/ Native</span></a
      >
      <span class="studio-badge">Svelte 5 · Threlte 8</span>
    </header>
    <div class="studio-intro" id="composition">
      <p class="studio-eyebrow">Native Composition Studio / 01</p>
      <h1>One scene.<br />Many possibilities.</h1>
      <p class="studio-lede">
        Shape a living material, compose it inside your own Threlte scene, or
        share one completed frame across a family of views. Native Svelte,
        without a React bridge.
      </p>
      <nav class="native-section-nav" aria-label="Composition studies">
        <a href="#preview-title">Material studio</a>
        <a href="#independent-title">Independent scenes</a>
        <a href="#host-title">Host composition</a>
        <a href="#mirror-heading">Source / View</a>
      </nav>
    </div>
    <section class="native-main-section" aria-labelledby="preview-title">
      <div class="studio-workspace">
        <div class="studio-panel native-main-panel">
          <div class="studio-panel-header">
            <div>
              <p class="studio-eyebrow">Live material</p>
              <h2 id="preview-title">Your native canvas</h2>
            </div>
            <span class="native-mode-label"
              >{effectiveVariant
                ? effectiveVariant.replace(':', ' / ')
                : 'Waiting for native material'}</span
            >
          </div>
          <div
            class="preview studio-preview"
            class:offscreen={!visiblePlacement}
            bind:this={wrapper}
            data-testid="gradient-wrapper"
          >
            {#if mounted}
              <ShaderGradientCanvas
                {...canvasConfig}
                data-gradient-main
                style="width:100%;height:100%;"
                onError={reportError}
              >
                {#snippet fallback(state)}<Fallback
                    {state}
                    {controller}
                  />{/snippet}
                <SceneProbe
                  controller={presentationController}
                  channel="main"
                />
                {#if effectiveShader === 'glass'}
                  <GlassStudyScene />
                {/if}
                <ShaderGradient
                  {...settings}
                  onCameraUpdate={cameraUpdate}
                  onError={reportError}
                />
              </ShaderGradientCanvas>
            {:else}<p>
                Managed Canvas unmounted. Independent and host scenes remain
                available.
              </p>{/if}
          </div>
          <div class="studio-panel-footer native-preview-caption">
            <p>
              {#if effectiveShader === 'glass'}
                Physical transmission through real opaque scene geometry. Load
                the glass study for a front-facing sphere, a smooth surface and
                HDR reflections. Plane and water-plane glass are sheets, not a
                closed lens. The scene context is placed behind the front-facing
                study, not behind every camera angle.
              {:else}
                A full native shader, not a video or CSS gradient. Explore the
                palette, change the surface, then compose the result below.
              {/if}
            </p>
            <span
              >{canvasConfig.pointerEvents === 'auto'
                ? 'Pointer interaction enabled'
                : 'Decorative · pointer-transparent'}</span
            >
            <output aria-label="Camera update"
              >{cameraOutput
                ? JSON.stringify(cameraOutput)
                : 'Camera callback pending'}</output
            >
            {#if errorOutput}<p class="studio-error" role="alert">
                Last reported error: {errorOutput}
              </p>{/if}
          </div>
        </div>
        <aside
          class="studio-controls native-material-controls"
          aria-label="Material controls"
        >
          <fieldset>
            <legend>Preset &amp; material</legend>
            <label
              >Preset<select
                value={selectedPreset}
                onchange={(event) =>
                  applyPreset(event.currentTarget.value as PresetName)}
              >
                <option value="glass-study" disabled
                  >Custom · Glass study</option
                >
                {#each Object.entries(presets) as [name, preset] (name)}
                  <option value={name}>{preset.title}</option>
                {/each}
              </select></label
            >
            <label
              >Shader<select bind:value={settings.shader}
                >{#each ['defaults', 'positionMix', 'cosmic', 'glass'] as shader (shader)}<option
                    value={shader}>{shader}</option
                  >{/each}</select
              ></label
            >
            <label
              >Geometry<select bind:value={settings.type}
                ><option value="plane">Plane</option><option value="sphere"
                  >Sphere</option
                ><option value="waterPlane">Water plane</option></select
              ></label
            >
            <div class="native-palette">
              {#each ['color1', 'color2', 'color3'] as color (color)}<label
                  >{color}<input
                    type="color"
                    value={String(settings[color as 'color1'])}
                    oninput={(event) =>
                      update({ [color]: event.currentTarget.value })}
                  /></label
                >{/each}
            </div>
            <div class="studio-actions">
              <button
                class="studio-button"
                onclick={() => {
                  const animate = motionPaused ? 'on' : 'off'
                  if (settings.control === 'query') {
                    update({
                      urlString: patchDemoSearchParams(settings.urlString, {
                        animate,
                      }),
                    })
                  } else {
                    update({ animate })
                  }
                  if (animate === 'on' && prefersReducedMotion)
                    canvasConfig.respectReducedMotion = false
                }}>{motionPaused ? 'Resume motion' : 'Pause motion'}</button
              >
              <button class="studio-button-secondary" onclick={applyGlassStudy}
                >Load glass study</button
              >
            </div>
            <p class="native-control-note">
              10 Core presets · 4 shaders × 3 geometries. A preset restores its
              complete settings; edits are your own composition.
            </p>
            {#if prefersReducedMotion && canvasConfig.respectReducedMotion !== false}
              <p class="studio-note">
                Reduced motion is active. Resume motion explicitly opts this
                canvas into animation.
              </p>
            {/if}
            <label
              ><input type="checkbox" bind:checked={settings.wireframe} /> Wireframe</label
            >
            <details class="native-query-controls">
              <summary>URL settings &amp; precedence</summary>
              <label
                >Control source<select bind:value={settings.control}
                  ><option value="props">Explicit props</option><option
                    value="query">Typed URL query overrides</option
                  ></select
                ></label
              >
              <label
                >Query URL or search string<textarea
                  rows="3"
                  bind:value={settings.urlString}
                  placeholder="?shader=cosmic&amp;uTime=4&amp;animate=off"
                ></textarea></label
              >
              <p>
                Precedence: halo → explicit props → recognized valid query
                values. Switching presets restores explicit props mode.
              </p>
            </details>
          </fieldset>
        </aside>
      </div>
    </section>
    <section class="studio-section" aria-labelledby="settings-title">
      <div class="studio-section-heading">
        <div>
          <p class="studio-eyebrow">Fine-tune / 01.1</p>
          <h2 id="settings-title">Make the material yours.</h2>
        </div>
        <p class="studio-copy">
          Camera, lighting, time and lifecycle are real scene inputs. Paused
          scenes still respond to deliberate edits and resizing. Renderer
          construction options are separated because they recreate the owned
          renderer.
        </p>
      </div>
      <details class="native-advanced-controls">
        <summary
          >Open the complete control desk <span
            >Surface · time · camera · HDR · lifecycle</span
          ></summary
        >
        <div class="controls-grid">
          <fieldset class="lifecycle-controls">
            <legend>Canvas &amp; lifecycle</legend>
            <label
              ><input type="checkbox" bind:checked={mounted} /> Mount managed Canvas</label
            >
            <label
              ><input type="checkbox" bind:checked={visiblePlacement} /> Place managed
              preview in viewport</label
            >
            <label
              ><input type="checkbox" bind:checked={canvasConfig.lazyLoad} /> Lazy
              mount while visible</label
            >
            <label
              ><input
                type="checkbox"
                bind:checked={canvasConfig.respectReducedMotion}
              /> Respect real reduced-motion preference</label
            >
            <label
              >Pointer behavior<select bind:value={canvasConfig.pointerEvents}
                ><option value="none">Decorative (none)</option><option
                  value="auto">Interactive (auto)</option
                ></select
              ></label
            >
            <label
              >Pixel density<input
                type="number"
                min="0.25"
                max="3"
                step="0.25"
                bind:value={canvasConfig.pixelDensity}
              /></label
            >
            <label
              >Field of view<input
                type="number"
                min="1"
                max="179"
                step="1"
                bind:value={canvasConfig.fov}
              /></label
            >
            <label
              >Intersection threshold<input
                type="number"
                min="0"
                max="1"
                step="0.1"
                bind:value={canvasConfig.threshold}
              /></label
            >
            <label
              >Intersection root margin<input
                bind:value={canvasConfig.rootMargin}
              /></label
            >
            <details>
              <summary
                >Renderer construction options (explicit recreation)</summary
              >
              <p>
                These options recreate the owned renderer. Ordinary visual, DPR
                and FOV changes do not.
              </p>
              <label
                ><input
                  type="checkbox"
                  bind:checked={canvasConfig.preserveDrawingBuffer}
                /> Preserve drawing buffer</label
              >
              <label
                >Power preference<select
                  bind:value={canvasConfig.powerPreference}
                  ><option value="default">Default</option><option
                    value="low-power">Low power</option
                  ><option value="high-performance">High performance</option
                  ></select
                ></label
              >
            </details>
          </fieldset>
          {#each numericGroups as group (group.title)}
            <fieldset>
              <legend>{group.title}</legend>
              {#each group.fields as field (field.key)}
                <label
                  >{field.label}<input
                    type="number"
                    value={Number(settings[field.key])}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    oninput={(event) => {
                      if (Number.isFinite(event.currentTarget.valueAsNumber))
                        update({
                          [field.key]: event.currentTarget.valueAsNumber,
                        })
                    }}
                  /></label
                >
              {/each}
              {#if group.title === 'Temporal controls'}
                <label
                  >Animation<select bind:value={settings.animate}
                    ><option value="on">Animate</option><option value="off"
                      >Paused</option
                    ></select
                  ></label
                >
                <label
                  >Range<select bind:value={settings.range}
                    ><option value="disabled">Disabled</option><option
                      value="enabled">Enabled</option
                    ></select
                  ></label
                >
                <label
                  >Loop<select bind:value={settings.loop}
                    ><option value="off">Off</option><option value="on"
                      >On (takes precedence over range)</option
                    ></select
                  ></label
                >
              {:else if group.title === 'Camera pose'}
                <label
                  ><input
                    type="checkbox"
                    bind:checked={settings.enableTransition}
                  /> Smooth camera transitions</label
                >
                <label
                  ><input type="checkbox" bind:checked={settings.zoomOut} /> Zoom
                  out framing</label
                >
              {/if}
            </fieldset>
          {/each}
          <fieldset>
            <legend>Lighting, HDR and effects</legend>
            <label
              >Lighting<select bind:value={settings.lightType}
                ><option value="3d">Ambient / 3D</option><option value="env"
                  >HDR environment</option
                ></select
              ></label
            >
            <label
              >Brightness<input
                type="number"
                min="0"
                step="0.1"
                bind:value={settings.brightness}
              /></label
            >
            <label
              >HDR preset<select bind:value={settings.envPreset}
                ><option value="city">City</option><option value="dawn"
                  >Dawn</option
                ><option value="lobby">Lobby</option></select
              ></label
            >
            <label
              >HDR base path<input
                bind:value={canvasConfig.envBasePath}
                placeholder="Default remote asset manifest"
              /></label
            >
            <button
              onclick={() => {
                canvasConfig.envBasePath = undefined
              }}>Restore default HDR manifest base</button
            >
            <p>
              For a real failure fallback, select HDR and set an unavailable
              base URL; restore a valid base to recover.
            </p>
            <label
              >Grain<select bind:value={settings.grain}
                ><option value="on">On</option><option value="off">Off</option
                ></select
              ></label
            >
            <label
              >Grain blending<input
                type="number"
                min="0"
                max="1"
                step="0.05"
                bind:value={settings.grainBlending}
              /></label
            >
            <label
              ><input type="checkbox" bind:checked={settings.toggleAxis} /> Axes helper</label
            >
          </fieldset>
        </div>
      </details>
    </section>
    <section class="studio-section" aria-labelledby="independent-title">
      <div class="studio-section-heading">
        <div>
          <p class="studio-eyebrow">Independent scenes / 02</p>
          <h2 id="independent-title">Together, not coupled.</h2>
        </div>
        <p class="studio-copy">
          Two native canvases, two independent scenes and cameras. Change the
          left material or seek its paused time: the right composition and your
          main canvas keep their own settings.
        </p>
      </div>
      <div class="native-inline-controls">
        <label>
          <input
            type="checkbox"
            data-testid="independent-canvases-toggle"
            bind:checked={independentMounted}
          />
          Show independent canvases
        </label>
        <label
          >Left instance color<input
            type="color"
            bind:value={independentColor}
          /></label
        >
        <label
          >Left instance seek<input
            type="number"
            step="0.5"
            bind:value={independentTime}
          /></label
        >
      </div>
      <div class="independent-grid">
        {#if independentMounted}
          <figure class="native-instance">
            <div class="small-preview" data-testid="independent-a">
              <ShaderGradientCanvas
                pixelDensity={1}
                lazyLoad={false}
                style="width:100%;height:100%"
                ><ShaderGradient
                  {...presets.mint.props}
                  grain="off"
                  animate="off"
                  color1={independentColor}
                  uTime={independentTime}
                /></ShaderGradientCanvas
              >
            </div>
            <figcaption>
              <span>Instance A / Mint</span><span>Your color &amp; time</span>
            </figcaption>
          </figure>
          <figure class="native-instance">
            <div class="small-preview" data-testid="independent-b">
              <ShaderGradientCanvas
                pixelDensity={1}
                lazyLoad={false}
                style="width:100%;height:100%"
                ><ShaderGradient
                  {...presets.sunset.props}
                  grain="off"
                  animate="off"
                  uTime={7}
                /></ShaderGradientCanvas
              >
            </div>
            <figcaption>
              <span>Instance B / Sunset</span><span
                >Independent · paused at 7</span
              >
            </figcaption>
          </figure>
        {:else}
          <p class="studio-note">
            Independent canvases intentionally unmounted. Their controls and the
            other studies remain available.
          </p>
        {/if}
      </div>
    </section>
    <section class="studio-section" aria-labelledby="host-title">
      <div class="studio-section-heading">
        <div>
          <p class="studio-eyebrow">Host composition / 03</p>
          <h2 id="host-title">Your scene stays yours.</h2>
        </div>
        <p class="studio-copy">
          A consumer-owned Threlte camera, generated environment and gold box
          coexist with two external native gradients. Remove either gradient, or
          both: the host resources must stay intact.
        </p>
      </div>
      <div class="studio-cards native-capability-cards">
        <article class="studio-card">
          <span class="native-card-index">01 / Compose</span>
          <h3>Bring your own Canvas.</h3>
          <p>
            External mode joins the existing Threlte tree instead of creating
            another managed canvas.
          </p>
        </article>
        <article class="studio-card">
          <span class="native-card-index">02 / Keep ownership</span>
          <h3>Remove only the gradient.</h3>
          <p>
            Clear the gradients below. The gold box, camera and environment
            belong to the host, not to the shader.
          </p>
        </article>
        <article class="studio-card">
          <span class="native-card-index">03 / Reframe</span>
          <h3>One real camera.</h3>
          <p>
            Orbit the host to reframe the box and both materials together. This
            is scene composition, not a 2D mirror.
          </p>
        </article>
      </div>
      <div class="button-row studio-actions">
        <button
          onclick={() => {
            external = { ...external, gradients: external.gradients.slice(1) }
          }}
          disabled={external.gradients.length === 0}
          >Remove first external gradient</button
        >
        <button
          onclick={() => {
            external = {
              ...external,
              gradients: external.gradients.slice(0, -1),
            }
          }}
          disabled={external.gradients.length === 0}
          >Remove last external gradient</button
        >
        <button
          onclick={() => {
            external = { enabled: true, gradients: [] }
          }}>Clear gradients, keep host</button
        >
        <button
          onclick={() => {
            external = {
              enabled: true,
              gradients: [
                { type: 'sphere', positionX: -1.6, animate: 'off', uTime: 1 },
                {
                  type: 'sphere',
                  shader: 'cosmic',
                  positionX: 1.6,
                  animate: 'off',
                  uTime: 3,
                },
              ],
            }
          }}>Restore two gradients</button
        >
      </div>
      <label
        ><input
          type="checkbox"
          checked={external.enabled}
          onchange={(event) => {
            external = { ...external, enabled: event.currentTarget.checked }
          }}
        /> Mount external host</label
      >
      <label
        >Host camera orbit<input
          type="range"
          min="-1.2"
          max="1.2"
          step="0.05"
          bind:value={hostAngle}
        /></label
      >
      <div class="host-preview" data-testid="external-host">
        {#if external.enabled}
          <svelte:boundary onerror={controller.hostError}>
            <Canvas dpr={1} renderMode="on-demand"
              ><ExternalScene
                gradients={external.gradients}
                {controller}
                angle={hostAngle}
              /></Canvas
            >
            {#snippet failed(error, reset)}
              <div class="fallback" role="alert">
                <p>
                  External host unavailable: {error instanceof Error
                    ? error.message
                    : String(error)}
                </p>
                <button onclick={reset}>Retry host creation</button>
              </div>
            {/snippet}
          </svelte:boundary>
        {:else}<p>Host intentionally unmounted.</p>{/if}
      </div>
    </section>
    <section
      class="studio-section"
      aria-labelledby="mirror-heading"
      data-testid="mirror-demo"
    >
      <div class="studio-section-heading">
        <div>
          <p class="studio-eyebrow">Source / View composition / 04</p>
          <h2 id="mirror-heading">Render once. Frame it everywhere.</h2>
        </div>
        <p class="studio-copy">
          The square, wide and tall views are centered-cover 2D copies of one
          producer’s completed frame, including grain. They share a camera and
          are not independent 3D perspectives. The fourth view uses its own
          handle and producer.
        </p>
      </div>
      <p class="studio-note">
        Start with “Add late mirror producer”. The three waiting views connect
        to handle A. The independent B view already has its own producer; C is
        an explicit spare handle for rebinding. Releasing the last visible
        consumer frees the source GPU; reentry creates a fresh generation at
        configured time.
      </p>
      <div class="studio-actions native-mirror-actions">
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
      <div class="native-mirror-gallery">
        {#each mirrorViewIds as id (id)}
          {@const config = mirrorViews[id]}
          {#if config.mounted}
            <figure class="native-mirror-card">
              <div
                class="native-mirror-surface"
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
              <figcaption>
                <span
                  >{id === 'independent'
                    ? 'Independent scene'
                    : `${id} / centered cover`}</span
                ><span>Handle {config.source}</span>
              </figcaption>
            </figure>
          {/if}
        {/each}
      </div>
      <p class="native-source-status" data-testid="mirror-source-status">
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
      <details class="native-mirror-controls">
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
      <p class="native-observation-note">
        Frame, copy and pixel observations are pull-only development fixtures,
        not per-frame UI. Unobservable GPU allocation/disposal metrics stay
        null; observed WebGL identities and actual context-loss status are not
        GPU-memory certificates.
      </p>
    </section>
    <footer class="studio-footer">
      <p>Native Svelte 5 · Threlte 8 · public @shadergradient/svelte</p>
      <p>
        Dev-only <code>window.gradientFixture</code> v1 observes actual public
        Threlte scenes and completed render stages. Production fixture
        qualification can explicitly opt in with
        <code>VITE_GRADIENT_FIXTURE=1</code>.
      </p>
    </footer>
  {/if}
</main>
