import type { GradientSettingsInput } from '@shadergradient/svelte'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ url }) => {
  // Each request returns its own serializable settings. Nothing is retained on the server.
  const requestLabel = url.searchParams.get('request') ?? 'native-kit'
  const color = url.searchParams.get('color1')
  const color1 = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#ff5005'
  const initialSettings: GradientSettingsInput = {
    color1,
    control: 'query',
    urlString: url.search,
  }
  return { requestLabel, initialSettings, requestQuery: url.search }
}
