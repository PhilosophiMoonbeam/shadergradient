#!/usr/bin/env bash
# sync-docs.sh — Idempotent vendor of Threlte docs + examples
#
# Sources (from threlte/threlte monorepo):
#   1. apps/docs/src/content/ → docs/     (narrative MDX)
#   2. apps/docs/src/examples/ → examples/ (Svelte/TS example components)
#
# Usage:
#   bash scripts/sync-docs.sh                    # defaults (main branch)
#   bash scripts/sync-docs.sh --ref main         # pin branch/tag/SHA
#   bash scripts/sync-docs.sh --dry-run          # show what would change
#
# Deterministic: same inputs → same outputs. Re-run to upgrade.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
REPO="threlte/threlte"
REF="main"
DOCS_SUBPATH="apps/docs/src/content"
EXAMPLES_SUBPATH="apps/docs/src/examples"
DRY_RUN=false

# ── Parse args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
	case "$1" in
		--ref)
			REF="$2"
			shift 2
			;;
		--dry-run)
			DRY_RUN=true
			shift
			;;
		-h | --help)
			sed -n '2,/^$/s/^# //p' "$0"
			exit 0
			;;
		*)
			echo "Unknown arg: $1" >&2
			exit 1
			;;
	esac
done

# ── Paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "${SCRIPT_DIR}")"
DOCS_DIR="${SKILL_DIR}/docs"
EXAMPLES_DIR="${SKILL_DIR}/examples"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

log() { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
err() { printf '\033[1;31mERR: %s\033[0m\n' "$*" >&2; }

# ── Preflight checks ─────────────────────────────────────────────────
for cmd in curl tar python3; do
	command -v "${cmd}" >/dev/null 2>&1 || {
		err "Missing: ${cmd}"
		exit 1
	}
done

# Optional GitHub auth — raises API rate limits (CI passes GITHUB_TOKEN).
GH_AUTH=()
GH_API_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
[[ -n "${GH_API_TOKEN}" ]] && GH_AUTH=(-H "Authorization: Bearer ${GH_API_TOKEN}")

# ── 1. Download repo tarball ──────────────────────────────────────────
log "Downloading ${REPO}@${REF}"

TARBALL_URL="https://api.github.com/repos/${REPO}/tarball/${REF}"
curl "${GH_AUTH[@]+"${GH_AUTH[@]}"}" -sL "${TARBALL_URL}" -o "${TMP_DIR}/repo.tar.gz"

tar xzf "${TMP_DIR}/repo.tar.gz" -C "${TMP_DIR}"
EXTRACTED_ROOT="$(find "${TMP_DIR}" -maxdepth 1 -type d -name 'threlte-threlte-*' | head -1)"

if [[ -z "${EXTRACTED_ROOT}" ]]; then
	err "Could not find extracted repo directory"
	exit 1
fi

# Validate expected paths exist
for subpath in "${DOCS_SUBPATH}" "${EXAMPLES_SUBPATH}"; do
	if [[ ! -d "${EXTRACTED_ROOT}/${subpath}" ]]; then
		err "${subpath} not found in tarball"
		exit 1
	fi
done

# ── 2. Vendor docs content ───────────────────────────────────────────
DOC_COUNT="$(find "${EXTRACTED_ROOT}/${DOCS_SUBPATH}" \( -name '*.md' -o -name '*.mdx' \) | wc -l | tr -d ' ')"
info "Found ${DOC_COUNT} doc files"

if ${DRY_RUN}; then
	info "[dry-run] Would sync ${DOC_COUNT} doc files to ${DOCS_DIR}/"
else
	rm -rf "${DOCS_DIR}"
	mkdir -p "${DOCS_DIR}"
	# Copy only text docs (MD/MDX) — skip any binary assets
	(cd "${EXTRACTED_ROOT}/${DOCS_SUBPATH}" && find . \( -name '*.md' -o -name '*.mdx' \) -print0 \
		| while IFS= read -r -d '' f; do
			mkdir -p "${DOCS_DIR}/$(dirname "${f}")"
			cp "${f}" "${DOCS_DIR}/${f}"
		done)
	info "Synced ${DOC_COUNT} doc files to docs/"
fi

# ── 3. Vendor examples ───────────────────────────────────────────────
EXAMPLE_COUNT="$(find "${EXTRACTED_ROOT}/${EXAMPLES_SUBPATH}" -type f | wc -l | tr -d ' ')"
info "Found ${EXAMPLE_COUNT} example files"

if ${DRY_RUN}; then
	info "[dry-run] Would sync ${EXAMPLE_COUNT} example files to ${EXAMPLES_DIR}/"
else
	rm -rf "${EXAMPLES_DIR}"
	mkdir -p "${EXAMPLES_DIR}"
	# Copy all example files (Svelte, TS, GLSL, JSON, etc.)
	(cd "${EXTRACTED_ROOT}/${EXAMPLES_SUBPATH}" && find . -type f -print0 \
		| while IFS= read -r -d '' f; do
			mkdir -p "${EXAMPLES_DIR}/$(dirname "${f}")"
			cp "${f}" "${EXAMPLES_DIR}/${f}"
		done)
	info "Synced ${EXAMPLE_COUNT} example files to examples/"
fi

# ── 4. Resolve commit SHA ────────────────────────────────────────────
RESOLVED_SHA="$(curl "${GH_AUTH[@]+"${GH_AUTH[@]}"}" -s "https://api.github.com/repos/${REPO}/commits/${REF}" \
	| python3 -c "import json,sys; print(json.load(sys.stdin).get('sha','unknown')[:12])")"

# ── 5. Generate routing map ──────────────────────────────────────────
if ! ${DRY_RUN}; then
	log "Generating routing map"

	ROUTING_MAP="${SKILL_DIR}/references/routing-map.md"

	# Classify docs into Learn vs Reference tracks, then by category
	declare -a LEARN_GETTING_STARTED=() LEARN_BASICS=() LEARN_ADVANCED=()
	declare -a REF_CORE=() REF_EXTRAS=() REF_GLTF=() REF_RAPIER=()
	declare -a REF_THEATRE=() REF_XR=() REF_FLEX=() REF_STUDIO=()
	declare -a OTHER=()

	frontmatter="$(python3 "${SCRIPT_DIR}/parse-frontmatter.py" "${DOCS_DIR}")"

	while IFS=$'\t' read -r rel_path title; do
		[[ -z "${rel_path}" ]] && continue

		# Classify by directory structure
		case "${rel_path}" in
			learn/getting-started/*) LEARN_GETTING_STARTED+=("${title}"$'\t'"${rel_path}") ;;
			learn/basics/*) LEARN_BASICS+=("${title}"$'\t'"${rel_path}") ;;
			learn/advanced/*) LEARN_ADVANCED+=("${title}"$'\t'"${rel_path}") ;;
			reference/core/*) REF_CORE+=("${title}"$'\t'"${rel_path}") ;;
			reference/extras/*) REF_EXTRAS+=("${title}"$'\t'"${rel_path}") ;;
			reference/gltf/*) REF_GLTF+=("${title}"$'\t'"${rel_path}") ;;
			reference/rapier/*) REF_RAPIER+=("${title}"$'\t'"${rel_path}") ;;
			reference/theatre/*) REF_THEATRE+=("${title}"$'\t'"${rel_path}") ;;
			reference/xr/*) REF_XR+=("${title}"$'\t'"${rel_path}") ;;
			reference/flex/*) REF_FLEX+=("${title}"$'\t'"${rel_path}") ;;
			reference/studio/*) REF_STUDIO+=("${title}"$'\t'"${rel_path}") ;;
			*) OTHER+=("${title}"$'\t'"${rel_path}") ;;
		esac
	done <<<"${frontmatter}"

	# Write routing map
	write_section() {
		local header="$1"
		shift
		local -a entries=("$@")
		[[ ${#entries[@]} -eq 0 ]] && return

		printf '\n## %s\n\n| Title | File |\n|-------|------|\n' "${header}" >>"${ROUTING_MAP}"
		printf '%s\n' "${entries[@]}" | sort -t$'\t' -k1,1 | while IFS=$'\t' read -r title rel; do
			# shellcheck disable=SC2016 # backticks are literal markdown
			printf '| %s | `docs/%s` |\n' "${title}" "${rel}" >>"${ROUTING_MAP}"
		done
	}

	cat >"${ROUTING_MAP}" <<HEADER
# Routing Map

Auto-generated from vendored doc frontmatter. Topic → doc file.
Load the file matching the user's question.

Pinned to commit \`${RESOLVED_SHA}\`.
HEADER

	write_section "Learn: Getting Started" "${LEARN_GETTING_STARTED[@]+"${LEARN_GETTING_STARTED[@]}"}"
	write_section "Learn: Basics" "${LEARN_BASICS[@]+"${LEARN_BASICS[@]}"}"
	write_section "Learn: Advanced" "${LEARN_ADVANCED[@]+"${LEARN_ADVANCED[@]}"}"
	write_section "@threlte/core" "${REF_CORE[@]+"${REF_CORE[@]}"}"
	write_section "@threlte/extras" "${REF_EXTRAS[@]+"${REF_EXTRAS[@]}"}"
	write_section "@threlte/gltf" "${REF_GLTF[@]+"${REF_GLTF[@]}"}"
	write_section "@threlte/rapier" "${REF_RAPIER[@]+"${REF_RAPIER[@]}"}"
	write_section "@threlte/theatre" "${REF_THEATRE[@]+"${REF_THEATRE[@]}"}"
	write_section "@threlte/xr" "${REF_XR[@]+"${REF_XR[@]}"}"
	write_section "@threlte/flex" "${REF_FLEX[@]+"${REF_FLEX[@]}"}"
	write_section "@threlte/studio" "${REF_STUDIO[@]+"${REF_STUDIO[@]}"}"
	write_section "Other" "${OTHER[@]+"${OTHER[@]}"}"

	ENTRY_COUNT="$(grep -c '^|[^-]' "${ROUTING_MAP}" || true)"
	info "Generated routing map with ${ENTRY_COUNT} entries"
fi

# ── 6. Generate source index ─────────────────────────────────────────
if ! ${DRY_RUN}; then
	log "Writing provenance to references/source-index.md"

	sync_date="$(date -u +%Y-%m-%d)"

	cat >"${SKILL_DIR}/references/source-index.md" <<EOF
# Source Index

Canonical sources and version pins for vendored content.

## Provenance

| Source | Ref | Resolved | Date |
|--------|-----|----------|------|
| [threlte/threlte](https://github.com/${REPO}) | \`${REF}\` | \`${RESOLVED_SHA}\` | ${sync_date} |

## External references (not vendored)

- [threlte.xyz](https://threlte.xyz/) — official docs site
- [GitHub repo](https://github.com/${REPO}) — source code

## Re-sync

\`\`\`bash
# Update to latest
bash scripts/sync-docs.sh

# Pin specific commit
bash scripts/sync-docs.sh --ref ${RESOLVED_SHA}
\`\`\`

## Vendored layout

- \`docs/\` — narrative MDX from apps/docs/src/content/ (${DOC_COUNT} files)
- \`examples/\` — Svelte example components from apps/docs/src/examples/ (${EXAMPLE_COUNT} files)

## Package order (from docs navigation)

1. \`@threlte/core\`
2. \`@threlte/extras\`
3. \`@threlte/gltf\`
4. \`@threlte/rapier\`
5. \`@threlte/theatre\`
6. \`@threlte/xr\`
7. \`@threlte/flex\`
8. \`@threlte/studio\`

## Freshness rule

Guidance is pinned to versions above. When user asks about newer APIs:
1. Answer with pinned guidance first
2. State version limit
3. Recommend checking latest docs
EOF
fi

# ── Summary ───────────────────────────────────────────────────────────
log "Done"
info "commit: ${RESOLVED_SHA} (ref: ${REF})"
info "Docs: ${DOC_COUNT} files  |  Examples: ${EXAMPLE_COUNT} files"
${DRY_RUN} && info "(dry-run — no files written)"
exit 0
