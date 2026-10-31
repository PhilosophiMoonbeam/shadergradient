import { createApp, h, shallowRef, nextTick } from 'vue'

export function createHost({ library, canvasProps, onCameraUpdate, onError }) {
  let currentProps
  const generation = shallowRef(0)
  createApp({
    render: () => {
      void generation.value
      return currentProps ? h(library.ShaderGradientCanvas, canvasProps, {
        default: () => h(library.ShaderGradient, { ...currentProps, onCameraUpdate, onError }),
      }) : null
    },
  }).mount('#fixture')
  return async (props) => {
    currentProps = props
    generation.value++
    await nextTick()
  }
}
