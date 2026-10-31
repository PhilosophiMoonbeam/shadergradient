import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'

export function createHost({ library, canvasProps, onCameraUpdate, onError }) {
  const root = createRoot(document.getElementById('fixture'))
  return (props) => flushSync(() => root.render(
    h(library.ShaderGradientCanvas, canvasProps,
      h(library.ShaderGradient, { ...props, onCameraUpdate, onError }))
  ))
}
