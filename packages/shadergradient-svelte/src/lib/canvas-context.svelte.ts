import { createContext } from 'svelte'
import { fromStore } from 'svelte/store'
import { useTask, useThrelte, type ThrelteContext } from '@threlte/core'
import { defaultEnvBasePath } from '@shadergradient/core'
import type { PerspectiveCamera, WebGLRenderer } from 'three'
import type {
  CanvasContextInput,
  CanvasLifecycleContext,
  CanvasSettings,
  CompletedFrame,
  Dispose,
  EnvironmentState,
  FramePhase,
  FrameSize,
  GradientError,
  RenderReplacement,
  ScheduledWork,
} from './types.js'

type Threlte = ThrelteContext<WebGLRenderer>
const [readContext, writeContext] = createContext<CanvasLifecycleContext>()

interface WorkRegistration {
  work: ScheduledWork
  live: boolean
}

interface FrameRegistration {
  listener: (frame: CompletedFrame) => void
  live: boolean
}

class Lifecycle implements CanvasLifecycleContext {
  private binding = $state.raw<Threlte>()
  private measuredSize = $state.raw<{
    current: { width: number; height: number }
  }>()
  private measuredDpr = $state.raw<{ current: number }>()
  private halted = $state(false)
  private workVersion = $state(0)
  private deferInvalidations = false
  private queueInvalidation: (() => void) | undefined
  private controls: WorkRegistration[] = []
  private animations: WorkRegistration[] = []
  private listeners: FrameRegistration[] = []
  private readonly environmentListeners = new Set<
    (state: EnvironmentState) => void
  >()
  private environmentOwner: symbol | undefined
  private environment = $state.raw<EnvironmentState>({ status: 'disabled' })
  private replacement = $state.raw<{
    owner: symbol
    value: RenderReplacement
    previousAutoRender: boolean
    binding: Threlte
  }>()
  readonly settings: CanvasSettings
  readonly size: FrameSize

  constructor(
    private readonly input: CanvasContextInput,
    readonly rendererOwnership: 'canvas' | 'host' = 'canvas'
  ) {
    this.settings = {
      get pixelDensity() {
        return input.settings().pixelDensity
      },
      get fov() {
        return input.settings().fov
      },
      get envBasePath() {
        return input.settings().envBasePath
      },
      get respectReducedMotion() {
        return input.settings().respectReducedMotion
      },
    }
    const self = this
    this.size = {
      get width() {
        return $effect.tracking()
          ? (self.measuredSize?.current.width ?? 0)
          : (self.binding?.size.current.width ?? 0)
      },
      get height() {
        return $effect.tracking()
          ? (self.measuredSize?.current.height ?? 0)
          : (self.binding?.size.current.height ?? 0)
      },
      get dpr() {
        // Subscribe only for tracked consumers; hot scheduler reads stay direct.
        if ($effect.tracking()) self.measuredDpr?.current
        return self.binding?.renderer.getPixelRatio() ?? 1
      },
    }
  }

  get reducedMotion() {
    return this.input.reducedMotion()
  }
  get active() {
    return !this.halted && this.input.active()
  }
  get canvas() {
    return this.halted ? undefined : this.binding?.canvas
  }
  get renderer() {
    return this.halted ? undefined : this.binding?.renderer
  }
  get environmentState() {
    return this.environment
  }

  invalidate = () => {
    if (!this.binding || this.halted) return
    if (this.deferInvalidations) {
      this.queueInvalidation?.()
      return
    }
    this.binding.invalidate()
    if (this.binding.renderMode.current === 'manual') this.binding.advance()
  }

  registerWork(phase: FramePhase, work: ScheduledWork): Dispose {
    // Replace collections only on lifecycle operations. An in-flight dispatch keeps
    // its original indexed collection, while removals synchronously revoke leases.
    const registration: WorkRegistration = { work, live: true }
    if (phase === 'controls') this.controls = [...this.controls, registration]
    else this.animations = [...this.animations, registration]
    this.workVersion += 1
    this.invalidate()
    return () => {
      if (!registration.live) return
      registration.live = false
      if (phase === 'controls')
        this.controls = this.controls.filter((entry) => entry !== registration)
      else
        this.animations = this.animations.filter(
          (entry) => entry !== registration
        )
      this.workVersion += 1
    }
  }

  replaceRender(owner: symbol, value: RenderReplacement): Dispose {
    const binding = this.binding
    if (!binding)
      throw new Error('Render replacement requires a bound <Canvas> lifecycle.')
    if (this.replacement)
      throw new Error('Only one render replacement may own a <Canvas>.')
    const lease = {
      owner,
      value,
      previousAutoRender: binding.autoRender.current,
      binding,
    }
    this.replacement = lease
    binding.autoRender.set(false)
    // Suppress the plain task synchronously, before reactive store synchronization.
    binding.autoRenderTask.stop()
    this.invalidate()
    return () => {
      if (this.replacement !== lease) return
      this.replacement = undefined
      if (!binding.autoRender.current)
        binding.autoRender.set(lease.previousAutoRender)
      if (binding.autoRender.current) binding.autoRenderTask.start()
      this.invalidate()
    }
  }

  subscribeAfterRender(listener: (frame: CompletedFrame) => void): Dispose {
    const registration: FrameRegistration = { listener, live: true }
    this.listeners = [...this.listeners, registration]
    return () => {
      if (!registration.live) return
      registration.live = false
      this.listeners = this.listeners.filter((entry) => entry !== registration)
    }
  }

  setEnvironmentState(
    owner: symbol,
    state: EnvironmentState | undefined
  ): void {
    if (state === undefined) {
      if (this.environmentOwner !== owner) return
      this.environmentOwner = undefined
      this.environment = { status: 'disabled' }
    } else {
      if (
        this.environmentOwner !== undefined &&
        this.environmentOwner !== owner
      ) {
        throw new Error(
          'Only one managed gradient may own environment state in a <Canvas>. Use external mode for additional gradients.'
        )
      }
      this.environmentOwner = owner
      this.environment = state
    }
    for (const listener of this.environmentListeners) listener(this.environment)
  }

  subscribeEnvironment(listener: (state: EnvironmentState) => void): Dispose {
    this.environmentListeners.add(listener)
    listener(this.environment)
    return () => {
      this.environmentListeners.delete(listener)
    }
  }

  reportError = (error: GradientError) => {
    if (error.code === 'context-lost' || error.code === 'renderer') {
      this.halted = true
      if (this.rendererOwnership === 'canvas')
        this.binding?.autoRenderTask.stop()
    }
    this.input.onError()?.(error)
  }

  private hasWork(collection: WorkRegistration[]): boolean {
    this.workVersion
    if (!this.active || this.reducedMotion) return false
    for (let index = 0; index < collection.length; index += 1) {
      const registration = collection[index]
      if (registration.live && registration.work.active()) return true
    }
    return false
  }

  private dispatch(collection: WorkRegistration[], delta: number): void {
    // Main-stage temporal changes belong to this scheduler turn, not its successor.
    this.deferInvalidations = false
    if (
      !this.active ||
      this.reducedMotion ||
      this.binding?.renderer.getContext().isContextLost()
    )
      return
    for (let index = 0; index < collection.length; index += 1) {
      if (!this.active || this.reducedMotion) break
      const registration = collection[index]
      if (!registration.live || !registration.work.active()) continue
      registration.work.tick(delta)
      this.invalidate()
    }
  }

  bind(binding: Threlte): void {
    if (this.binding) {
      if (this.binding.renderer !== binding.renderer) {
        throw new Error(
          'A Canvas lifecycle cannot bind to a different nested <Canvas>.'
        )
      }
      return
    }
    this.binding = binding
    this.measuredSize = fromStore(binding.size)
    this.measuredDpr = fromStore(binding.dpr)
    this.halted = false
    this.deferInvalidations = false
    let invalidationQueued = false
    const flushInvalidation = () => {
      invalidationQueued = false
      if (
        this.binding !== binding ||
        this.halted ||
        binding.renderer.getContext().isContextLost()
      )
        return
      this.deferInvalidations = false
      binding.invalidate()
      if (binding.renderMode.current === 'manual') binding.advance()
    }
    this.queueInvalidation = () => {
      if (invalidationQueued) return
      invalidationQueued = true
      queueMicrotask(flushInvalidation)
    }
    let completed = false
    let sequence = 0
    const frame = { canvas: binding.canvas, width: 0, height: 0, sequence: 0 }
    const controls = useTask((delta) => this.dispatch(this.controls, delta), {
      stage: binding.mainStage,
      autoInvalidate: false,
      running: () => this.hasWork(this.controls),
    })
    useTask((delta) => this.dispatch(this.animations, delta), {
      stage: binding.mainStage,
      after: controls.task,
      autoInvalidate: false,
      running: () => this.hasWork(this.animations),
    })

    const plainTask = binding.autoRenderTask
    let plainFrame = 0
    useTask(
      () => {
        completed = false
        // Threlte clears invalidation after its render stage. Late requests must
        // escape that reset; ordinary main-stage animation never queues a job.
        this.deferInvalidations = true
        plainFrame = binding.renderer.info.render.frame
        if (
          this.replacement ||
          (this.rendererOwnership === 'canvas' &&
            (this.halted || binding.renderer.getContext().isContextLost()))
        )
          plainTask.stop()
      },
      {
        stage: binding.renderStage,
        before: plainTask,
        autoInvalidate: false,
      }
    )
    const replacementTask = useTask(
      (delta) => {
        const lease = this.replacement
        if (
          !lease ||
          this.halted ||
          binding.renderer.getContext().isContextLost()
        )
          return
        if (this.size.width <= 0 || this.size.height <= 0) return
        try {
          lease.value.render(delta)
          completed =
            !this.halted && !binding.renderer.getContext().isContextLost()
        } catch (cause) {
          this.reportError({
            code: 'renderer',
            message: 'The <Canvas> render pipeline failed to complete a frame.',
            cause,
          })
        }
      },
      {
        stage: binding.renderStage,
        after: plainTask,
        autoInvalidate: false,
      }
    )
    useTask(
      () => {
        if (
          !this.replacement &&
          binding.renderer.info.render.frame !== plainFrame
        )
          completed = true
        if (!completed || this.halted || this.binding !== binding) return
        completed = false
        const canvas = binding.canvas
        if (canvas.width <= 0 || canvas.height <= 0) return
        frame.width = canvas.width
        frame.height = canvas.height
        frame.sequence = ++sequence
        const listeners = this.listeners
        for (let index = 0; index < listeners.length; index += 1) {
          if (this.halted || this.binding !== binding) break
          const registration = listeners[index]
          if (registration.live) registration.listener(frame)
        }
      },
      {
        stage: binding.renderStage,
        after: [plainTask, replacementTask.task],
        autoInvalidate: false,
      }
    )

    $effect(() => {
      // These live inputs may resume existing work or request a paused redraw.
      this.input.active()
      this.input.reducedMotion()
      this.settings.pixelDensity
      this.settings.fov
      this.measuredSize?.current
      this.invalidate()
    })
    $effect.pre(() => () => this.unbind(binding))
  }

  releaseRenderer(renderer: WebGLRenderer): void {
    const binding = this.binding
    if (binding?.renderer === renderer) this.unbind(binding)
  }

  private unbind(binding: Threlte): void {
    if (this.binding !== binding) return
    const lease = this.replacement
    if (lease?.binding === binding) {
      this.replacement = undefined
      if (!binding.autoRender.current)
        binding.autoRender.set(lease.previousAutoRender)
      if (binding.autoRender.current) binding.autoRenderTask.start()
    }
    this.binding = undefined
    this.measuredSize = undefined
    this.measuredDpr = undefined
    this.deferInvalidations = false
    this.queueInvalidation = undefined
  }
}

export function createCanvasContext(
  input: CanvasContextInput
): CanvasLifecycleContext {
  return new Lifecycle(input)
}

export function releaseCanvasRenderer(
  context: CanvasLifecycleContext,
  renderer: WebGLRenderer
): void {
  if (context instanceof Lifecycle) context.releaseRenderer(renderer)
}

export function provideCanvasContext(
  context: CanvasLifecycleContext
): CanvasLifecycleContext {
  return writeContext(context)
}

export function getCanvasContext(): CanvasLifecycleContext | undefined {
  // createContext's original getter/setter pair also works at the Svelte 5.40 floor.
  try {
    return readContext()
  } catch {
    return undefined
  }
}

export function useCanvasLifecycle(): CanvasLifecycleContext {
  let binding: Threlte
  try {
    binding = useThrelte()
  } catch (cause) {
    const error: GradientError = {
      code: 'missing-context',
      message:
        'ShaderGradient scene components must be rendered below a Threlte <Canvas> (or <ShaderGradientCanvas>).',
      cause,
    }
    getCanvasContext()?.reportError(error)
    throw Object.assign(new Error(error.message, { cause }), {
      code: error.code,
    })
  }
  let lifecycle = getCanvasContext()
  if (!lifecycle) {
    const hostCamera = fromStore(binding.camera)
    const hostDpr = fromStore(binding.dpr)
    const settings: CanvasSettings = {
      get pixelDensity() {
        if ($effect.tracking()) hostDpr.current
        return binding.renderer.getPixelRatio()
      },
      get fov() {
        const camera = (
          $effect.tracking() ? hostCamera.current : binding.camera.current
        ) as PerspectiveCamera
        return camera.isPerspectiveCamera ? camera.fov : 45
      },
      envBasePath: defaultEnvBasePath,
      respectReducedMotion: false,
    }
    lifecycle = provideCanvasContext(
      new Lifecycle(
        {
          settings: () => settings,
          active: () => true,
          reducedMotion: () => false,
          onError: () => undefined,
        },
        'host'
      )
    )
  }
  if (!(lifecycle instanceof Lifecycle))
    throw new Error('Invalid ShaderGradient Canvas lifecycle context.')
  lifecycle.bind(binding)
  return lifecycle
}
