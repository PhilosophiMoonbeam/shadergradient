<script module>
  import {
    ShaderGradientCanvas,
    ShaderGradient,
    ShaderGradientSource,
    ShaderGradientView,
    createGradientSource,
  } from '@shadergradient/svelte'

  // These are the actual imported runtime values, not source-text assertions.
  const runtime = {
    ShaderGradientCanvas,
    ShaderGradient,
    ShaderGradientSource,
    ShaderGradientView,
    createGradientSource,
  }
  export const publicRuntimeNames = Object.keys(runtime).filter(
    (name) => typeof runtime[name] === 'function'
  )
</script>

<script>
  import { onDestroy, untrack } from 'svelte'

  let { requestId, color1, uTime, observe } = $props()
  // This server-only component owns one immutable request snapshot and handle.
  const request = untrack(() => ({ requestId, color1, uTime, observe }))
  const source = createGradientSource({ label: `SSR ${request.requestId}` })
  const settings = {
    color1: request.color1,
    color2: '#8b58dd',
    color3: '#d5e8ef',
    uTime: request.uTime,
    animate: 'off',
    grain: 'off',
    lightType: '3d',
    enableTransition: false,
  }
  request.observe({
    requestId: request.requestId,
    color1: request.color1,
    uTime: request.uTime,
    source,
    initialSourceState: { ...source.state },
  })
  onDestroy(() => source.dispose())
</script>

<article data-request={requestId} data-color={color1} data-time={uTime}>
  <h1>Server-rendered native gradient: {requestId}</h1>
  <p>
    Request {requestId} uses color {color1} at time {uTime}. This surrounding
    content is available without JavaScript or WebGL.
  </p>
  <ShaderGradientCanvas
    style="width:360px;height:180px;background:#24324b;"
    pixelDensity={1}
    lazyLoad={false}
    aria-label={`Gradient for request ${requestId}`}
  >
    <ShaderGradient {...settings} />
    {#snippet fallback(state)}
      <p data-testid="ssr-canvas-fallback">
        Gradient {requestId}: {state.status}; a decorative preview will appear
        after client mount.
      </p>
    {/snippet}
  </ShaderGradientCanvas>
  <ShaderGradientSource {source} gradient={settings} width={360} height={180}>
    {#snippet fallback(state)}
      <span data-testid="ssr-source-fallback"
        >Source {requestId}: {state.status}</span
      >
    {/snippet}
  </ShaderGradientSource>
  <ShaderGradientView
    {source}
    style="width:360px;height:180px;background:#24324b;"
  >
    {#snippet fallback(state)}
      <p data-testid="ssr-view-fallback">
        Mirror {requestId}: {state.status}; the static description remains
        useful without a canvas.
      </p>
    {/snippet}
  </ShaderGradientView>
  <a href="/ownership">Inspect the retained ownership scene</a>
</article>
