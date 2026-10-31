import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  loadPreparedNativeConsumers,
  prepareNativeConsumers,
} from '../svelte/package-consumers.mjs'

// F28 prepares once, then passes this exact manifest to its webServer/projects.
// Importing this facade does not pack, install, launch a server, or launch a browser.
export async function prepareSvelteBrowserConsumers(options = {}) {
  return await prepareNativeConsumers(options)
}

const cells = [
  ['plain-current', 'plain', '5.57.3', 3112],
  ['kit-current', 'kit', '5.57.3', 3113],
  ['plain-lower', 'plain', '5.40.0', 3115],
  ['kit-lower', 'kit', '5.57.1', 3116],
]
const mainViews = ['square', 'wide', 'tall']
const allViews = [...mainViews, 'independent']
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const errorText = (error) => error?.stack ?? String(error)
const inside = (root, path) => {
  const child = relative(root, path)
  return (
    child === '' ||
    (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
  )
}

// This is a real Node preload, not an SSR approximation. Both compiled plain SSR
// and the production Kit process run with fetch denied before any app imports.
const ssrGuard = `import { writeFileSync } from 'node:fs';
const path = process.env.SHADERGRADIENT_SSR_GUARD;
if (!path) throw new Error('Missing owned SSR guard evidence path');
const evidence = { armed: true, pid: process.pid, node: process.version, attempts: 0, firstURL: null };
const save = () => writeFileSync(path, JSON.stringify(evidence));
save();
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value(input) {
  evidence.attempts++;
  evidence.firstURL ??= String(input?.url ?? input).slice(0, 2048);
  save();
  throw new Error('Packed native SSR attempted an asset/network fetch: ' + evidence.firstURL);
} });
`

class OwnedResources {
  entries = []
  closing = false
  register(name, stop) {
    const entry = { name, status: 'registered', promise: null }
    const release = () => {
      // Defer stop until the acquisition's promise has been assigned, including
      // when an abort is delivered synchronously by the acquisition itself.
      entry.promise ??= Promise.resolve()
        .then(stop)
        .then(
          () => {
            entry.status = 'released'
          },
          (error) => {
            entry.status = 'failed'
            entry.error = errorText(error)
            throw error
          }
        )
      return entry.promise
    }
    entry.release = release
    this.entries.push(entry)
    // A pending operation may register its owned result while cleanup awaits
    // another resource. Release it too, rather than throwing away its handle.
    if (this.closing) void release().catch(() => {})
    return release
  }
  async close() {
    this.closing = true
    const errors = []
    const visited = new Set()
    for (;;) {
      const entry = this.entries.findLast((item) => !visited.has(item))
      if (!entry) return errors
      visited.add(entry)
      try {
        await entry.release()
      } catch (error) {
        errors.push(error)
      }
    }
  }
  snapshot() {
    return this.entries.map(({ name, status, error }) => ({
      name,
      status,
      ...(error ? { error } : {}),
    }))
  }
}

async function assertFreePort(run, port) {
  run.signal.throwIfAborted()
  const server = createServer()
  let listening
  const close = run.resources.register(`port-probe:${port}`, async () => {
    await listening?.catch(() => {})
    if (server.listening)
      await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept()))
      )
  })
  try {
    run.signal.throwIfAborted()
    listening = new Promise((accept, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port, exclusive: true }, accept)
    })
    await listening
    run.signal.throwIfAborted()
  } catch (error) {
    run.fail(error)
    throw error
  } finally {
    await close()
  }
}

async function within(action, timeout, description, signal) {
  signal?.throwIfAborted()
  let timer
  let onAbort
  const cancelled = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${description}: exceeded ${timeout}ms`)),
      timeout
    )
    if (signal) {
      onAbort = () => reject(signal.reason)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => {
        signal?.throwIfAborted()
        return action()
      }),
      cancelled,
    ])
    signal?.throwIfAborted()
    return value
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

async function releaseOwned(releases, primary, description) {
  const errors = []
  for (const release of releases) {
    try {
      await release()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) {
    throw new AggregateError(
      [...(primary ? [primary] : []), ...errors],
      `${description}${
        primary ? `; original failure: ${errorText(primary)}` : ''
      }`,
      primary ? { cause: primary } : undefined
    )
  }
}

async function poll(
  run,
  description,
  observe,
  predicate,
  timeout = run.timeout
) {
  const deadline = Date.now() + timeout
  let value
  while (Date.now() < deadline) {
    run.signal.throwIfAborted()
    value = await within(
      observe,
      Math.max(1, deadline - Date.now()),
      description,
      run.signal
    )
    if (predicate(value)) return value
    await delay(60, undefined, { signal: run.signal })
  }
  throw new Error(
    `${description}: timed out; last actual observation: ${JSON.stringify(
      value
    )}`
  )
}

function startProcess(run, name, launch, env = {}) {
  run.signal.throwIfAborted()
  let child
  let exited = false
  let closed = false
  let failure
  let exit
  let output = ''
  let omittedBytes = 0
  let finish
  const completion = new Promise((accept) => {
    finish = accept
  })
  const logPath = resolve(run.root, `${name}.log`)
  const args = [...launch.args]
  // spawn(detached:true) already gives this exact owned child its own session.
  // A second setsid inside bwrap escapes that group and leaves Node/stdio alive.
  let removedNewSession = false
  if (
    process.platform !== 'win32' &&
    launch.command.split('/').at(-1) === 'bwrap'
  ) {
    const option = args.indexOf('--new-session')
    const command = args.indexOf('--')
    if (option >= 0 && (command < 0 || option < command)) {
      args.splice(option, 1)
      removedNewSession = true
    }
  }
  const termination = { signals: [], pipesDetached: false }
  const send = (signal) => {
    if (!child?.pid) return
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, signal)
      else child.kill(signal)
      termination.signals.push({
        signal,
        target: process.platform !== 'win32' ? -child.pid : child.pid,
      })
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
      // The direct child is still owned even if setup failed before its group
      // existed. Never search for or signal an unrelated PID/name/port.
      if (!exited && child.exitCode === null && child.signalCode === null) {
        child.kill(signal)
        termination.signals.push({ signal, target: child.pid })
      }
    }
  }
  const stop = run.resources.register(`process:${name}`, async () => {
    try {
      if (child?.pid) {
        // Signal the owned group even after its leader's exit: descendants may
        // still hold pipes. 'exit' and 'close' are intentionally separate.
        send('SIGTERM')
        let graceful = closed
        if (!graceful) {
          try {
            await within(
              () => completion,
              4000,
              `${name}: graceful exit and stdio drain`
            )
            graceful = true
          } catch (error) {
            termination.gracefulError = errorText(error)
          }
        }
        if (!graceful) {
          send('SIGKILL')
          await within(
            () => completion,
            4000,
            `${name}: forced exit and stdio drain`
          )
        }
        if (!exited && !failure)
          throw new Error(
            `${name}: stdio closed without an observed process exit`
          )
      }
    } finally {
      // A cleanup defect must never retain the controller event loop or erase
      // the log/real PID evidence needed to clean up that exact owned process.
      child?.stdout?.destroy()
      child?.stderr?.destroy()
      child?.unref()
      termination.pipesDetached = true
      await run.save(`${name}.log`, output)
    }
  })
  const environment = { ...process.env, ...launch.env, ...env }
  delete environment.NODE_PATH
  environment.NODE_OPTIONS = env.NODE_OPTIONS ?? ''
  try {
    run.signal.throwIfAborted()
    child = spawn(launch.command, args, {
      cwd: launch.cwd,
      env: environment,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const append = (chunk) => {
      const available = Math.max(0, 1024 * 1024 - Buffer.byteLength(output))
      const bytes = Buffer.from(chunk)
      output += bytes.subarray(0, available).toString()
      omittedBytes += Math.max(0, bytes.length - available)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => {
      failure = error
      exited = true
      closed = true
      finish()
    })
    child.once('exit', (code, signal) => {
      exit = { code, signal }
      exited = true
    })
    child.once('close', (code, signal) => {
      exit ??= { code, signal }
      closed = true
      finish()
    })
  } catch (error) {
    failure = error
    exited = true
    closed = true
    finish()
  }
  return {
    stop,
    completion,
    get output() {
      return output
    },
    assertRunning() {
      if (failure) throw failure
      if (exited || closed)
        throw new Error(
          `${name}: production process exited ${JSON.stringify(
            exit
          )}\n${output}`
        )
    },
    assertSuccess() {
      if (failure) throw failure
      assert.equal(
        exit?.code,
        0,
        `${name}: command failed ${JSON.stringify(exit)}\n${output}`
      )
      assert.equal(
        omittedBytes,
        0,
        `${name}: command output exceeded evidence budget`
      )
    },
    evidence() {
      return {
        command: launch.command,
        declaredArgs: launch.args,
        args,
        removedNewSession,
        cwd: launch.cwd,
        pid: child?.pid ?? null,
        processGroup:
          process.platform !== 'win32' ? (child?.pid ?? null) : null,
        exited,
        closed,
        exit: exit ?? null,
        termination,
        logPath,
        omittedBytes,
      }
    },
  }
}

async function readGuard(path) {
  const evidence = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(
    evidence.armed,
    true,
    'The actual server process must arm the SSR fetch guard'
  )
  assert.equal(
    evidence.attempts,
    0,
    `Actual SSR attempted asset fetch: ${JSON.stringify(evidence)}`
  )
  return evidence
}

async function requestDocument(run, url) {
  const response = await fetch(url, {
    signal: AbortSignal.any([run.signal, AbortSignal.timeout(run.timeout)]),
  })
  assert.equal(response.status, 200, `${url}: production HTTP response`)
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i)
  const html = await response.text()
  assert.ok(
    Buffer.byteLength(html) <= 2 * 1024 * 1024,
    'Production document exceeds owned evidence budget'
  )
  return html
}

async function inspectNativeSSRCanvases(run, browser, consumer, html) {
  run.signal.throwIfAborted()
  let creating
  let creatingPage
  let primary
  const close = run.resources.register(
    `context:${consumer.id}:ssr-dom`,
    async () => {
      await within(
        async () => {
          const context = await creating?.catch(() => null)
          await context?.close()
          const page = await creatingPage?.catch(() => null)
          await page?.close()
        },
        5000,
        `${consumer.id}: close SSR DOM parser context`
      )
    }
  )
  try {
    run.signal.throwIfAborted()
    creating = browser.newContext({
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: 'block',
    })
    const context = await within(
      () => creating,
      run.timeout,
      'create SSR DOM parser context',
      run.signal
    )
    run.signal.throwIfAborted()
    creatingPage = context.newPage()
    const page = await within(
      () => creatingPage,
      run.timeout,
      'create SSR DOM parser page',
      run.signal
    )
    page.setDefaultTimeout(run.timeout)
    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: run.timeout,
    })
    const observation = await within(
      () =>
        page.evaluate(() => {
          const all = [...document.querySelectorAll('canvas')]
          const external = all.filter((canvas) =>
            canvas.closest('[data-testid="external-host"]')
          )
          return {
            totalCanvasCount: all.length,
            nativeCanvasCount: all.length - external.length,
            consumerOwnedThrelteHostCanvasCount: external.length,
            externalHostHTML:
              document.querySelector('[data-testid="external-host"]')
                ?.outerHTML ?? null,
            oracle:
              'actual compiled SSR HTML parsed with JavaScript disabled; only the explicit consumer-owned external Threlte host is a non-native canvas surface',
          }
        }),
      run.timeout,
      'inspect actual SSR canvas DOM',
      run.signal
    )
    assert.equal(
      observation.nativeCanvasCount,
      0,
      'Native Canvas/Source/View must not SSR a canvas'
    )
    assert.equal(
      observation.consumerOwnedThrelteHostCanvasCount,
      consumer.kind === 'plain' ? 1 : 0,
      'Preserve the actual consumer-owned Threlte SSR host markup, not a fabricated native canvas'
    )
    return observation
  } catch (error) {
    primary = error
    run.fail(error)
    throw error
  } finally {
    await releaseOwned([close], primary, 'SSR DOM parser cleanup failed')
  }
}

async function verifySSR(run, consumer, serverGuardPath, browser) {
  run.signal.throwIfAborted()
  if (consumer.kind === 'plain') {
    const entry = consumer.artifacts.ssr?.entry
    assert.ok(
      isAbsolute(entry ?? ''),
      `${consumer.id}: missing actual compiled Svelte SSR entry`
    )
    assert.ok(
      inside(consumer.root, await realpath(entry)),
      'Compiled SSR entry must belong to the isolated consumer'
    )
    run.signal.throwIfAborted()
    const isolation = consumer.evidence.isolation
    assert.ok(
      Array.isArray(isolation.prefix) && isAbsolute(isolation.node),
      'Missing actual checkout-hidden SSR launcher prefix'
    )
    const runnerName = `${consumer.id}-render.mjs`
    const runner = resolve(run.root, runnerName)
    let runnerWrite
    const stopRunner = run.resources.register(
      `temporary:${runnerName}`,
      async () => {
        await runnerWrite?.catch(() => {})
        await rm(runner, { force: true })
      }
    )
    runnerWrite = run.save(
      runnerName,
      `import { writeFileSync } from 'node:fs';
const names = ['window','document','HTMLElement','HTMLCanvasElement','WebGLRenderingContext','WebGL2RenderingContext','ResizeObserver','IntersectionObserver','requestAnimationFrame'];
if (names.some(name => name in globalThis)) throw new Error('Compiled SSR is not running without browser globals');
const { render, App } = await import(${JSON.stringify(
        pathToFileURL(entry).href
      )});
if (typeof render !== 'function' || !App) throw new Error('Compiled SSR entry must publicly export render and App');
const first = render(App); const html = first.body; const head = first.head;
const second = render(App); const repeated = second.body;
if (html !== repeated) throw new Error('Separate compiled Svelte SSR renders leaked instance state');
writeFileSync(${JSON.stringify(
        resolve(run.root, `${consumer.id}-compiled-ssr.json`)
      )}, JSON.stringify({ html, head, browserGlobalsAbsent: true, node: process.version, renders: 2 }));
`
    )
    await runnerWrite
    run.signal.throwIfAborted()
    const guardPath = resolve(
      run.root,
      `${consumer.id}-compiled-ssr-guard.json`
    )
    const child = startProcess(
      run,
      `${consumer.id}-compiled-ssr`,
      {
        ...consumer.launch,
        args: [
          ...isolation.prefix,
          '--chdir',
          consumer.root,
          '--',
          isolation.node,
          runner,
        ],
      },
      run.guardEnvironment(guardPath)
    )
    let primary
    try {
      await poll(
        run,
        'compiled Svelte SSR process completion',
        async () =>
          await Promise.race([
            child.completion.then(() => true),
            delay(30).then(() => false),
          ]),
        Boolean
      )
      child.assertSuccess()
      const rendered = JSON.parse(
        await readFile(
          resolve(run.root, `${consumer.id}-compiled-ssr.json`),
          'utf8'
        )
      )
      assert.match(rendered.html, /Native gradient playground/)
      assert.match(rendered.html, /data-gradient-fallback="deferred"/)
      assert.match(rendered.html, /data-testid="mirror-view-square"/)
      const canvasDOM = await inspectNativeSSRCanvases(
        run,
        browser,
        consumer,
        rendered.html
      )
      return {
        kind: 'installed-native-vite-compiled-svelte-server-render',
        entry,
        htmlSha256: digest(rendered.html),
        htmlBytes: Buffer.byteLength(rendered.html),
        ...canvasDOM,
        renders: rendered.renders,
        browserGlobalsAbsent: rendered.browserGlobalsAbsent,
        fetch: await readGuard(guardPath),
        process: child.evidence(),
      }
    } catch (error) {
      primary = error
      run.fail(error)
      throw error
    } finally {
      await releaseOwned(
        [child.stop, stopRunner],
        primary,
        'Compiled SSR process/runner cleanup failed'
      )
    }
  }
  const cases = [
    { request: `packed-alpha-${randomUUID()}`, color: '#1122ee' },
    { request: `packed-beta-${randomUUID()}`, color: '#ee2211' },
  ]
  const documents = await Promise.all(
    [...cases, cases[0]].map(async ({ request, color }) => {
      const url = new URL('/', consumer.baseURL)
      url.searchParams.set('request', request)
      url.searchParams.set('color1', color)
      const html = await requestDocument(run, url)
      assert.match(html, /data-testid="ssr-content"/)
      assert.match(
        html,
        /This article, navigation and controls are server rendered/
      )
      assert.ok(
        html.includes(`data-request="${request}"`),
        'SSR must render this actual request label'
      )
      assert.ok(
        html.includes(`data-color1="${color}"`),
        'SSR must render this actual request color'
      )
      assert.match(html, /data-native-fallback="deferred"/)
      assert.match(html, /data-testid="mirror-view-square"/)
      assert.doesNotMatch(html, /<canvas(?:\s|>)/i)
      return { request, color, html, url: url.href }
    })
  )
  assert.equal(
    documents[0].html,
    documents[2].html,
    'Repeated request must not retain another request settings'
  )
  assert.ok(
    !documents[0].html.includes(cases[1].request),
    'Concurrent SSR requests must not share labels'
  )
  assert.ok(
    !documents[1].html.includes(cases[0].request),
    'Concurrent SSR requests must not share labels'
  )
  const evidence = []
  for (const [index, item] of documents.entries()) {
    const path = await run.save(`${consumer.id}-ssr-${index}.html`, item.html)
    evidence.push({
      url: item.url,
      request: item.request,
      color: item.color,
      path,
      sha256: digest(item.html),
      bytes: Buffer.byteLength(item.html),
      canvasCount: 0,
    })
  }
  const away = await requestDocument(run, new URL('/away', consumer.baseURL))
  assert.match(away, /Away from the gradient/)
  assert.doesNotMatch(away, /<canvas(?:\s|>)/i)
  return {
    kind: 'compiled-kit-adapter-production-http',
    concurrentRequests: evidence,
    fallback: 'useful server-rendered content and deferred native fallback',
    fetch: await readGuard(serverGuardPath),
    away: { sha256: digest(away), canvasCount: 0 },
  }
}

// Observe real rendering without replacing GL, forcing preservation, or retaining
// completed canvases. The bounded held contexts exist solely to test actual loss.
async function installBrowserProbe(page) {
  await page.addInitScript(() => {
    const records = []
    const byContext = new WeakMap()
    const probe = { documentId: crypto.randomUUID(), records, overflow: false }
    window.__packedNativeProbe = probe
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const context = Reflect.apply(original, this, args)
      if (
        (args[0] === 'webgl2' || args[0] === 'webgl') &&
        context &&
        !byContext.has(context)
      ) {
        if (records.length >= 32) probe.overflow = true
        else {
          const record = {
            gl: context,
            canvas: this,
            draws: 0,
            linked: null,
            time: null,
          }
          byContext.set(context, record)
          records.push(record)
        }
      }
      return context
    }
    for (const prototype of [
      globalThis.WebGLRenderingContext?.prototype,
      globalThis.WebGL2RenderingContext?.prototype,
    ]) {
      if (!prototype) continue
      for (const method of [
        'drawArrays',
        'drawElements',
        'drawArraysInstanced',
        'drawElementsInstanced',
      ]) {
        const draw = prototype[method]
        if (typeof draw !== 'function') continue
        prototype[method] = function (...args) {
          const result = Reflect.apply(draw, this, args)
          const record = byContext.get(this)
          if (record && !this.isContextLost()) {
            record.draws++
            const program = this.getParameter(this.CURRENT_PROGRAM)
            if (program) {
              record.linked = !!this.getProgramParameter(
                program,
                this.LINK_STATUS
              )
              const location = this.getUniformLocation(program, 'uTime')
              if (location) record.time = this.getUniform(program, location)
            }
          }
          return result
        }
      }
    }
  })
}

async function fixture(page, method, ...args) {
  return await page.evaluate(
    async ({ method, args }) => {
      let owner = window.gradientFixture
      const parts = method.split('.')
      for (const name of parts.slice(0, -1)) owner = owner[name]
      return await owner[parts.at(-1)](...args)
    },
    { method, args }
  )
}
const snapshot = (page) => fixture(page, 'snapshot')
const mirrorSnapshot = (page) => fixture(page, 'mirrors.snapshot')
const mirrorCall = (page, method, ...args) =>
  fixture(page, `mirrors.${method}`, ...args)

async function settledMirrors(run, page) {
  let previous
  let since = Date.now()
  return await poll(
    run,
    'paused sources settle without a continuing copy/frame ticker',
    () => mirrorSnapshot(page),
    (state) => {
      const current = JSON.stringify({
        sources: Object.values(state.sources).map((s) => ({
          frames: s.frames,
          status: s.state.status,
          generation: s.state.generation,
          visibleViews: s.demand.visibleViews,
          pendingFrames: s.demand.pendingFrames,
        })),
        views: Object.values(state.views).map((v) => ({
          copies: v.copies,
          clears: v.clears,
          width: v.buffer?.width ?? null,
          height: v.buffer?.height ?? null,
        })),
      })
      if (current !== previous) {
        previous = current
        since = Date.now()
      }
      return (
        Date.now() - since >= 400 &&
        state.instrumentation.pendingRequests === 0 &&
        Object.values(state.sources).every(
          (source) =>
            source.state.status !== 'ready' || source.demand.pendingFrames === 0
        )
      )
    }
  )
}

function checkCopies(state, ids = mainViews, source = 'A') {
  try {
    const producer = state.sources[source]
    assert.equal(producer.state.status, 'ready')
    assert.equal(
      producer.lastFrame?.preserveDrawingBuffer,
      false,
      'Source must copy synchronous final frames without preserveDrawingBuffer opt-in'
    )
    for (const id of ids) {
      const view = state.views[id]
      assert.ok(
        view.attached && view.copies > 0 && view.pixels?.nonzeroAlpha > 100,
        `${id}: actual nonblank 2D copy`
      )
      assert.equal(
        view.lastCopy?.source,
        source,
        `${id}: actual drawImage source provenance`
      )
      assert.equal(
        view.lastCopy?.generation,
        producer.state.generation,
        `${id}: actual generation provenance`
      )
      assert.equal(
        view.lastCopy?.width,
        view.buffer?.width,
        `${id}: copied buffer width is current`
      )
      assert.equal(
        view.lastCopy?.height,
        view.buffer?.height,
        `${id}: copied buffer height is current`
      )
      assert.equal(
        view.oracle?.width,
        view.buffer?.width,
        `${id}: oracle buffer width is current`
      )
      assert.equal(
        view.oracle?.height,
        view.buffer?.height,
        `${id}: oracle buffer height is current`
      )
      assert.equal(
        view.oracle?.differingBytes,
        0,
        `${id}: same-final-frame grain/cover oracle`
      )
      assert.equal(view.oracle?.maxChannelError, 0)
      assert.equal(view.error, null)
    }
  } catch (error) {
    // Preserve the exact assertion input, not only a later observation after
    // another asynchronous resize/frame might already have completed.
    error.mirrorFailure = {
      source,
      ids,
      observation: state,
      nonblankTerms: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            attached: state.views[id].attached,
            copies: state.views[id].copies,
            nonzeroAlpha: state.views[id].pixels?.nonzeroAlpha ?? null,
            attachedPass: state.views[id].attached === true,
            copiesPass: state.views[id].copies > 0,
            alphaPass: state.views[id].pixels?.nonzeroAlpha > 100,
          },
        ])
      ),
    }
    throw error
  }
}

async function pixels(run, page, locator, name) {
  await locator.scrollIntoViewIfNeeded()
  const bytes = await locator.screenshot({ timeout: run.timeout })
  const image = run.PNG.sync.read(bytes)
  const startX = Math.max(1, Math.floor(image.width * 0.05))
  const startY = Math.max(1, Math.floor(image.height * 0.05))
  const anchor = (startY * image.width + startX) * 4
  let count = 0,
    colored = 0,
    contrast = 0
  for (let y = startY; y < image.height - startY; y++) {
    for (let x = startX; x < image.width - startX; x++) {
      const i = (y * image.width + x) * 4
      count++
      if (
        image.data[i + 3] > 0 &&
        Math.max(...image.data.subarray(i, i + 3)) > 0
      )
        colored++
      if (
        [0, 1, 2].some(
          (c) => Math.abs(image.data[i + c] - image.data[anchor + c]) >= 2
        )
      )
        contrast++
    }
  }
  assert.ok(
    count > 100 && colored / count > 0.01 && contrast / count > 0.01,
    `${name}: real raster interior must contain spatially nonuniform gradient pixels`
  )
  const path = await run.save(`${name}.png`, bytes)
  return {
    path,
    sha256: digest(bytes),
    width: image.width,
    height: image.height,
    interiorPixels: count,
    coloredFraction: colored / count,
    contrastFraction: contrast / count,
    image,
  }
}
function imageEvidence({ image, ...evidence }) {
  return evidence
}
function changedPixels(left, right) {
  assert.equal(left.width, right.width)
  assert.equal(left.height, right.height)
  let changed = 0
  for (let i = 0; i < left.data.length; i += 4) {
    if (
      [0, 1, 2].some((c) => Math.abs(left.data[i + c] - right.data[i + c]) > 8)
    )
      changed++
  }
  return changed / (left.width * left.height)
}

async function verifyManaged(run, page, consumer, core) {
  const main = page.locator(
    consumer.kind === 'plain'
      ? '[data-testid="gradient-wrapper"]'
      : '[data-testid="managed-placement"]'
  )
  await main.scrollIntoViewIfNeeded()
  await fixture(page, 'configureCanvas', {
    lazyLoad: false,
    pixelDensity: 1,
    envBasePath: '/native-feature-hdr',
    respectReducedMotion: false,
  })
  const frozen = {
    ...core.presets.halo.props,
    control: 'props',
    urlString: '',
    lightType: '3d',
    animate: 'off',
    grain: 'off',
    loop: 'off',
    range: 'disabled',
    uTime: 2,
    enableTransition: false,
    zoomOut: false,
  }
  await fixture(page, 'update', frozen)
  const initial = await poll(
    run,
    'managed native scene completes actual rendering',
    () => snapshot(page),
    (s) =>
      !!s.canvas &&
      !s.canvas.contextLost &&
      !!s.scene?.meshes.length &&
      s.counters.completedFrames > 0
  )
  const canvas = main.locator('canvas')
  assert.equal(await canvas.count(), 1)
  const first = await pixels(run, page, canvas, `${consumer.id}-managed-halo`)
  const presets = []
  for (const name of ['sunset', 'halo']) {
    await page
      .getByRole('combobox', { name: 'Preset', exact: true })
      .selectOption(name)
    await fixture(page, 'update', {
      control: 'props',
      lightType: '3d',
      animate: 'off',
      grain: 'off',
      enableTransition: false,
      uTime: 2,
    })
    const actual = await poll(
      run,
      `real ${name} preset controls update the native mesh`,
      () => snapshot(page),
      (s) =>
        s.scene?.meshes[0]?.shader === core.presets[name].props.shader &&
        s.scene.meshes[0].type === core.presets[name].props.type
    )
    const raster = await pixels(
      run,
      page,
      canvas,
      `${consumer.id}-preset-${name}`
    )
    const changedFraction = changedPixels(first.image, raster.image)
    if (name === 'sunset')
      assert.ok(
        changedFraction > 0.005,
        'Actual preset selection must change visible native pixels'
      )
    presets.push({
      name,
      mesh: actual.scene.meshes[0],
      pixels: imageEvidence(raster),
      changedFractionFromHalo: changedFraction,
    })
  }
  // Exercise the actual pause control, not an observation that happens to stand still.
  await fixture(page, 'update', { ...frozen, animate: 'on', uSpeed: 1 })
  await poll(
    run,
    'animation really advances time',
    () => snapshot(page),
    (s) => s.scene?.meshes[0]?.time > 2.1
  )
  if (consumer.kind === 'plain')
    await page
      .getByRole('combobox', { name: 'Animation', exact: true })
      .selectOption('off')
  else
    await page.getByRole('checkbox', { name: 'Animate', exact: true }).uncheck()
  await fixture(page, 'update', { uTime: -2 })
  const paused = await poll(
    run,
    'pause and negative seek reach the real mesh',
    () => snapshot(page),
    (s) => Math.abs((s.scene?.meshes[0]?.time ?? Infinity) + 2) < 1e-6
  )
  await delay(350, undefined, { signal: run.signal })
  const pausedLater = await snapshot(page)
  assert.equal(
    pausedLater.scene.meshes[0].time,
    paused.scene.meshes[0].time,
    'Paused native animation cannot continue advancing'
  )
  await fixture(page, 'update', {
    cAzimuthAngle: 47.2,
    cPolarAngle: 63.7,
    cDistance: 5.12345,
    cameraZoom: 1.23456,
    enableTransition: false,
    type: 'plane',
  })
  const camera = await poll(
    run,
    'typed camera callback reports actual rounded camera controls',
    () => snapshot(page),
    (s) =>
      s.cameraUpdates.some(
        (u) =>
          u.cAzimuthAngle === 47 && u.cPolarAngle === 64 && u.cDistance === 5.12
      )
  )
  const position = camera.scene.camera.position
  assert.ok(
    Math.abs(Math.hypot(...position) - 5.12345) < 0.001,
    'Camera callback must correspond to actual scene camera'
  )
  await fixture(page, 'configureCanvas', { pointerEvents: 'auto' })
  const beforeDrag = await snapshot(page)
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.57, {
    steps: 12,
  })
  await page.mouse.up()
  const controls = await poll(
    run,
    'real trusted mouse drag changes controlled camera and callback',
    () => snapshot(page),
    (s) =>
      s.cameraUpdates.length > beforeDrag.cameraUpdates.length &&
      s.scene.camera.position.some(
        (v, i) => Math.abs(v - beforeDrag.scene.camera.position[i]) > 0.01
      )
  )
  await fixture(page, 'update', frozen)
  await fixture(page, 'configureCanvas', { pixelDensity: 1 })
  const ambient = await pixels(run, page, canvas, `${consumer.id}-ambient`)
  const environments = []
  for (const envPreset of ['city', 'dawn', 'lobby']) {
    const previous = (await snapshot(page)).scene.environmentUuid
    await fixture(page, 'update', { lightType: 'env', envPreset })
    const loaded = await poll(
      run,
      `real self-hosted ${envPreset} HDR decodes into the scene`,
      () => snapshot(page),
      (s) => !!s.scene?.environmentUuid && s.scene.environmentUuid !== previous
    )
    const rendered = await pixels(
      run,
      page,
      canvas,
      `${consumer.id}-hdr-${envPreset}`
    )
    const changedFraction = changedPixels(ambient.image, rendered.image)
    assert.ok(
      changedFraction > 0.005,
      `${envPreset}: actually decoded HDR must affect rendered pixels`
    )
    environments.push({
      preset: envPreset,
      environmentUuid: loaded.scene.environmentUuid,
      pixels: imageEvidence(rendered),
      changedFraction,
    })
  }
  const beforeUnmount = await snapshot(page)
  await page.evaluate(
    (selector) => {
      const canvas = document.querySelector(selector).querySelector('canvas')
      window.__packedManagedGL = canvas.getContext('webgl2')
    },
    consumer.kind === 'plain'
      ? '[data-testid="gradient-wrapper"]'
      : '[data-testid="managed-placement"]'
  )
  await fixture(page, 'lifecycle.setMounted', false)
  const unmounted = await poll(
    run,
    'owned managed renderer is actually disposed and context lost',
    () =>
      page.evaluate(() => ({
        state: window.gradientFixture.snapshot(),
        lost: window.__packedManagedGL?.isContextLost() ?? null,
      })),
    (s) =>
      !s.state.canvas &&
      s.lost === true &&
      s.state.counters.rendererDisposals >
        beforeUnmount.counters.rendererDisposals
  )
  assert.equal(await canvas.count(), 0)
  await fixture(page, 'lifecycle.setMounted', true)
  const remounted = await poll(
    run,
    'managed renderer remount creates fresh actual identity',
    () => snapshot(page),
    (s) =>
      !!s.canvas &&
      s.canvas.rendererIdentity !== beforeUnmount.canvas.rendererIdentity &&
      s.counters.completedFrames > beforeUnmount.counters.completedFrames
  )
  assert.deepEqual(remounted.errors, [])
  return {
    initial,
    pixels: imageEvidence(first),
    presets,
    pause: {
      time: pausedLater.scene.meshes[0].time,
      actualAdvanceBeforePause: true,
    },
    camera: {
      callbacks: camera.cameraUpdates,
      dragCallbacks: controls.cameraUpdates.length,
      positionAfterDrag: controls.scene.camera.position,
    },
    environments,
    lifecycle: { beforeUnmount, unmounted, remounted },
  }
}

async function verifyMirrors(run, page, consumer, diagnostics, evidence) {
  await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
  await poll(
    run,
    'late Source has genuinely waiting visible Views',
    () => mirrorSnapshot(page),
    (s) =>
      s.sources.A.state.status === 'absent' &&
      s.sources.A.demand.visibleViews === 3 &&
      s.sources.B.state.status === 'ready'
  )
  await mirrorCall(page, 'setOracle', true)
  await mirrorCall(page, 'configureSource', 'main', { mounted: true })
  const initial = await poll(
    run,
    'all three aspect-ratio Views copy a real final frame',
    () => mirrorSnapshot(page),
    (s) =>
      mainViews.every(
        (id) =>
          s.views[id].copies > 0 &&
          s.views[id].oracle &&
          s.views[id].pixels?.nonzeroAlpha > 100
      ) && s.sources.A.state.status === 'ready'
  )
  evidence.initial = initial
  checkCopies(initial)
  const initialPixels = []
  for (const id of mainViews)
    initialPixels.push(
      imageEvidence(
        await pixels(
          run,
          page,
          page.getByTestId(`mirror-view-${id}`).locator('canvas'),
          `${consumer.id}-mirror-${id}`
        )
      )
    )
  const independentBefore = (await settledMirrors(run, page)).sources.B
  await mirrorCall(page, 'configureSource', 'main', {
    gradient: { color1: '#12ee30', uTime: 11, grain: 'on' },
  })
  await mirrorCall(page, 'requestFrame', 'A')
  const changed = await poll(
    run,
    'source mutation delivers fresh synchronous final-grain copies',
    () => mirrorSnapshot(page),
    (s) =>
      mainViews.every(
        (id) =>
          s.views[id].copies > initial.views[id].copies &&
          s.views[id].pixels?.hash !== initial.views[id].pixels?.hash
      )
  )
  evidence.changed = changed
  checkCopies(changed)
  assert.equal(
    changed.sources.A.state.generation,
    initial.sources.A.state.generation
  )
  assert.equal(
    changed.sources.A.contextIdentity,
    initial.sources.A.contextIdentity
  )
  assert.equal(
    changed.sources.B.state.generation,
    independentBefore.state.generation
  )
  assert.equal(
    changed.sources.B.lastFrame.sequence,
    independentBefore.lastFrame.sequence
  )
  const beforeResize = await settledMirrors(run, page)
  evidence.resize = {
    before: beforeResize,
    requested: { width: 240, height: 120, pixelDensity: 2, maxDimension: 300 },
    expectedBuffer: { width: 300, height: 150 },
    sampleCount: 0,
    samples: [],
  }
  await mirrorCall(page, 'configureView', 'wide', {
    width: 240,
    height: 120,
    pixelDensity: 2,
    maxDimension: 300,
  })
  const completedResize = await poll(
    run,
    'View DPR and buffer cap perform a fresh actual copy',
    async () => {
      const state = await mirrorSnapshot(page)
      const resize = evidence.resize
      resize.sampleCount++
      resize.lastObservation = state
      resize.samples.push({ observedAt: new Date().toISOString(), state })
      // Retain first8/last8 actual samples, not fabricated intermediates.
      if (resize.samples.length > 16) resize.samples.splice(8, 1)
      return state
    },
    (s) => {
      const producer = s.sources.A
      const view = s.views.wide
      return (
        producer.state.status === 'ready' &&
        producer.frames > beforeResize.sources.A.frames &&
        producer.lastFrame?.generation === producer.state.generation &&
        view.attached &&
        view.copies > beforeResize.views.wide.copies &&
        view.buffer?.width === 300 &&
        view.buffer?.height === 150 &&
        view.lastCopy?.source === 'A' &&
        view.lastCopy?.generation === producer.state.generation &&
        view.lastCopy?.width === 300 &&
        view.lastCopy?.height === 150 &&
        view.oracle?.width === 300 &&
        view.oracle?.height === 150 &&
        view.oracle?.differingBytes === 0 &&
        view.oracle?.maxChannelError === 0 &&
        view.pixels?.nonzeroAlpha > 100 &&
        view.error === null
      )
    }
  )
  evidence.resize.completed = completedResize
  const resized = await settledMirrors(run, page)
  evidence.resize.settled = resized
  checkCopies(resized)
  assert.equal(
    resized.sources.A.state.generation,
    beforeResize.sources.A.state.generation,
    'Paused View resize must not rotate the Source generation'
  )
  assert.equal(
    resized.sources.A.contextIdentity,
    initial.sources.A.contextIdentity
  )
  await mirrorCall(page, 'configureView', 'wide', { source: 'B' })
  await mirrorCall(page, 'requestFrame', 'B')
  const rebound = await poll(
    run,
    'View rebind observes B provenance, not old A pixels',
    () => mirrorSnapshot(page),
    (s) =>
      s.views.wide.lastCopy?.source === 'B' &&
      s.views.wide.copies > resized.views.wide.copies
  )
  checkCopies(rebound, ['wide'], 'B')
  await mirrorCall(page, 'configureView', 'wide', { source: 'A' })
  await mirrorCall(page, 'requestFrame', 'A')
  const duplicateBefore = (await mirrorSnapshot(page)).duplicate.errors.length
  const attemptId = diagnostics.negativeAttempts.length + 1
  const duplicateAttempt = {
    id: attemptId,
    kind: 'duplicate-producer',
    phase: `negative-duplicate-producer-${attemptId}`,
    startedAt: new Date().toISOString(),
    startConsoleIndex: diagnostics.console.length,
    typedFailures: [],
    confirmed: false,
  }
  diagnostics.negativeAttempts.push(duplicateAttempt)
  diagnostics.activeNegativeAttemptId = attemptId
  diagnostics.phase = duplicateAttempt.phase
  await mirrorCall(page, 'setDuplicate', true)
  const duplicate = await poll(
    run,
    'actual duplicate Source fails through its own typed boundary',
    () => mirrorSnapshot(page),
    (s) => s.duplicate.errors.length === duplicateBefore + 1
  )
  assert.equal(duplicate.duplicate.errors.at(-1).code, 'duplicate-producer')
  duplicateAttempt.typedFailures =
    duplicate.duplicate.errors.slice(duplicateBefore)
  assert.equal(
    duplicateAttempt.typedFailures.length,
    1,
    'Each deliberate duplicate mount must yield exactly its own typed failure'
  )
  await page.getByTestId('mirror-duplicate-error').waitFor()
  assert.equal(duplicate.sources.A.state.status, 'ready')
  assert.deepEqual(duplicate.errors, [])
  await mirrorCall(page, 'setDuplicate', false)
  const originalAfterDuplicate = await mirrorCall(page, 'requestFrame', 'A')
  assert.ok(
    originalAfterDuplicate.sources.A.frames > duplicate.sources.A.frames,
    'Original producer must complete a real frame after rejecting the duplicate'
  )
  duplicateAttempt.originalProducerAfter = originalAfterDuplicate.sources.A
  duplicateAttempt.confirmed = true
  duplicateAttempt.endConsoleIndex = diagnostics.console.length
  duplicateAttempt.finishedAt = new Date().toISOString()
  diagnostics.activeNegativeAttemptId = null
  diagnostics.phase = 'mirrors'
  // Request a genuinely absent asset. Kit returns404; a plain SPA server may
  // return its HTML document, which must genuinely fail HDR decoding instead.
  const missingURL = new URL(
    `/missing-packed-hdr-${run.id}/city.hdr`,
    consumer.baseURL
  ).href
  diagnostics.expectedMissingURL = missingURL
  diagnostics.phase = 'hdr-failure'
  await mirrorCall(page, 'configureSource', 'main', {
    canvas: { envBasePath: new URL('.', missingURL).pathname },
    gradient: { lightType: 'env', envPreset: 'city' },
  })
  const failedHDR = await poll(
    run,
    'missing real HDR becomes typed Source error and clears Views',
    () => mirrorSnapshot(page),
    (s) =>
      s.sources.A.state.status === 'error' &&
      s.sources.A.state.error?.code === 'environment' &&
      mainViews.every((id) => s.views[id].pixels?.nonzeroAlpha === 0)
  )
  assert.ok(
    failedHDR.errors.some(
      (e) =>
        e.code === 'environment' &&
        e.message.includes(
          missingURL.slice(new URL(consumer.baseURL).origin.length)
        )
    )
  )
  assert.equal(failedHDR.sources.B.state.status, 'ready')
  const missingResponse = await poll(
    run,
    'missing self-hosted HDR has an observed real response/body',
    async () => diagnostics.responses.find((r) => r.url === missingURL),
    (response) => !!response?.bodySha256
  )
  assert.ok(
    missingResponse.status === 404 ||
      (consumer.kind === 'plain' &&
        missingResponse.status === 200 &&
        /text\/html/i.test(missingResponse.contentType ?? '')),
    `Unexpected missing-HDR HTTP semantics: ${JSON.stringify(missingResponse)}`
  )
  diagnostics.missingHDREvidence = {
    ...missingResponse,
    failure:
      missingResponse.status === 404
        ? 'http-not-found'
        : 'actual-spa-html-hdr-decode-failure',
    sourceError: failedHDR.sources.A.state.error,
  }
  await mirrorCall(page, 'configureSource', 'main', {
    canvas: { envBasePath: '/native-feature-hdr' },
  })
  await mirrorCall(page, 'requestFrame', 'A')
  const recovered = await poll(
    run,
    'successful actual HDR decode recovers Source readiness and copies',
    () => mirrorSnapshot(page),
    (s) =>
      s.sources.A.state.status === 'ready' &&
      mainViews.every((id) => s.views[id].pixels?.nonzeroAlpha > 100)
  )
  checkCopies(recovered)
  diagnostics.phase = 'mirrors'
  await mirrorCall(page, 'configureSource', 'main', {
    gradient: { lightType: '3d' },
  })
  await mirrorCall(page, 'requestFrame', 'A')
  const beforeHidden = await settledMirrors(run, page)
  await page.evaluate(() => {
    window.__packedSourceGL = window.gradientFixture.mirrors.context('A')
  })
  for (const id of mainViews)
    await mirrorCall(page, 'configureView', id, { visible: false })
  const hidden = await poll(
    run,
    'real offscreen demand releases the owned Source renderer',
    () =>
      page.evaluate(() => ({
        state: window.gradientFixture.mirrors.snapshot(),
        lost: window.__packedSourceGL?.isContextLost() ?? null,
      })),
    (s) =>
      s.state.sources.A.demand.visibleViews === 0 &&
      s.state.sources.A.demand.pendingFrames === 0 &&
      s.state.sources.A.state.status === 'loading' &&
      s.lost === true
  )
  await mirrorCall(page, 'requestFrame', 'A')
  const oneShot = await poll(
    run,
    'hidden one-shot publishes then releases its actual lease',
    () => mirrorSnapshot(page),
    (s) =>
      s.sources.A.frames > hidden.state.sources.A.frames &&
      s.sources.A.state.status === 'loading' &&
      s.sources.A.demand.pendingFrames === 0 &&
      s.instrumentation.pendingRequests === 0
  )
  assert.equal(oneShot.sources.A.lastFrame.preserveDrawingBuffer, false)
  for (const id of mainViews)
    assert.equal(
      oneShot.views[id].copies,
      hidden.state.views[id].copies,
      'Offscreen View cannot copy a hidden one-shot'
    )
  for (const id of mainViews)
    await mirrorCall(page, 'configureView', id, { visible: true })
  await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
  const reentered = await poll(
    run,
    'viewport reentry creates a fresh Source generation',
    () => mirrorSnapshot(page),
    (s) =>
      s.sources.A.state.status === 'ready' &&
      s.sources.A.state.generation > beforeHidden.sources.A.state.generation &&
      mainViews.every(
        (id) =>
          s.views[id].copies > oneShot.views[id].copies &&
          s.views[id].pixels?.nonzeroAlpha > 100
      )
  )
  checkCopies(reentered)
  assert.notEqual(
    reentered.sources.A.contextIdentity,
    beforeHidden.sources.A.contextIdentity
  )
  await mirrorCall(page, 'configureSource', 'main', { source: 'C' })
  for (const id of mainViews)
    await mirrorCall(page, 'configureView', id, { source: 'C' })
  await mirrorCall(page, 'requestFrame', 'C')
  const sourceRebound = await poll(
    run,
    'Source and Views rebind through the third public handle',
    () => mirrorSnapshot(page),
    (s) =>
      s.sources.A.state.status === 'absent' &&
      s.sources.C.state.status === 'ready' &&
      mainViews.every(
        (id) =>
          s.views[id].lastCopy?.source === 'C' &&
          s.views[id].pixels?.nonzeroAlpha > 100
      )
  )
  checkCopies(sourceRebound, mainViews, 'C')
  await mirrorCall(page, 'configureSource', 'main', { mounted: false })
  const detached = await poll(
    run,
    'Source detach clears actual buffers without disposing caller handle',
    () => mirrorSnapshot(page),
    (s) =>
      s.sources.C.state.status === 'absent' &&
      mainViews.every((id) => s.views[id].pixels?.nonzeroAlpha === 0)
  )
  for (const tree of ['main', 'independent'])
    await mirrorCall(page, 'configureSource', tree, { mounted: false })
  for (const id of allViews)
    await mirrorCall(page, 'configureView', id, { mounted: false })
  for (const id of ['A', 'B', 'C']) await mirrorCall(page, 'disposeHandle', id)
  const terminal = await poll(
    run,
    'caller-owned handles dispose and release demand/wrappers/requests',
    () => mirrorSnapshot(page),
    (s) =>
      ['A', 'B', 'C'].every(
        (id) =>
          s.sources[id].state.status === 'disposed' &&
          s.sources[id].demand.visibleViews === 0 &&
          s.sources[id].demand.pendingFrames === 0
      ) &&
      s.instrumentation.viewWrappers === 0 &&
      s.instrumentation.pendingRequests === 0
  )
  const rejected = await page.evaluate(async () => {
    try {
      await window.gradientFixture.mirrors.requestFrame('C')
      return null
    } catch (error) {
      return { code: error.code, message: error.message }
    }
  })
  assert.equal(
    rejected?.code,
    'source-disposed',
    'Disposed handle must fail meaningfully, not silently no-op'
  )
  assert.ok(terminal.contexts.entries.length <= 3)
  assert.ok(
    terminal.errors.every(
      (error) =>
        error.code === 'environment' &&
        error.message.includes(`/missing-packed-hdr-${run.id}/`)
    ),
    'No unexpected mirror callback errors'
  )
  assert.equal(
    terminal.errors.length,
    failedHDR.errors.length,
    'Recovery/lifecycle must not manufacture further environment errors'
  )
  return {
    initial,
    initialPixels,
    changed,
    resized,
    rebound,
    duplicate,
    failedHDR,
    recovered,
    hidden,
    oneShot,
    reentered,
    sourceRebound,
    detached,
    terminal,
    rejected,
    stable: await settledMirrors(run, page),
    unavailable: {
      privateRendererAllocationAndDisposalTotals:
        'Not exposed by the public fixture; resources fields remain null, not invented zero counts.',
    },
  }
}

async function verifyNavigation(run, page, consumer) {
  if (consumer.kind !== 'kit') {
    await fixture(page, 'lifecycle.setMounted', false)
    return {
      kind: 'plain-client',
      managedUnmounted: !(await snapshot(page)).canvas,
      routeNavigation: {
        available: false,
        reason:
          'Independent plain starter has no router; Kit consumers exercise real client navigation.',
      },
    }
  }
  const documentId = await page.evaluate(() => {
    window.__packedOldMirrors = window.gradientFixture.mirrors
    return window.__packedNativeProbe.documentId
  })
  await page.getByTestId('away-link').click()
  await page.waitForURL(new URL('/away', consumer.baseURL).href)
  await page.getByRole('heading', { name: 'Away from the gradient' }).waitFor()
  const destroyed = await poll(
    run,
    'Kit client navigation destroys previous request handles and registration',
    () =>
      page.evaluate(() => ({
        documentId: window.__packedNativeProbe.documentId,
        fixturePresent: !!window.gradientFixture,
        state: window.__packedOldMirrors.snapshot(),
        canvasCount: document.querySelectorAll('canvas').length,
      })),
    (s) =>
      !s.fixturePresent &&
      s.canvasCount === 0 &&
      s.state.instrumentation.frameSubscriptions === 0 &&
      s.state.instrumentation.viewWrappers === 0 &&
      s.state.instrumentation.pendingRequests === 0 &&
      s.state.contexts.entries.length === 0
  )
  assert.equal(
    destroyed.documentId,
    documentId,
    'Kit navigation must be hydrated client routing, not a document reload'
  )
  assert.ok(
    Object.values(destroyed.state.sources).every(
      (s) => s.state.status === 'disposed'
    )
  )
  const rejected = await page.evaluate(async () => {
    try {
      await window.__packedOldMirrors.requestFrame('A')
      return null
    } catch (error) {
      return { code: error.code, message: error.message }
    }
  })
  assert.equal(rejected?.code, 'mirror-fixture-disposed')
  await page.getByTestId('back-link').click()
  await page.waitForURL(new URL('/', consumer.baseURL).href)
  await page.waitForFunction(
    () => window.gradientFixture?.mirrors?.version === 1
  )
  assert.equal(
    await page.evaluate(() => window.__packedNativeProbe.documentId),
    documentId
  )
  const fresh = await mirrorSnapshot(page)
  assert.equal(
    fresh.sources.A.state.status,
    'absent',
    'Returning route creates fresh request-owned handles'
  )
  assert.equal(fresh.sources.A.frames, 0)
  await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
  await mirrorCall(page, 'configureSource', 'main', { mounted: true })
  await mirrorCall(page, 'requestFrame', 'A')
  await poll(
    run,
    'return navigation renders a genuine new public Source/View frame',
    () => mirrorSnapshot(page),
    (s) =>
      s.sources.A.state.status === 'ready' &&
      s.views.square.pixels?.nonzeroAlpha > 100
  )
  await page.getByTestId('away-link').click()
  await page.waitForURL(new URL('/away', consumer.baseURL).href)
  await poll(
    run,
    'second navigation removes all actual scene canvases',
    () => page.locator('canvas').count(),
    (count) => count === 0
  )
  return {
    kind: 'compiled-kit-hydration-and-client-navigation',
    sameDocument: true,
    destroyed,
    rejected,
    fresh,
    secondTeardownCanvasCount: 0,
  }
}

async function verifyKitHydratedIsolation(
  run,
  browser,
  page,
  consumer,
  evidence
) {
  run.signal.throwIfAborted()
  let creating
  let creatingPage
  let second
  let primary
  const close = run.resources.register(
    `context:${consumer.id}:request-isolation`,
    async () => {
      await within(
        async () => {
          const acquired = await creating?.catch(() => null)
          await acquired?.close()
          const page = await creatingPage?.catch(() => null)
          await page?.close()
        },
        5000,
        `${consumer.id}: close request-isolation context`
      )
    }
  )
  try {
    run.signal.throwIfAborted()
    creating = browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      serviceWorkers: 'block',
    })
    const context = await within(
      () => creating,
      run.timeout,
      `${consumer.id}: create request-isolation context`,
      run.signal
    )
    run.signal.throwIfAborted()
    creatingPage = context.newPage()
    second = await within(
      () => creatingPage,
      run.timeout,
      `${consumer.id}: create request-isolation page`,
      run.signal
    )
    second.setDefaultTimeout(run.timeout)
    second.setDefaultNavigationTimeout(run.timeout)
    const errors = []
    evidence.errors = errors
    evidence.stage = 'hydrate-secondary-request'
    let overflow = false
    const observeError = (error) => {
      if (errors.length < 256) errors.push(error)
      else overflow = true
    }
    second.on('pageerror', (error) => observeError(errorText(error)))
    second.on('console', (message) => {
      if (
        message.type() === 'error' ||
        /hydrat|mismatch|derived_inert|shader error/i.test(message.text())
      )
        observeError(message.text())
    })
    second.on('requestfailed', (request) =>
      observeError(`${request.url()}: ${request.failure()?.errorText}`)
    )
    const beta = new URL('/', consumer.baseURL)
    beta.searchParams.set('request', `packed-hydrated-beta-${run.id}`)
    beta.searchParams.set('color1', '#ee2211')
    evidence.secondURL = beta.href
    assert.equal(
      (await second.goto(beta.href, { waitUntil: 'networkidle' }))?.status(),
      200
    )
    await second.waitForFunction(
      () => window.gradientFixture?.mirrors?.version === 1
    )
    assert.equal(
      await second.getByTestId('request-settings').getAttribute('data-request'),
      `packed-hydrated-beta-${run.id}`
    )
    assert.equal(
      await second.getByTestId('request-settings').getAttribute('data-color1'),
      '#ee2211'
    )
    await second.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
    await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
    const firstInitial = await mirrorSnapshot(page)
    const secondInitial = await mirrorSnapshot(second)
    Object.assign(evidence, {
      firstInitial,
      secondInitial,
      stage: 'mount-primary-source',
    })
    assert.equal(firstInitial.sources.A.state.status, 'absent')
    assert.equal(secondInitial.sources.A.state.status, 'absent')
    await mirrorCall(page, 'configureSource', 'main', {
      mounted: true,
      gradient: { color1: '#12ee30', uTime: 11 },
    })
    await mirrorCall(page, 'requestFrame', 'A')
    const firstPublished = await poll(
      run,
      'first hydrated request renders its own Source frame',
      () => mirrorSnapshot(page),
      (s) =>
        s.sources.A.state.status === 'ready' &&
        s.views.square.pixels?.nonzeroAlpha > 100
    )
    evidence.firstPublished = firstPublished
    const secondUnchanged = await mirrorSnapshot(second)
    evidence.secondUnchanged = secondUnchanged
    assert.equal(secondUnchanged.sources.A.state.status, 'absent')
    assert.equal(
      secondUnchanged.sources.A.frames,
      secondInitial.sources.A.frames
    )
    assert.equal(secondUnchanged.views.square.pixels?.nonzeroAlpha ?? 0, 0)
    await mirrorCall(second, 'configureSource', 'main', {
      mounted: true,
      gradient: { color1: '#ee1230', uTime: 23 },
    })
    await mirrorCall(second, 'requestFrame', 'A')
    evidence.stage = 'mount-secondary-source'
    const secondPublished = await poll(
      run,
      'second hydrated request renders its different real Source frame',
      () => mirrorSnapshot(second),
      (s) =>
        s.sources.A.state.status === 'ready' &&
        s.views.square.pixels?.nonzeroAlpha > 100
    )
    evidence.secondPublished = secondPublished
    evidence.stage = 'settle-both-request-owned-trees'
    const firstReady = await settledMirrors(run, page)
    evidence.firstReady = firstReady
    const secondReady = await settledMirrors(run, second)
    evidence.secondReady = secondReady
    for (const [label, state] of [
      ['first', firstReady],
      ['second', secondReady],
    ]) {
      assert.equal(
        state.sources.A.state.status,
        'ready',
        `${label} request Source A is ready at settled baseline`
      )
      assert.equal(
        state.sources.A.demand.pendingFrames,
        0,
        `${label} request Source A has no unfinished View/frame leases at baseline`
      )
      assert.ok(
        state.views.square.pixels?.nonzeroAlpha > 100,
        `${label} request baseline retains actual rendered pixels`
      )
    }
    assert.notEqual(
      firstReady.views.square.pixels.hash,
      secondReady.views.square.pixels.hash,
      'Separately hydrated request settings must produce different actual pixels'
    )
    evidence.stage = 'teardown-primary-with-secondary-settled'
    await mirrorCall(page, 'configureSource', 'main', {
      ...firstInitial.trees.main,
      mounted: false,
    })
    await poll(
      run,
      'first request teardown returns its Views to waiting',
      () => mirrorSnapshot(page),
      (s) =>
        s.sources.A.state.status === 'absent' &&
        s.views.square.pixels?.nonzeroAlpha === 0
    )
    const secondAfterFirstTeardown = await settledMirrors(run, second)
    evidence.secondAfterFirstTeardown = secondAfterFirstTeardown
    evidence.stage = 'assert-request-owned-isolation-after-teardown'
    assert.equal(secondAfterFirstTeardown.sources.A.state.status, 'ready')
    assert.equal(
      secondAfterFirstTeardown.sources.A.frames,
      secondReady.sources.A.frames,
      'Tearing down the first request must not advance the already settled second request Source A'
    )
    assert.equal(
      secondAfterFirstTeardown.views.square.pixels.hash,
      secondReady.views.square.pixels.hash
    )
    for (const id of ['A', 'B', 'C']) {
      assert.deepEqual(
        secondAfterFirstTeardown.sources[id],
        secondReady.sources[id],
        `Second request source ${id} retains its own generation/context/frames/demand after first request teardown`
      )
    }
    for (const tree of ['main', 'independent']) {
      assert.deepEqual(
        secondAfterFirstTeardown.trees[tree],
        secondReady.trees[tree],
        `Second request ${tree} settings remain request-owned`
      )
    }
    for (const id of allViews) {
      assert.deepEqual(
        secondAfterFirstTeardown.views[id],
        secondReady.views[id],
        `Second request View ${id} retains its actual pixels/copy provenance/counters`
      )
    }
    for (const tree of ['main', 'independent'])
      await mirrorCall(second, 'configureSource', tree, { mounted: false })
    for (const id of allViews)
      await mirrorCall(second, 'configureView', id, { mounted: false })
    for (const id of ['A', 'B', 'C'])
      await mirrorCall(second, 'disposeHandle', id)
    assert.equal(overflow, false)
    assert.deepEqual(
      errors,
      [],
      'Second independently hydrated request must not hide browser/HTTP/hydration failures'
    )
    return {
      kind: 'two-independent-hydrated-kit-requests-one-browser',
      secondURL: beta.href,
      firstInitial,
      secondInitial,
      secondUnchanged,
      firstReady,
      secondReady,
      secondAfterFirstTeardown,
      errors,
    }
  } catch (error) {
    primary = error
    run.fail(error)
    evidence.status = 'failed'
    evidence.failureBeforeClose = {
      capturedAt: new Date().toISOString(),
      error: errorText(error),
      stage: evidence.stage,
    }
    for (const [label, target] of [
      ['first', page],
      ['second', second],
    ]) {
      if (!target || target.isClosed()) {
        evidence.failureBeforeClose[label] = {
          unavailable: 'Owned request page already closed or unavailable.',
        }
        continue
      }
      try {
        evidence.failureBeforeClose[label] = await within(
          () =>
            target.evaluate(() => ({
              url: location.href,
              fixture: window.gradientFixture?.snapshot() ?? null,
              mirrors: window.gradientFixture?.mirrors?.snapshot() ?? null,
              request:
                document
                  .querySelector('[data-testid="request-settings"]')
                  ?.getAttribute('data-request') ?? null,
              viewport: {
                width: innerWidth,
                height: innerHeight,
                scrollX,
                scrollY,
                dpr: devicePixelRatio,
              },
            })),
          1500,
          `${consumer.id}: capture ${label} hydrated request before secondary context close`
        )
      } catch (captureError) {
        evidence.failureBeforeClose[label] = {
          captureError: errorText(captureError),
        }
      }
    }
    throw error
  } finally {
    await releaseOwned(
      [close],
      primary,
      'Request-isolation context cleanup failed'
    )
  }
}

async function verifyBrowser(run, browser, consumer, core, result) {
  run.signal.throwIfAborted()
  let context
  let page
  let primary
  let creatingContext
  let creatingPage
  const close = run.resources.register(`context:${consumer.id}`, async () => {
    await within(
      async () => {
        const acquired = await creatingContext?.catch(() => null)
        await acquired?.close()
        const acquiredPage = await creatingPage?.catch(() => null)
        await acquiredPage?.close()
      },
      5000,
      `${consumer.id}: close production browser context`
    )
  })
  try {
    run.signal.throwIfAborted()
    creatingContext = browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      serviceWorkers: 'block',
    })
    context = await within(
      () => creatingContext,
      run.timeout,
      `${consumer.id}: create production browser context`,
      run.signal
    )
    run.signal.throwIfAborted()
    creatingPage = context.newPage()
    page = await within(
      () => creatingPage,
      run.timeout,
      `${consumer.id}: create production browser page`,
      run.signal
    )
    page.setDefaultTimeout(run.timeout)
    page.setDefaultNavigationTimeout(run.timeout)
    const diagnostics = {
      phase: 'hydration',
      pageErrors: [],
      console: [],
      failedRequests: [],
      requests: [],
      responses: [],
      hdr: [],
      expectedMissingURL: null,
      negativeAttempts: [],
      activeNegativeAttemptId: null,
      overflow: [],
    }
    const appendDiagnostic = (key, value) => {
      if (diagnostics[key].length < 2048) diagnostics[key].push(value)
      else if (!diagnostics.overflow.includes(key))
        diagnostics.overflow.push(key)
    }
    result.diagnostics = diagnostics
    const bodies = new Set()
    page.on('pageerror', (error) =>
      appendDiagnostic('pageErrors', errorText(error))
    )
    page.on('console', (message) =>
      appendDiagnostic('console', {
        type: message.type(),
        text: message.text().slice(0, 8192),
        location: message.location(),
        phase: diagnostics.phase,
        negativeAttemptId: diagnostics.activeNegativeAttemptId,
      })
    )
    page.on('request', (request) =>
      appendDiagnostic('requests', {
        url: request.url(),
        type: request.resourceType(),
        phase: diagnostics.phase,
      })
    )
    page.on('requestfailed', (request) =>
      appendDiagnostic('failedRequests', {
        url: request.url(),
        failure: request.failure(),
        phase: diagnostics.phase,
      })
    )
    page.on('response', (response) => {
      const record = {
        url: response.url(),
        status: response.status(),
        contentType: response.headers()['content-type'] ?? null,
        phase: diagnostics.phase,
      }
      appendDiagnostic('responses', record)
      if (record.url === diagnostics.expectedMissingURL) {
        const task = response
          .body()
          .then((bytes) => {
            assert.ok(
              bytes.length <= 2 * 1024 * 1024,
              'Intentional missing-HDR response exceeds evidence budget'
            )
            record.bodyBytes = bytes.length
            record.bodySha256 = digest(bytes)
          })
          .catch((error) => {
            record.bodyError = errorText(error)
          })
        bodies.add(task)
        task.finally(() => bodies.delete(task))
      }
      if (
        record.status === 200 &&
        /\/native-feature-hdr\/(city|dawn|lobby)\.hdr$/.test(record.url)
      ) {
        const task = response
          .body()
          .then((bytes) => {
            const name = new URL(record.url).pathname.slice(1)
            const expected = consumer.artifacts.publicAssets?.files?.find(
              (file) => file.path === name || file.path.endsWith(`/${name}`)
            )
            assert.ok(
              expected,
              `Actual HDR response ${name} must occur in the prepared public asset hash manifest`
            )
            assert.equal(
              digest(bytes),
              expected.sha256,
              `Actual HTTP HDR bytes must match prepared candidate ${name}`
            )
            diagnostics.hdr.push({
              ...record,
              bytes: bytes.length,
              sha256: digest(bytes),
              manifestFile: expected.path,
            })
          })
          .catch((error) => {
            record.bodyError = errorText(error)
          })
        bodies.add(task)
        task.finally(() => bodies.delete(task))
      }
    })
    await installBrowserProbe(page)
    const browserURL = new URL('/', consumer.baseURL)
    if (consumer.kind === 'kit') {
      browserURL.searchParams.set('request', `packed-hydrated-alpha-${run.id}`)
      browserURL.searchParams.set('color1', '#1122ee')
    }
    const response = await page.goto(browserURL.href, {
      waitUntil: 'networkidle',
    })
    assert.equal(response?.status(), 200)
    await page.waitForFunction(
      () =>
        window.gradientFixture?.version === 1 &&
        window.gradientFixture.mirrors?.version === 1
    )
    if (consumer.kind === 'kit') {
      assert.equal(await page.getByTestId('ssr-content').count(), 1)
      assert.equal(
        await page.getByTestId('request-settings').getAttribute('data-request'),
        `packed-hydrated-alpha-${run.id}`
      )
      assert.equal(
        await page.getByTestId('request-settings').getAttribute('data-color1'),
        '#1122ee'
      )
      diagnostics.phase = 'request-isolation'
      result.requestIsolation = { status: 'running' }
      const isolated = await verifyKitHydratedIsolation(
        run,
        browser,
        page,
        consumer,
        result.requestIsolation
      )
      Object.assign(result.requestIsolation, isolated, { status: 'passed' })
    }
    result.managed = await verifyManaged(run, page, consumer, core)
    diagnostics.phase = 'mirrors'
    result.mirrors = { status: 'running' }
    const mirrors = await verifyMirrors(
      run,
      page,
      consumer,
      diagnostics,
      result.mirrors
    )
    Object.assign(result.mirrors, mirrors, { status: 'passed' })
    result.backend = await page.evaluate(() => {
      const probe = window.__packedNativeProbe
      return {
        overflow: probe.overflow,
        contexts: probe.records.map(({ gl, canvas, draws, linked, time }) => {
          const lost = gl.isContextLost()
          const extension = lost
            ? null
            : gl.getExtension('WEBGL_debug_renderer_info')
          return {
            scope:
              canvas.closest('[data-testid]')?.getAttribute('data-testid') ??
              null,
            draws,
            linked,
            gradientTime: time,
            lost,
            attributes: lost ? null : gl.getContextAttributes(),
            vendor: lost ? null : gl.getParameter(gl.VENDOR),
            renderer: lost ? null : gl.getParameter(gl.RENDERER),
            unmaskedVendor: extension
              ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
              : null,
            unmaskedRenderer: extension
              ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
              : null,
          }
        }),
      }
    })
    assert.equal(result.backend.overflow, false)
    assert.ok(
      result.backend.contexts.some(
        (context) => context.draws > 0 && context.linked === true
      ),
      'At least one actual linked GPU program must draw'
    )
    assert.ok(
      result.backend.contexts.every(
        (context) =>
          !context.attributes ||
          context.attributes.preserveDrawingBuffer === false
      ),
      'No blanket preserveDrawingBuffer opt-in'
    )
    diagnostics.phase = 'navigation'
    result.navigation = await verifyNavigation(run, page, consumer)
    await Promise.all([...bodies])
    assert.deepEqual(
      diagnostics.overflow,
      [],
      'Browser diagnostics must remain within their bounded evidence budget'
    )
    assert.ok(
      diagnostics.responses.every((response) => !response.bodyError),
      'HTTP HDR bodies must be hashed and match actual prepared artifacts'
    )
    for (const preset of ['city', 'dawn', 'lobby'])
      assert.ok(
        diagnostics.hdr.some(
          (asset) => asset.url.endsWith(`/${preset}.hdr`) && asset.bytes > 100
        ),
        `Real self-hosted ${preset} HDR must be fetched, hashed and decoded`
      )
    assert.deepEqual(
      diagnostics.pageErrors,
      [],
      'No uncaught browser errors, including hydration/lifecycle failures'
    )
    assert.deepEqual(
      diagnostics.failedRequests,
      [],
      'No failed requests may be hidden as successful runtime qualification'
    )
    assert.deepEqual(
      diagnostics.console.filter((entry) =>
        /hydrat|mismatch|derived_inert|shader error|VALIDATE_STATUS/i.test(
          entry.text
        )
      ),
      [],
      'No hydration, reactive teardown, or GPU diagnostics'
    )
    const acceptedNegativeConsole = new Set()
    for (const attempt of diagnostics.negativeAttempts) {
      assert.equal(
        attempt.confirmed,
        true,
        'An expected diagnostic must belong to a completed deliberate negative attempt'
      )
      assert.ok(attempt.typedFailures.length > 0)
      assert.ok(
        attempt.typedFailures.every(
          (failure) =>
            failure.code === 'duplicate-producer' &&
            typeof failure.message === 'string' &&
            failure.message.length > 0
        )
      )
      const matched = diagnostics.console.flatMap((entry, index) => {
        const firstLine = entry.text.split(/\r?\n/, 1)[0]
        const sameTypedMessage = attempt.typedFailures.some((failure) => {
          const typedFirstLine = failure.message.split(/\r?\n/, 1)[0]
          return (
            firstLine === typedFirstLine ||
            firstLine === `Error: ${typedFirstLine}`
          )
        })
        return entry.type === 'error' &&
          entry.phase === attempt.phase &&
          entry.negativeAttemptId === attempt.id &&
          index >= attempt.startConsoleIndex &&
          index < attempt.endConsoleIndex &&
          entry.location.url.startsWith(
            `${new URL(consumer.baseURL).origin}/`
          ) &&
          sameTypedMessage
          ? [{ index, entry }]
          : []
      })
      attempt.consoleEvidence = {
        typedFailureCount: attempt.typedFailures.length,
        observedCount: matched.length,
        eventIndices: matched.map(({ index }) => index),
        boundaryLogged: matched.length > 0,
        policy:
          consumer.kind === 'kit'
            ? 'Production Kit boundary logs exactly one original diagnostic per captured typed failure.'
            : 'Plain boundary may omit console logging; any emitted diagnostic must still match its captured typed failure exactly once.',
      }
      if (consumer.kind === 'kit') {
        assert.equal(
          matched.length,
          attempt.typedFailures.length,
          'Controlled Kit duplicate diagnostic count must match its actual typed failure count'
        )
      } else {
        assert.ok(
          matched.length <= attempt.typedFailures.length,
          'Plain duplicate boundary cannot log more diagnostics than actual typed failures'
        )
      }
      for (const { entry } of matched) acceptedNegativeConsole.add(entry)
    }
    const unexpectedConsole = diagnostics.console.filter(
      (entry) =>
        entry.type === 'error' &&
        !acceptedNegativeConsole.has(entry) &&
        !(
          entry.phase === 'hdr-failure' &&
          entry.location.url === diagnostics.expectedMissingURL &&
          /404|not found/i.test(entry.text)
        )
    )
    assert.deepEqual(
      unexpectedConsole,
      [],
      'Only individually correlated controlled duplicate diagnostics and the exact asserted missing-HDR HTTP 404 console error are expected'
    )
    assert.deepEqual(
      diagnostics.responses.filter(
        (response) =>
          response.status >= 400 &&
          !(
            response.url === diagnostics.expectedMissingURL &&
            response.status === 404
          )
      ),
      [],
      'No unexplained HTTP failure responses'
    )
    const origin = new URL(consumer.baseURL).origin
    assert.deepEqual(
      diagnostics.requests.filter(
        (request) =>
          /^https?:/.test(request.url) && new URL(request.url).origin !== origin
      ),
      [],
      'Packed production consumer must not depend on checkout dev servers or remote runtime/HDR assets'
    )
    result.hydration = {
      actualProductionDocument: true,
      usefulKitSSRPreserved: consumer.kind === 'kit',
      noHydrationDiagnostics: true,
    }
  } catch (error) {
    primary = error
    run.fail(error)
    if (result.mirrors?.status === 'running') result.mirrors.status = 'failed'
    if (result.requestIsolation?.status === 'running')
      result.requestIsolation.status = 'failed'
    const failure = {
      capturedAt: new Date().toISOString(),
      phase: result.diagnostics?.phase ?? null,
      error: errorText(error),
      assertionMirrorState: error?.mirrorFailure ?? null,
      requestIsolationBeforeClose:
        result.requestIsolation?.failureBeforeClose ?? null,
    }
    result.failureSnapshot = failure
    if (page && !page.isClosed()) {
      try {
        failure.current = await within(
          () =>
            page.evaluate(() => {
              const fixture = window.gradientFixture
              const probe = window.__packedNativeProbe
              return {
                url: location.href,
                viewport: {
                  width: innerWidth,
                  height: innerHeight,
                  scrollX,
                  scrollY,
                  dpr: devicePixelRatio,
                },
                fixture: fixture?.snapshot() ?? null,
                mirrors: fixture?.mirrors?.snapshot() ?? null,
                mirrorRects: Object.fromEntries(
                  ['square', 'wide', 'tall', 'independent'].map((id) => {
                    const node = document.querySelector(
                      `[data-testid="mirror-view-${id}"]`
                    )
                    const rect = node?.getBoundingClientRect()
                    return [
                      id,
                      rect
                        ? {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height,
                          }
                        : null,
                    ]
                  })
                ),
                contexts:
                  probe?.records.map(
                    ({ gl, canvas, draws, linked, time }, index) => {
                      const lost = gl.isContextLost()
                      return {
                        identity: index + 1,
                        scope:
                          canvas
                            .closest('[data-testid]')
                            ?.getAttribute('data-testid') ?? null,
                        width: canvas.width,
                        height: canvas.height,
                        draws,
                        linked,
                        time,
                        lost,
                        attributes: lost ? null : gl.getContextAttributes(),
                      }
                    }
                  ) ?? null,
              }
            }),
          2000,
          `${consumer.id}: capture actual failure state before context close`
        )
      } catch (captureError) {
        failure.captureError = errorText(captureError)
      }
    } else
      failure.captureUnavailable = 'Owned page already closed or unavailable.'
    try {
      failure.path = await run.save(
        `${consumer.id}-browser-failure.json`,
        `${JSON.stringify(failure, null, 2)}\n`
      )
    } catch (saveError) {
      failure.saveError = errorText(saveError)
    }
    throw error
  } finally {
    await releaseOwned(
      [close],
      primary,
      'Production browser context cleanup failed'
    )
  }
}

/**
 * Actual packed desktop-Chromium qualification; never prepares a second time.
 * options: timeoutMs (per operation, default 30s), totalTimeoutMs (default 12min),
 * launchOptions (real Chromium launch options), reportPath (inside artifactRoot),
 * signal (optional caller AbortSignal, observed before manifest validation).
 * The four production servers are owned and run serially, with one browser total.
 * F28's broader multi-engine specs remain separate and consume the same manifest.
 * Reports retain real failures and honest unobservable resource counts.
 */
export async function verifyPreparedNativeConsumers(prepared, options = {}) {
  options.signal?.throwIfAborted()
  const resources = new OwnedResources()
  const abort = new AbortController()
  let failed = false
  let failure
  const fail = (error) => {
    if (failed) return
    failed = true
    failure = error
  }
  // Re-drain on final cleanup: an earlier abort may have started cleanup before
  // an already-pending acquisition registered or resolved its owned resource.
  const cleanup = () => resources.close()
  const cancel = (reason) => {
    fail(reason)
    abort.abort(reason)
    void cleanup()
  }
  const onAbort = () => cancel(options.signal.reason)
  const interrupt = (signal) => {
    const error = new Error(
      `Packed runtime verification interrupted by ${signal}`
    )
    error.code = signal
    cancel(error)
  }
  const onINT = () => interrupt('SIGINT')
  const onTERM = () => interrupt('SIGTERM')
  const lifecycle = {
    resources,
    abort,
    cleanup,
    interrupt,
    fail,
    get failed() {
      return failed
    },
    get failure() {
      return failure
    },
  }
  try {
    process.once('SIGINT', onINT)
    process.once('SIGTERM', onTERM)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    abort.signal.throwIfAborted()
    const report = await verifyPreparedNativeConsumersOwned(
      prepared,
      options,
      lifecycle
    )
    if (failed) throw failure
    return report
  } catch (error) {
    fail(error)
    throw failure
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    process.removeListener('SIGINT', onINT)
    process.removeListener('SIGTERM', onTERM)
  }
}

async function verifyPreparedNativeConsumersOwned(
  prepared,
  options,
  lifecycle
) {
  const { resources, abort, cleanup, interrupt } = lifecycle
  abort.signal.throwIfAborted()
  assert.equal(prepared?.schemaVersion, 1)
  assert.ok(
    isAbsolute(prepared.manifestPath ?? ''),
    'Pass the actual disk-backed prepared manifest, not an invented consumer object'
  )
  const verified = await loadPreparedNativeConsumers(prepared.manifestPath, {
    signal: abort.signal,
  })
  abort.signal.throwIfAborted()
  assert.equal(
    prepared.candidate.fingerprint,
    verified.candidate.fingerprint,
    'Prepared candidate identity changed'
  )
  for (const key of ['artifactRoot', 'packages', 'consumers'])
    assert.deepEqual(
      prepared[key],
      verified[key],
      `Prepared ${key} must match the validated actual manifest`
    )
  prepared = verified
  assert.equal(prepared.consumers.length, cells.length)
  for (const [id, kind, version, port] of cells) {
    const consumer = prepared.consumers.find((item) => item.id === id)
    assert.ok(consumer, `Missing actual independent consumer ${id}`)
    assert.equal(consumer.kind, kind)
    assert.equal(consumer.svelteVersion, version)
    assert.equal(consumer.port, port)
    assert.equal(consumer.mode, 'production')
    const url = new URL(consumer.baseURL)
    assert.equal(url.origin, `http://127.0.0.1:${port}`)
    assert.equal(consumer.launch.cwd, consumer.root)
    assert.ok(
      isAbsolute(consumer.root) && inside(prepared.artifactRoot, consumer.root)
    )
    assert.equal(
      consumer.evidence.isolation.kind,
      'bubblewrap-checkout-hidden',
      'Unavailable checkout isolation must be explicit failure, never reported as independent runtime success'
    )
  }
  const id = `${Date.now()}-${randomUUID()}`
  const root = resolve(prepared.artifactRoot, 'runtime-runs', id)
  const reportPath = options.reportPath
    ? resolve(options.reportPath)
    : resolve(root, 'report.json')
  assert.ok(
    inside(prepared.artifactRoot, reportPath),
    'Runtime evidence must remain inside the owned artifact namespace'
  )
  const timeout = options.timeoutMs ?? 30_000
  const totalTimeout = options.totalTimeoutMs ?? 12 * 60_000
  assert.ok(Number.isFinite(timeout) && timeout >= 1000 && timeout <= 120_000)
  assert.ok(
    Number.isFinite(totalTimeout) &&
      totalTimeout >= timeout &&
      totalTimeout <= 30 * 60_000
  )
  const report = {
    schemaVersion: 1,
    kind: 'actual-packed-native-production-runtime',
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    manifestPath: prepared.manifestPath,
    candidateFingerprint: prepared.candidate.fingerprint,
    packages: Object.fromEntries(
      Object.entries(prepared.packages).map(([key, pkg]) => [
        key,
        {
          name: pkg.name,
          version: pkg.version,
          sha256: pkg.sha256,
          tarball: pkg.tarball,
        },
      ])
    ),
    controller: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    workerLimit: 1,
    consumers: [],
    resources: {
      owner: 'verifyPreparedNativeConsumers',
      root,
      budgetBytes: 128 * 1024 * 1024,
      cleanup: [],
      unavailable: {
        universalSDKPrivateAllocationCounts:
          'Not publicly observable; actual held context loss, owned processes, browser contexts, fixture leases and wrapper/subscriber counters are reported instead.',
      },
    },
  }
  let savedBytes = 0
  const run = {
    id,
    root,
    resources,
    timeout,
    signal: abort.signal,
    fail: lifecycle.fail,
    async save(name, bytes) {
      const path = resolve(root, name)
      assert.ok(
        inside(root, path),
        'Evidence path escaped owned runtime directory'
      )
      savedBytes += Buffer.byteLength(bytes)
      assert.ok(
        savedBytes <= report.resources.budgetBytes,
        'Owned runtime evidence budget exceeded'
      )
      await writeFile(path, bytes)
      return path
    },
    guardEnvironment(path) {
      return {
        SHADERGRADIENT_SSR_GUARD: path,
        NODE_OPTIONS: `--import=${
          pathToFileURL(resolve(root, 'ssr-guard.mjs')).href
        }`,
      }
    },
  }
  let browser
  const deadline = setTimeout(() => interrupt('runtime-deadline'), totalTimeout)
  try {
    run.signal.throwIfAborted()
    await mkdir(root, { recursive: true })
    run.signal.throwIfAborted()
    await mkdir(dirname(reportPath), { recursive: true })
    run.signal.throwIfAborted()
    const guardPath = resolve(root, 'ssr-guard.mjs')
    let guardWrite
    resources.register('temporary:ssr-guard.mjs', async () => {
      await guardWrite?.catch(() => {})
      await rm(guardPath, { force: true })
    })
    guardWrite = run.save('ssr-guard.mjs', ssrGuard)
    await guardWrite
    run.signal.throwIfAborted()
    const require = createRequire(import.meta.url)
    const playwrightPath = require.resolve('@playwright/test')
    const playwrightPackage = require.resolve('@playwright/test/package.json')
    const { chromium } = require('@playwright/test')
    const { PNG } = require('pngjs')
    run.PNG = PNG
    report.controller.playwright = {
      entry: playwrightPath,
      version: JSON.parse(await readFile(playwrightPackage, 'utf8')).version,
    }
    report.controller.pngjs = {
      version: JSON.parse(
        await readFile(require.resolve('pngjs/package.json'), 'utf8')
      ).version,
    }
    report.controller.verifier = {
      path: fileURLToPath(import.meta.url),
      sha256: digest(await readFile(fileURLToPath(import.meta.url))),
    }
    run.signal.throwIfAborted()
    let launchingBrowser
    const closeBrowser = resources.register('browser:chromium', async () => {
      const acquired = await launchingBrowser?.catch(() => null)
      if (!acquired) return
      const process = acquired.process()
      report.controller.browserCleanup = { pid: process.pid, forced: false }
      try {
        await within(
          () => acquired.close(),
          5000,
          'close sole Chromium BrowserServer'
        )
      } catch (error) {
        report.controller.browserCleanup.forced = true
        report.controller.browserCleanup.gracefulError = errorText(error)
        try {
          await within(
            () => acquired.kill(),
            5000,
            'kill sole owned Chromium BrowserServer'
          )
        } catch (killError) {
          if (process.exitCode === null && process.signalCode === null)
            process.kill('SIGKILL')
          try {
            await within(
              () =>
                new Promise((accept) => {
                  if (process.exitCode !== null || process.signalCode !== null)
                    accept()
                  else process.once('exit', accept)
                }),
              3000,
              'reap exact owned Chromium process'
            )
          } finally {
            process.stdout?.destroy()
            process.stderr?.destroy()
            process.unref()
          }
          throw new AggregateError(
            [error, killError],
            'Chromium graceful and public forced cleanup failed',
            { cause: error }
          )
        }
      }
      report.controller.browserCleanup.exitCode = process.exitCode
      report.controller.browserCleanup.signalCode = process.signalCode
    })
    run.signal.throwIfAborted()
    launchingBrowser = chromium.launchServer({
      ...options.launchOptions,
      headless: true,
      timeout,
    })
    const browserServer = await within(
      () => launchingBrowser,
      timeout,
      'launch sole Chromium BrowserServer',
      run.signal
    )
    run.signal.throwIfAborted()
    let connectingBrowser
    const closeConnection = resources.register(
      'browser:chromium-connection',
      async () => {
        await within(
          async () => {
            const connected = await connectingBrowser?.catch(() => null)
            await connected?.close()
          },
          5000,
          'close sole owned Chromium connection'
        )
      }
    )
    run.signal.throwIfAborted()
    connectingBrowser = chromium.connect(browserServer.wsEndpoint(), {
      timeout,
    })
    browser = await within(
      () => connectingBrowser,
      timeout,
      'connect to sole Chromium BrowserServer',
      run.signal
    )
    run.signal.throwIfAborted()
    report.controller.browser = {
      name: 'chromium',
      version: browser.version(),
      transport: 'one-owned-BrowserServer',
      pid: browserServer.process().pid,
      executable:
        options.launchOptions?.executablePath ?? chromium.executablePath(),
      launchOptions: options.launchOptions ?? {},
      scope: 'desktop packed smoke, not F28 multi-engine acceptance',
    }
    for (const [consumerId] of cells) {
      run.signal.throwIfAborted()
      const consumer = prepared.consumers.find((item) => item.id === consumerId)
      const result = {
        id: consumer.id,
        kind: consumer.kind,
        svelteVersion: consumer.svelteVersion,
        status: 'running',
        baseURL: consumer.baseURL,
        root: consumer.root,
        isolation: consumer.evidence.isolation,
        toolchain: consumer.evidence.toolchain,
        artifacts: consumer.artifacts,
        startedAt: new Date().toISOString(),
      }
      report.consumers.push(result)
      await assertFreePort(run, consumer.port)
      run.signal.throwIfAborted()
      const guard = resolve(root, `${consumer.id}-server-ssr-guard.json`)
      const server = startProcess(
        run,
        `${consumer.id}-production`,
        consumer.launch,
        run.guardEnvironment(guard)
      )
      let primary
      try {
        await poll(
          run,
          `${consumer.id}: actual production HTTP readiness`,
          async () => {
            server.assertRunning()
            try {
              const response = await fetch(consumer.baseURL, {
                signal: AbortSignal.any([run.signal, AbortSignal.timeout(800)]),
              })
              await response.arrayBuffer()
              assert.equal(
                response.status,
                200,
                `${consumer.id}: actual production readiness HTTP failure must not be retried`
              )
              return response.status
            } catch (error) {
              run.signal.throwIfAborted()
              if (
                error.cause?.code === 'ECONNREFUSED' ||
                error.name === 'TimeoutError'
              )
                return null
              throw error
            }
          },
          (status) => status === 200
        )
        result.ssr = await verifySSR(run, consumer, guard, browser)
        const coreRoot = await realpath(consumer.artifacts.installed.core.root)
        const coreManifest = JSON.parse(
          await readFile(resolve(coreRoot, 'package.json'), 'utf8')
        )
        assert.equal(coreManifest.name, prepared.packages.core.name)
        const publicImport = coreManifest.exports?.['.']?.import
        assert.ok(
          typeof publicImport === 'string' && publicImport.startsWith('./'),
          'Use the installed pure-core public ESM import condition, not a CJS/private entry'
        )
        const corePath = await realpath(resolve(coreRoot, publicImport))
        assert.ok(
          inside(coreRoot, corePath),
          'Controller reads public core data from this installed candidate, not the checkout'
        )
        const core = await import(pathToFileURL(corePath).href)
        await verifyBrowser(run, browser, consumer, core, result)
        result.ssr.finalServerFetchEvidence = await readGuard(guard)
        server.assertRunning()
        result.status = 'passed'
      } catch (error) {
        primary = error
        run.fail(error)
        result.status = 'failed'
        result.error = errorText(error)
        throw error
      } finally {
        try {
          await releaseOwned(
            [server.stop],
            primary,
            `${consumer.id}: production server cleanup failed`
          )
        } finally {
          result.server = server.evidence()
          result.finishedAt = new Date().toISOString()
        }
      }
    }
    assert.equal(
      browser.contexts().length,
      0,
      'All per-consumer browser contexts must close before releasing the sole worker'
    )
    await closeConnection()
    await closeBrowser()
    run.signal.throwIfAborted()
    report.status = 'passed'
  } catch (error) {
    lifecycle.fail(error)
    report.status = 'failed'
    report.error = errorText(error)
  } finally {
    clearTimeout(deadline)
    const errors = await cleanup()
    report.resources.cleanup = resources.snapshot()
    report.resources.evidenceBytesWritten = savedBytes
    report.finishedAt = new Date().toISOString()
    report.reportPath = reportPath
    if (errors.length) {
      lifecycle.fail(
        new AggregateError(errors, 'Packed runtime cleanup failed')
      )
      report.status = 'failed'
      report.cleanupErrors = errors.map(errorText)
    }
    if (lifecycle.failed) {
      report.status = 'failed'
      report.error = errorText(lifecycle.failure)
    }
    try {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        flag: 'wx',
      })
      // Cancellation can arrive during the final filesystem write. Never
      // publish passed evidence for that call, or replace its original reason.
      if (lifecycle.failed && report.status === 'passed') {
        report.status = 'failed'
        report.error = errorText(lifecycle.failure)
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
      }
    } catch (error) {
      lifecycle.fail(error)
      report.status = 'failed'
      report.error = errorText(lifecycle.failure)
      report.reportWriteError = errorText(error)
    }
  }
  if (lifecycle.failed) {
    const failure = lifecycle.failure
    if (
      (typeof failure === 'object' && failure !== null) ||
      typeof failure === 'function'
    ) {
      try {
        failure.report = report
        failure.reportPath = reportPath
      } catch {
        // Primitive/frozen caller reasons remain the original rejection.
      }
    }
    throw failure
  }
  return report
}

async function main(args) {
  const options = {}
  let verify = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--verify') verify = true
    else if (argument === '--prepare-only') verify = false
    else if (
      argument === '--reuse-manifest' ||
      argument === '--artifact-root' ||
      argument === '--manifest'
    ) {
      const value = args[++index]
      assert.ok(
        value && !value.startsWith('--'),
        `${argument} requires an absolute path`
      )
      assert.ok(isAbsolute(value), `${argument} requires an absolute path`)
      options[
        argument === '--reuse-manifest'
          ? 'reuseManifest'
          : argument === '--artifact-root'
            ? 'artifactRoot'
            : 'manifestPath'
      ] = value
    } else if (argument === '--help') {
      console.log(
        'node tests/browser/prepare-svelte.mjs [--prepare-only|--verify] [--reuse-manifest ABSOLUTE_PATH] [--artifact-root ABSOLUTE_PATH] [--manifest ABSOLUTE_PATH]\nDefault: prepare only. --verify reuses that one actual manifest for serial production HTTP/compiled SSR/Chromium/HDR/Source/View/lifecycle qualification. Existing evidence is retained inside the owned artifact root; no import starts services.'
      )
      return
    } else
      throw new Error(`Unknown packed Svelte preparation argument: ${argument}`)
  }
  const abort = new AbortController()
  const interrupt = (signal) => {
    const error = new Error(
      `Packed Svelte qualification interrupted by ${signal}`
    )
    error.code = signal
    abort.abort(error)
  }
  const onINT = () => interrupt('SIGINT')
  const onTERM = () => interrupt('SIGTERM')
  process.once('SIGINT', onINT)
  process.once('SIGTERM', onTERM)
  options.signal = abort.signal
  try {
    const prepared = await prepareSvelteBrowserConsumers(options)
    abort.signal.throwIfAborted()
    const report = verify
      ? await verifyPreparedNativeConsumers(prepared, { signal: abort.signal })
      : null
    abort.signal.throwIfAborted()
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          mode: verify ? 'verified' : 'prepared',
          manifestPath: prepared.manifestPath,
          candidateFingerprint: prepared.candidate.fingerprint,
          ...(report
            ? { reportPath: report.reportPath, status: report.status }
            : {}),
          consumers: prepared.consumers.map(({ id, baseURL, launch }) => ({
            id,
            baseURL,
            launch,
          })),
        },
        null,
        2
      )
    )
  } finally {
    process.removeListener('SIGINT', onINT)
    process.removeListener('SIGTERM', onTERM)
  }
}

function printFailure(error, seen = new Set()) {
  if (seen.has(error)) return
  seen.add(error)
  console.error(errorText(error))
  if (error?.reportPath)
    console.error(`Actual packed runtime failure evidence: ${error.reportPath}`)
  if (error?.cause) {
    console.error('Original cause:')
    printFailure(error.cause, seen)
  }
  for (const nested of error?.errors ?? []) {
    if (seen.has(nested)) continue
    console.error('Failure/cleanup member:')
    printFailure(nested, seen)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    printFailure(error)
    process.exitCode =
      error?.code === 'SIGINT' ? 130 : error?.code === 'SIGTERM' ? 143 : 1
  })
}
