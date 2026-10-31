<script module>
  const rendererIdentities = new WeakMap()
  let nextRendererIdentity = 0
</script>

<script>
  import { untrack } from 'svelte'
  import { fromStore } from 'svelte/store'
  import { useCamera, useStage, useTask, useThrelte } from '@threlte/core'
  import CameraControls from 'camera-controls'
  import * as THREE from 'three'

  let { onready } = $props()
  const threlte = useThrelte()
  const registry = useCamera()
  const activeCamera = fromStore(threlte.camera)
  const size = fromStore(threlte.size)
  const { scene, renderer } = threlte
  let rendererIdentity = rendererIdentities.get(renderer)
  if (rendererIdentity === undefined) {
    rendererIdentity = ++nextRendererIdentity
    rendererIdentities.set(renderer, rendererIdentity)
  }
  const previousCamera = threlte.camera.current
  const previousManual = registry.manual.current
  const previousEnvironment = scene.environment
  const previousBackground = scene.background
  const hostResources = new Set()
  const observations = new Map()
  const removeObservers = new Set()
  const ownedTextures = new Set()
  const waiters = new Set()
  let renderSerial = 0
  let publishedSerial = 0
  let completedFrames = 0
  let stopped = false
  let attempt = null

  function observe(
    resource,
    kind,
    owner = hostResources.has(resource) ? 'host' : 'native'
  ) {
    if (!resource || observations.has(resource)) return
    const event = { id: resource.uuid, kind, owner, disposals: 0 }
    observations.set(resource, event)
    const ondispose = () => {
      event.disposals += 1
    }
    resource.addEventListener('dispose', ondispose)
    removeObservers.add(() =>
      resource.removeEventListener('dispose', ondispose)
    )
    if (attempt && owner === 'native') attempt.resources.add(event.id)
  }

  function observeMaterial(material) {
    if (!material || observations.has(material)) return
    observe(material, 'material')
    // Only publicly attached material slots are observable here. No private
    // render targets, pass inventories, or constructor/prototype interception.
    for (const key of Object.keys(material)) {
      const value = material[key]
      if (value?.isTexture) observe(value, 'texture')
    }
  }

  function observeObject(object) {
    if (object.geometry?.isBufferGeometry) observe(object.geometry, 'geometry')
    if (Array.isArray(object.material)) {
      for (const material of object.material) observeMaterial(material)
    } else observeMaterial(object.material)
    if (object.isLight && typeof object.dispose === 'function')
      observe(object, 'light')
  }

  function scan() {
    scene.traverse(observeObject)
    if (scene.environment?.isTexture) observe(scene.environment, 'texture')
  }

  function makeEnvironment(red, green, blue) {
    const texture = new THREE.DataTexture(
      new Uint8Array([
        red,
        green,
        blue,
        255,
        200,
        180,
        120,
        255,
        65,
        90,
        140,
        255,
        160,
        195,
        220,
        255,
        160,
        195,
        220,
        255,
        65,
        90,
        140,
        255,
        200,
        180,
        120,
        255,
        red,
        green,
        blue,
        255,
      ]),
      4,
      2,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    )
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.needsUpdate = true
    ownedTextures.add(texture)
    hostResources.add(texture)
    observe(texture, 'texture', 'host')
    return texture
  }

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
  camera.position.set(0, 0.7, 7)
  camera.lookAt(0, 0, 0)
  const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5)
  const material = new THREE.MeshBasicMaterial({ color: '#f5d66f' })
  const hostMesh = new THREE.Mesh(geometry, material)
  hostMesh.name = 'consumer-owned-ownership-box'
  hostMesh.rotation.set(0.28, 0.5, 0)
  hostMesh.position.set(0, -0.35, 0.7)
  hostResources.add(geometry)
  hostResources.add(material)
  observe(geometry, 'geometry', 'host')
  observe(material, 'material', 'host')
  let currentEnvironment = makeEnvironment(110, 150, 205)
  scene.environment = currentEnvironment
  const background = new THREE.Color('#17243b')
  scene.background = background
  // Register a real consumer camera, not just a temporary camera-store write.
  // The public Threlte registry must retain it when managed ownership retires.
  registry.makeDefaultCameras.add(camera)
  registry.makeDefaultCameraManual.set(camera, true)
  registry.manual.set(true)
  threlte.camera.set(camera)
  scene.add(camera, hostMesh)

  const childAdded = (event) => {
    event.child.traverse(observeObject)
    untrack(updateAttempt)
  }
  const childRemoved = () => {
    untrack(updateAttempt)
  }
  scene.addEventListener('childadded', childAdded)
  scene.addEventListener('childremoved', childRemoved)
  scan()

  CameraControls.install({ THREE })
  const controls = new CameraControls(camera, renderer.domElement)
  controls.smoothTime = 0
  controls.draggingSmoothTime = 0
  controls.restThreshold = 0.001
  controls.mouseButtons.right = CameraControls.ACTION.NONE
  controls.mouseButtons.middle = CameraControls.ACTION.NONE
  const controlTask = useTask(
    (delta) => {
      if (stopped || threlte.camera.current !== camera || !controls.enabled) {
        controlTask.stop()
        return
      }
      if (controls.update(delta)) threlte.invalidate()
      else controlTask.stop()
    },
    { autoStart: false, autoInvalidate: false }
  )
  const wakeControls = () => {
    if (stopped || threlte.camera.current !== camera || !controls.enabled)
      return
    controlTask.start()
    threlte.invalidate()
  }
  controls.addEventListener('controlstart', wakeControls)
  controls.addEventListener('control', wakeControls)
  controls.addEventListener('wake', wakeControls)
  controls.update(0)

  $effect.pre(() => {
    const enabled = activeCamera.current === camera
    controls.enabled = enabled
    if (!enabled) {
      controls.cancel()
      controls.stop()
      controlTask.stop()
    }
  })
  $effect.pre(() => {
    const measured = size.current
    if (measured.width <= 0 || measured.height <= 0) return
    camera.aspect = measured.width / measured.height
    camera.updateProjectionMatrix()
    threlte.invalidate()
  })

  function counts() {
    let meshes = 0
    let lights = 0
    scene.traverse((object) => {
      if (object.isMesh && object !== hostMesh) meshes += 1
      if (object.isLight) lights += 1
    })
    return { meshes, lights }
  }

  function updateAttempt(current = threlte.camera.current) {
    if (!attempt) return
    const visible = counts()
    attempt.peakNativeMeshCount = Math.max(
      attempt.peakNativeMeshCount,
      visible.meshes
    )
    attempt.peakNativeLightCount = Math.max(
      attempt.peakNativeLightCount,
      visible.lights
    )
    if (current !== camera) attempt.managedCameraObserved = true
  }

  $effect.pre(() => {
    const current = activeCamera.current
    untrack(() => updateAttempt(current))
  })

  const originalRender = renderer.render
  function observedRender(renderScene, renderCamera) {
    scan()
    originalRender.call(this, renderScene, renderCamera)
    if (!this.getContext().isContextLost()) renderSerial += 1
  }
  renderer.render = observedRender
  const completedStage = useStage(Symbol('ownership-completed-output'), {
    after: threlte.renderStage,
  })
  const completedTask = completedStage.createTask(
    Symbol('ownership-completed-output'),
    () => {
      if (
        stopped ||
        publishedSerial === renderSerial ||
        renderer.getContext().isContextLost()
      )
        return
      if (
        renderer.getRenderTarget() !== null ||
        renderer.domElement.width < 1 ||
        renderer.domElement.height < 1
      )
        return
      publishedSerial = renderSerial
      completedFrames += 1
      for (const waiter of waiters) {
        if (completedFrames <= waiter.after) continue
        waiters.delete(waiter)
        clearTimeout(waiter.timeout)
        waiter.resolve()
      }
    }
  )

  function waitForRender() {
    if (stopped)
      return Promise.reject(
        new Error('The retained ownership Canvas has been destroyed.')
      )
    return new Promise((resolve, reject) => {
      const waiter = { after: completedFrames, resolve, reject, timeout: null }
      waiter.timeout = setTimeout(() => {
        waiters.delete(waiter)
        reject(
          new Error(
            `Ownership fixture received no completed host render within 8000ms (camera=${threlte.camera.current.uuid}, nativeMeshes=${counts().meshes}, contextLost=${renderer.getContext().isContextLost()}).`
          )
        )
      }, 8000)
      waiters.add(waiter)
      threlte.invalidate()
    })
  }

  const probe = {
    renderer,
    scene,
    hostCamera: camera,
    hostMesh,
    controls,
    camera: () => threlte.camera.current,
    invalidate: threlte.invalidate,
    classes: {
      Texture: THREE.Texture,
      BufferGeometry: THREE.BufferGeometry,
      Material: THREE.Material,
    },
    waitForRender,
    beginAttempt() {
      attempt = {
        resources: new Set(),
        peakNativeMeshCount: 0,
        peakNativeLightCount: 0,
        managedCameraObserved: false,
        startingFrame: completedFrames,
      }
    },
    attemptEvidence() {
      if (!attempt) return null
      untrack(updateAttempt)
      return {
        observedNativeResourceIds: [...attempt.resources],
        peakNativeMeshCount: attempt.peakNativeMeshCount,
        peakNativeLightCount: attempt.peakNativeLightCount,
        managedCameraObserved: attempt.managedCameraObserved,
        managedHelperAllocated:
          attempt.managedCameraObserved || attempt.peakNativeLightCount > 0,
        failedBeforeFirstRender: completedFrames === attempt.startingFrame,
        completedFrames: completedFrames - attempt.startingFrame,
        // Public scene observations do not expose native helper onMount hooks.
        nativeHelperOnMountRan: null,
      }
    },
    replaceEnvironment() {
      currentEnvironment = makeEnvironment(205, 95, 150)
      scene.environment = currentEnvironment
      threlte.invalidate()
    },
    snapshot() {
      scan()
      const visible = counts()
      return {
        host: {
          sceneUuid: scene.uuid,
          cameraUuid: threlte.camera.current.uuid,
          environmentUuid: scene.environment?.uuid ?? null,
          meshUuid: hostMesh.uuid,
          rendererIdentity,
          contextLost: renderer.getContext().isContextLost(),
        },
        nativeMeshCount: visible.meshes,
        nativeLightCount: visible.lights,
        resourceEvents: Array.from(observations.values(), (event) => ({
          ...event,
        })),
      }
    },
  }
  const release = untrack(() => onready(probe))

  $effect.pre(() => () => {
    stopped = true
    release?.()
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout)
      waiter.reject(
        new Error(
          'The retained ownership Canvas was destroyed before rendering.'
        )
      )
    }
    waiters.clear()
    completedStage.removeTask(completedTask)
    threlte.scheduler.removeStage(completedStage)
    if (renderer.render === observedRender) renderer.render = originalRender
    scene.removeEventListener('childadded', childAdded)
    scene.removeEventListener('childremoved', childRemoved)
    controls.removeEventListener('controlstart', wakeControls)
    controls.removeEventListener('control', wakeControls)
    controls.removeEventListener('wake', wakeControls)
    controls.dispose()
    hostMesh.removeFromParent()
    camera.removeFromParent()
    geometry.dispose()
    material.dispose()
    if (ownedTextures.has(scene.environment))
      scene.environment = previousEnvironment
    if (scene.background === background) scene.background = previousBackground
    if (threlte.camera.current === camera) {
      threlte.camera.set(previousCamera)
      registry.manual.set(previousManual)
    }
    registry.makeDefaultCameras.delete(camera)
    registry.makeDefaultCameraManual.delete(camera)
    for (const texture of ownedTextures) texture.dispose()
    ownedTextures.clear()
    // Retain listeners through sibling teardown, including repeated disposal.
    // Only the owning Threlte Canvas disposes the renderer itself.
    queueMicrotask(() => {
      for (const remove of removeObservers) remove()
      removeObservers.clear()
      observations.clear()
      hostResources.clear()
    })
  })
</script>
