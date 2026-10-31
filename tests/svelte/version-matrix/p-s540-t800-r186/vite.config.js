import { svelte } from '@sveltejs/vite-plugin-svelte';
export default { plugins: [svelte()], ssr: { noExternal: ['@threlte/core'] }, build: { outDir: 'dist' } };
