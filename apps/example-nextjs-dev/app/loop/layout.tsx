import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Time Study · ShaderGradient',
  description: 'Explore actual shader animation, loop periods and range behavior without a synthetic progress clock.',
}

export default function TimeStudyLayout({ children }: { children: ReactNode }) {
  return children
}
