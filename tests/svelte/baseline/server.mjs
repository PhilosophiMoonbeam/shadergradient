import { createRequire } from 'node:module'
import { readFile, access } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const directory = dirname(fileURLToPath(import.meta.url))
export const repository = resolve(directory, '../../..')
function selectExport(target, conditions) {
  if (typeof target === 'string') return target
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const selected = selectExport(candidate, conditions)
      if (selected) return selected
    }
  } else if (target && typeof target === 'object') {
    for (const [condition, candidate] of Object.entries(target)) {
      if (!conditions.has(condition)) continue
      const selected = selectExport(candidate, conditions)
      if (selected) return selected
    }
  }
}
export async function packageInfo(name, from, environment = 'browser') {
  const require = createRequire(join(from, 'package.json'))
  let entry
  try { entry = require.resolve(`${name}/package.json`) }
  catch { entry = require.resolve(name) }
  let folder = dirname(entry)
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
      if (manifest.name === name) {
        const exports = manifest.exports
        const rootExport = exports && typeof exports === 'object' && !Array.isArray(exports)
          && Object.keys(exports).some((key) => key.startsWith('.')) ? exports['.'] : exports
        const target = exports === undefined ? manifest.module || manifest.main
          : selectExport(rootExport, new Set(['import', environment, 'module', 'development', 'default']))
        if (exports !== undefined && !target)
          throw new Error(`No public ${environment} import export for ${name} from ${from}`)
        const publicEntry = target ? resolve(folder, target) : require.resolve(name)
        await access(publicEntry)
        return { name, version: manifest.version, folder, manifest, entry: publicEntry }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = dirname(folder)
    if (parent === folder) throw new Error(`Cannot locate ${name} manifest from ${from}`)
    folder = parent
  }
}
export async function startFixture(adapter, options) {
  const from = resolve(repository, options[`${adapter}Root`] ||
    (adapter === 'react' ? 'apps/example-nextjs-dev' : 'apps/example-vue-dev'))
  const viteInfo = await packageInfo('vite', resolve(repository, 'apps/example-vue-dev'), 'node')
  const { createServer } = await import(pathToFileURL(viteInfo.entry).href)
  const dependencies = adapter === 'react'
    ? ['react', 'react-dom', 'three', '@react-three/fiber']
    : ['vue', 'three', '@tresjs/core']
  const packages = await Promise.all(dependencies.map((name) => packageInfo(name, from)))
  const alias = []
  for (const item of packages) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    alias.push({ find: new RegExp(`^${escaped}$`), replacement: item.entry })
    if (item.name === 'three') {
      // `addons` is an export-map alias, not a physical directory.
      alias.push({ find: /^three\/addons\//, replacement: `${item.folder}/examples/jsm/` })
      for (const name of ['addons', 'webgpu', 'tsl']) {
        const target = item.manifest.exports?.[`./${name}`]
        if (typeof target === 'string')
          alias.push({ find: new RegExp(`^three/${name}$`), replacement: resolve(item.folder, target) })
      }
    }
    alias.push({ find: new RegExp(`^${escaped}/`), replacement: `${item.folder}/` })
  }
  const adapterFolder = resolve(repository, adapter === 'react'
    ? 'packages/shadergradient' : 'packages/shadergradient-vue')
  const manifest = JSON.parse(await readFile(join(adapterFolder, 'package.json'), 'utf8'))
  const adapterEntry = resolve(adapterFolder, manifest.exports['.'].import)
  await access(adapterEntry) // A missing build is a failure, never a source fallback.
  alias.push({ find: '@baseline/adapter', replacement: adapterEntry })
  alias.push({ find: '@baseline/host', replacement: join(directory, 'fixture', `${adapter}.mjs`) })
  const server = await createServer({
    configFile: false, root: join(directory, 'fixture'),
    cacheDir: join(options.out, 'vite-cache', adapter),
    resolve: { alias, dedupe: dependencies },
    optimizeDeps: { include: adapter === 'react' ? ['react', 'react-dom/client', '@react-three/fiber'] : ['vue', '@tresjs/core'] },
    server: { host: '127.0.0.1', port: adapter === 'react' ? 3194 : 3195,
      strictPort: true, fs: { allow: [repository] } },
  })
  await server.listen()
  return { server, url: server.resolvedUrls.local[0],
    packages: [...packages, viteInfo].map(({ name, version, folder, entry }) => ({ name, version, folder, entry })),
    adapterEntry, adapterVersion: manifest.version, dependencyRoot: from }
}
