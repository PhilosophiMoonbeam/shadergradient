<script lang="ts">
  import { onDestroy } from 'svelte'
  import { T } from '@threlte/core'
  import {
    ShaderGradientSource,
    ShaderGradientView,
    createGradientSource,
    type CompletedFrame,
    type FrameLease,
    type GradientError,
    type GradientSourceHandle,
    type GradientSourceOptions,
    type ProducerToken,
    type ShaderGradientSourceProps,
    type ShaderGradientViewProps,
    type SourceDemand,
    type SourceState,
    type SourceViewLease,
  } from '@shadergradient/svelte'

  const options = { label: 'consumer tree A' } satisfies GradientSourceOptions
  // Instance setup, never a module singleton or label/string rendezvous.
  const a: GradientSourceHandle = createGradientSource(options)
  const b: GradientSourceHandle = createGradientSource({ label: 'consumer tree B' })
  onDestroy(() => { a.dispose(); b.dispose() })

  const reportError = (error: GradientError): void => {
    const code: GradientError['code'] = error.code
    const cause: unknown = error.cause
    console.info(code, error.message, cause)
  }
  const producer = {
    source: a,
    gradient: {
      mode: 'managed', shader: 'glass', type: 'sphere', animate: 'off', uTime: -3,
      grain: 'on', lightType: 'env', envPreset: 'dawn',
      onCameraUpdate(update) {
        const zoom: number | undefined = update.cameraZoom
        const distance: number | undefined = update.cDistance
        console.info(update.cAzimuthAngle, update.cPolarAngle, zoom, distance)
      },
      onError: reportError,
    },
    canvas: { fov: 52, envBasePath: '/environments/', respectReducedMotion: true, preserveDrawingBuffer: false },
    width: 640,
    height: 360,
    pixelDensity: 1.5,
    maxDimension: 1024,
    class: 'producer',
    title: 'Typed producer',
    children: scene,
    fallback: sourceFallback,
    onError: reportError,
  } satisfies ShaderGradientSourceProps
  const view = {
    source: a,
    class: 'view',
    style: 'width: 240px; height: 160px',
    role: 'img',
    'aria-label': 'Typed mirror',
    'aria-hidden': false,
    pixelDensity: 1.25,
    maxDimension: 512,
    threshold: 0.2,
    rootMargin: '16px',
    fallback: sourceFallback,
    onError: reportError,
    onclick(event) {
      const element: HTMLDivElement = event.currentTarget
      console.info(element.id, event.clientX)
    },
  } satisfies ShaderGradientViewProps

  function describeSource(state: SourceState): string {
    const generation: number = state.generation
    if (state.status === 'error') {
      const error: GradientError = state.error
      return `${generation}:${error.code}:${error.message}`
    }
    const status: 'absent' | 'loading' | 'ready' | 'disposed' = state.status
    return `${generation}:${status}`
  }
  // Compile-only consumer functions use real public method signatures; they are
  // not invoked to reserve a fake producer or to retain a borrowed frame.
  function subscribeToSource(handle: GradientSourceHandle): () => void {
    return handle.subscribeFrames((frame: CompletedFrame, token: ProducerToken) => {
      const canvas: HTMLCanvasElement = frame.canvas
      const dimensions: [number, number] = [frame.width, frame.height]
      const sequence: number = frame.sequence
      const identity: symbol = token.identity
      console.info(canvas.width, dimensions, sequence, token.generation, identity)
    })
  }
  function requestAndCancel(handle: GradientSourceHandle): void {
    const lease: FrameLease = handle.requestFrame()
    lease.release()
    const viewLease: SourceViewLease = handle.attachView(false)
    viewLease.setVisible(true)
    viewLease.release()
    const demand: SourceDemand = handle.demand
    console.info(demand.visibleViews, demand.pendingFrames)
  }
</script>

{#snippet sourceFallback(state: SourceState)}
  <p role="status">{describeSource(state)}</p>
{/snippet}

{#snippet scene()}
  <T.AmbientLight intensity={0.2} />
{/snippet}

<!-- Views can be declared before their producer and share the explicit handle. -->
<ShaderGradientView {...view} data-contract="view-before-producer" />
<ShaderGradientSource {...producer} />
<ShaderGradientView source={a} fallback={sourceFallback} style="width: 120px; height: 240px" />
<ShaderGradientSource source={b} gradient={{ shader: 'defaults', animate: 'off', uTime: 7 }} fallback={sourceFallback}>
  <T.DirectionalLight intensity={0.3} />
</ShaderGradientSource>
<ShaderGradientView source={b} fallback={sourceFallback} style="width: 200px; height: 100px" />
