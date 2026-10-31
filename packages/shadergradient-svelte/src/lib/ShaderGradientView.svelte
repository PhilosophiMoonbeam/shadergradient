<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type {
    CompletedFrame,
    Dispose,
    FrameLease,
    GradientSourceHandle,
    ProducerToken,
    ShaderGradientViewProps,
    SourceState,
    SourceViewLease,
  } from './types.js'

  let {
    source,
    pixelDensity = 1,
    maxDimension = 2048,
    threshold = 0,
    rootMargin = '0px',
    fallback,
    onError,
    style,
    'aria-hidden': ariaHidden = true,
    ...attributes
  }: ShaderGradientViewProps = $props()

  // Spread-backed prop invalidations are not changes of handle ownership.
  const sourceHandle = $derived(source)

  let wrapper = $state.raw<HTMLDivElement>()
  let canvas = $state.raw<HTMLCanvasElement>()
  let mounted = $state(false)
  let binding = $state.raw<ViewBinding>()
  let boundSource = $state.raw<GradientSourceHandle>()
  let sourceState = $state.raw<SourceState>()
  let copied = $state(false)

  const density = $derived(
    Number.isFinite(pixelDensity) && pixelDensity > 0
      ? Math.min(2, Math.max(0.25, pixelDensity))
      : 1
  )
  const dimension = $derived(
    Number.isFinite(maxDimension) && maxDimension > 0
      ? Math.min(4096, Math.max(1, Math.round(maxDimension)))
      : 2048
  )
  const intersectionThreshold = $derived(
    Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
      ? threshold
      : 0
  )
  const viewState = $derived(
    boundSource === source && sourceState ? sourceState : source.state
  )
  const ready = $derived(
    boundSource === source && copied && viewState.status === 'ready'
  )

  interface ViewBinding {
    configure(
      density: number,
      dimension: number,
      threshold: number,
      rootMargin: string
    ): void
    dispose(): void
  }

  function createBinding(
    handle: GradientSourceHandle,
    host: HTMLDivElement,
    destination: HTMLCanvasElement,
    initialDensity: number,
    initialDimension: number,
    initialThreshold: number,
    initialRootMargin: string
  ): ViewBinding {
    let live = true
    let context: CanvasRenderingContext2D | null = null
    let currentState = handle.state
    let view: SourceViewLease | undefined
    let pending: FrameLease | undefined
    let requestVersion = 0
    let releaseState: Dispose | undefined
    let releaseFrames: Dispose | undefined
    let resizeObserver: ResizeObserver | undefined
    let intersectionObserver: IntersectionObserver | undefined
    let observingThreshold: number | undefined
    let observingMargin: string | undefined
    let intersecting = typeof IntersectionObserver === 'undefined'
    let cssWidth = 0
    let cssHeight = 0
    let requestedDensity = initialDensity
    let edgeLimit = initialDimension

    function isCurrent(): boolean {
      return live && source === handle
    }

    function drawable(): boolean {
      return (
        isCurrent() &&
        context !== null &&
        intersecting &&
        cssWidth > 0 &&
        cssHeight > 0 &&
        currentState.status !== 'disposed'
      )
    }

    function clearPixels() {
      if (isCurrent()) copied = false
      context?.clearRect(0, 0, destination.width, destination.height)
    }

    function cancelRequest() {
      requestVersion += 1
      const previous = pending
      pending = undefined
      previous?.release()
    }

    function requestFreshFrame() {
      cancelRequest()
      if (!drawable()) return
      const version = requestVersion
      const request = handle.requestFrame()
      // Invalidation may synchronously publish, dispose, or replace the producer.
      if (!drawable() || version !== requestVersion) request.release()
      else pending = request
    }

    function updateDemand(fresh: boolean) {
      const visible = drawable()
      if (!visible) cancelRequest()
      view?.setVisible(visible)
      if (visible && fresh) requestFreshFrame()
    }

    function resizeBuffer() {
      clearPixels()
      // One scale preserves aspect ratio and bounds both edges (and their area).
      const scale =
        cssWidth > 0 && cssHeight > 0
          ? Math.min(
              requestedDensity,
              edgeLimit / cssWidth,
              edgeLimit / cssHeight
            )
          : 0
      const width =
        scale > 0
          ? Math.max(1, Math.min(edgeLimit, Math.floor(cssWidth * scale)))
          : 0
      const height =
        scale > 0
          ? Math.max(1, Math.min(edgeLimit, Math.floor(cssHeight * scale)))
          : 0
      if (destination.width !== width) destination.width = width
      if (destination.height !== height) destination.height = height
      updateDemand(true)
    }

    function setSize(width: number, height: number) {
      if (!isCurrent()) return false
      const nextWidth = Number.isFinite(width) && width > 0 ? width : 0
      const nextHeight = Number.isFinite(height) && height > 0 ? height : 0
      if (nextWidth === cssWidth && nextHeight === cssHeight) return false
      cssWidth = nextWidth
      cssHeight = nextHeight
      resizeBuffer()
      return true
    }

    function measure() {
      // Match ResizeObserver's content box without creating a polling loop.
      const styles = window.getComputedStyle(host)
      const paddingX =
        Number.parseFloat(styles.paddingLeft) +
        Number.parseFloat(styles.paddingRight)
      const paddingY =
        Number.parseFloat(styles.paddingTop) +
        Number.parseFloat(styles.paddingBottom)
      const borderX =
        Number.parseFloat(styles.borderLeftWidth) +
        Number.parseFloat(styles.borderRightWidth)
      const borderY =
        Number.parseFloat(styles.borderTopWidth) +
        Number.parseFloat(styles.borderBottomWidth)
      const borderBox = styles.boxSizing === 'border-box'
      const hasLayout = host.getClientRects().length > 0
      return setSize(
        hasLayout
          ? Number.parseFloat(styles.width) -
              (borderBox ? paddingX + borderX : 0)
          : 0,
        hasLayout
          ? Number.parseFloat(styles.height) -
              (borderBox ? paddingY + borderY : 0)
          : 0
      )
    }

    function observeVisibility(nextThreshold: number, nextMargin: string) {
      if (
        observingThreshold === nextThreshold &&
        observingMargin === nextMargin
      )
        return
      observingThreshold = nextThreshold
      observingMargin = nextMargin
      intersectionObserver?.disconnect()
      intersectionObserver = undefined
      if (typeof IntersectionObserver === 'undefined') {
        const changed = !intersecting
        intersecting = true
        if (changed) {
          clearPixels()
          updateDemand(true)
        }
        return
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (!isCurrent() || intersectionObserver !== observer) return
          for (const entry of entries) {
            if (entry.target !== host || intersecting === entry.isIntersecting)
              continue
            intersecting = entry.isIntersecting
            clearPixels()
            // Also catch zero-to-nonzero layout on reentry without ResizeObserver.
            if (!measure()) updateDemand(true)
          }
        },
        { threshold: nextThreshold, rootMargin: nextMargin }
      )
      intersectionObserver = observer
      observer.observe(host)
    }

    function copyFrame(frame: CompletedFrame, token: ProducerToken) {
      if (!drawable() || !context) return
      const snapshot = handle.state
      if (
        snapshot.status !== 'ready' ||
        token.generation !== snapshot.generation ||
        !Number.isFinite(frame.width) ||
        !Number.isFinite(frame.height) ||
        frame.width <= 0 ||
        frame.height <= 0 ||
        frame.width !== frame.canvas.width ||
        frame.height !== frame.canvas.height ||
        destination.width === 0 ||
        destination.height === 0
      )
        return
      const width = destination.width
      const height = destination.height
      const scale = Math.max(width / frame.width, height / frame.height)
      const cropWidth = width / scale
      const cropHeight = height / scale
      try {
        // Borrowed framebuffer: this copy must finish inside publishFrame dispatch.
        context.clearRect(0, 0, width, height)
        context.drawImage(
          frame.canvas,
          (frame.width - cropWidth) / 2,
          (frame.height - cropHeight) / 2,
          cropWidth,
          cropHeight,
          0,
          0,
          width,
          height
        )
      } catch (cause) {
        clearPixels()
        onError?.({
          code: 'copy',
          message:
            'The <ShaderGradientView> could not copy the completed source frame.',
          cause,
        })
        return
      }
      requestVersion += 1
      pending = undefined
      copied = true
    }

    boundSource = handle
    copied = false
    releaseState = handle.subscribe((next) => {
      if (!isCurrent()) return
      const previous = currentState
      currentState = next
      sourceState = next
      if (next.status !== 'ready' || next.generation !== previous.generation)
        clearPixels()
      if (next.status === 'disposed') {
        cancelRequest()
        view?.release()
        view = undefined
      }
    })
    releaseFrames = handle.subscribeFrames(copyFrame)
    try {
      context = destination.getContext('2d')
      if (!context) throw new Error('A Canvas 2D context is unavailable.')
    } catch (cause) {
      onError?.({
        code: 'copy',
        message:
          'The <ShaderGradientView> could not create its Canvas 2D context.',
        cause,
      })
    }
    if (handle.state.status !== 'disposed') view = handle.attachView(false)
    observeVisibility(initialThreshold, initialRootMargin)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
    } else {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === host)
            setSize(entry.contentRect.width, entry.contentRect.height)
        }
      })
      resizeObserver.observe(host)
    }

    return {
      configure(nextDensity, nextDimension, nextThreshold, nextMargin) {
        if (!isCurrent()) return
        const sizeChanged =
          requestedDensity !== nextDensity || edgeLimit !== nextDimension
        requestedDensity = nextDensity
        edgeLimit = nextDimension
        // Prop-driven layout changes also remain observable without ResizeObserver.
        const resized = !resizeObserver && measure()
        if (sizeChanged && !resized) resizeBuffer()
        observeVisibility(nextThreshold, nextMargin)
      },
      dispose() {
        if (!live) return
        live = false
        resizeObserver?.disconnect()
        intersectionObserver?.disconnect()
        window.removeEventListener('resize', measure)
        releaseFrames?.()
        releaseState?.()
        cancelRequest()
        view?.release()
        view = undefined
        context?.clearRect(0, 0, destination.width, destination.height)
        context = null
        copied = false
        if (boundSource === handle) {
          boundSource = undefined
          sourceState = undefined
        }
      },
    }
  }

  onMount(() => {
    mounted = true
    return () => {
      mounted = false
    }
  })

  $effect.pre(() => {
    const handle = sourceHandle
    const host = wrapper
    const destination = canvas
    if (!mounted || !host || !destination) return
    const owned = untrack(() =>
      createBinding(
        handle,
        host,
        destination,
        density,
        dimension,
        intersectionThreshold,
        rootMargin
      )
    )
    binding = owned
    return () => {
      owned.dispose()
      binding = undefined
    }
  })

  $effect(() => {
    const owned = binding
    const nextDensity = density
    const nextDimension = dimension
    const nextThreshold = intersectionThreshold
    const nextMargin = rootMargin
    // Read these so layout-only attribute/style changes have a fallback measurement.
    Object.values(attributes)
    style
    untrack(() =>
      owned?.configure(nextDensity, nextDimension, nextThreshold, nextMargin)
    )
  })
</script>

<div
  bind:this={wrapper}
  {...attributes}
  aria-hidden={ariaHidden}
  style={`position:relative;pointer-events:none;${style ?? ''}`}
>
  {#if mounted}
    <canvas bind:this={canvas} width="0" height="0" aria-hidden="true"></canvas>
  {/if}
  {#if !ready && fallback}
    <div class="shadergradient-fallback">{@render fallback(viewState)}</div>
  {/if}
</div>

<style>
  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .shadergradient-fallback {
    position: absolute;
    inset: 0;
  }
</style>
