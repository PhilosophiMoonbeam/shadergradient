<script lang="ts">
  import {
    ShaderGradient,
    ShaderGradientCanvas,
    presets,
    presetsArray,
    type CameraUpdate,
    type CanvasFallbackState,
    type GradientError,
    type ManagedGradientProps,
    type ShaderGradientCanvasProps,
    type ShaderGradientProps,
    type WrapperAttributes,
  } from '@shadergradient/svelte'

  const reportError = (error: GradientError): void => {
    const code: GradientError['code'] = error.code
    const message: string = error.message
    const cause: unknown = error.cause
    console.info(code, message, cause)
  }
  const reportCamera = (update: CameraUpdate): void => {
    const azimuth: number = update.cAzimuthAngle
    const polar: number = update.cPolarAngle
    const distance: number | undefined = update.cDistance
    const zoom: number | undefined = update.cameraZoom
    // Rounding is runtime behavior; public payloads must remain numeric, not strings.
    console.info(azimuth.toFixed(0), polar.toFixed(0), distance?.toFixed(2), zoom?.toFixed(2))
  }
  const cameraPayloads: CameraUpdate[] = [
    { cAzimuthAngle: 37, cPolarAngle: 81, cDistance: 4.25 },
    { cAzimuthAngle: 37, cPolarAngle: 81, cameraZoom: 2.75 },
    { cAzimuthAngle: 37, cPolarAngle: 81 },
  ]
  const managed = {
    ...presets.halo.props,
    shader: 'glass',
    type: 'sphere',
    animate: 'off',
    uTime: -2,
    cAzimuthAngle: 37,
    cPolarAngle: 81,
    cameraZoom: 2.75,
    onCameraUpdate: reportCamera,
    onError: reportError,
  } satisfies ManagedGradientProps
  const attributes = {
    id: 'native-canvas-contract',
    class: ['gradient', { paused: true }],
    style: 'width: 320px; height: 180px; pointer-events: auto',
    role: 'img',
    'aria-label': 'A typed gradient',
    'aria-hidden': false,
    tabindex: 0,
    onclick(event) {
      const element: HTMLDivElement = event.currentTarget
      const pointer: MouseEvent = event
      console.info(element.id, pointer.clientX)
    },
  } satisfies WrapperAttributes
  const canvas = {
    ...attributes,
    children: scene,
    fallback: canvasFallback,
    onError: reportError,
    pixelDensity: 1.25,
    fov: 55,
    pointerEvents: 'auto',
    envBasePath: '/environments/',
    respectReducedMotion: true,
    active: true,
    lazyLoad: false,
    threshold: 0.25,
    rootMargin: '20px',
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  } satisfies ShaderGradientCanvasProps

  function modeDescription(props: ShaderGradientProps): string {
    if (props.mode === 'external') {
      const forbidden: undefined = props.grain
      return `${props.mode}:${props.uTime}:${forbidden}`
    }
    const managedMode: 'managed' | undefined = props.mode
    return `${managedMode ?? 'managed'}:${props.grain}`
  }
  function describeFallback(state: CanvasFallbackState): string {
    if (state.status === 'error' || state.status === 'unsupported') {
      const error: GradientError = state.error
      return `${state.status}:${error.code}:${error.message}`
    }
    const pending: 'deferred' | 'loading' = state.status
    return pending
  }
</script>

{#snippet canvasFallback(state: CanvasFallbackState)}
  <p role="status">{describeFallback(state)}</p>
{/snippet}

{#snippet scene()}
  <ShaderGradient {...managed} />
{/snippet}

<ShaderGradientCanvas {...canvas} data-contract="explicit-snippets" />
<ShaderGradientCanvas class="implicit-children" style="width: 320px; height: 180px" fallback={canvasFallback}>
  <ShaderGradient shader="positionMix" type="waterPlane" onCameraUpdate={reportCamera} onError={reportError} />
</ShaderGradientCanvas>
<p>{modeDescription(managed)} / {presetsArray.length} / {cameraPayloads.length}</p>
