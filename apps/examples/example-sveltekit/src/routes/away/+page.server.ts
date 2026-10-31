import type { PageServerLoad } from './$types'

export const load = (({ url }) => {
  const preset = url.searchParams.get('preset') ?? 'halo'
  const request = url.searchParams.get('request') ?? 'welcome'
  return { returnTo: `/?${new URLSearchParams({ preset, request })}` }
}) satisfies PageServerLoad
