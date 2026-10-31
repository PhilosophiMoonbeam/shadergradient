import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  open,
  readdir,
  readFile,
  lstat,
  rm,
  writeFile,
} from 'node:fs/promises'

const source = dirname(fileURLToPath(import.meta.url))
const nativePackage = resolve(source, '../../../packages/shadergradient-svelte')
const workspace = resolve(nativePackage, '../..')
const root = join(nativePackage, '.sprint-lifecycle-support')
const registration = `${root}.owner.json`
const owner = randomUUID()
const byteLimit = 30 * 1024 * 1024
const host = '127.0.0.1'
const args = process.argv.slice(2)
let port = 3114
if (args.length) {
  const value =
    args.length === 2 && args[0] === '--port'
      ? args[1]
      : args.length === 1
      ? args[0].match(/^--port(?:=)?(\d+)$/)?.[1]
      : null
  if (
    !value ||
    !/^\d+$/.test(value) ||
    Number(value) < 1024 ||
    Number(value) > 65535
  )
    throw new Error(
      'Usage: node tests/svelte/lifecycle-support/server.mjs --port 3114'
    )
  port = Number(value)
}
const origin = `http://${host}:${port}`
const hotPath = join(root, 'hot-state.js')
const updates = []
let vite
let ownsRegistration = false
let ownsRoot = false
let originalHotState
let marker = 'baseline'
let color1 = '#ff5005'
let revision = 0
let mutating = false
let mutation = Promise.resolve()
let stopping = false
let cleanupPromise
let budgetTimer
let budgetTask = Promise.resolve()
let budgetRunning = false
const socketRestorers = new Set()

async function treeBytes(directory) {
  let bytes = 0
  // Vite's temporary cache children may disappear during a budget walk.
  // Losing the owned root is still an error, as are permission and I/O failures.
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === 'ENOENT' && directory !== root) return []
      throw error
    }
  )
  for (const entry of entries) {
    const path = join(directory, entry.name)
    let stat
    try {
      stat = await lstat(path)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (stat.isSymbolicLink())
      throw new Error(`Unexpected symlink in owned support tree: ${path}`)
    bytes += stat.isDirectory() ? await treeBytes(path) : stat.size
    if (bytes > byteLimit)
      throw new Error('Owned lifecycle support tree exceeded its 30 MiB limit')
  }
  return bytes
}
function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(value))
}
function trace(raw) {
  let payload
  try {
    payload = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
  } catch {
    return
  }
  if (payload.type === 'update') {
    for (const update of payload.updates ?? []) {
      updates.push({
        type: payload.type,
        path: update.acceptedPath ?? update.path ?? '',
        timestamp: update.timestamp ?? Date.now(),
      })
    }
  } else if (payload.type === 'full-reload' || payload.type === 'error') {
    updates.push({
      type: payload.type,
      path: payload.path ?? payload.err?.id ?? '',
      timestamp: Date.now(),
    })
  }
  if (updates.length > 100) updates.splice(0, updates.length - 100)
}
function observeSocket(socket) {
  // Observe bytes actually handed to a connected Vite WebSocket, not a guessed
  // watcher event or a fabricated update after the control endpoint writes.
  const original = socket.send
  function send(data, ...rest) {
    const result = original.call(this, data, ...rest)
    trace(data)
    return result
  }
  const restore = () => {
    if (socket.send === send) socket.send = original
    socketRestorers.delete(restore)
  }
  socket.send = send
  socket.once('close', restore)
  socketRestorers.add(restore)
}
async function emptyControlRequest(request, url) {
  if (url.search)
    throw new Error(
      'Control endpoints do not accept query parameters or file paths'
    )
  if (request.headers.origin && request.headers.origin !== origin)
    throw new Error('Control endpoint requires the loopback consumer origin')
  for await (const chunk of request) {
    if (chunk.length)
      throw new Error(
        'Control endpoints do not accept request bodies or file paths'
      )
  }
}
function html(client, title) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><div id="app"></div><script type="module" src="/${client}"></script></body></html>`
}
async function route(request, response, next) {
  try {
    const url = new URL(request.url, origin)
    const path = url.pathname
    if (path === '/hmr/status' && request.method === 'GET') {
      json(response, 200, { revision, marker, updates: updates.slice() })
      return
    }
    if (path === '/hmr/apply' || path === '/hmr/restore') {
      if (request.method !== 'POST') {
        json(response, 405, { error: 'POST required' })
        return
      }
      try {
        await emptyControlRequest(request, url)
      } catch (error) {
        json(response, 400, { error: error.message })
        return
      }
      if (stopping || mutating) {
        json(response, 409, {
          error: 'Owned control operation already active or server stopping',
        })
        return
      }
      mutating = true
      mutation = (async () => {
        const edited = path === '/hmr/apply'
        const nextMarker = edited ? 'edited' : 'baseline'
        const nextColor = edited ? '#1460ed' : '#ff5005'
        // Fixed path, fixed content: the source fixture is never changed.
        // Vite's own watcher and dependency graph perform the actual HMR.
        const content = edited
          ? "// Server-owned temporary dependency edit.\nexport const marker = 'edited'\nexport const color1 = '#1460ed'\n"
          : originalHotState
        await writeFile(hotPath, content, 'utf8')
        marker = nextMarker
        color1 = nextColor
        revision += 1
        await treeBytes(root)
        json(response, 200, { revision, marker, color1 })
      })()
      try {
        await mutation
      } finally {
        mutating = false
      }
      return
    }
    if (path === '/ssr' && request.method === 'GET') {
      const module = await vite.ssrLoadModule('/ssr-entry.js')
      if (typeof module.runSsrProbes !== 'function')
        throw new Error('SSR worker must export runSsrProbes')
      // The worker performs its real synchronous render/traps after loading;
      // this server neither fabricates evidence nor overlaps global traps.
      json(response, 200, module.runSsrProbes())
      return
    }
    if (
      request.method === 'GET' &&
      ['/ownership', '/ownership/', '/hmr', '/hmr/'].includes(path)
    ) {
      const hmr = path.startsWith('/hmr')
      const document = await vite.transformIndexHtml(
        path,
        html(
          hmr ? 'hmr-client.js' : 'ownership-client.js',
          hmr ? 'Native dependency HMR' : 'Native host ownership'
        )
      )
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      response.end(document)
      return
    }
    if (path === '/' && request.method === 'GET') {
      response.writeHead(302, { Location: '/ownership' })
      response.end()
      return
    }
    next()
  } catch (error) {
    if (!response.headersSent) json(response, 500, { error: error.message })
    else response.destroy(error)
    fail(error)
  }
}
async function start() {
  // Exclusive registration precedes directory/cache/server acquisition. Never
  // reclaim an existing (possibly live) owner or touch shared node_modules caches.
  const record = JSON.stringify({
    owner,
    pid: process.pid,
    root,
    source,
    origin,
    byteLimit,
    serverLimit: 1,
    websocketTraceLimit: 100,
    createdAt: new Date().toISOString(),
  })
  const lease = await open(registration, 'wx', 0o600)
  ownsRegistration = true
  try {
    await lease.writeFile(record)
  } finally {
    await lease.close()
  }
  await mkdir(root)
  ownsRoot = true
  await writeFile(join(root, '.owner.json'), record, 'utf8')
  const required = [
    'OwnershipApp.svelte',
    'OwnershipProbe.svelte',
    'ownership-client.js',
    'SsrProbe.svelte',
    'ssr-entry.js',
    'HmrApp.svelte',
    'HmrProbe.svelte',
    'hmr-client.js',
    'hot-state.js',
  ]
  const names = new Set(required)
  for (const entry of await readdir(source)) {
    if (/^(?:Ownership|Hmr|Ssr)[\w-]*\.svelte$/.test(entry)) names.add(entry)
  }
  let copiedBytes = Buffer.byteLength(record)
  for (const name of names) {
    const path = join(source, name)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Support fixture must be a regular file: ${name}`)
    copiedBytes += stat.size
    if (copiedBytes > byteLimit)
      throw new Error('Support fixture exceeds its 30 MiB limit')
    const content = await readFile(path)
    await writeFile(join(root, name), content, { flag: 'wx' })
    if (name === 'hot-state.js') originalHotState = content.toString('utf8')
  }
  const nativeRequire = createRequire(join(nativePackage, 'package.json'))
  for (const [name, major] of [
    ['vite', 8],
    ['@sveltejs/vite-plugin-svelte', 7],
  ]) {
    // Plugin 7 does not export a /package.json subpath. Locate metadata from
    // its publicly resolved entry instead of importing an unexported subpath.
    let directory = dirname(nativeRequire.resolve(name))
    let manifest
    while (true) {
      try {
        const candidate = JSON.parse(
          await readFile(join(directory, 'package.json'), 'utf8')
        )
        if (candidate.name === name) {
          manifest = candidate
          break
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      const parent = dirname(directory)
      if (parent === directory)
        throw new Error(`Cannot locate public tool metadata: ${name}`)
      directory = parent
    }
    if (Number(manifest.version.split('.')[0]) !== major)
      throw new Error(
        `Native support requires ${name} ${major}, resolved ${manifest.version}`
      )
  }
  const [{ createServer }, { svelte }] = await Promise.all([
    import(pathToFileURL(nativeRequire.resolve('vite')).href),
    import(
      pathToFileURL(nativeRequire.resolve('@sveltejs/vite-plugin-svelte')).href
    ),
  ])
  // Public Vite JavaScript API; native Svelte config supplies its preprocess.
  // https://vite.dev/guide/api-javascript#createServer
  vite = await createServer({
    configFile: false,
    root,
    cacheDir: join(root, '.vite'),
    appType: 'custom',
    mode: 'development',
    clearScreen: false,
    plugins: [
      svelte({ configFile: join(nativePackage, 'svelte.config.js') }),
      {
        name: 'owned-native-lifecycle-routes',
        configureServer(server) {
          server.middlewares.use(route)
        },
      },
    ],
    resolve: {
      dedupe: ['svelte', 'three', '@threlte/core', 'camera-controls'],
    },
    optimizeDeps: {
      entries: [join(root, 'ownership-client.js'), join(root, 'hmr-client.js')],
    },
    ssr: {
      noExternal: [
        '@shadergradient/svelte',
        '@shadergradient/core',
        '@threlte/core',
        'svelte',
      ],
    },
    server: {
      host,
      port,
      strictPort: true,
      open: false,
      cors: false,
      hmr: true,
      fs: { strict: true, allow: [workspace] },
    },
  })
  vite.ws.on('connection', observeSocket)
  await vite.listen()
  await treeBytes(root)
  budgetTimer = setInterval(() => {
    if (budgetRunning || stopping) return
    budgetRunning = true
    budgetTask = treeBytes(root)
      .catch(fail)
      .finally(() => {
        budgetRunning = false
      })
  }, 1000)
  budgetTimer.unref()
  console.log(
    `Native lifecycle support ready ${origin} (ownership /ownership; SSR /ssr; HMR /hmr/)`
  )
}
async function cleanup() {
  stopping = true
  clearInterval(budgetTimer)
  await budgetTask
  await mutation.catch(() => {})
  const errors = []
  // Restore even on failed qualification, then release the server before its
  // private cache/tree. No active/shared cache outside this owner is removed.
  if (ownsRoot && originalHotState !== undefined) {
    try {
      await writeFile(hotPath, originalHotState, 'utf8')
    } catch (error) {
      errors.push(error)
    }
  }
  if (vite) {
    try {
      await vite.close()
    } catch (error) {
      errors.push(error)
    }
    for (const restore of socketRestorers) restore()
  }
  if (ownsRoot) {
    try {
      await rm(root, { recursive: true, force: true })
    } catch (error) {
      errors.push(error)
    }
  }
  if (ownsRegistration) {
    try {
      const record = JSON.parse(await readFile(registration, 'utf8'))
      if (record.owner !== owner)
        throw new Error('Support ownership registration changed; preserving it')
      await rm(registration)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Lifecycle support cleanup failed')
}
function shutdown(code) {
  process.exitCode = Math.max(process.exitCode ?? 0, code)
  if (!cleanupPromise)
    cleanupPromise = startup
      .catch(() => {})
      .then(cleanup)
      .catch((error) => {
        console.error(error)
        process.exitCode = 1
      })
  return cleanupPromise
}
function fail(error) {
  console.error(error)
  void shutdown(1)
}
process.once('SIGINT', () => {
  void shutdown(0)
})
process.once('SIGTERM', () => {
  void shutdown(0)
})
process.once('uncaughtException', fail)
process.once('unhandledRejection', fail)
const startup = start()
startup.catch(fail)
