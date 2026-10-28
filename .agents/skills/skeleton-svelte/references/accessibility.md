# Accessibility and browser verification

Skeleton's [core 5.0.1 CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/index.css) styles native elements; arbitrary containers do not gain semantics, validation policy, or focus management from classes. Use semantic HTML and verify actual behavior. This is distinct from the optional Svelte 5 framework components in `@skeletonlabs/skeleton-svelte@5.0.1` and their individual interaction contracts. The [Forms documentation](https://www.skeleton.dev/docs/svelte/tailwind-components/forms) calls for browser/platform validation; [Tables](https://www.skeleton.dev/docs/svelte/tailwind-components/tables) uses links or buttons inside cells rather than interactive rows. Neither appearance utilities nor framework components certify an application's accessibility.

## Preserve native semantics and names

- Use `<button type="button">` for an action, `<button type="submit">` for submission, and `<a href="…">` for navigation. `btn` does not make a `div` keyboard-operable. Native buttons already support Space and Enter; do not add duplicate key handlers.
- Keep meaningful heading levels and landmarks (`main`, navigation, sections with headings). Visual `h1`–`h6` classes do not change semantic levels.
- Provide visible labels. An explicit `<label for="email">` needs an exactly matching, unique input `id`. Wrapping one control in a label is also valid. A placeholder or hover-only title is not a substitute.
- Retain useful native attributes: correct `type`, `name`, `autocomplete`, `required`, and input constraints. Use `fieldset`/`legend` for related radio/checkbox groups.
- Icon-only buttons need a stable accessible name, such as `aria-label="Close settings"`; hide purely decorative icons from assistive technology. Do not rely on a tooltip for the only name.
- Preserve table structure: `caption`, `thead`, `tbody`, `th scope="col"` and `th scope="row"` where appropriate. Do not put `thead` inside `tbody`, even if a copied demonstration does so. Put actions in cells and make repeated names specific (“View Alice's profile”).
- Do not remove focus outlines without an equally visible replacement. Use the natural document order; avoid positive `tabindex`, nested buttons/links, and visual reordering that disagrees with keyboard order.
- `.disabled` changes appearance, not native disabled semantics or keyboard behavior. Use `disabled` on supported controls; `aria-disabled` alone needs deliberate prevention of activation and an appropriate focus policy. Do not imply a disabled link still navigates safely.
- `field-group` joins controls visually; preserve each label and use a real `fieldset`/`legend` when a semantic group is needed. Label a `<meter>` and supply correct bounds plus a readable value; it is a measurement, not a progress indicator.

Sources: [WAI Labeling Controls](https://www.w3.org/WAI/tutorials/forms/labels/), [Buttons](https://www.skeleton.dev/docs/svelte/tailwind-components/buttons), [Typography](https://www.skeleton.dev/docs/svelte/design/typography), [Tables](https://www.skeleton.dev/docs/svelte/tailwind-components/tables), [native disabled appearance](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/base/globals.css).

## Lucide icons and control names

Prefer Lucide when an icon improves recognition; labels remain the primary explanation. Apply these rules to the actual rendered SVG and control:

- **Labeled button or link:** keep the icon decorative with `aria-hidden="true"` and retain the visible action/destination text. For an icon-only control, put its accessible name on the button or link, not the SVG; use specific wording such as “Close settings.” A tooltip is supplementary, not the only name. Do not move control state or relationships such as `aria-expanded` or `aria-controls` onto the icon.
- **Default hiding is conditional:** in `@lucide/svelte@1.61.0`, automatic `aria-hidden="true"` applies only with no child snippet and no `aria-*`, `role`, or `title` prop. Adding any of these suppresses that inference; it does not establish a useful name or role by itself. Keep decorative icons explicitly hidden when adding attributes or children. `focusable="false"` may be used to keep SVG itself out of focus, but it neither names nor disables the enclosing control.
- **Standalone meaningful icon:** use `role="img"` with an explicit `aria-label`, or associate a nested `<title>` through `aria-labelledby`. Name its contextual meaning, not its shape. A `title` string attribute is not a nested `<title>` element. Prefer visible text if meaning would otherwise be ambiguous.
- **IDs only for associations:** `aria-label` needs no ID. If using `aria-labelledby`, generate a unique, hydration-stable title ID with `$props.id()` in component instance initialization and reference that exact ID. Never reuse a fixed title ID across repeated icons.
- **Rendering and interaction:** check meaningful icon contrast, forced colors, focus visibility, and the actual button/link target size, not just SVG dimensions. Keep status understandable without color alone. Static icons need no motion machinery; if an icon is animated, preserve its meaning in a static reduced-motion alternative.

See [complete accessible icon examples](lucide.md#accessible-icons-and-controls), [styling precedence](lucide.md#props-and-styling), and [icon verification](lucide.md#verification). Inspect names and roles in the accessibility tree, then exercise the flow with the supported screen reader/browser combinations; SVG defaults do not certify announcements.

Sources: [Lucide Svelte accessibility](https://lucide.dev/guide/svelte/advanced/accessibility), [pinned default-hidden inference](https://unpkg.com/@lucide/svelte@1.61.0/dist/utils/hasA11yProp.js), [pinned icon rendering](https://unpkg.com/@lucide/svelte@1.61.0/dist/Icon.svelte), [Svelte instance IDs](https://svelte.dev/docs/svelte/$props#$props.id()).

## Validation, errors, and status

Validate on the server for persisted operations; client constraints improve interaction but are not a trust boundary. Keep submitted values when returning errors. Associate field help and error text through `aria-describedby`; set `aria-invalid="true"` only when validation finds an error, not on every untouched required field.

Describe errors in text, identify the affected field, and explain how to correct it. A red border alone is insufficient. For multiple errors, offer a summary with links to invalid controls. After submission, focus the summary or first invalid field as appropriate; do not fight native browser validation focus.

For a dynamically updated nonurgent result, use a persistent `role="status"` region and update its text. Use `role="alert"` sparingly for important dynamically added errors; do not announce every keystroke. Keep success and error messages visible long enough to read. A transient toast must not be the only place to recover from a failed submission. Static content on initial page load and dynamically updated content have different announcement behavior: test with assistive technology, not just an accessibility tree snapshot.

For asynchronous work, show a pending state promptly, prevent unintended duplicate submissions, and preserve entered values on failure. Report success only after confirmation; an explicit optimistic flow needs rollback. Keep errors near the affected controls and expose waiting/result messages without moving focus to decorative feedback. Do not invent progress percentages or delay completion to finish an animation. The persistent status region in the local recipe below also applies to application feedback; `role="status"` already implies polite announcements.

Sources: [WAI Form Notifications](https://www.w3.org/WAI/tutorials/forms/notifications/), [WCAG Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

## Standalone styled local form recipe

This complete `ProfilePreview.svelte` component updates a **local preview**, not an account or server. It requires JavaScript, the global Skeleton core/framework CSS and theme, and the required forms plugin described in [styling.md](styling.md); presets come from core. Controls remain disabled until mounting, so the unenhanced form cannot send the name through a native submission. Native `required` and `maxlength` constraints run before the `submit` handler. The local policy preserves entered whitespace and accepts whitespace-only text: `required` rejects an empty string, not a blank-looking one. For nonblank or persisted values, use the explicit validation policy in [sveltekit.md](sveltekit.md#native-form-actions-with-progressive-enhancement), not this preview as persistence.

**File: `ProfilePreview.svelte`**
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  const uid = $props.id();
  let ready = $state(false);
  let preview = $state('Not set');
  let status = $state('');

  onMount(() => { ready = true; });

  function updatePreview(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('displayName');
    preview = typeof value === 'string' ? value : '';
    status = `Preview updated to ${preview}. Nothing was saved to a server.`;
  }
</script>

<section class="card preset-filled-surface-100-900 space-y-4 p-4" aria-labelledby={`${uid}-title`}>
  <h2 id={`${uid}-title`} class="h3">Display name preview</h2>
  <form onsubmit={updatePreview} class="space-y-4">
    <div class="space-y-2">
      <label class="label-text" for={`${uid}-name`}>Display name (required)</label>
      <input
        id={`${uid}-name`}
        name="displayName"
        type="text"
        class="input"
        autocomplete="nickname"
        required
        maxlength="60"
        disabled={!ready}
        aria-describedby={`${uid}-help`}
      />
      <p id={`${uid}-help`} class="text-sm">Use up to 60 characters, including spaces. JavaScript is required; nothing is sent or saved.</p>
    </div>
    <button type="submit" disabled={!ready} class="btn preset-filled-primary-500">Update preview</button>
  </form>
  <dl>
    <dt class="font-bold">Preview name</dt>
    <dd>{preview}</dd>
  </dl>
  <p role="status" aria-atomic="true">{status}</p>
</section>
```

`$props.id()` gives each instance a unique, hydration-stable ID; suffixes keep its title, label and help associations local. This example retains native validation rather than creating custom error state. For application validation failures, add visible field errors and `aria-invalid` only after validation returns a result.

Sources: [Forms](https://www.skeleton.dev/docs/svelte/tailwind-components/forms), [Presets](https://www.skeleton.dev/docs/svelte/tailwind-utilities/presets), [exact Svelte 5.57.2 IDs/lifecycle types](https://unpkg.com/svelte@5.57.2/types/index.d.ts), [Svelte event attributes](https://svelte.dev/docs/svelte/basic-markup#Events), [WAI Notifications](https://www.w3.org/WAI/tutorials/forms/notifications/).

## Modal and tooltip interaction contracts

Choose native `<dialog>` methods or the current framework `Dialog` component and preserve its documented trigger/content wiring. `class="dialog"` supplies CSS, not modality: `showModal()` opens a modal in the top layer with background inertness; `show()` or the `open` attribute is nonmodal. Use `close()` or a `method="dialog"` form to close it. A nonmodal dialog is not automatically a tooltip.

Native dialog, its optional animation, newer `closedby="any"` light-dismiss, and invoker `command`/`commandfor` controls have **separate** browser support. Keep an explicit working close/cancel control; do not require backdrop-click dismissal. For unsupported invokers, retain a tested `showModal()`/`close()` path or an ordinary route/inline alternative appropriate to the task. Essential content must remain reachable when an enhanced dialog cannot run. Do not assume native dialog support implies `@starting-style`, discrete overlay transitions, or light-dismiss support.

For a modal dialog, verify all of these:

- Opening moves focus inside to an appropriate element. For complex content, the title or introductory static text may be a better initial focus target than the first action; destructive flows generally favor the least destructive action.
- Tab and Shift+Tab remain within the open modal. Background content is inert to keyboard and pointer interaction, not merely dimmed.
- Escape closes it; provide an obvious keyboard-operable close or cancel button.
- Closing normally restores focus to the invoking control, or to a logical successor if that control was removed.
- The dialog has an accessible name through its visible title (`aria-labelledby`) or an explicit label. Use `aria-modal="true"` only when the implementation actually enforces modality. Avoid flattening complex dialog content into one huge `aria-describedby` announcement.

For tooltip-like help, verify hover **and keyboard focus** expose it, Escape dismisses it, and focus stays on the trigger. Associate tooltip text through `aria-describedby`; the tooltip itself has `role="tooltip"` and no focusable content. Keep it visible while the pointer moves over its content. If it contains links/buttons, it is an interactive popup, not a tooltip; use the appropriate dialog/popover interaction model. Essential instructions should be visible without opening a tooltip. The APG tooltip pattern is explicitly a work in progress, not a finalized component certification.

Sources: [Skeleton native Dialogs](https://www.skeleton.dev/docs/svelte/tailwind-components/dialogs), [MDN dialog](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog), [APG Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [APG Tooltip](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/).

For simple mobile page navigation, a native `<details>`/`<summary>` disclosure can avoid a modal entirely. Retain its native keyboard behavior and marker; put real links inside a named `<nav>`. It is not an ARIA `menu`, does not trap focus, and does not require Escape dismissal. Skeleton's optional `disclosure`/`disclosure-content` classes add appearance and intrinsic-size animation, not a different interaction model. Unsupported `::details-content`/`interpolate-size` animation should fall back to instant native toggling. Where shared `details name` supports exclusive groups, allocate a unique group name per unrelated instance. See the responsive shell in [design.md](design.md). If choosing an overlay instead, implement the full modal contract above.

## Focus visibility and drag alternatives

Sticky headers/footers, banners, and floating panels must not entirely hide a component when it receives keyboard focus (WCAG 2.4.11, AA). Keep both the control and its focus indicator visible; account for overlays in scroll layout, for example with appropriate `scroll-padding`. Test narrow and zoomed layouts, not only the default viewport. The criterion assesses user-movable content in its initial position; user-opened content has a limited allowance when the focused component can be revealed without advancing focus. Neither allowance justifies an invisible focus indicator.

For authored drag interactions, provide equivalent functionality with a **single pointer without dragging** (2.5.7, AA), unless dragging is essential or the unmodified interaction belongs to the browser. Click/tap buttons, menus, or numeric inputs can provide alternatives for moving, sorting, resizing, or setting a value. Keyboard shortcuts alone do **not** meet this requirement; test keyboard access separately. A swipe is not a suitable non-drag alternative.

Skeleton's `FloatingPanel` supports controlled `position`/`size` and change callbacks; use those contracts for click/tap-operable movement and sizing controls when needed. Minimize/maximize buttons alone do not establish equivalent positioning or sizing functionality. Keep panel content and controls reachable on small screens; choose an inline layout instead when floating behavior adds no value.

Sources: [WCAG Focus Not Obscured Minimum](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), [WCAG Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [Floating Panel](https://www.skeleton.dev/docs/svelte/framework-components/floating-panel), [exact 5.0.1 FloatingPanel props](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/floating-panel/anatomy/root.svelte.d.ts), [underlying exact 1.43.0 movement/size interface](https://unpkg.com/@zag-js/floating-panel@1.43.0/dist/floating-panel.types.d.ts).

## Contrast, motion, and scale

Theme contrast tokens are a starting point, not evidence that every composite design passes. Measure the rendered foreground/background in each theme and scheme. Text normally needs at least **4.5:1**; qualifying large text needs **3:1**. Meaningful authored control/state indicators need **3:1** against adjacent colors. Check focus rings, placeholders, outlined borders when needed to identify a control, icons, and text over glass/gradients/images. Opacity can break otherwise suitable token pairings. Do not encode state solely through hue; accompany color with text or another meaningful cue.

Respect `prefers-reduced-motion` for nonessential motion, including custom CSS and Svelte transitions. A CSS media rule cannot cancel every JavaScript-driven animation; condition the transition or animation mechanism itself when needed. Preserve feedback with a static indicator or lower-motion alternative rather than hiding the result.

Global CSS fragment: application-owned decorative motion plus optional native dialog/disclosure transitions. Keep JavaScript-driven motion handling separate:

```css
@media (prefers-reduced-motion: reduce) {
  .decorative-motion,
  .animate-dialog,
  .animate-dialog::backdrop {
    animation: none;
    transition: none;
  }
  .disclosure summary { transition: none; }
  .disclosure::details-content { transition: none; }
}
```

Autostarting movement, blinking, or scrolling that lasts **more than five seconds** alongside other content needs a user mechanism to pause, stop, or hide it unless essential (2.2.2, A). Autostarting **auto-updating information has no five-second exception**; provide pause/stop/hide or update-frequency control. Hover/focus-only pausing is insufficient if movement resumes when users leave to use the page. For Skeleton `Marquee`, provide a visible keyboard- and click/tap-operable pause control using its documented pause state or `useMarquee` API; `pauseOnInteraction` alone is not enough. A static reduced-motion alternative must expose all meaningful items, not freeze most of them outside a clipped viewport.

Avoid flashing effects. Content must not flash more than **three times in any one-second period** unless below the defined general-flash and red-flash thresholds (2.3.1, A). A short duration, pause button, or reduced-motion option does not excuse an unsafe flash. Inspect all simultaneous effects and looping media; do not judge safety by animation duration alone.

Distinguish these requirements from AAA: **44 × 44 CSS pixels** is Target Size Enhanced (2.5.5, with exceptions); disabling nonessential interaction-triggered motion is Animation from Interactions (2.3.3); keeping the entire focused component unobscured is 2.4.12. Focus Appearance (2.4.13) adds minimum indicator area and focused/unfocused contrast requirements, not an AA rule that every outline must be 2px. Continue honoring reduced motion and using generous targets when targeting AA.

Sources: [WCAG Pause Stop Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html), [WCAG Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html), [Marquee](https://www.skeleton.dev/docs/svelte/framework-components/marquee), [exact 5.0.1 Marquee props](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/marquee/anatomy/root.svelte.d.ts), [underlying exact 1.43.0 pause interface](https://unpkg.com/@zag-js/marquee@1.43.0/dist/marquee.types.d.ts), [WCAG Target Size Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), [WCAG Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html), [WCAG Focus Not Obscured Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-enhanced.html), [WCAG Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html).

Check zoom, text enlargement, narrow layouts, and platform high-contrast/forced-colors settings. Do not shrink text or controls merely to fit an intended screenshot. Measure interactive targets: WCAG 2.2 AA requires at least **24 × 24 CSS pixels** or a qualifying spacing/other exception; **44 × 44** is a stronger touch-friendly design target, not the AA minimum. Recheck rendered dimensions whenever `--spacing`, `field-*`, `btn-*`, or element-size tokens change. `--default-outline-width` is configurable, not an enforced accessibility guardrail: retain visible focus, including when overflow, rounded corners, and forced colors affect its rendering.

Treat masks and corner shapes as progressive decoration. Apply masking to a separate decorative layer, never essential text, the only informative image, the accessible name, or a focusable target's outline. Unsupported masking can leave an element unmasked; a supported but empty, failed, or unsupported-format mask resource can instead hide it completely. Do not rely on that resource as an essential-content fallback. Keep unmasked meaningful content available, and verify failed resources as well as unsupported CSS. Corner-shape utilities require nonzero radius; retain useful rounded fallback geometry and do not convey state through corner shape alone. Theme corner tokens do not automatically reshape all controls. Avoid animating blur, masks, or corner geometry unless requested and with a static reduced-motion alternative.

Sources: [WCAG Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [WCAG Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [WCAG Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [MDN reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion), [Spacing](https://www.skeleton.dev/docs/svelte/design/spacing), [Masks](https://www.skeleton.dev/docs/svelte/tailwind-utilities/masks), [mask resource failure](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-image), [Corner shapes](https://www.skeleton.dev/docs/svelte/tailwind-utilities/corner-shapes).

## Concrete verification checklist

Perform these checks in the actual supported browsers after implementation; this reference does not claim they have already been run. This is a focused implementation checklist, not a complete WCAG audit or certification.

1. **Keyboard only:** Use Tab and Shift+Tab through the whole flow. Confirm visible, ordered focus, button activation with Enter and Space, and link activation with Enter. Verify that menus, tabs, and other widgets retain the chosen library's keyboard contract. Check for unintended traps; a modal intentionally contains focus until dismissal. With sticky headers/footers, banners and floating panels present, ensure focused controls are not entirely hidden and focus indicators remain visible at narrow widths and zoom.
2. **Modal/tooltip/disclosure:** Exercise opening, Escape, close/cancel, focus restoration, background inertness, tooltip focus exposure, hover persistence, and accessible names. Try a removed trigger and long dialog content. Check dialog behavior independently of newer light-dismiss/invoker support. Test disclosure keyboard toggling with and without animation support and independent grouping across instances.
3. **Form:** Activate labels and submit empty, whitespace-only, overlength, invalid, and valid values under the declared policy. Check error association and focus, exact failed-value retention, keyboard behavior for selects/radios, autocomplete and native mobile inputs. Verify server failures separately from browser constraints, with and without enhancement. Mount two reusable instances and confirm each label/help/error resolves only its own control. For asynchronous flows, try slow success/failure and repeated activation: pending feedback must be prompt, duplicate requests prevented under the declared policy, entered data preserved, and success truthful.
4. **Screen reader/accessibility tree:** Inspect names, roles, heading levels, label association and table headers; use a real screen reader to hear error/status changes. Ensure icons and toasts are neither unnamed nor needlessly announced twice.
5. **Responsive/visual:** Check narrow and wide viewports, 200% text enlargement and reflow at 320 CSS pixels, long labels, forced colors and reduced motion both before mount and after preference changes. Measure target sizes/spacing and rendered contrast in both schemes for every active theme, including default, focus, selected, invalid and disabled states. Disabled controls are contrast-exempt, not permission to obscure their state. Check static fallbacks for unsupported blur/corner/mask CSS and failed mask resources; essential content and focus must remain visible.
6. **SSR/hydration:** Hard reload with slow JavaScript and an opposite persisted mode. Check first-paint flash, matching server and client markup, console hydration warnings, navigation behavior, and browser-only storage access. Check essential native form and navigation behavior without JavaScript; enhanced widgets may require JavaScript but must not falsely appear functional before hydration.
7. **Tailwind/theme pipeline:** Confirm the correct `data-theme`, mode selector and computed `color-scheme`; global core and framework CSS inclusion; forms plugin; application/shared-source detection; and complete literal class names. Presets ship in core, not a separate optional import. Use [styling.md](styling.md)'s debugging sequence rather than replacing broken tokens with random hardcoded colors.
8. **Motion and dragging:** Pause continuous/auto-updating content, then move focus and pointer elsewhere; it must stay paused until deliberately resumed. Check all meaningful marquee items remain available in the static reduced-motion alternative. Inspect animation/media timing, looping, and combined flash rates; use threshold analysis if relying on a flashing exception, not a visual guess. Complete every authored drag action with clicks/taps alone, including panel movement and sizing, then separately with keyboard controls. Check small-screen panel bounds and access to close/restore controls.

Sources: [Forms browser support](https://www.skeleton.dev/docs/svelte/tailwind-components/forms), [APG Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [WAI Notifications](https://www.w3.org/WAI/tutorials/forms/notifications/), [Mode](https://www.skeleton.dev/docs/svelte/guides/mode), [Svelte lifecycle](https://svelte.dev/docs/svelte/lifecycle-hooks).
