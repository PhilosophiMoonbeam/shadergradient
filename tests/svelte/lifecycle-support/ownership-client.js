import { mount, unmount } from 'svelte'
import OwnershipApp from './OwnershipApp.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('Ownership fixture requires an #app mount target.')
const app = mount(OwnershipApp, { target })

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void unmount(app)
  })
}
