// Demo URL editing only: validation and effective settings remain SDK-owned.
// Preserve first-entry URLSearchParams semantics, encoded colors and fragments
// exactly as the documented query input accepts them.
export function demoSearchParams(input = ''): URLSearchParams {
  const fragment = input.indexOf('#')
  const text = fragment === -1 ? input : input.slice(0, fragment)
  const question = text.indexOf('?')
  const query =
    question !== -1
      ? text.slice(question + 1)
      : text.includes('/') || text.includes('://')
      ? ''
      : text
  return new URLSearchParams(query)
}

export function patchDemoSearchParams(
  input: string | undefined,
  patch: object
): string {
  const query = demoSearchParams(input)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) query.delete(key)
    else query.set(key, String(value))
  }
  return query.toString()
}
