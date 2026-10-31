<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import Canvas from './Canvas.svelte'
  import CanvasScene from './CanvasScene.svelte'
  import ShaderGradient from './ShaderGradient.svelte'
  import type {
    CanvasLifecycleContext,
    CompletedFrame,
    Dispose,
    EnvironmentState,
    GradientError,
    GradientSourceHandle,
    ProducerToken,
    ShaderGradientSourceProps,
    SourceDemand,
  } from './types.js'

  let {
    source,
    gradient,
    canvas,
    width = 1024,
    height = 1024,
    pixelDensity = 1,
    maxDimension = 2048,
    children,
    fallback,
    onError,
    style,
    ...attributes
  }: ShaderGradientSourceProps = $props()

  // Spread-prop invalidation is broader than producer identity. A referentially
  // equal derived handle must not tear down the reservation on size/DPR edits.
  const sourceHandle = $derived(source)

  const cssWidth = $derived(
    Number.isFinite(width) && width > 0 ? Math.max(1, Math.round(width)) : 1024
  )
  const cssHeight = $derived(
    Number.isFinite(height) && height > 0
      ? Math.max(1, Math.round(height))
      : 1024
  )
  const requestedDensity = $derived(
    Number.isFinite(pixelDensity) && pixelDensity > 0
      ? Math.min(2, Math.max(0.25, pixelDensity))
      : 1
  )
  const edgeLimit = $derived(
    Number.isFinite(maxDimension) && maxDimension > 0
      ? Math.min(4096, Math.max(1, Math.round(maxDimension)))
      : 2048
  )
  const density = $derived(
    Math.min(requestedDensity, edgeLimit / cssWidth, edgeLimit / cssHeight)
  )
  const preserve = $derived(canvas?.preserveDrawingBuffer ?? false)
  const power = $derived(canvas?.powerPreference ?? 'default')

  interface ProducerCanvas {
    readonly preserve: boolean
    readonly power: WebGLPowerPreference
    readonly width: number
    readonly height: number
    readonly density: number
    capture(lifecycle: CanvasLifecycleContext): void
    gradientError(error: GradientError): void
    canvasError(error: GradientError): void
    sceneError(cause: unknown): never
  }

  interface ProducerBinding {
    readonly handle: GradientSourceHandle
    readonly demand: SourceDemand
    readonly scene: ProducerCanvas | undefined
    configure(
      preserve: boolean,
      power: WebGLPowerPreference,
      width: number,
      height: number,
      density: number
    ): void
    dispose(): void
  }

  let mounted = $state(false)
  let binding = $state.raw<ProducerBinding>()
  // This ordinary reference is the synchronous cleanup owner, including failures
  // before a child Canvas or a deferred mount cleanup has finished initializing.
  let ownedBinding: ProducerBinding | undefined
  let destroying = false

  function createBinding(
    handle: GradientSourceHandle,
    initialPreserve: boolean,
    initialPower: WebGLPowerPreference,
    initialWidth: number,
    initialHeight: number,
    initialDensity: number
  ): ProducerBinding {
    let live = true
    let token: ProducerToken | undefined
    let releaseState: Dispose | undefined
    let demand = $state.raw<SourceDemand>(handle.demand)
    let scene = $state.raw<ProducerCanvas>()
    let retireScene: Dispose | undefined
    let invalidateScene: Dispose | undefined
    let selectedPreserve = initialPreserve
    let selectedPower = initialPower
    // Child Canvas teardown can outlive this component's derived prop graph.
    // Keep its primitive dimensions in the reservation's own state instead.
    let selectedWidth = $state(initialWidth)
    let selectedHeight = $state(initialHeight)
    let selectedDensity = $state(initialDensity)
    let reconciling = false

    function current(): boolean {
      return live && source === handle
    }

    function rotate() {
      const previous = token
      token = undefined
      if (!previous) return
      const next = handle.resetProducer(previous)
      // State listeners may synchronously dispose the handle during reset.
      if (live && handle.state.status !== 'disposed') token = next
    }

    function removeScene(reset: boolean) {
      const retire = retireScene
      retireScene = undefined
      invalidateScene = undefined
      if (!destroying) scene = undefined
      // Revoke both subscriptions before the token changes or Canvas is removed.
      retire?.()
      if (reset && live) rotate()
    }

    function reconcile() {
      if (!current() || !token || reconciling) return
      reconciling = true
      try {
        if (demand.visibleViews === 0 && demand.pendingFrames === 0) {
          if (scene) removeScene(true)
        }
        // Reset notifications can synchronously create fresh demand.
        if (
          current() &&
          token &&
          !scene &&
          (demand.visibleViews > 0 || demand.pendingFrames > 0)
        ) {
          scene = createScene()
        }
      } finally {
        reconciling = false
      }
    }

    function createScene(): ProducerCanvas {
      let active = true
      let context: CanvasLifecycleContext | undefined
      let renderer: CanvasLifecycleContext['renderer']
      let element: HTMLCanvasElement | undefined
      let releaseFrames: Dispose | undefined
      let releaseEnvironment: Dispose | undefined
      let environmentError: GradientError | undefined
      let rendererError: GradientError | undefined
      let environment: EnvironmentState | undefined

      function isCurrent(): boolean {
        return active && current() && scene === owned
      }

      function clearSubscriptions() {
        const frames = releaseFrames
        const environments = releaseEnvironment
        releaseFrames = undefined
        releaseEnvironment = undefined
        context = undefined
        frames?.()
        environments?.()
      }

      function setError(error: GradientError) {
        if (!isCurrent() || !token) return
        if (error.code === 'environment') {
          environmentError = error
        } else {
          // Keep the Canvas mounted for its actual context-restoration event,
          // but retire the failed generation before any old frame can publish.
          const firstFailure = rendererError === undefined
          rendererError = error
          clearSubscriptions()
          if (firstFailure) rotate()
        }
        if (token && isCurrent()) {
          handle.setProducerState(token, {
            status: 'error',
            error: rendererError ?? error,
          })
        }
      }

      function environmentChanged(next: EnvironmentState) {
        if (!isCurrent() || !token || rendererError) return
        if (
          environment?.status === next.status &&
          (next.status !== 'error' || environment.error === next.error)
        )
          return
        environment = next
        if (next.status === 'error') {
          environmentError = next.error
          handle.setProducerState(token, { status: 'error', error: next.error })
          return
        }
        // Only a real environment transition clears an environment failure.
        // A color edit must not turn a failed HDR into a ready ambient frame.
        environmentError = undefined
        handle.setProducerState(token, { status: 'loading' })
        if (isCurrent()) context?.invalidate()
      }

      const owned: ProducerCanvas = {
        preserve: selectedPreserve,
        power: selectedPower,
        get width() {
          return selectedWidth
        },
        get height() {
          return selectedHeight
        },
        get density() {
          return selectedDensity
        },
        capture(lifecycle) {
          if (!isCurrent() || !token) return
          const nextRenderer = lifecycle.renderer
          const nextElement = lifecycle.canvas
          if (!nextRenderer || !nextElement) return
          if (renderer === nextRenderer && element === nextElement) return
          // A failed renderer is not healed by HDR or a repeated bridge callback.
          if (rendererError && renderer === undefined) return
          clearSubscriptions()
          if (renderer && !rendererError) rotate()
          if (!isCurrent() || !token) return
          renderer = nextRenderer
          element = nextElement
          context = lifecycle
          rendererError = undefined
          environmentError = undefined
          environment = undefined
          const generationToken = token
          handle.setProducerState(generationToken, { status: 'loading' })
          if (!isCurrent() || token !== generationToken) return
          const unsubscribeEnvironment = lifecycle.subscribeEnvironment(
            (next) => {
              if (token === generationToken) environmentChanged(next)
            }
          )
          if (!isCurrent() || token !== generationToken) {
            unsubscribeEnvironment()
            return
          }
          releaseEnvironment = unsubscribeEnvironment
          releaseFrames = lifecycle.subscribeAfterRender(
            (frame: CompletedFrame) => {
              if (
                !isCurrent() ||
                token !== generationToken ||
                rendererError ||
                environmentError ||
                lifecycle.canvas !== frame.canvas ||
                lifecycle.renderer !== nextRenderer ||
                (lifecycle.environmentState.status !== 'disabled' &&
                  lifecycle.environmentState.status !== 'ready') ||
                lifecycle.size.width !== selectedWidth ||
                lifecycle.size.height !== selectedHeight ||
                nextRenderer.getPixelRatio() !== selectedDensity ||
                frame.width !==
                  Math.max(1, Math.floor(selectedWidth * selectedDensity)) ||
                frame.height !==
                  Math.max(1, Math.floor(selectedHeight * selectedDensity))
              )
                return
              // Borrowed final raw/grain backbuffer: all View copies finish here,
              // before returning to the same Threlte post-render dispatch.
              handle.publishFrame(generationToken, frame)
            }
          )
          lifecycle.invalidate()
        },
        gradientError(error) {
          if (!isCurrent()) return
          setError(error)
          try {
            gradient?.onError?.(error)
          } finally {
            onError?.(error)
          }
        },
        canvasError(error) {
          if (!isCurrent()) return
          setError(error)
          try {
            canvas?.onError?.(error)
          } finally {
            onError?.(error)
          }
        },
        sceneError(cause) {
          if (isCurrent()) {
            setError({
              code: 'renderer',
              message:
                cause instanceof Error
                  ? cause.message
                  : 'The source scene could not complete initialization or an update.',
              cause,
            })
          }
          // Retire publication before the outer Canvas boundary destroys
          // Threlte's renderer and delivers its typed error callback.
          throw cause
        },
      }
      invalidateScene = () => {
        if (!isCurrent() || rendererError) return
        context?.invalidate()
      }
      retireScene = () => {
        if (!active) return
        active = false
        clearSubscriptions()
        renderer = undefined
        element = undefined
        environment = undefined
        environmentError = undefined
        rendererError = undefined
      }
      return owned
    }

    const owned: ProducerBinding = {
      handle,
      get demand() {
        return demand
      },
      get scene() {
        return scene
      },
      configure(nextPreserve, nextPower, nextWidth, nextHeight, nextDensity) {
        if (!current()) return
        const recreate =
          selectedPreserve !== nextPreserve || selectedPower !== nextPower
        const resize =
          selectedWidth !== nextWidth ||
          selectedHeight !== nextHeight ||
          selectedDensity !== nextDensity
        selectedPreserve = nextPreserve
        selectedPower = nextPower
        selectedWidth = nextWidth
        selectedHeight = nextHeight
        selectedDensity = nextDensity
        if (recreate && scene) removeScene(true)
        reconcile()
        if (resize) invalidateScene?.()
      },
      dispose() {
        if (!live) return
        live = false
        releaseState?.()
        releaseState = undefined
        removeScene(false)
        const previous = token
        token = undefined
        // Caller owns terminal handle disposal. Clear its producer before the
        // keyed child Canvas can release its renderer and borrowed backbuffer.
        if (previous) handle.detachProducer(previous)
      },
    }

    try {
      token = handle.attachProducer({
        onDemandChange(next) {
          if (!current()) return
          demand = next
          reconcile()
        },
        invalidate() {
          if (!current()) return
          reconcile()
          invalidateScene?.()
        },
      })
      const unsubscribe = handle.subscribe((state) => {
        if (state.status === 'disposed') owned.dispose()
      })
      if (live) releaseState = unsubscribe
      else unsubscribe()
      reconcile()
      return owned
    } catch (cause) {
      owned.dispose()
      // A rejected claim has no token: never mutate or detach its incumbent.
      const error = cause as Partial<GradientError> | null
      if (
        error?.code === 'duplicate-producer' ||
        error?.code === 'source-disposed'
      ) {
        onError?.({
          code: error.code,
          message:
            error.message ?? 'The gradient source producer could not attach.',
          cause,
        })
      }
      throw cause
    }
  }

  $effect.pre(() => () => {
    // The subtree is already being destroyed. Retire external leases, but do not
    // dirty its keyed scene/prop graph and make child cleanup read dead deriveds.
    destroying = true
    ownedBinding?.dispose()
    ownedBinding = undefined
  })

  onMount(() => {
    mounted = true
  })

  $effect.pre(() => {
    const handle = sourceHandle
    if (!mounted) return
    const owned = untrack(() =>
      createBinding(handle, preserve, power, cssWidth, cssHeight, density)
    )
    ownedBinding = owned
    binding = owned
    return () => {
      owned.dispose()
      if (ownedBinding === owned) ownedBinding = undefined
      if (!destroying) binding = undefined
    }
  })

  $effect.pre(() => {
    const owned = binding
    const nextPreserve = preserve
    const nextPower = power
    const nextWidth = cssWidth
    const nextHeight = cssHeight
    const nextDensity = density
    untrack(() =>
      owned?.configure(
        nextPreserve,
        nextPower,
        nextWidth,
        nextHeight,
        nextDensity
      )
    )
  })
</script>

<div
  {...attributes}
  aria-hidden="true"
  inert
  style={`${style ?? ''};display:block;box-sizing:content-box;padding:0;border:0;position:absolute;left:-100000px;top:0;width:${cssWidth}px;height:${cssHeight}px;overflow:hidden;opacity:0;pointer-events:none;`}
>
  {#if binding && binding.handle === source && binding.scene}
    {#key binding.scene}
      {@const scene = untrack(() => binding?.scene)}
      {#if scene}
        <Canvas
          {...canvas}
          preserveDrawingBuffer={scene.preserve}
          powerPreference={scene.power}
          pixelDensity={scene.density}
          active={binding.demand.visibleViews > 0}
          lazyLoad={false}
          pointerEvents="none"
          aria-hidden="true"
          style={`width:${scene.width}px;height:${scene.height}px;box-sizing:content-box;padding:0;border:0;pointer-events:none;`}
          onError={scene.canvasError}
        >
          <CanvasScene
            onReady={(lifecycle) => untrack(() => scene.capture(lifecycle))}
          >
            <svelte:boundary onerror={scene.sceneError}>
              <ShaderGradient
                {...gradient}
                mode="managed"
                onError={scene.gradientError}
              />
              {@render children?.()}
            </svelte:boundary>
          </CanvasScene>
        </Canvas>
      {/if}
    {/key}
  {/if}
  {#if source.state.status !== 'ready' && fallback}
    {@render fallback(source.state)}
  {/if}
</div>
