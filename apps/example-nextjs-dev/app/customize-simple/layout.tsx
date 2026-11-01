import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Canvas Study · ShaderGradient',
  description: 'Explore field of view, pixel density and surface polish with an actual ShaderGradient scene.',
}

export default function CanvasStudyLayout({ children }: { children: ReactNode }) {
  return children
}
