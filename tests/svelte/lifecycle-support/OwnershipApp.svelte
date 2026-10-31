<script>
  import { onMount, tick } from 'svelte'
  import { Canvas as ThrelteCanvas } from '@threlte/core'
  import { ShaderGradient } from '@shadergradient/svelte'
  import { WebGLRenderer } from 'three'
  import OwnershipProbe from './OwnershipProbe.svelte'

  let mode = $state(null)
  let managedCount = $state(0)
  let contender = $state(false)
  let outsideCanvas = $state(false)
  let errors = $state.raw([])
  let initialFailure = $state.raw(null)
  let probe
  let managedReset
  let contenderReset
  let outsideReset
  const reportedCauses = new WeakSet()
  const gradient = {
    animate: 'off',
    uTime: 9,
    grain: 'off',
    type: 'sphere',
    color1: '#ff5005',
    color2: '#8746ff',
    color3: '#c5edf5',
    lightType: '3d',
    brightness: 0.8,
    toggleAxis: true,
    enableTransition: false,
    cAzimuthAngle: 180,
    cPolarAngle: 85,
  }

  function attach(value) {
    probe = value
    return () => {
      if (probe === value) probe = undefined
    }
  }

  function recordError(error) {
    const cause = error?.cause
    if (cause && (typeof cause === 'object' || typeof cause === 'function'))
      reportedCauses.add(cause)
    if (error && (typeof error === 'object' || typeof error === 'function'))
      reportedCauses.add(error)
    errors = [
      ...errors,
      {
        code: typeof error?.code === 'string' ? error.code : 'boundary',
        message:
          typeof error?.message === 'string' ? error.message : String(error),
      },
    ]
  }

  function boundaryError(error) {
    if (
      error &&
      (typeof error === 'object' || typeof error === 'function') &&
      reportedCauses.has(error)
    )
      return
    recordError(error)
  }

  function managedFailed(error, reset) {
    managedReset = reset
    if (mode === 'failed-initial-managed')
      initialFailure = probe?.attemptEvidence() ?? null
    boundaryError(error)
  }

  function snapshot() {
    if (!probe)
      throw new Error('The retained ownership Canvas has not initialized.')
    return {
      mode,
      errors: errors.map((error) => ({ ...error })),
      ...probe.snapshot(),
      initialFailure,
    }
  }

  async function settle() {
    // tick commits the branch and all synchronous boundary cleanup. A separate
    // completed-output task then observes a real subsequent Threlte render.
    await tick()
    if (!probe) throw new Error('The retained ownership Canvas is unavailable.')
    await probe.waitForRender()
    return snapshot()
  }

  async function clear() {
    managedCount = 0
    contender = false
    outsideCanvas = false
    await settle()
    return snapshot()
  }

  async function run(nextMode) {
    if (
      ![
        'missing-context',
        'duplicate-managed-owner',
        'failed-initial-managed',
      ].includes(nextMode)
    ) {
      throw new TypeError(`Unknown ownership failure mode: ${String(nextMode)}`)
    }
    await clear()
    mode = nextMode
    errors = []
    initialFailure = null
    // A boundary's public reset recreates its now-empty, healthy branch before
    // the next operation. The retained host Canvas is never keyed/remounted.
    managedReset?.()
    contenderReset?.()
    outsideReset?.()
    managedReset = contenderReset = outsideReset = undefined
    await tick()
    if (nextMode === 'missing-context') {
      outsideCanvas = true
      return settle()
    }
    if (nextMode === 'duplicate-managed-owner') {
      managedCount = 1
      await settle()
      // The incumbent is already rendered, outside the contender's boundary.
      contender = true
      return settle()
    }
    probe.beginAttempt()
    // Both owners enter a single initially empty boundary in the same commit.
    // The first owner's real partial setup must be rolled back when its sibling
    // reports duplicate-managed; this is not an early synthetic throw.
    managedCount = 2
    return settle()
  }

  async function recover() {
    outsideCanvas = false
    contender = false
    managedCount = 1
    managedReset?.()
    contenderReset?.()
    outsideReset?.()
    managedReset = contenderReset = outsideReset = undefined
    return settle()
  }

  async function replaceEnvironment() {
    if (!probe)
      throw new Error('The retained ownership Canvas has not initialized.')
    probe.replaceEnvironment()
    return settle()
  }

  function refs() {
    if (!probe)
      throw new Error('The retained ownership Canvas has not initialized.')
    return {
      renderer: probe.renderer,
      scene: probe.scene,
      camera: probe.camera,
      hostMesh: probe.hostMesh,
      controls: probe.controls,
      classes: probe.classes,
      invalidate: probe.invalidate,
    }
  }

  const api = { run, recover, clear, replaceEnvironment, snapshot, refs }
  onMount(() => {
    window.gradientOwnership = api
    return () => {
      if (window.gradientOwnership === api) delete window.gradientOwnership
    }
  })

  const createRenderer = (canvas) =>
    new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    })
</script>

<svelte:head>
  <title>Native gradient ownership lifecycle</title>
</svelte:head>

<main>
  <h1>Retained consumer-owned Threlte scene</h1>
  <p>
    The yellow host box, registered camera, environment and live controls belong
    to this consumer.
  </p>
  <div class="viewport" data-testid="ownership-host">
    <ThrelteCanvas dpr={1} renderMode="on-demand" {createRenderer}>
      <OwnershipProbe onready={attach} />
      <svelte:boundary onerror={managedFailed}>
        {#if managedCount > 0}
          <ShaderGradient {...gradient} onError={recordError} />
        {/if}
        {#if managedCount > 1}
          <ShaderGradient {...gradient} onError={recordError} />
        {/if}
      </svelte:boundary>
      <svelte:boundary
        onerror={(error, reset) => {
          contenderReset = reset
          boundaryError(error)
        }}
      >
        {#if contender}
          <ShaderGradient {...gradient} onError={recordError} />
        {/if}
      </svelte:boundary>
    </ThrelteCanvas>
  </div>
  <svelte:boundary
    onerror={(error, reset) => {
      outsideReset = reset
      boundaryError(error)
    }}
  >
    {#if outsideCanvas}
      <ShaderGradient {...gradient} onError={recordError} />
    {/if}
  </svelte:boundary>
  <p role="status" data-testid="ownership-state">
    Mode: {mode ?? 'host-only'}; errors: {errors.length}
  </p>
  <ul aria-label="Observed lifecycle errors">
    {#each errors as error, index (`${index}:${error.code}`)}
      <li><code>{error.code}</code>: {error.message}</li>
    {/each}
  </ul>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
    color: #e8edf7;
    background: #0e1524;
  }
  main {
    max-width: 900px;
    margin: 0 auto;
    padding: 24px;
  }
  .viewport {
    height: 420px;
    width: 100%;
    border: 1px solid #66748e;
  }
  code {
    color: #ffd76b;
  }
</style>
