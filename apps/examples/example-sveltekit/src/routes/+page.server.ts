import { presets } from '@shadergradient/core'
import type { PresetName } from '@shadergradient/svelte'
import type { PageServerLoad } from './$types'

export const load = (({ url }) => {
  const requestedPreset = url.searchParams.get('preset') ?? 'halo'
  const preset: PresetName = Object.hasOwn(presets, requestedPreset)
    ? (requestedPreset as PresetName)
    : 'halo'
  const requestLabel =
    url.searchParams.get('request')?.trim().slice(0, 80) || 'welcome'

  // Every value is returned to this request; neither presets nor shared state is mutated.
  return {
    preset,
    requestLabel,
    title: presets[preset].title,
  }
}) satisfies PageServerLoad
