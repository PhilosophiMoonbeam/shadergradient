import type {
  CompletedFrame,
  Dispose,
  FrameLease,
  GradientError,
  GradientSourceHandle,
  GradientSourceOptions,
  ProducerToken,
  SourceDemand,
  SourceProducer,
  SourceState,
  SourceViewLease,
} from './types.js'

type StateListener = (state: SourceState) => void
type FrameListener = (frame: CompletedFrame, token: ProducerToken) => void

interface Subscription<Listener> {
  listener: Listener | undefined
}

interface ProducerReservation {
  callbacks: SourceProducer
  token: ProducerToken
}

interface PendingFrameRequest {
  sequence: number
  pending: boolean
  previous: PendingFrameRequest | undefined
  next: PendingFrameRequest | undefined
}

export function createGradientSource(
  options: GradientSourceOptions = {}
): GradientSourceHandle {
  const label = options.label
  const description =
    label === undefined ? 'Gradient source' : `Gradient source "${label}"`
  const noop: Dispose = () => {}
  let generation = 0
  let disposed = false
  let producer: ProducerReservation | undefined
  let visibleViews = 0
  let pendingFrames = 0
  let requestSequence = 0
  let pendingHead: PendingFrameRequest | undefined
  let pendingTail: PendingFrameRequest | undefined
  let stateListeners: Subscription<StateListener>[] = []
  let frameListeners: Subscription<FrameListener>[] = []

  // Keep internal bookkeeping untracked; only the public getters are reactive reads.
  let stateSnapshot: SourceState = Object.freeze({
    status: 'absent',
    generation,
  })
  let demandSnapshot: SourceDemand = Object.freeze({
    visibleViews,
    pendingFrames,
  })
  let reactiveState = $state.raw<SourceState>(stateSnapshot)
  let reactiveDemand = $state.raw<SourceDemand>(demandSnapshot)

  function sourceError(
    code: 'duplicate-producer' | 'source-disposed'
  ): Error & GradientError {
    const message =
      code === 'duplicate-producer'
        ? `${description} already has an attached producer. Detach that producer before attaching another, or create a separate source handle.`
        : `${description} has been disposed. Create a new source handle before attaching a producer, view, or frame request.`
    return Object.assign(new Error(message), { code })
  }

  function createToken(): ProducerToken {
    return Object.freeze({ generation, identity: Symbol(label) })
  }

  function isCurrent(token: ProducerToken): boolean {
    return (
      !disposed &&
      producer !== undefined &&
      producer.token === token &&
      token.generation === generation
    )
  }

  function notifyState(next: SourceState): void {
    const listeners = stateListeners
    for (let index = 0; index < listeners.length; index += 1) {
      // A listener may synchronously reset, detach, or dispose this handle.
      if (stateSnapshot !== next) return
      const listener = listeners[index].listener
      if (listener !== undefined) listener(next)
    }
  }

  function setState(next: SourceState): void {
    stateSnapshot = Object.freeze(next)
    reactiveState = stateSnapshot
    notifyState(stateSnapshot)
  }

  function updateDemand(): void {
    if (
      demandSnapshot.visibleViews === visibleViews &&
      demandSnapshot.pendingFrames === pendingFrames
    ) {
      return
    }
    demandSnapshot = Object.freeze({ visibleViews, pendingFrames })
    reactiveDemand = demandSnapshot
    const owner = producer
    if (owner !== undefined) owner.callbacks.onDemandChange(demandSnapshot)
  }

  function removeRequest(request: PendingFrameRequest): void {
    request.pending = false
    if (request.previous === undefined) pendingHead = request.next
    else request.previous.next = request.next
    if (request.next === undefined) pendingTail = request.previous
    else request.next.previous = request.previous
    request.previous = undefined
    request.next = undefined
    pendingFrames -= 1
  }

  return {
    get state() {
      return reactiveState
    },
    get demand() {
      return reactiveDemand
    },
    subscribe(listener): Dispose {
      if (disposed) {
        listener(stateSnapshot)
        return noop
      }
      const subscription: Subscription<StateListener> = { listener }
      stateListeners = [...stateListeners, subscription]
      listener(stateSnapshot)
      return () => {
        if (subscription.listener === undefined) return
        subscription.listener = undefined
        stateListeners = stateListeners.filter(
          (entry) => entry !== subscription
        )
      }
    },
    subscribeFrames(listener): Dispose {
      if (disposed) return noop
      const subscription: Subscription<FrameListener> = { listener }
      frameListeners = [...frameListeners, subscription]
      return () => {
        if (subscription.listener === undefined) return
        subscription.listener = undefined
        frameListeners = frameListeners.filter(
          (entry) => entry !== subscription
        )
      }
    },
    attachProducer(callbacks): ProducerToken {
      if (disposed) throw sourceError('source-disposed')
      if (producer !== undefined) throw sourceError('duplicate-producer')
      generation += 1
      const token = createToken()
      const owner: ProducerReservation = { callbacks, token }
      const pendingAtAttach = requestSequence
      producer = owner
      setState({ status: 'loading', generation })
      if (producer === owner) callbacks.onDemandChange(demandSnapshot)
      if (
        producer === owner &&
        pendingHead !== undefined &&
        pendingHead.sequence <= pendingAtAttach
      ) {
        callbacks.invalidate()
      }
      return token
    },
    resetProducer(token): ProducerToken | undefined {
      if (!isCurrent(token)) return undefined
      generation += 1
      const next = createToken()
      // isCurrent guarantees that this reservation is still attached.
      producer!.token = next
      setState({ status: 'loading', generation })
      return next
    },
    setProducerState(token, next): boolean {
      if (!isCurrent(token)) return false
      if (next.status === 'error') {
        setState({ status: 'error', generation, error: next.error })
      } else {
        setState({ status: 'loading', generation })
      }
      return true
    },
    publishFrame(token, frame): boolean {
      if (
        !isCurrent(token) ||
        !Number.isFinite(frame.width) ||
        !Number.isFinite(frame.height) ||
        frame.width <= 0 ||
        frame.height <= 0 ||
        frame.width !== frame.canvas.width ||
        frame.height !== frame.canvas.height
      ) {
        return false
      }

      // Capture boundaries before readiness callbacks can add requests or subscriptions.
      const pendingAtStart = requestSequence
      const listeners = frameListeners
      const readyState: SourceState =
        stateSnapshot.status === 'ready'
          ? stateSnapshot
          : Object.freeze({ status: 'ready', generation })
      if (stateSnapshot !== readyState) setState(readyState)

      for (let index = 0; index < listeners.length; index += 1) {
        if (!isCurrent(token) || stateSnapshot !== readyState) return true
        const listener = listeners[index].listener
        if (listener !== undefined) listener(frame, token)
      }
      if (!isCurrent(token) || stateSnapshot !== readyState) return true

      // Requests are ordered by creation, so no per-frame snapshot array is needed.
      let fulfilled = false
      while (
        pendingHead !== undefined &&
        pendingHead.sequence <= pendingAtStart
      ) {
        removeRequest(pendingHead)
        fulfilled = true
      }
      if (fulfilled) updateDemand()
      return true
    },
    detachProducer(token): void {
      if (!isCurrent(token)) return
      generation += 1
      producer = undefined
      setState({ status: 'absent', generation })
    },
    attachView(initiallyVisible): SourceViewLease {
      if (disposed) throw sourceError('source-disposed')
      let released = false
      let visible = false

      function setVisible(next: boolean): void {
        if (released || disposed || visible === next) return
        const owner = producer
        visible = next
        visibleViews += next ? 1 : -1
        updateDemand()
        if (
          next &&
          !released &&
          visible &&
          producer === owner &&
          owner !== undefined
        ) {
          owner.callbacks.invalidate()
        }
      }

      const lease: SourceViewLease = {
        setVisible,
        release() {
          if (released) return
          released = true
          if (disposed || !visible) return
          visible = false
          visibleViews -= 1
          updateDemand()
        },
      }
      setVisible(initiallyVisible)
      return lease
    },
    requestFrame(): FrameLease {
      if (disposed) throw sourceError('source-disposed')
      const owner = producer
      requestSequence += 1
      const request: PendingFrameRequest = {
        sequence: requestSequence,
        pending: true,
        previous: pendingTail,
        next: undefined,
      }
      if (pendingTail === undefined) pendingHead = request
      else pendingTail.next = request
      pendingTail = request
      pendingFrames += 1
      updateDemand()
      if (request.pending && producer === owner && owner !== undefined) {
        owner.callbacks.invalidate()
      }
      return {
        release() {
          if (!request.pending) return
          removeRequest(request)
          updateDemand()
        },
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      generation += 1
      producer = undefined
      while (pendingHead !== undefined) removeRequest(pendingHead)
      visibleViews = 0
      updateDemand()
      for (let index = 0; index < frameListeners.length; index += 1) {
        frameListeners[index].listener = undefined
      }
      frameListeners = []
      try {
        setState({ status: 'disposed', generation })
      } finally {
        for (let index = 0; index < stateListeners.length; index += 1) {
          stateListeners[index].listener = undefined
        }
        stateListeners = []
      }
    },
  }
}
