# Sources, compatibility evidence, and distribution

Reference baseline as of **2026-10-18**: Skeleton core and Svelte components
**5.0.1**, Svelte **5.57.2**, SvelteKit **3.1.0**, Tailwind CSS **4.3.3**.
Lucide is independently pinned to **`@lucide/svelte@1.61.0`** (Svelte peer **`^5`**)
when icons are useful; it does not change the existing stack pins or become a
dependency of recipes that use no icons.
Exact packages establish API and dependency contracts, not upstream certification
of every application, deployment, or accessibility requirement.

## Exclusive framework scope

Skill version **3.1** targets **SvelteKit 3.1+ exclusively**. The supported
implementation path uses modern configuration, imports, state, navigation and
forms. Older framework references identify migration inputs or patterns to
replace; they are not alternative recipes. This policy supersedes earlier
legacy-framework preservation guidance without relabeling historical test runs.

The earlier Kit-only scope cutover changed instructions, not executable examples
or the then-existing dependency pins. A fresh exact-baseline fixture passed `npm run check` (**173 files,
0 errors, 0 warnings**) and client/server production builds. Production preview
returned SSR HTML and exercised native HTML POSTs: whitespace failure returned
400 with the exact raw value; valid input returned 200 with its greeting.
Skill-format and local link/fence checks passed. Adapter-auto still had no
production target, and the build emitted the environmental color warning.
Later releases require matching API/source checks; these results certify neither
future releases nor a production deployment.

## Choose the authority before copying code

1. **Inspect the application's resolved packages first.** Lockfile and installed
   metadata determine availability; manifest ranges and documentation titles do not.
2. **Use exact published packages for exports, declarations, CSS, peers, and
   engines.** Read implementation when types omit behavior. Internal inspection
   paths are not supported application import specifiers.
3. **Use current official Skeleton v5 documentation for intent and examples.**
   Check examples against the installed version. Archived v4 documentation is
   staged migration evidence, not the v5 destination API.
4. **Use version-appropriate official framework documentation.** Rolling pages
   can change; compare signatures with exact installed Svelte/Kit/Tailwind packages.
   This skill targets Kit 3.1+ exclusively, regardless of upstream Skeleton's
   broader framework support. Older conventions are migration/avoidance context.
5. **Treat search, Context7, and supplied research as discovery/secondary sources.**
   Follow underlying sources and resolve conflicts using exact package evidence.
   Scores, labels, statistics, and prose do not establish API compatibility.

## Primary-source map by task

| Task | Primary sources | How to use them |
| --- | --- | --- |
| Establish versions and dependency contracts | Registry: [core 5.0.1](https://registry.npmjs.org/@skeletonlabs/skeleton/5.0.1), [components 5.0.1](https://registry.npmjs.org/@skeletonlabs/skeleton-svelte/5.0.1), [Svelte 5.57.2](https://registry.npmjs.org/svelte/5.57.2), [Kit 3.1.0](https://registry.npmjs.org/@sveltejs/kit/3.1.0), [Tailwind 4.3.3](https://registry.npmjs.org/tailwindcss/4.3.3) | Read `version`, `exports`, peers, optional peers, and engines. Development dependencies are not consumer requirements. |
| Install Skeleton 5 | Official [SvelteKit installation](https://www.skeleton.dev/docs/svelte/get-started/installation/sveltekit.md) and [core API](https://www.skeleton.dev/docs/svelte/get-started/core-api.md) | Use current CSS imports and theme activation with this skill's Kit 3.1+ setup; upstream minimums do not broaden the skill's target. |
| Migrate older Skeleton applications | Official [v4-to-v5 migration](https://www.skeleton.dev/docs/svelte/get-started/migrate-from-v4.md); archived [v3-to-v4](https://v4.skeleton.dev/docs/svelte/get-started/migrate-from-v3) and [v2-to-v4](https://v4.skeleton.dev/docs/svelte/get-started/migrate-from-v2); exact [CLI source](https://unpkg.com/skeleton@5.0.1/dist/index.mjs) | Reach functional v4.15.2 before v5. CLI transformations do not replace manual component, Svelte-peer, field-group, and caller migration. See [migration](migration.md). |
| Select exports and component anatomy | Exact [package metadata](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/package.json), [runtime index](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/index.js), [declarations](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/index.d.ts); official [fundamentals](https://www.skeleton.dev/docs/svelte/get-started/fundamentals.md) and [Svelte documentation index](https://www.skeleton.dev/llms-svelte.txt) | Follow public exports into their declarations/source. Root is the public component entrypoint; `/composed` is not exported. See [components](components.md). |
| Resolve state, callbacks, and floating anatomy | Official [Tabs](https://www.skeleton.dev/docs/svelte/framework-components/tabs.md), [Accordion](https://www.skeleton.dev/docs/svelte/framework-components/accordion.md), [Switch](https://www.skeleton.dev/docs/svelte/framework-components/switch.md), [Tooltip](https://www.skeleton.dev/docs/svelte/framework-components/tooltip.md), [Dialog](https://www.skeleton.dev/docs/svelte/framework-components/dialog.md), [Toast](https://www.skeleton.dev/docs/svelte/framework-components/toast.md) | Verify callbacks, bindability, providers, and element snippets against shipped declarations. See [recipes](recipes.md). |
| Integrate Lucide components | Official [Svelte guide](https://lucide.dev/guide/svelte/), [getting started](https://lucide.dev/guide/svelte/getting-started), [migration](https://lucide.dev/guide/svelte/migration), and [GitHub source](https://github.com/lucide-icons/lucide/tree/main/packages/svelte); exact [1.61.0 metadata](https://registry.npmjs.org/@lucide/svelte/1.61.0), [public declarations](https://unpkg.com/@lucide/svelte@1.61.0/dist/lucide-svelte.d.ts), [prop/component types](https://unpkg.com/@lucide/svelte@1.61.0/dist/types.d.ts), [Icon implementation](https://unpkg.com/@lucide/svelte@1.61.0/dist/Icon.svelte), and [context implementation](https://unpkg.com/@lucide/svelte@1.61.0/dist/context.js) | Package exports/types determine the API; rolling docs explain intent. See [Lucide](lucide.md) and the [package cutover](migration.md#migrate-lucide-to-the-current-svelte-package). |
| Discover and verify an icon | Official [icon catalog](https://lucide.dev/icons/); exact [1.61.0 metadata](https://registry.npmjs.org/@lucide/svelte/1.61.0) and [public declarations](https://unpkg.com/@lucide/svelte@1.61.0/dist/lucide-svelte.d.ts) | Search visually or by meaning, then verify canonical slug, public subpath and named export in the resolved package; the rolling catalog is not a frozen availability list. See [discovery](lucide.md#discover-and-verify-an-icon) and [offline inspection](lucide.md#offline-package-inspection). |
| Apply deeper Lucide patterns | Official Svelte [TypeScript](https://lucide.dev/guide/svelte/advanced/typescript), [filled icons](https://lucide.dev/guide/svelte/advanced/filled-icons), [combining icons](https://lucide.dev/guide/svelte/advanced/combining-icons), and [global styling](https://lucide.dev/guide/svelte/advanced/global-styling); exact [types](https://unpkg.com/@lucide/svelte@1.61.0/dist/types.d.ts), [Icon implementation](https://unpkg.com/@lucide/svelte@1.61.0/dist/Icon.svelte), and [context implementation](https://unpkg.com/@lucide/svelte@1.61.0/dist/context.js) | Rolling examples need exact-package checks, especially custom-node types and context behavior. Use [advanced patterns](lucide-patterns.md); a reusable consumer is optional, not a required global abstraction. |
| Use optional Lucide Lab data | Official [Svelte Lab guide](https://lucide.dev/guide/svelte/advanced/with-lucide-lab); exact [0.7.0 registry metadata](https://registry.npmjs.org/@lucide/lab/0.7.0), [package manifest](https://unpkg.com/@lucide/lab@0.7.0/package.json), [declarations](https://unpkg.com/@lucide/lab@0.7.0/dist/lucide-lab.d.ts), and [ESM entrypoint](https://unpkg.com/@lucide/lab@0.7.0/dist/esm/lucide-lab.js) | Lab is an optional extra only for applications using its data. Inspect its actual named data export and node shape against `@lucide/svelte@1.61.0`, not a copied name or documentation type alias. See [custom data and Lab](lucide-patterns.md#custom-icon-data-and-lab). |
| Style themes, native controls, and presets | Official [themes](https://www.skeleton.dev/docs/svelte/design/themes), [colors](https://www.skeleton.dev/docs/svelte/design/colors), [presets](https://www.skeleton.dev/docs/svelte/tailwind-utilities/presets), [forms](https://www.skeleton.dev/docs/svelte/tailwind-components/forms.md); exact [core CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/index.css), [presets CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/utilities/presets.css), [Cerberus](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/themes/cerberus.css), [framework CSS](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/index.css) | Separate core/native CSS from optional framework behavior. Presets are included in core; form utilities require the forms plugin. See [styling](styling.md). |
| Compose responsive pages | Official [typography](https://www.skeleton.dev/docs/svelte/design/typography), [spacing](https://www.skeleton.dev/docs/svelte/design/spacing), [responsive design](https://tailwindcss.com/docs/responsive-design) | Apply [design](design.md), then inspect actual narrow/wide rendering; a recipe is not an exported AppShell component. |
| Configure Tailwind 4 | Official [Vite installation](https://tailwindcss.com/docs/installation/using-vite), [class detection](https://tailwindcss.com/docs/detecting-classes-in-source-files), [dark mode](https://tailwindcss.com/docs/dark-mode), [upgrade guide](https://tailwindcss.com/docs/upgrade-guide); exact [Vite plugin metadata](https://registry.npmjs.org/@tailwindcss/vite/4.3.3) | Use complete class strings and stylesheet-relative shared-source paths. Framework CSS replaces the old Skeleton distribution scan, not all uses of `@source`. |
| Write Svelte 5 state and lifecycle | Official [migration](https://svelte.dev/docs/svelte/v5-migration-guide), [$state](https://svelte.dev/docs/svelte/$state), [$derived](https://svelte.dev/docs/svelte/$derived), [$effect](https://svelte.dev/docs/svelte/$effect), [$props](https://svelte.dev/docs/svelte/$props), [snippets](https://svelte.dev/docs/svelte/snippet), [lifecycle](https://svelte.dev/docs/svelte/lifecycle-hooks); exact [types](https://unpkg.com/svelte@5.57.2/types/index.d.ts) | Use instance-owned state and hydration-stable IDs; distinguish browser-only lifecycle from SSR. |
| Add optional motion or route continuity | Official [Svelte motion](https://svelte.dev/docs/svelte/svelte-motion), [transitions](https://svelte.dev/docs/svelte/transition), [attachments](https://svelte.dev/docs/svelte/@attach), [Kit view-transition pattern](https://svelte.dev/docs/kit/faq#How-do-I-use-the-view-transitions-API); exact [Spring](https://unpkg.com/svelte@5.57.2/src/motion/spring.js), [Tween](https://unpkg.com/svelte@5.57.2/src/motion/tweened.js), and [Kit router](https://unpkg.com/@sveltejs/kit@3.1.0/src/runtime/client/client.js) | Separate actual state from interpolation; verify cancellation, reduced motion, lifecycle cleanup, and nonblocking navigation. |
| Evaluate expressive effects and performance | [Animation purpose](https://www.nngroup.com/articles/animation-purpose-ux/), [rendering cost](https://web.dev/articles/animations-guide), [LCP optimization](https://web.dev/articles/optimize-lcp), [Core Web Vitals](https://web.dev/articles/vitals) | Design recommendations and measurement targets are not proof of user outcomes, field performance, or accessibility. |
| Configure or migrate Kit 3.1+ | Official [stable Kit 3 migration](https://svelte.dev/docs/kit/migrating-to-sveltekit-3), [environment variables](https://svelte.dev/docs/kit/environment-variables); exact [Kit declarations](https://unpkg.com/@sveltejs/kit@3.1.0/types/index.d.ts) | Use Vite configuration, `$app/tsconfig`, `#lib`, `$app/env`, `$app/state`, and current navigation/enhancement signatures. Remove historical alternatives during migration. |
| Implement isolated SSR and native/progressive forms | Official [state management](https://svelte.dev/docs/kit/state-management), [load](https://svelte.dev/docs/kit/load), [server-only modules](https://svelte.dev/docs/kit/server-only-modules), [form actions](https://svelte.dev/docs/kit/form-actions) | Keep user data out of server singletons; preserve native POST and raw failed text. See [SvelteKit integration](sveltekit.md). |
| Evaluate interaction and accessibility | WAI [modal dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [labels](https://www.w3.org/WAI/tutorials/forms/labels/), [form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/), [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | These are requirements/guidance, not passed checks. Use [accessibility](accessibility.md). |
| Distribute the skill | [Agent Skills specification](https://agentskills.io/specification) | Preserve directory naming, string metadata, relative references, and progressive disclosure. |

Version-qualified registry URLs describe published metadata; UNPKG exposes the
same published package files. If unavailable, inspect the installed copy or the
registry record's `dist.tarball`, not an unversioned `latest` substitute.

## Secondary research and corrections

The supplied Gemini research, [Architectural Evolution and Design System
Engineering in Skeleton v5](https://share.gemini.google/2iTB8QXtd8cZ), informed
research questions, not API authority. Its shared page redirected to
[Gemini's canonical share](https://gemini.google.com/share/0b64a27b7a4e).
The following corrections also apply when official prose conflicts with packages:

- Accordion uses `value: string[]`, `onValueChange`, and `e.value`, not
  `open/onOpenChange/e.change`. The exported step component is `Steps`, not `Stepper`.
- Export spelling is `QrCode`, not `QRCode`. Verify names from runtime exports,
  not documentation-navigation totals or assumed component counts.
- `createToaster` creates a store, not an enforced process singleton. Keep stores
  instance-owned; share through layout context when needed, with one renderer per
  store. Never put user-specific notification queues in a mutable SSR singleton.
- Tokens, contrast assignments, OKLCH, and framework components do not guarantee
  accessibility. Measure rendered contrast and test keyboard/focus behavior.
- Do not treat preview/beta labels, browser-support tables, utility/property/theme
  totals, adoption statistics, or trend claims as stable package contracts. Use
  versioned evidence for relevant features and test target browsers. Local preview
  examples do not establish persistence or production readiness.
- Provider factories need required IDs; element snippets must forward supplied
  attributes. Custom example presets and corner tokens do not imply shipped
  utilities or automatic global geometry. See the relevant component/style guide.

### Supplemental research review

The user-supplied **`temp_supp_research-doc.md`**, titled “Expressive UI
Development Reference” with a **2026-10-18** cutoff, is unvetted secondary research.
It explicitly disclaims compilation/browser testing. The skill is self-contained;
that temporary authoring input is not an installation prerequisite.

| Research area | Disposition |
| --- | --- |
| Versions, package responsibilities, installation, themes, migrations | Retain exact-baseline optional-peer, adapter, CSS-import, and token qualifications. The skill's exclusive Kit 3.1+ scope supersedes earlier legacy-framework preservation policy. |
| Compound component examples | Correct `<Switch.Root>` to callable `<Switch>`; 5.0.1's [Switch anatomy](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/components/switch/modules/anatomy.d.ts) has no `Root` member. Documentation-entry totals are not runtime export totals. |
| Reactivity, motion, and route continuity | Validate against exact Svelte/Kit declarations and implementation; see [purposeful motion](sveltekit.md#purposeful-motion). Do not copy hardcoded reusable disclosure IDs or assume skipped visual transitions imply failed navigation. |
| Tailwind extensibility and browser support | Add CSS-first extension guidance and cumulative browser constraints in [styling](styling.md). Keep Skeleton as the authoritative theme layer. |
| Expressive design, feedback, and performance | Add [purposeful feedback and measured performance](design.md#purposeful-feedback-and-motion). Retain static reading surfaces and truthful state; editorial trends, neurochemical claims, and universal timing ranges are not requirements. |
| Motion, focus, dragging, and accessibility levels | Add precise safeguards in [accessibility](accessibility.md#contrast-motion-and-scale), not an implied accessibility certification. |
| Maintenance and verification | Existing exact-package, native/enhanced-form, hydration, responsive, and evidence-limit procedures remain applicable. Only executed supplemental checks are recorded below. |

Context7 is discovery evidence; primary sources and the exact installed packages
resolve API questions. Motion remains optional within the Kit 3.1+ target and
does not require experimental framework features. No Kit 2 implementation path
is supported by this skill.

### Pinned third-party Lucide review

The user-supplied [Lucide Svelte reference at commit
`42cf82f`](https://raw.githubusercontent.com/aksuharun/skills/42cf82f1c5e0bdbc88fec16db452d21f3a8ab016/lucide-icons/references/lucide-svelte.md)
is **secondary research**, not official Lucide documentation. Its frozen review
covered 15 units: 14 initially needed validation and one was a practice; all
15 were flagged and adjudicated. The deterministic pre-filter removed 23
blank/heading/separator blocks; the batch had no errors or truncated units.
The following corrections are exact-package/source reviews, not test results;
the initial classification labels were not treated as authority.

- Use `@lucide/svelte@1.61.0` with its exact Svelte `^5` peer. The separately
  versioned [`lucide-svelte@1.0.1`](https://registry.npmjs.org/lucide-svelte/1.0.1)
  is deprecated in favor of `@lucide/svelte`; do not add an old-Svelte path.
  Preserve the consumer's package manager and lockfile.
- Root named imports such as `Camera` are public and valid. Canonical default
  imports from `@lucide/svelte/icons/<slug>` are the preferred convention, not a
  fix for an unsupported root API. They keep module traversal focused; neither
  “always bundles every icon” nor universally “faster builds” is established.
  A namespace/all-icon runtime catalog differs from static named imports.
- The public `circle-alert` path is supported. Prefer canonical names and
  theme-aware `currentColor`, not arbitrary example paint.
- `size` accepts `number | string` and defaults to `24`; CSS can override rendered
  dimensions. `color` defaults to `currentColor` and supplies SVG stroke.
  `strokeWidth` accepts `number | string` and defaults to `2`; the raw SVG
  `stroke-width` attribute is also accepted through rest attributes.
- `absoluteStrokeWidth` is **deprecated, not removed**. Prefer `nonScalingStroke`,
  which applies `vector-effect="non-scaling-stroke"` to shapes; it is not the old
  numeric resize formula. A table heading/divider in the research is structural,
  not additional API evidence.
- SVG attributes are supported. Any `aria-*`, `role`, `title`, or child snippet
  suppresses automatic `aria-hidden` inference. Name actual controls and keep
  their icons decorative; meaningful standalone icons need `role="img"` and an
  accessible name. Markup alone does not establish screen-reader certification.
- Use `LucideIcon` (`Component<LucideProps>`) for generated icon component values.
  `typeof Icon` refers to the generic custom-icon component, whose required
  custom-icon input makes it the wrong general icon-map type; a type-only import
  is not inherently invalid.
- Generic `Icon` still supports `iconNode: LucideIconNode[]` as one branch of its
  input union. Validate the actual typed node shape. Optional `@lucide/lab` was
  not part of that original review's runtime evidence; the current
  [advanced example](lucide-patterns.md#custom-icon-data-and-lab) has its own
  additional dependency and requires separately recorded verification.

These corrections come from the primary sources above and the exact installed
package, not from the research's wording. The [Lucide verification
guide](lucide.md#verification) specifies integration checks; no new runtime
outcome is implied by this source review.

## Offline installed-package inspection

1. Read manifest, lockfile, and installed metadata through the actual workspace
   dependency layout, including symlinks. Record resolved versions and overrides;
   preserve package manager and lockfile.
2. Read `exports`/`types`. In component 5.0.1, start at `dist/index.d.ts` and
   `dist/index.js`, then follow relative declarations and source. Inspect required
   props, callback payloads, snippet tuples, child members, and bindability.
3. Follow inherited Zag contracts through the installed dependency version, not
   rolling Zag documentation. Read implementation for rendered tags, hidden/native
   inputs, default styling, event forwarding, and lifecycle behavior.
4. Inspect core `src/index.css`, its imported utilities, and `src/themes/*.css`,
   plus Svelte package `dist/index.css`. Core exports only its root, themes, and
   package metadata; `/optional/presets` is obsolete. Inspect installed Svelte/Kit
   `types/index.d.ts` for framework contracts.
5. Compare only affected contracts when versions differ. Do not silently change
   dependencies to fit an example. Name missing evidence rather than inventing APIs.

For Lucide-specific exports, declarations, component source and context, use
[offline package inspection](lucide.md#offline-package-inspection). Resolve the
actual workspace dependency instead of assuming a flat `node_modules` layout;
internal file paths inspected here are not public import recommendations.

## Exact compatibility baseline and observed evidence

| Dependency/runtime | Exact baseline |
| --- | --- |
| Node / npm observed during installation | `24.15.0` / `12.2.0` |
| `@skeletonlabs/skeleton` / `@skeletonlabs/skeleton-svelte` | `5.0.1` / `5.0.1` |
| `svelte` / `@sveltejs/kit` | `5.57.2` / `3.1.0` |
| `vite` / `@sveltejs/vite-plugin-svelte` | `8.3.4` / `7.3.1` |
| `typescript` / `svelte-check` | `6.0.3` / `4.7.7` |
| `tailwindcss` / `@tailwindcss/vite` | `4.3.3` / `4.3.3` |
| `@sveltejs/adapter-auto` / `@tailwindcss/forms` | `8.0.0` / `0.5.11` |

Core requires Tailwind `^4.0.0`; components require Svelte `^5.40.0`. Kit 3.1.0
requires Node `>=22.17`, Svelte `^5.57.1`, Vite `^8.0.12`, and Svelte Vite plugin
`^7.0.0`; TypeScript `^6.0.0` is optional. Combined tool engines permit maintained
Node 22 from 22.17 or Node 24+; use a maintained compatible release. JavaScript-only
apps need not add TypeScript. Preserve the application's production adapter.
These pins and peers do not certify every version in their ranges.

**Independent Lucide package observation:** `@lucide/svelte@1.61.0` and its
Svelte `^5` peer were observed in registry metadata and the exact installed
package. This optional icon pin is separate from the historical stack table and
checks below. It does not retroactively add Lucide coverage to those runs.

**Original v5 baseline checks (2026-10-18):**

- The isolated installation added 130 packages without forced peers, using the
  exact versions above.
- Eighteen complete documented components were extracted into the fixture.
  `npm run check` checked 945 files with 0 errors and 0 warnings.
- Client and server production builds passed. `adapter-auto` found no production
  target; the environment emitted a `NO_COLOR`/`FORCE_COLOR` warning.
- `skills-ref validate` passed. Structural checks covered 11 Markdown files,
  99 local links, and 45 code fences with no failures.
- A consumer type proof accepted the catalog's 31 components, 200 listed anatomy
  members, and 30 helper exports. This establishes type availability, not runtime
  coverage of every export.

**Observed browser interactions:** Chromium **155.0.8059.84**, production preview:

| Scenario | Observed result |
| --- | --- |
| Tabs | Click, ArrowLeft, Home, and End updated focus, panels, and controlled state. |
| Accordion | Click selected cancel; Space collapsed the controlled value to none. |
| Switch/native form | Space changed state; `FormData` omitted unchecked notifications and included checked notifications as `on`. |
| Tooltip | Focus exposed portalled help with matching `aria-describedby`; Escape hid it. |
| Dialog | Title/description, initial Cancel focus, Tab containment, Escape focus restoration, Cancel, local confirmation, and 320px viewport fit passed. |
| Toast | The instance-owned group rendered title/description; Enter on its named Close removed it before auto-expiry. |
| Combobox | Keyboard selection, true empty results, full-list reopening, pointer/Space Clear, and disjoint controls passed. Open and closed popups fit 320px; controls had no overflow at 320, 375, and 1280px. |
| Pagination | Native page buttons accepted Enter; row slices, last-page boundaries, size reset, zero/one-row states, and parent-form non-submission passed. |
| Provider/custom element | Explicit-ID Tooltip provider, forwarded button attributes, getter state, and Escape worked. |
| Repeated instances | 55 IDs were unique; labels resolved; second Tabs/ProfilePreview/Dialog state remained isolated; Summary links focused their own heading. |
| Native field groups | Both documented grouped-field labels focused their own inputs; coordinated `field-xl`/`btn-xl` controls measured 42px high. |
| Native dialog/disclosure | `showModal`, Escape, dialog-form results, and independent exclusive disclosure groups worked. |
| Theme/motion | Light/dark pairings and independent local-scheme brand colors changed; application reduced-motion rules disabled native transitions. |
| Svelte state | Native parent binding updated the derived counter; route state rendered; media changes updated mounted state. |
| Server forms | Enhanced failure retained spaces and focused the invalid field. Native HTML POSTs preserved spaces and all 81 overlength characters; valid, missing, and file values followed the declared policy. |
| No JavaScript | Required validation, failed/successful native POSTs, disabled local previews/filters, four SSR briefs, and native navigation worked. |
| Responsive shell | Apply/reset/search/status/empty states, skip-link focus, and mobile section links worked; no overflow at 320/375/768/1280px. Narrow/wide screenshots were inspected. |
| Kit 3 navigation | Shallow address-bar metadata stayed distinct from rendered `page.url`; `refreshAll()` worked; persisted state survived reload. |

The hydrated preview had no recorded runtime or hydration errors. Script requests
were deliberately blocked in the no-JavaScript run; protocol inspection reported
`blockedReason: csp`, with no loading failures after JavaScript was re-enabled.
These observations do not certify a full contrast, forced-colors, text-zoom, or
screen-reader audit, every exported/beta component, framework file-upload or
monorepo runtime, concurrent authenticated-session isolation, or deployment.
`adapter-auto` had no production target. Local confirmations do not establish
persistence; historical v3 checks were not relabeled as v5 evidence.

### Supplemental validation — 2026-10-18

The supplemental review kept the exact dependency baseline above. A fresh
installation added **130 packages** without forced peers on Node **24.15.0** /
npm **12.2.0**. Eighteen named component files and their route/CSS examples were
extracted into a disposable application; the optional route-motion layout
replaced, rather than concatenated with, its baseline layout.

- `npm run check`: **926 files, 0 errors, 0 warnings**.
- `npm run build`: client/server production builds passed. `adapter-auto` again
  had no production target; the environment emitted the color-variable warning.
- `skills-ref validate skills/skeleton-svelte` and local link/fence checks passed.
- Generated Tailwind **4.3.3** CSS confirmed `@container-size` (and absence of
  `size-container`), documented scrollbar utilities, `zoom-125`, `tab-4`, custom
  easing, and an exclusive class in an explicitly registered external source.

Chromium **155.0.8059.84** production-preview checks covered:

| Scenario | Observed result |
| --- | --- |
| Spring selection | Text/pressed state, independent instances, eight rapid Space activations, destruction/remount, and live reduced-motion changes worked without unhandled rejections. |
| Initial reduced motion / no JavaScript | Preference set before hydration kept scale neutral and skipped route decoration. Without JavaScript, local selection controls remained disabled in SSR output. |
| Native route continuity | Native transitions, Kit 3 shallow filtering/state retention, route titles, and Back/Forward worked. Unsupported API and injected synchronous setup failure still navigated. |
| Native rejection/cancellation paths | Explicit skip, duplicate-name snapshot failure, a deferred-update timeout, rapid navigation cancelling an active decoration, and an injected update-callback rejection completed without blocking the final route or producing unhandled rejections. |
| CSS extensions | Frame padding changed from 1px to 3px; opacity changed from 0.6 to 0.25 without new classes. Linear/radial/conic gradients rendered, custom easing resolved, and the solid reading surface inverted with color scheme. |
| Visual inspection | CSS-extension screenshots were inspected at 1280px dark and 320px light; the narrow page had no horizontal overflow. |
| Existing behavior | Tabs selected Activity; keyboard Switch state matched native `FormData`. Enhanced and no-JavaScript native POST failures preserved exact whitespace; enhanced failure focused the input and native success rendered its greeting. |

The hydrated normal, unsupported-API, and initial-reduced-motion runs recorded
no runtime/hydration errors. Fifteen scenario groups were retained in the review
evidence. A 13-section coverage audit had no batch errors, input exclusions, or
truncations; advisory safety/low-confidence flags were manually adjudicated
against sources, declarations, and the affected runtime cases, with no unresolved
concrete coverage finding.

These checks do **not** establish older-browser fallback coverage, production
Core Web Vitals, screen-reader announcements, full WCAG conformance, exhaustive
Marquee/FloatingPanel behavior, deployment, or every possible navigation race.
Fault injection tested decoration handling; it did not turn failed application
operations into successes. The temporary research and disposable fixture are not
required to consume this skill.

### Lucide validation — 2026-10-22

A fresh fixture installed **131 packages** without forced peers: the exact
framework/toolchain table above plus **`@lucide/svelte@1.61.0`**. Node/npm were
**24.15.0 / 12.2.0**. Twenty-eight named documentation inputs were extracted,
including **24 component files** and all **six Lucide example files**; the
context child was rendered through its documented parent.

- `npm run check`: **5,013 files, 0 errors, 0 warnings**.
- `npm run build`: client/server production builds passed. Adapter-auto had no
  production target; environmental color and occasional bundler-timing notices
  were not deployment or performance certification.
- Skill-format validation and local link/fence checks passed.
- Production module evidence retained exactly **seven used icon implementations**
  in both client and server output. The fixture used per-icon imports, public
  root imports, custom `Icon`, and a finite map; this is observed tree-shaking,
  not a blanket speed or bundle-size guarantee.

Production preview used Chromium **156.0.8078.47**, with 13 recorded scenario
groups covering the following:

| Area | Observed result |
| --- | --- |
| SSR and no JavaScript | Nine inline SVGs rendered; local counter/tooltip controls remained disabled, context attributes were present, and native fragment links worked. |
| Names and native interaction | Click/Space incremented the counter and Reset cleared it. Chromium's actual AX tree ignored seven decorative SVGs and exposed the two named meaningful images. |
| Skeleton composition | The element-snippet trigger was one named native button with a direct SVG child. Focus/hover opened its associated tooltip; Escape dismissed it. |
| Reusable/runtime data | Repeated counters stayed independent; all fragment IDs were unique and resolved. Finite component selection changed icons, retained text for unknown/prototype keys, and recovered to a known key. |
| Props, CSS, and context | Public root and per-icon Camera geometry matched. Default SVG size/stroke was 24/2; context 32/1 and explicit 20/2 worked. Raw SVG stroke attributes and CSS size/stroke overrides behaved as documented. Direct versus wrapped control icons measured 16 versus 24px. |
| Stroke mechanisms | `nonScalingStroke` added per-shape vector effects. Deprecated `absoluteStrokeWidth` still worked through its different numeric mechanism; no removal claim was inferred. |
| Theme and fallbacks | `currentColor` followed control foreground in light/dark schemes. Forced-colors emulation kept meaningful icons visible in the forced foreground; static icons remained nonanimated with reduced motion. |
| Responsive rendering | Open tooltips and the page fit 320/375/768/1280px widths. At 320px, content was bounded to the available 304px. Narrow light, wide dark, and forced-colors screenshots were inspected. |
| Existing server actions | Native HTML POST failure preserved exact whitespace; valid input rendered its greeting. |

Runtime inspection found and corrected two new-example defects: primary-500
counter text measured **3.62:1** contrast in the tested theme, so it now uses a
neutral filled preset; tooltip intrinsic width exceeded 320px, so its content
now consumes `--available-width`. Both fixes were rebuilt and re-exercised.
Targeted **axe-core 4.13.0** scans of the final icon demo reported **0 violations**
in light and dark schemes. The hydrated run recorded no runtime/hydration errors
or unhandled rejections.

These results are not a screen-reader, full WCAG, all-theme, cross-browser,
deployment, future-version, live-context-mutation, or Lucide Lab certification.
The disposable fixture and module-analysis instrumentation are not required to
consume the skill; the underlying application still owns real persistence.

### Lucide review expansion — source evidence and verification boundary

**Observed 2026-10-22.** Current official documentation was retrieved through
Context7 and primary Lucide pages, then checked against exact installed source.
A fresh fixture added **132 packages** with `--ignore-scripts`, without forced
peers: the framework baseline above, `@lucide/svelte@1.61.0`, and the optional
`@lucide/lab@0.7.0`. Node/npm remained **24.15.0 / 12.2.0**.

All **12 named Lucide component files** were extracted verbatim: the original six
plus six advanced files. Child components were mounted through their parents;
artwork was mounted twice to check association isolation.

- `npm run check` (`svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`):
  **4,993 files, 0 errors, 0 warnings**.
- Client/server production builds passed, including the optional Lab import.
  Adapter-auto still had no deployment target; the environment emitted the
  `NO_COLOR`/`FORCE_COLOR` notice.
- `skills-ref validate` and local link/fence checks passed.
- The documented offline lookup ran from the consuming fixture. Digit/acronym
  mappings `ArrowDown01` → `arrow-down-0-1` and `ArrowDownAZ` → `arrow-down-a-z`
  resolved through public exports; declarations identified deprecated
  `ArrowDownAz`. No Svelte component evaluation was required for inspection.

Chromium **156.0.8078.47**, production preview:

| Area | Observed result |
| --- | --- |
| Reactive consumer | Heart changed to Star; computed dimensions changed from 32 to 64px, stroke from 2 to 1px, and the checkbox added/removed per-shape non-scaling vectors. Approved raw/data attributes reached the decorative SVG. Favorite changed native `aria-pressed` and visible status. |
| External-key boundary | Unknown and `__proto__` keys produced working text-only controls; keyboard activation worked, state survived the fallback, and a known key restored the icon. |
| Composition and names | Duplicate artwork had distinct title IDs and correct associations. The native AX tree inspected 13 new-example SVGs: nine were ignored; four were named images, including two “Scanned user” instances. The nested user SVG stayed decorative. |
| Fill, custom data, and Lab | Outline/filled star paint and stroke differed as documented. The `icon` data branch rendered its circle/path; Lab's `iconNode` branch rendered two paths whose geometry exactly matched the installed `pear` export. |
| Directional navigation | RTL mirrored only the navigation arrow, not the checkmark. Keyboard activation reached the real fragment target; returning to LTR removed mirroring. |
| SSR without JavaScript | All 22 SVGs rendered, including Lab and composed artwork; nine local controls were disabled. The initial heart and meaningful names were present, and native fragment navigation worked. |
| Theme regression | Forms normalization initially produced 1.02:1 dark input text contrast. Skeleton `input`/`select` classes corrected the input/select text backdrop to 18.26:1; select text was checked in both schemes. |
| Responsive and existing behavior | Final screenshots were inspected at 320px light and 1280px dark. The narrow page had no horizontal overflow; its input measured 288px. Existing Add/Reset worked, and the settled keyboard/hover tooltip remained 304px wide within the 320px viewport. |

Final **axe-core 4.13.0** scans reported **0 violations and one needs-review
result in each scheme**. The remaining result concerned the select's CSS
background-image caret; its solid text backdrop was checked using computed,
composited colors and visual inspection rather than suppressing the rule.
Browser diagnostics recorded no runtime/hydration errors.

Fixture-only preparation defects were corrected before final gates: missing Kit
type generation, an executed inspector accidentally included by the root
checker glob, and a missing document title. The documented heredoc itself
creates no inspector file. Temporary fixtures and browser sessions were removed.

This separately establishes the recorded advanced examples, not all Lab exports,
live context mutation, native popup rendering on every platform, screen-reader
announcements, full WCAG conformance, cross-browser support, deployment, or
future-version compatibility.

## Maintenance and future re-verification

1. Record date, runtime, package manager, exact resolved versions, lockfile, and
   workspace configuration. Do not generalize one fixture to an entire peer range.
2. Compare exact metadata, exports, declarations, source, and CSS with current v5
   docs. Use archives only for authorized staged migration. Review engines,
   optional peers, adapters, public entrypoints, tokens, and source detection.
3. Update every affected example, caller, reference, and task route together.
   Remove obsolete APIs rather than retaining compatibility shims.
4. In an authorized disposable fixture or application workflow, install without
   forced peers; extract complete documented examples/configuration. Run project
   checks and production build after edits finish. Record actual commands, results,
   warnings, and failures; do not predict counts.
5. Exercise hydration, repeated-instance associations, callback state, providers,
   keyboard/focus, overlays, responsive/theme/mode rendering, native/enhanced forms,
   raw failed values, and no-JavaScript behavior as applicable. Report browser and
   exact interactions; visual checks do not certify accessibility.
6. Verify request isolation, production adapter, and deployment target separately
   when required. Record unavailable checks and remaining limits explicitly.

## Portable distribution and installation

Distribute the entire `skeleton-svelte/` directory with `SKILL.md` and `references/`
intact. Follow the consumer host's documented skill-discovery instructions; retain
its directory name, relative links, and filenames. Do not ship only `SKILL.md`,
flatten references, or depend on authoring-workspace absolute paths.

There is no universal host-specific installation path in this format. Refresh
host discovery only when required. Installing the skill copies documentation,
not application dependencies or a verified toolchain, and does not mandate its use
for unrelated UI work. Bundled references and installed-package inspection work
offline; dependency installation uses the application's normal registry/cache.
