import { randomUUID } from 'node:crypto'
import { open, unlink } from 'node:fs/promises'
import type { TestInfo } from '@playwright/test'

export async function attachEvidence(
  info: TestInfo,
  name: string,
  options: { body: string | Buffer; contentType: string }
): Promise<void> {
  const scratch = info.outputPath(`.evidence-${randomUUID()}`)
  const file = await open(scratch, 'wx')
  let failed = false
  let failure: unknown
  try {
    await file.writeFile(options.body)
    await file.close()
    // Public attach copies the file before resolving; only our scratch is removed.
    await info.attach(name, { path: scratch, contentType: options.contentType })
  } catch (error) {
    failed = true
    failure = error
  } finally {
    // Attempt both cleanup operations without replacing the first failure.
    try {
      await file.close()
    } catch (error) {
      if (!failed) {
        failed = true
        failure = error
      }
    }
    try {
      await unlink(scratch)
    } catch (error) {
      if (!failed) {
        failed = true
        failure = error
      }
    }
  }
  if (failed) throw failure
}
