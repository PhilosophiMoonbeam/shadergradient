import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const matrix = JSON.parse(
  await readFile(join(fixtureRoot, 'matrix.json'), 'utf8')
)
const options = {
  consumerRoot: resolve(fixtureRoot, '../../../apps/example-svelte-dev'),
  case: 'all',
}
const valueFlags = new Map([
  ['--consumer-root', 'consumerRoot'],
  ['--case', 'case'],
  ['--expect-svelte', 'expectSvelte'],
  ['--artifact-id', 'artifactId'],
  ['--report', 'report'],
])
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index]
  if (flag === '--list' || flag === '--help') {
    options[flag.slice(2)] = true
    continue
  }
  const key = valueFlags.get(flag)
  assert.ok(key, `Unknown option ${flag}; use --help`)
  const value = process.argv[++index]
  assert.ok(value && !value.startsWith('--'), `Missing value for ${flag}`)
  options[key] = value
}
if (options.help) {
  console.info(
    'Public generated-declaration Svelte consumer matrix (no installs/builds).'
  )
  for (const [flag, description] of Object.entries(matrix.runner.flags)) {
    console.info(`${flag}\n  ${description}`)
  }
  console.info('\nParent prerequisites:')
  for (const prerequisite of matrix.prerequisites)
    console.info(`  ${prerequisite}`)
  console.info('\nExamples:')
  for (const invocation of matrix.runner.invocations)
    console.info(`  ${invocation}`)
} else if (options.list) {
  console.info(
    ['positive', ...matrix.negative.map((entry) => entry.id)].join('\n')
  )
} else {
  await main()
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function resolveEsm(specifier, directory, packageMetadata = false) {
  // Node's ESM eval parent is rooted at cwd. Match the real Svelte consumer's
  // customConditions without the experimental import.meta.resolve parent
  // argument, writing into dependency trees, or importing native components.
  const source = `
    import assert from 'node:assert/strict'
    import { dirname } from 'node:path'
    import { fileURLToPath } from 'node:url'
    assert.equal(dirname(fileURLToPath(import.meta.url)), process.cwd())
    const [specifier, kind] = process.argv.slice(1)
    let url
    if (kind === 'package') {
      try {
        url = import.meta.resolve(specifier + '/package.json')
      } catch (error) {
        if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
        url = import.meta.resolve(specifier)
      }
    } else {
      url = import.meta.resolve(specifier)
    }
    process.stdout.write(JSON.stringify({ url, parentURL: import.meta.url, mode: 'node-esm-import', customConditions: ['svelte'] }))
  `
  return new Promise((resolveEntry, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--conditions=svelte',
        '--input-type=module',
        '--eval',
        source,
        '--',
        specifier,
        packageMetadata ? 'package' : 'module',
      ],
      {
        cwd: directory,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      try {
        assert.equal(signal, null, `ESM resolution terminated for ${specifier}`)
        assert.equal(
          exitCode,
          0,
          `ESM resolution failed for ${specifier} from ${directory}\n${stderr}`
        )
        const resolved = JSON.parse(stdout)
        assert.ok(
          resolved.url.startsWith('file:'),
          `Expected installed file resolution for ${specifier}`
        )
        resolveEntry(resolved)
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function packageInfo(name, parentDirectory) {
  const resolution = await resolveEsm(name, parentDirectory, true)
  const entry = fileURLToPath(resolution.url)
  let directory = dirname(await realpath(entry))
  for (;;) {
    try {
      const manifestPath = join(directory, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (manifest.name === name)
        return { directory, manifestPath, manifest, resolution }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
    const parent = dirname(directory)
    assert.notEqual(
      parent,
      directory,
      `Cannot locate manifest for ${name} from ${entry}`
    )
    directory = parent
  }
}

function identity(info) {
  return {
    name: info.manifest.name,
    version: info.manifest.version,
    manifest: info.manifestPath,
    resolution: info.resolution,
  }
}

async function consumerContext(consumerRoot) {
  const requireFrom = createRequire(join(consumerRoot, 'package.json'))
  const infos = {}
  for (const name of [
    '@shadergradient/svelte',
    'svelte',
    '@threlte/core',
    'three',
    '@types/three',
    'typescript',
    'svelte-check',
  ]) {
    infos[name] = await packageInfo(name, consumerRoot)
  }
  // Core may be a correctly installed transitive dependency, not a host root
  // dependency. Identify the actual copy used by native, without adding aliases.
  infos['@shadergradient/core'] = await packageInfo(
    '@shadergradient/core',
    infos['@shadergradient/svelte'].directory
  )
  const svelteVersion = infos.svelte.manifest.version
  assert.ok(
    matrix.bounds.svelte.includes(svelteVersion),
    `Unsupported qualification context Svelte ${svelteVersion}; select ${matrix.bounds.svelte.join(', ')}`
  )
  if (options.expectSvelte)
    assert.equal(
      svelteVersion,
      options.expectSvelte,
      'Actual consumer Svelte differs from requested compiler'
    )
  for (const name of [
    '@threlte/core',
    'three',
    '@types/three',
    'typescript',
    'svelte-check',
  ]) {
    assert.equal(
      infos[name].manifest.version,
      matrix.bounds[name],
      `Actual ${name} must match the selected F03/F22 evidence pin`
    )
  }
  const compilerResolution = await resolveEsm('svelte/compiler', consumerRoot)
  const compilerPath = fileURLToPath(compilerResolution.url)
  const compiler = await import(compilerResolution.url)
  assert.equal(
    compiler.VERSION,
    svelteVersion,
    'Consumer compiler implementation differs from manifest version'
  )

  // A symlink to a current-only SDK must not masquerade as lower-peer evidence.
  // Check the actual package/tool dependency contexts, not just the host manifest.
  const dependencyContexts = {}
  for (const owner of ['@shadergradient/svelte', 'svelte-check']) {
    const ownerDirectory = infos[owner].directory
    const names =
      owner === 'svelte-check'
        ? ['svelte', 'typescript']
        : ['svelte', '@threlte/core', 'three', '@shadergradient/core']
    dependencyContexts[owner] = {}
    for (const name of names) {
      const resolved = await packageInfo(name, ownerDirectory)
      assert.equal(
        resolved.manifest.version,
        infos[name].manifest.version,
        `${owner} resolves a different ${name} than consumerRoot`
      )
      dependencyContexts[owner][name] = identity(resolved)
    }
  }
  const ts = requireFrom('typescript')
  const checkBin = infos['svelte-check'].manifest.bin
  const binPath =
    typeof checkBin === 'string' ? checkBin : checkBin['svelte-check']
  assert.equal(
    typeof binPath,
    'string',
    'Installed svelte-check has no CLI entry'
  )
  const nativeExport =
    infos['@shadergradient/svelte'].manifest.exports?.['.']?.types
  assert.equal(
    typeof nativeExport,
    'string',
    'Native package must expose generated types through its public root export'
  )
  const declaredEntry = await realpath(
    resolve(infos['@shadergradient/svelte'].directory, nativeExport)
  )
  assert.ok(
    declaredEntry.endsWith('.d.ts'),
    'Native public types export is not a generated declaration'
  )
  assert.ok(
    relative(
      infos['@shadergradient/svelte'].directory,
      declaredEntry
    ).startsWith('dist/'),
    'Native public types must resolve the built dist output, not private source'
  )
  const lockfiles = {}
  for (const name of [
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lock',
  ]) {
    try {
      lockfiles[name] = hash(await readFile(join(consumerRoot, name)))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return {
    ts,
    checkPath: resolve(infos['svelte-check'].directory, binPath),
    declaredEntry,
    evidence: {
      consumerRoot,
      node: process.version,
      packages: Object.fromEntries(
        Object.entries(infos).map(([name, info]) => [name, identity(info)])
      ),
      compiler: {
        path: await realpath(compilerPath),
        version: compiler.VERSION,
        resolution: compilerResolution,
      },
      dependencyContexts,
      nativeTypes: {
        path: declaredEntry,
        sha256: hash(await readFile(declaredEntry)),
      },
      lockfiles,
    },
  }
}

function parseDiagnostics(stdout) {
  const diagnostics = []
  const failures = []
  let summary
  for (const line of stdout.split(/\r?\n/)) {
    const payload = /^\d+ (.*)$/.exec(line)?.[1]
    if (!payload) continue
    if (payload.startsWith('{')) {
      const diagnostic = JSON.parse(payload)
      if (diagnostic.type === 'ERROR' || diagnostic.type === 'WARNING')
        diagnostics.push(diagnostic)
    } else if (payload.startsWith('FAILURE ')) {
      failures.push(payload)
    } else {
      const completed =
        /^COMPLETED (\d+) FILES (\d+) ERRORS (\d+) WARNINGS (\d+) FILES_WITH_PROBLEMS$/.exec(
          payload
        )
      if (completed)
        summary = {
          files: Number(completed[1]),
          errors: Number(completed[2]),
          warnings: Number(completed[3]),
          filesWithProblems: Number(completed[4]),
        }
    }
  }
  return { diagnostics, failures, summary }
}

async function check(checkPath, caseRoot, configPath) {
  const args = [
    checkPath,
    '--workspace',
    caseRoot,
    '--tsconfig',
    join(caseRoot, 'tsconfig.json'),
    '--config',
    configPath,
    '--output',
    'machine-verbose',
    '--fail-on-warnings',
  ]
  return new Promise((resolveCheck, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: caseRoot,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      try {
        resolveCheck({
          command: [process.execPath, ...args],
          exitCode,
          signal,
          stdout,
          stderr,
          ...parseDiagnostics(stdout),
        })
      } catch (error) {
        reject(error)
      }
    })
  })
}

function assertDiagnostics(result, entry, caseRoot, source) {
  assert.equal(result.signal, null, 'Compiler terminated by a signal')
  assert.deepEqual(result.failures, [], 'Compiler reported a tooling failure')
  assert.ok(
    result.summary,
    'Compiler did not emit a complete machine-verbose summary'
  )
  assert.ok(result.summary.files > 0, 'Compiler did not check any files')
  const errors = result.diagnostics.filter(
    (diagnostic) => diagnostic.type === 'ERROR'
  )
  const warnings = result.diagnostics.filter(
    (diagnostic) => diagnostic.type === 'WARNING'
  )
  assert.equal(errors.length, result.summary.errors, 'Incomplete error output')
  assert.equal(
    warnings.length,
    result.summary.warnings,
    'Incomplete warning output'
  )
  assert.equal(warnings.length, 0, 'Unexpected compiler warning')
  if (entry.id === 'positive') {
    assert.equal(result.exitCode, 0, 'Positive public consumer did not compile')
    assert.equal(errors.length, 0, 'Positive consumer has diagnostics')
    return
  }
  assert.equal(
    result.exitCode,
    1,
    'Negative case must fail from diagnostics, not pass/crash'
  )
  assert.ok(
    errors.length > 0,
    'Negative fixture failed without an intended diagnostic'
  )
  const lines = source.split('\n')
  const matchingLines = lines.flatMap((line, index) =>
    line.includes(entry.expected.anchor) ? [index] : []
  )
  assert.equal(
    matchingLines.length,
    1,
    `Expected expression must uniquely identify ${entry.id}`
  )
  const targetLine = matchingLines[0]
  for (const diagnostic of errors) {
    // 4.7.7 machine-verbose ranges are LSP-style, zero-based; do not match wording.
    const filename = diagnostic.filename ?? diagnostic.fn
    assert.equal(typeof filename, 'string', 'Diagnostic has no source filename')
    assert.equal(
      resolve(caseRoot, filename),
      join(caseRoot, 'Consumer.svelte'),
      'Diagnostic is outside the isolated negative fixture'
    )
    assert.equal(
      diagnostic.source,
      entry.expected.source,
      'Diagnostic is not the intended TypeScript kind'
    )
    assert.ok(
      entry.expected.codes.includes(Number(diagnostic.code)),
      `Unexpected diagnostic kind ${diagnostic.code} for ${entry.id}`
    )
    assert.ok(
      diagnostic.start.line <= targetLine && diagnostic.end.line >= targetLine,
      `Diagnostic is outside the intended expression for ${entry.id}`
    )
  }
}

async function runCase(entry, temporaryRoot, context) {
  const caseRoot = join(temporaryRoot, entry.id)
  await mkdir(caseRoot)
  const files = entry.id === 'positive' ? entry.files : [entry.file]
  const fixtureHashes = {}
  let negativeSource
  for (const file of files) {
    const destination = join(
      caseRoot,
      entry.id === 'positive'
        ? file.slice('positive/'.length)
        : 'Consumer.svelte'
    )
    await copyFile(join(fixtureRoot, file), destination)
    const content = await readFile(destination, 'utf8')
    fixtureHashes[file] = hash(content)
    if (entry.id !== 'positive') negativeSource = content
  }
  const tsconfig = JSON.parse(
    await readFile(join(fixtureRoot, 'tsconfig.json'), 'utf8')
  )
  tsconfig.include = ['**/*.svelte', '**/*.ts']
  await writeFile(
    join(caseRoot, 'tsconfig.json'),
    `${JSON.stringify(tsconfig, null, 2)}\n`
  )
  const converted = context.ts.convertCompilerOptionsFromJson(
    tsconfig.compilerOptions,
    caseRoot
  )
  assert.equal(
    converted.errors.length,
    0,
    'Invalid isolated TypeScript configuration'
  )
  assert.equal(
    converted.options.paths,
    undefined,
    'Public consumers must not use paths aliases'
  )
  const resolution = context.ts.resolveModuleName(
    '@shadergradient/svelte',
    join(caseRoot, 'consumer.ts'),
    converted.options,
    context.ts.sys
  ).resolvedModule
  assert.ok(
    resolution,
    'Public native package does not resolve from the actual consumer context'
  )
  const resolvedDeclaration = await realpath(resolution.resolvedFileName)
  assert.equal(
    resolvedDeclaration,
    context.declaredEntry,
    'Public import bypassed the generated package types export'
  )
  const result = await check(
    context.checkPath,
    caseRoot,
    join(temporaryRoot, 'svelte.config.js')
  )
  const evidence = {
    id: entry.id,
    fixtureHashes,
    resolvedDeclaration,
    expected: entry.expected ?? { errors: 0, warnings: 0 },
    ...result,
  }
  try {
    assertDiagnostics(result, entry, caseRoot, negativeSource)
    return { ...evidence, passed: true }
  } catch (error) {
    return { ...evidence, passed: false, failure: error.message }
  }
}

async function main() {
  const selected =
    options.case === 'all'
      ? [matrix.positive, ...matrix.negative]
      : [matrix.positive, ...matrix.negative].filter(
          (entry) => entry.id === options.case
        )
  assert.ok(selected.length, `Unknown case ${options.case}; use --list`)
  const report = {
    schemaVersion: 1,
    scope: matrix.scope,
    artifactId: options.artifactId ?? null,
    requestedCase: options.case,
    cases: [],
    passed: false,
  }
  let temporaryRoot
  try {
    const consumerRoot = await realpath(resolve(options.consumerRoot))
    const context = await consumerContext(consumerRoot)
    report.context = context.evidence
    // Copy, never symlink: imports must resolve inside the installed host consumer.
    temporaryRoot = await mkdtemp(join(consumerRoot, '.shadergradient-types-'))
    await writeFile(
      join(temporaryRoot, 'package.json'),
      '{"private":true,"type":"module"}\n'
    )
    await copyFile(
      join(fixtureRoot, 'svelte.config.js'),
      join(temporaryRoot, 'svelte.config.js')
    )
    for (const entry of selected) {
      try {
        report.cases.push(await runCase(entry, temporaryRoot, context))
      } catch (error) {
        report.cases.push({
          id: entry.id,
          passed: false,
          failure: error.stack ?? error.message,
        })
      }
    }
    report.passed = report.cases.every((entry) => entry.passed)
  } catch (error) {
    report.failure = error.stack ?? error.message
  } finally {
    // Never delete a caller-selected path or any shared app/config/dependency tree.
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
    const json = `${JSON.stringify(report, null, 2)}\n`
    if (options.report) {
      const destination = isAbsolute(options.report)
        ? options.report
        : resolve(options.report)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, json)
    }
    process.stdout.write(json)
    if (!report.passed) process.exitCode = 1
  }
}
