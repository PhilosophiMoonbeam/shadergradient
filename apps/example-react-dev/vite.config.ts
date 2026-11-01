import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  },
  resolve: {
    dedupe: ['react', 'react-dom', '@react-three/fiber', 'three'],
  },
})
