# Runnable Skeleton 5 / Svelte 5 recipes

Targets core and component packages **5.0.1**, Svelte **5.57.2**, Tailwind **4.3.3**, and SvelteKit **3.1+** exclusively. The exact tested baseline uses Kit **3.1.0**; later Kit releases require matching dependency and source checks rather than assumed certification. Each Svelte fence is a complete standalone component. Import global Tailwind, Skeleton core, Skeleton Svelte root styles, and an activated theme first; native form classes also require `@tailwindcss/forms`. No icon dependency is needed. Mount a component in a page or copy its contents into `+page.svelte`.

- [State, callbacks, and snippets](#state-callbacks-and-snippets)
- [Tabs: controlled local panels](#tabs-controlled-local-panels)
- [Accordion: collapsible FAQ](#accordion-collapsible-faq)
- [Switch and native inputs: one state model, two APIs](#switch-and-native-inputs-one-state-model-two-apis)
- [Floating help: tooltip](#floating-help-tooltip)
- [Dialog strategy: Dialog, including drawer styling](#dialog-strategy-dialog-including-drawer-styling)
- [Toast strategy: create a store and mount a renderer](#toast-strategy-create-a-store-and-mount-a-renderer)
- [Combobox: searchable local selection](#combobox-searchable-local-selection)
- [Pagination: controlled local table](#pagination-controlled-local-table)
- [Optional Lucide icons and icon triggers](lucide.md#accessible-icons-and-controls)

For icon tasks, use the [Lucide reference](lucide.md): install/import boundaries, accessible controls, finite runtime selection, subtree defaults, and custom icons. Its complete `IconTooltip.svelte` demonstrates a Skeleton element-snippet icon trigger. The eight recipes below remain usable without an icon dependency.

## State, callbacks, and snippets

The recipe controls use props and callbacks; their 5.0.1 state props are not bindable. Native inputs still use Svelte bindings. Composition is ordinary children plus named anatomy, not the old wrapper snippet props.

| Component | Controlled prop | Callback payload |
| --- | --- | --- |
| Tabs | `value: string` | `onValueChange(e)` → `e.value` |
| Accordion | `value: string[]` | `onValueChange(e)` → `e.value` |
| Switch | `checked: boolean` | `onCheckedChange(e)` → `e.checked` |
| Tooltip, Popover, Dialog | `open: boolean` | `onOpenChange(e)` → `e.open` |
| Combobox | `value: string[]` | `onValueChange(e)` → `e.value` |
| Pagination | `page: number`, `pageSize: number` | `onPageChange(e)` → `e.page`/`e.pageSize`; `onPageSizeChange(e)` → `e.pageSize` |

Use `.Context` with `children(api)` for API access; `api` is a getter. Toast.Group is different: its children snippet receives a toast record. An `element(attributes)` snippet replaces an internal element and must spread all attributes onto a semantically valid replacement. Never nest a button inside a trigger.

Skeleton/Zag supplies supported keyboard/focus behavior and generated IDs. Keep names, state updates, contrast, persistence, validation, and fetching application-owned. Machine effects and portals start on the client, not during SSR. Keep initial state consistent across server/client. Roots generate hydration-stable IDs; custom associations use `$props.id()`. These examples are instance-owned, start floating surfaces closed, and make no server mutations. Local state resets when the component is recreated.

Sources: [fundamentals](https://www.skeleton.dev/docs/svelte/get-started/fundamentals.md), [5.0.1 declarations](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/index.d.ts), [shipped components](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/).

## Tabs: controlled local panels

Matching trigger/content values establish panel associations. These are local panels, not route links.

**File: `TabsExample.svelte`**
```svelte
<script lang="ts">
  import { Tabs } from '@skeletonlabs/skeleton-svelte';
  let selected = $state('overview');
</script>

<section class="space-y-4">
  <h2 class="h2">Project details</h2>
  <Tabs value={selected} onValueChange={(e) => (selected = e.value)}>
    <Tabs.List aria-label="Project details">
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
      <Tabs.Indicator />
    </Tabs.List>
    <Tabs.Content value="overview"><p>Project overview.</p></Tabs.Content>
    <Tabs.Content value="activity"><p>Recent project activity.</p></Tabs.Content>
  </Tabs>
  <p>Selected panel: {selected}</p>
</section>
```

Click Activity to select its panel. Left/Right move focus and, by default, automatically activate tabs; Home/End move to the first/last. With `activationMode="manual"`, Enter/Space activates the focused tab. Preserve the generated trigger roles/handlers and test duplicate instances without cross-associations.

Sources: [Tabs](https://www.skeleton.dev/docs/svelte/framework-components/tabs.md), [5.0.1 anatomy](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/tabs/modules/anatomy.d.ts), [ARIA Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

## Accordion: collapsible FAQ

Use actual headings at the correct document level; the trigger itself remains the button.

**File: `AccordionExample.svelte`**
```svelte
<script lang="ts">
  import { Accordion } from '@skeletonlabs/skeleton-svelte';
  let expanded = $state<string[]>(['billing']);
</script>

<section class="space-y-4">
  <h2 class="h2">Frequently asked questions</h2>
  <Accordion value={expanded} onValueChange={(e) => (expanded = e.value)} collapsible>
    <Accordion.Item value="billing">
      <h3><Accordion.ItemTrigger>When am I billed?</Accordion.ItemTrigger></h3>
      <Accordion.ItemContent><p>Billing occurs on the first day of each month.</p></Accordion.ItemContent>
    </Accordion.Item>
    <Accordion.Item value="cancel">
      <h3><Accordion.ItemTrigger>Can I cancel?</Accordion.ItemTrigger></h3>
      <Accordion.ItemContent><p>You can cancel from your account settings.</p></Accordion.ItemContent>
    </Accordion.Item>
  </Accordion>
  <p>Expanded sections: {expanded.join(', ') || 'none'}</p>
</section>
```

Enter/Space toggles a header; Up/Down and Home/End move between headers. `collapsible` allows `[]`; add `multiple` for independent expansion. Plain ItemContent stays mounted and hidden when closed, retaining child state. A conditional element snippet can intentionally unmount content for transitions; see [composition patterns](components.md#six-supported-composition-patterns).

For simple disclosures, prefer native `<details class="disclosure">` with `<summary>` and `.disclosure-content`. Exclusive native groups use `.disclosure-group` and a shared `name` derived from `$props.id()` for each group instance; do not reuse a global group name across unrelated instances. Browser support governs native grouping and optional animations.

Sources: [Accordion](https://www.skeleton.dev/docs/svelte/framework-components/accordion.md), [5.0.1 content source](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/accordion/anatomy/item-content.svelte), [native disclosures](https://www.skeleton.dev/docs/svelte/tailwind-components/disclosures.md).

## Switch and native inputs: one state model, two APIs

Switch is already a label. Its explicit HiddenInput retains native form participation; unchecked controls are omitted from FormData.

**File: `PreferencesForm.svelte`**
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Switch } from '@skeletonlabs/skeleton-svelte';
  let displayName = $state('Ada');
  let frequency = $state('weekly');
  let notifications = $state(false);
  let submitted = $state('');
  let ready = $state(false);
  onMount(() => { ready = true; });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    submitted = `${data.get('displayName')} / ${data.get('frequency')} / notifications: ${data.has('notifications')}`;
  }
</script>

<form class="max-w-md space-y-4" onsubmit={submit}>
  <label class="label">
    <span>Display name</span>
    <input class="input" name="displayName" required bind:value={displayName} />
  </label>
  <label class="label">
    <span>Summary frequency</span>
    <select class="select" name="frequency" bind:value={frequency}>
      <option value="daily">Daily</option>
      <option value="weekly">Weekly</option>
    </select>
  </label>
  <Switch name="notifications" checked={notifications} onCheckedChange={(e) => (notifications = e.checked)}>
    <Switch.Control><Switch.Thumb /></Switch.Control>
    <Switch.Label>Enable notifications</Switch.Label>
    <Switch.HiddenInput />
  </Switch>
  <p>Notifications: {notifications ? 'on' : 'off'}</p>
  <button type="submit" disabled={!ready} class="btn preset-filled-primary-500">Review preferences</button>
  <p role="status">{submitted}</p>
  <p class="text-sm">JavaScript is required to review this local form; nothing is saved.</p>
</form>
```

Click the label or press Space on the switch: state and submitted FormData must agree. Do not wrap Switch in another label or use `bind:checked` on it. Review preferences remains disabled until mount, preventing this local form from leaking values through an unenhanced GET. Replace the local handler with a real SvelteKit action for persistence; keep native validation and server error handling.

Sources: [Switch](https://www.skeleton.dev/docs/svelte/framework-components/switch.md), [5.0.1 hidden input](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/switch/anatomy/hidden-input.svelte), [native forms](https://www.skeleton.dev/docs/svelte/tailwind-components/forms.md), [Svelte bindings](https://svelte.dev/docs/svelte/bind).

## Floating help: tooltip

Tooltip contains supplemental, noninteractive text. Style its actual anatomy; Portal keeps its positioner outside clipping ancestors.

**File: `FloatingHelp.svelte`**
```svelte
<script lang="ts">
  import { Portal, Tooltip } from '@skeletonlabs/skeleton-svelte';
</script>

<Tooltip positioning={{ placement: 'top' }} openDelay={200}>
  <Tooltip.Trigger type="button" class="btn preset-tonal-primary" aria-label="Keyboard shortcuts help">
    Keyboard shortcuts
  </Tooltip.Trigger>
  <Portal>
    <Tooltip.Positioner class="z-50">
      <Tooltip.Content class="card preset-filled-surface-100-900 p-3 shadow-xl">
        Press Tab to move between controls.
      </Tooltip.Content>
    </Tooltip.Positioner>
  </Portal>
</Tooltip>
```

Hover/focus shows help; Escape dismisses it. Keep the trigger's accessible name and focus treatment. Essential instructions stay visible outside the tooltip. For interactive click-triggered content use Popover with its Title/Description and explicit Portal, or Dialog; do not place controls in a tooltip.

Sources: [Tooltip](https://www.skeleton.dev/docs/svelte/framework-components/tooltip.md), [Popover](https://www.skeleton.dev/docs/svelte/framework-components/popover.md), [5.0.1 tooltip anatomy](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/tooltip/modules/anatomy.d.ts).

## Dialog strategy: Dialog, including drawer styling

Title and Description anatomy supply associations. This headless Dialog explicitly supplies backdrop, position, surface, viewport limits, and stacking; it adds no motion.

**File: `ConfirmDialog.svelte`**
```svelte
<script lang="ts">
  import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
  let open = $state(false);
  let archived = $state(false);
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
  <Dialog.Trigger type="button" class="btn preset-tonal-primary">Archive project</Dialog.Trigger>
  <Portal>
    <Dialog.Backdrop class="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
      <Dialog.Content class="card preset-filled-surface-100-900 max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-4 overflow-y-auto p-6 shadow-xl">
        <Dialog.Title class="h2">Archive this project?</Dialog.Title>
        <Dialog.Description>This example changes local state only.</Dialog.Description>
        <div class="flex flex-wrap justify-end gap-3">
          <Dialog.CloseTrigger type="button" class="btn preset-tonal-primary">Cancel</Dialog.CloseTrigger>
          <button type="button" class="btn preset-filled-primary-500" onclick={() => { archived = true; open = false; }}>
            Confirm archive
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Positioner>
  </Portal>
</Dialog>
<p role="status">{archived ? 'Project archived in this example.' : 'Project is active.'}</p>
```

Preserve default modal focus containment, scroll prevention, Escape/outside dismissal, and focus restoration. Open by keyboard, cycle Tab/Shift+Tab, close with Cancel/Escape/confirmation, and check focus returns to the trigger. For destructive real mutations, choose an appropriate initial focus target, await the server result, and announce success only after success.

A drawer is styled Dialog, not a Drawer export: align Positioner to the start, use a constrained sidebar width and `100dvh` height, and retain naming, close controls, viewport fit, and focus behavior. Keep it motion-free by default; optional JavaScript transitions must subscribe to reduced-motion preferences after mount and clean up.

For simpler modal requirements, native `<dialog class="dialog">` with `showModal()`/`close()` already provides top-layer/modal behavior. Use `$props.id()`-prefixed `aria-labelledby`/`aria-describedby` targets and a real close control. Invoker commands and newer light-dismiss features are support-dependent enhancements, not a reason to invent framework APIs.

Sources: [Dialog](https://www.skeleton.dev/docs/svelte/framework-components/dialog.md), [5.0.1 anatomy](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/dialog/modules/anatomy.d.ts), [native dialogs](https://www.skeleton.dev/docs/svelte/tailwind-components/dialogs.md).

## Toast strategy: create a store and mount a renderer

The store belongs to this component instance. Toast.Group's snippet receives a toast record, not an API getter.

**File: `ToastExample.svelte`**
```svelte
<script lang="ts">
  import { Portal, Toast, createToaster } from '@skeletonlabs/skeleton-svelte';
  const toaster = createToaster({ placement: 'bottom-end' });
</script>

<Portal>
  <Toast.Group {toaster} class="z-[60]">
    {#snippet children(toast)}
      <Toast {toast} class="card preset-filled-surface-100-900 flex max-w-sm items-start gap-4 p-4 shadow-xl">
        <Toast.Message>
          <Toast.Title class="font-bold">{toast.title}</Toast.Title>
          <Toast.Description>{toast.description}</Toast.Description>
        </Toast.Message>
        <Toast.CloseTrigger type="button" class="btn preset-tonal-primary" aria-label="Dismiss notification">Close</Toast.CloseTrigger>
      </Toast>
    {/snippet}
  </Toast.Group>
</Portal>
<button type="button" class="btn preset-filled-primary-500" onclick={() => toaster.info({
  title: 'Notification example',
  description: 'Triggered by the notification button.'
})}>Show notification</button>
```

Each click creates a message; Close dismisses it. `.info`, `.success`, `.warning`, `.error`, and `.create` are supported; `duration: Infinity` prevents automatic expiry. Use Toast.ActionTrigger when providing an action, and keep permanent errors/actionable details inline too.

Each `createToaster()` call creates independent mutable state; it is not an enforced singleton. For app-wide messages, create one store in a layout instance, distribute it through Svelte context, and render one group for that store. Never mutate a request-shared server-module store with user-specific notifications. Trigger notifications from client interactions, not SSR.

Sources: [Toast](https://www.skeleton.dev/docs/svelte/framework-components/toast.md), [5.0.1 group source](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/toast/anatomy/group.svelte), [Zag store](https://unpkg.com/@zag-js/toast@1.43.0/dist/toast.store.js), [SSR state isolation](https://svelte.dev/docs/kit/state-management#Avoid-shared-state-on-the-server).

## Combobox: searchable local selection

Application-owned filtering creates a real empty result. Stable values, not labels, identify options. Selected-record lookup uses the complete data, independent of the currently filtered collection.

**File: `SearchableCombobox.svelte`**
```svelte
<script lang="ts">
  import { Combobox, Portal, useListCollection } from '@skeletonlabs/skeleton-svelte';
  const projects = [
    { label: 'Atlas design system', value: 'atlas', category: 'Design' },
    { label: 'Beacon dashboard', value: 'beacon', category: 'Analytics' },
    { label: 'Cedar documentation', value: 'cedar', category: 'Content' },
    { label: 'Delta storefront', value: 'delta', category: 'Commerce' }
  ];
  let items = $state(projects);
  let selected = $state<string[]>([]);
  const collection = $derived(useListCollection({
    items,
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value
  }));
  const selectedProject = $derived(projects.find((project) => project.value === selected[0]));
</script>

<section class="max-w-md space-y-4">
  <h2 class="h2">Choose a project</h2>
  <Combobox
    {collection}
    value={selected}
    onValueChange={(e) => (selected = e.value)}
    onInputValueChange={(e) => {
      const query = e.inputValue.trim().toLowerCase();
      items = projects.filter((project) => project.label.toLowerCase().includes(query));
    }}
    onOpenChange={(e) => { if (e.open && e.reason !== 'input-change') items = projects; }}
    positioning={{ placement: 'bottom-start', sameWidth: true }}
  >
    <Combobox.Label>Project</Combobox.Label>
    <Combobox.Control class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
      <Combobox.Input class="input min-w-0 w-full" placeholder="Search projects" />
      <Combobox.Trigger type="button" class="btn static inset-auto h-auto w-auto transform-none preset-tonal-primary" aria-label="Show project options">Show</Combobox.Trigger>
      <Combobox.ClearTrigger type="button" class="btn h-auto w-auto preset-tonal-primary" aria-label="Clear project selection">Clear</Combobox.ClearTrigger>
    </Combobox.Control>
    <Portal>
      <Combobox.Positioner class="z-50 max-w-[var(--available-width)]">
        <Combobox.Content class="card preset-filled-surface-100-900 max-h-72 overflow-y-auto p-2 shadow-xl">
          {#each items as project (project.value)}
            <Combobox.Item item={project} class="flex items-center justify-between gap-3 rounded-base p-2 data-[highlighted]:preset-tonal-primary">
              <Combobox.ItemText>{project.label}</Combobox.ItemText>
              <span class="text-sm">{project.category}</span>
              <Combobox.ItemIndicator>Selected</Combobox.ItemIndicator>
            </Combobox.Item>
          {:else}
            <p role="status" class="p-2">No matching projects.</p>
          {/each}
        </Combobox.Content>
      </Combobox.Positioner>
    </Portal>
  </Combobox>
  <p role="status">Selected project: {selectedProject ? `${selectedProject.label} (${selectedProject.value})` : 'none'}</p>
</section>
```

Type `bea`, then ArrowDown/Enter to select Beacon. Escape closes without submitting; Clear clears selection; reopening displays the full list. An unmatched query displays no options and a truthful empty message. Selection remains a string array; typed text is not itself a selected value. Duplicate labels are valid when values differ. Keep category text readable in normal/highlighted/selected states and both schemes; verify composited contrast instead of lowering metadata opacity blindly.

Skeleton 5.0.1's common CSS absolutely positions Trigger inside the input and gives it square icon-button dimensions. This text-button layout resets its position, inset, transform, width, and height. Separate grid columns keep Show and Clear apart; `minmax(0,1fr)` and `min-w-0` let the input shrink. The positioner's `--available-width` cap keeps its reference-width popup within the viewport's collision padding, including while closed.

This recipe only selects local data. Remote search requires application-owned loading/error/filtering behavior, not an invented built-in fetch or filter API. When collections change, keep the selected record/label available from full data and exercise selection retention; do not derive submitted identity solely from visible options.

Sources: [Combobox](https://www.skeleton.dev/docs/svelte/framework-components/combobox.md), [5.0.1 default styles](https://unpkg.com/@skeletonlabs/skeleton-common@5.0.1/src/components/combobox.css), [5.0.1 collection helper](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/hooks/use-list-collection.js), [5.0.1 root](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/combobox/anatomy/root.svelte), [contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Pagination: controlled local table

Pass the complete count, render the current slice yourself, and reset/clamp the page when size/count changes. The 23-row example includes explicit zero-result and boundary handling.

**File: `PaginatedProjects.svelte`**
```svelte
<script lang="ts">
  import { Pagination } from '@skeletonlabs/skeleton-svelte';
  const projects = Array.from({ length: 23 }, (_, index) => ({
    id: index + 1,
    name: `Project ${String(index + 1).padStart(2, '0')}`,
    status: index % 3 === 0 ? 'In review' : 'Active'
  }));
  let page = $state(1);
  let pageSize = $state(5);
  const totalPages = $derived(Math.max(1, Math.ceil(projects.length / pageSize)));
  const currentPage = $derived(Math.min(Math.max(1, page), totalPages));
  const start = $derived((currentPage - 1) * pageSize);
  const visibleProjects = $derived(projects.slice(start, start + pageSize));

  function changePageSize(size: number) {
    pageSize = size;
    page = 1;
  }
</script>

<section class="space-y-4">
  <h2 class="h2">Project directory</h2>
  <div class="table-wrap">
    <table class="table">
      <caption class="p-3 text-start">Local projects</caption>
      <thead><tr><th scope="col">ID</th><th scope="col">Project</th><th scope="col">Status</th></tr></thead>
      <tbody>
        {#each visibleProjects as project (project.id)}
          <tr><td>{project.id}</td><td>{project.name}</td><td>{project.status}</td></tr>
        {:else}
          <tr><td colspan="3">No projects.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="flex flex-wrap items-center justify-between gap-4">
    <label class="label">
      <span>Rows per page</span>
      <select class="select w-fit" value={String(pageSize)} onchange={(e) => changePageSize(Number(e.currentTarget.value))}>
        <option value="5">5</option><option value="10">10</option><option value="20">20</option>
      </select>
    </label>
    <Pagination
      count={projects.length}
      page={currentPage}
      {pageSize}
      onPageChange={(e) => (page = e.page)}
      onPageSizeChange={(e) => changePageSize(e.pageSize)}
      translations={{ rootLabel: 'Project pages' }}
      class="flex flex-wrap gap-2"
    >
      <Pagination.FirstTrigger type="button" disabled={currentPage <= 1} class="btn preset-tonal-primary">First</Pagination.FirstTrigger>
      <Pagination.PrevTrigger type="button" disabled={currentPage <= 1} class="btn preset-tonal-primary">Previous</Pagination.PrevTrigger>
      <Pagination.Context>
        {#snippet children(api)}
          {#each api().pages as entry, index}
            {#if entry.type === 'page'}
              <button {...api().getItemProps(entry)} type="button" class="btn preset-tonal-primary data-[selected]:preset-filled-primary-500">{entry.value}</button>
            {:else}
              <Pagination.Ellipsis {index}>…</Pagination.Ellipsis>
            {/if}
          {/each}
        {/snippet}
      </Pagination.Context>
      <Pagination.NextTrigger type="button" disabled={currentPage >= totalPages} class="btn preset-tonal-primary">Next</Pagination.NextTrigger>
      <Pagination.LastTrigger type="button" disabled={currentPage >= totalPages} class="btn preset-tonal-primary">Last</Pagination.LastTrigger>
    </Pagination>
  </div>
  <p role="status">
    {#if projects.length === 0}
      0 results
    {:else}
      Page {currentPage} of {totalPages}: rows {start + 1}–{start + visibleProjects.length} of {projects.length}
    {/if}
  </p>
</section>
```

Initially IDs 1–5 render. Next shows 6–10; Last shows 21–23 on page 5. Changing size to 20 resets to page 1; Last then shows 21–23 on page 2. `currentPage` clamps the supplied page and slice after a count reduction, including zero rows. If adapting this to mutable data, commit the clamped page when replacing the data so a later count increase does not restore an old requested page. Empty status says “0 results”, never “rows 1–0”. Controls remain visible for one/zero pages with boundaries disabled; hide them explicitly if that is the product policy.

Controls are individually tabbable, not a roving arrow-key list. Page entries retain the `type: 'page'` discriminant passed to `api().getItemProps(entry)`; `type="button"` belongs on the rendered native button. In 5.0.1 `Pagination.Item` defaults to an anchor without `href`, and its element snippet is anchor-typed. This recipe uses the public Context API's generated item attributes on a real button, preserving ARIA and events without casting anchor event handlers. FirstTrigger/LastTrigger attach click handlers without supplying button type or disabled boundaries; those props are explicit here to prevent parent-form submission and invalid boundary actions. The native select owns size selection; Pagination's callback does not create a picker or fetch rows.

Sources: [Pagination](https://www.skeleton.dev/docs/svelte/framework-components/pagination.md), [5.0.1 anatomy](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/pagination/modules/anatomy.d.ts), [Item source](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/pagination/anatomy/item.svelte), [FirstTrigger source](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/pagination/anatomy/first-trigger.svelte), [LastTrigger source](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/pagination/anatomy/last-trigger.svelte), [Zag 1.43.0 pagination types](https://unpkg.com/@zag-js/pagination@1.43.0/dist/pagination.types.d.ts).
