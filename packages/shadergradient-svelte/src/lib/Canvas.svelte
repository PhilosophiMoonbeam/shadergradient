<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { Canvas as ThrelteCanvas } from '@threlte/core'
  import { defaultEnvBasePath } from '@shadergradient/core'
  import {
    LinearSRGBColorSpace,
    NoToneMapping,
    Vector4,
    WebGLRenderer,
  } from 'three'
  import CanvasScene from './CanvasScene.svelte'
  import {
    createCanvasContext,
    provideCanvasContext,
    releaseCanvasRenderer,
  } from './canvas-context.svelte.js'
  import type {
    CanvasFallbackState,
    CanvasLifecycleContext,
    CanvasSettings,
    Dispose,
    GradientError,
    ShaderGradientCanvasProps,
  } from './types.js'

  let {
    children,
    fallback,
    pixelDensity = 1,
    fov = 45,
    pointerEvents = 'none',
    envBasePath = defaultEnvBasePath,
    respectReducedMotion = true,
    active = true,
    lazyLoad = true,
    threshold = 0,
    rootMargin = '0px',
    preserveDrawingBuffer = false,
    powerPreference = 'default',
    onError,
    style,
    'aria-hidden': ariaHidden = true,
    ...attributes
  }: ShaderGradientCanvasProps = $props()

  let wrapper = $state.raw<HTMLDivElement>()
  let mounted = $state(false)
  let visible = $state(false)
  let prefersReducedMotion = $state(false)
  let restoreGeneration = $state(0)
  let fallbackState = $state.raw<CanvasFallbackState>({ status: 'deferred' })
  let ready = $state(false)
  let generation = $state.raw<RendererGeneration>()
  const density = $derived(
    Number.isFinite(pixelDensity) && pixelDensity > 0 ? pixelDensity : 1
  )
  const fieldOfView = $derived(
    Number.isFinite(fov) && fov > 0 && fov < 180 ? fov : 45
  )
  const intersectionThreshold = $derived(
    Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
      ? threshold
      : 0
  )
  // Spread-backed prop getters can invalidate on unrelated updates. Renderer
  // ownership changes only when these primitive creation options actually change.
  const creationPreserve = $derived(preserveDrawingBuffer)
  const creationPower = $derived(powerPreference)
  const environmentBasePath = $derived(envBasePath)
  const eligible = $derived(mounted && visible)
  const settings: CanvasSettings = {
    get pixelDensity() {
      return density
    },
    get fov() {
      return fieldOfView
    },
    get envBasePath() {
      return environmentBasePath
    },
    get respectReducedMotion() {
      return respectReducedMotion
    },
  }

  function reportError(error: GradientError) {
    if (
      error.code === 'unsupported-webgl' ||
      error.code === 'renderer' ||
      error.code === 'context-lost'
    ) {
      ready = false
      fallbackState =
        error.code === 'unsupported-webgl'
          ? { status: 'unsupported', error }
          : { status: 'error', error }
    }
    onError?.(error)
  }

  const lifecycle = provideCanvasContext(
    createCanvasContext({
      settings: () => settings,
      reducedMotion: () => respectReducedMotion && prefersReducedMotion,
      active: () => active,
      onError: () => reportError,
    })
  )

  interface RendererGeneration {
    readonly failed: boolean
    createRenderer(canvas: HTMLCanvasElement): WebGLRenderer
    onReady(context: CanvasLifecycleContext): void
    onBoundaryError(cause: unknown): void
    dispose(): void
  }

  function createGeneration(
    preserve: boolean,
    power: WebGLPowerPreference
  ): RendererGeneration {
    let renderer: WebGLRenderer | undefined
    let canvas: HTMLCanvasElement | undefined
    let gl: WebGL2RenderingContext | null = null
    let releaseFrames: Dispose | undefined
    let releaseShaderDiagnostics: Dispose | undefined
    let releaseRenderer: Dispose | undefined
    let disposed = false
    let lost = $state(false)
    let context: CanvasLifecycleContext | undefined
    let initializationError: GradientError | undefined
    let initializationErrorReported = false

    function failInitialization(error: GradientError): never {
      // Framework transformError hooks may sanitize the thrown object. Keep the
      // original typed failure inside this renderer generation, not on the throw.
      initializationError = error
      throw Object.assign(new Error(error.message, { cause: error.cause }), {
        code: error.code,
      })
    }

    function releaseRendererAfterTeardown() {
      const release = releaseRenderer
      if (!release) return
      // Let Threlte's normal teardown run first. An initialization exception can
      // prevent its deferred disposal effect from ever being registered.
      void tick().then(() => {
        if (releaseRenderer === release) release()
      })
    }

    function contextLost(event: Event) {
      event.preventDefault()
      if (disposed || lost) return
      lost = true
      releaseFrames?.()
      releaseFrames = undefined
      releaseShaderDiagnostics?.()
      releaseShaderDiagnostics = undefined
      // Removing the failed Threlte subtree releases its renderer and scene.
      // Keep only this generation's context-restoration listener until recovery
      // or wrapper teardown; a retired scene must not retain renderer references.
      renderer = undefined
      context = undefined
      // The live lifecycle halts all dispatch/render tasks before reporting failure.
      lifecycle.reportError({
        code: 'context-lost',
        message:
          'The <Canvas> WebGL context was lost. Waiting for its restoration event.',
      })
      releaseRendererAfterTeardown()
    }

    function contextRestored() {
      if (disposed || !lost) return
      // Keep the failed subtree absent until the new generation is installed.
      // Only a real restoration event recreates this renderer and its scene.
      restoreGeneration += 1
    }

    return {
      get failed() {
        return lost
      },
      createRenderer(element) {
        canvas = element
        canvas.addEventListener('webglcontextlost', contextLost)
        canvas.addEventListener('webglcontextrestored', contextRestored)
        try {
          gl = canvas.getContext('webgl2', {
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: preserve,
            powerPreference: power,
          })
        } catch (cause) {
          failInitialization({
            code: 'renderer',
            message: 'The <Canvas> could not create its WebGL context.',
            cause,
          })
        }
        if (!gl) {
          failInitialization({
            code: 'unsupported-webgl',
            message: 'WebGL 2 is unavailable for <ShaderGradientCanvas>.',
          })
        }
        try {
          renderer = new WebGLRenderer({
            canvas,
            context: gl,
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: preserve,
            powerPreference: power,
          })
        } catch (cause) {
          failInitialization({
            code: 'renderer',
            message: 'The <Canvas> renderer could not be constructed.',
            cause,
          })
        }
        const ownedRenderer = renderer
        const disposeRenderer = ownedRenderer.dispose
        let rendererDisposed = false
        ownedRenderer.dispose = () => {
          if (rendererDisposed) return
          rendererDisposed = true
          releaseRenderer = undefined
          try {
            releaseCanvasRenderer(lifecycle, ownedRenderer)
          } finally {
            disposeRenderer.call(ownedRenderer)
          }
        }
        releaseRenderer = () => ownedRenderer.dispose()
        const setSize = ownedRenderer.setSize
        const setDrawingBufferSize = ownedRenderer.setDrawingBufferSize
        const setRenderTarget = ownedRenderer.setRenderTarget
        const setViewport = ownedRenderer.setViewport.bind(ownedRenderer)
        const getCurrentViewport = ownedRenderer.getCurrentViewport
        let minimumBuffer = false
        let minimumViewport: Vector4 | undefined

        function normalizeDrawingBuffer(width: number, height: number) {
          const wasMinimum = minimumBuffer
          minimumBuffer =
            width > 0 &&
            height > 0 &&
            (element.width === 0 || element.height === 0)
          if (!minimumBuffer) {
            if (wasMinimum) setViewport(0, 0, width, height)
            return
          }
          element.width = Math.max(1, element.width)
          element.height = Math.max(1, element.height)
          minimumViewport ??= new Vector4()
          minimumViewport.set(0, 0, element.width, element.height)
          ownedRenderer.state.viewport(minimumViewport)
        }

        // Preserve logical CSS size/aspect and the requested DPR. Three floors
        // their product, so a valid capped Source can otherwise have a zero edge.
        // These adapters belong only to this Canvas's renderer, never a host.
        ownedRenderer.setSize = (width, height, updateStyle) => {
          setSize.call(ownedRenderer, width, height, updateStyle)
          normalizeDrawingBuffer(width, height)
        }
        ownedRenderer.setDrawingBufferSize = (width, height, ratio) => {
          setDrawingBufferSize.call(ownedRenderer, width, height, ratio)
          normalizeDrawingBuffer(width, height)
        }
        ownedRenderer.getDrawingBufferSize = (target) =>
          target.set(element.width, element.height)
        ownedRenderer.setViewport = (
          x: number | Vector4,
          y?: number,
          width?: number,
          height?: number
        ) => {
          if (typeof x === 'number') setViewport(x, y!, width!, height!)
          else setViewport(x)
          if (minimumBuffer && ownedRenderer.getRenderTarget() === null) {
            ownedRenderer.state.viewport(minimumViewport!)
          }
        }
        ownedRenderer.setRenderTarget = (target, face, level) => {
          setRenderTarget.call(ownedRenderer, target, face, level)
          if (minimumBuffer && target === null) {
            ownedRenderer.state.viewport(minimumViewport!)
          }
        }
        ownedRenderer.getCurrentViewport = (target) => {
          if (minimumBuffer && ownedRenderer.getRenderTarget() === null) {
            return target.copy(minimumViewport!)
          }
          return getCurrentViewport.call(ownedRenderer, target)
        }
        const previousShaderError = ownedRenderer.debug.onShaderError
        const shaderError: NonNullable<
          WebGLRenderer['debug']['onShaderError']
        > = (shaderGl, program, vertexShader, fragmentShader) => {
          if (disposed || renderer !== ownedRenderer) return
          // r186 reports failed linkage through this hook instead of throwing.
          // Gather diagnostics only on failure, never by polling rendered frames.
          const diagnostics = {
            programLog: shaderGl.getProgramInfoLog(program) ?? '',
            validationStatus: shaderGl.getProgramParameter(
              program,
              shaderGl.VALIDATE_STATUS
            ),
            vertexShaderLog: shaderGl.getShaderInfoLog(vertexShader) ?? '',
            vertexShaderSource: shaderGl.getShaderSource(vertexShader) ?? '',
            fragmentShaderLog: shaderGl.getShaderInfoLog(fragmentShader) ?? '',
            fragmentShaderSource:
              shaderGl.getShaderSource(fragmentShader) ?? '',
          }
          try {
            lifecycle.reportError({
              code: 'renderer',
              message:
                'The <Canvas> WebGL shader program failed to compile or link.',
              cause: diagnostics,
            })
          } finally {
            // A custom r186 hook replaces Three's default console diagnostics.
            // Preserve an existing reporter, or retain visible failure logging.
            if (previousShaderError)
              previousShaderError(
                shaderGl,
                program,
                vertexShader,
                fragmentShader
              )
            else
              console.error(
                'ShaderGradient <Canvas>: WebGL shader program failed to compile or link.',
                diagnostics
              )
          }
        }
        ownedRenderer.debug.onShaderError = shaderError
        releaseShaderDiagnostics = () => {
          if (ownedRenderer.debug.onShaderError === shaderError) {
            ownedRenderer.debug.onShaderError = previousShaderError
          }
        }
        const render = ownedRenderer.render
        ownedRenderer.render = (scene, camera) => {
          if (disposed || lost) return
          try {
            if (minimumBuffer && ownedRenderer.getRenderTarget() === null) {
              ownedRenderer.state.viewport(minimumViewport!)
            }
            render.call(ownedRenderer, scene, camera)
          } catch (cause) {
            lifecycle.reportError({
              code: 'renderer',
              message: 'The <Canvas> renderer failed to complete a frame.',
              cause,
            })
          }
        }
        return renderer
      },
      onReady(bound) {
        if (disposed || context === bound) return
        context = bound
        releaseFrames?.()
        releaseFrames = bound.subscribeAfterRender(() => {
          if (disposed || lost || ready) return
          ready = true
        })
        bound.invalidate()
      },
      onBoundaryError(cause) {
        if (disposed || initializationErrorReported) return
        initializationErrorReported = true
        lifecycle.reportError(
          initializationError ?? {
            code: 'renderer',
            message:
              cause instanceof Error
                ? cause.message
                : 'The <Canvas> scene could not be initialized.',
            cause,
          }
        )
        releaseRendererAfterTeardown()
      },
      dispose() {
        if (disposed) return
        disposed = true
        releaseFrames?.()
        releaseShaderDiagnostics?.()
        canvas?.removeEventListener('webglcontextlost', contextLost)
        canvas?.removeEventListener('webglcontextrestored', contextRestored)
        // Finish any owned release skipped by failed child initialization.
        releaseRendererAfterTeardown()
        if (renderer) renderer.forceContextLoss()
        else if (gl && !gl.isContextLost())
          gl.getExtension('WEBGL_lose_context')?.loseContext()
        renderer = undefined
        canvas = undefined
        gl = null
        context = undefined
      },
    }
  }

  onMount(() => {
    mounted = true
  })

  $effect(() => {
    if (!respectReducedMotion) {
      prefersReducedMotion = false
      return
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      prefersReducedMotion = media.matches
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  })

  $effect(() => {
    if (!mounted || !wrapper) return
    if (!lazyLoad || typeof IntersectionObserver === 'undefined') {
      visible = true
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.target === wrapper) visible = entry.isIntersecting
      },
      { threshold: intersectionThreshold, rootMargin }
    )
    observer.observe(wrapper)
    return () => observer.disconnect()
  })

  $effect(() => {
    // This is the entire recreation boundary; DPR/FOV/size are deliberately absent.
    const shouldMount = eligible
    const preserve = creationPreserve
    const power = creationPower
    restoreGeneration
    ready = false
    if (!shouldMount) {
      generation = undefined
      fallbackState = { status: 'deferred' }
      return
    }
    const owned = untrack(() => createGeneration(preserve, power))
    fallbackState = { status: 'loading' }
    generation = owned
    return () => owned.dispose()
  })
</script>

<div
  bind:this={wrapper}
  {...attributes}
  aria-hidden={ariaHidden}
  style={`position:relative;pointer-events:${pointerEvents};${style ?? ''}`}
>
  {#if generation && !generation.failed}
    {#key generation}
      <svelte:boundary onerror={generation.onBoundaryError}>
        <ThrelteCanvas
          createRenderer={generation.createRenderer}
          dpr={density}
          renderMode="on-demand"
          colorSpace={LinearSRGBColorSpace}
          toneMapping={NoToneMapping}
          shadows={false}
        >
          <CanvasScene onReady={generation.onReady}>
            {@render children?.()}
          </CanvasScene>
        </ThrelteCanvas>
        {#snippet failed()}{/snippet}
      </svelte:boundary>
    {/key}
  {/if}
  {#if !ready && fallback}
    <div class="shadergradient-fallback">{@render fallback(fallbackState)}</div>
  {/if}
</div>

<style>
  .shadergradient-fallback {
    position: absolute;
    inset: 0;
  }
</style>
