#!/usr/bin/env bash
# =============================================================================
# scripts/release-tag.sh
#
# Safe Loom release: dev → main merge → version bump → annotated tag →
# push main + tag → merge version bump back to dev → push dev.
#
# Usage:
#   ./scripts/release-tag.sh --version 0.1.0-beta.4 --dry-run
#   ./scripts/release-tag.sh --version 0.1.0-beta.4 --execute
#   ./scripts/release-tag.sh --version 0.1.0-beta.4 --execute --remote upstream
#   ./scripts/release-tag.sh --version 0.1.0-beta.4 --execute --dev dev --main main
#
# Options:
#   --version <semver>   Required. Target version (e.g. 0.1.0-beta.4)
#   --dry-run            Inspect and report; do not change anything
#   --execute            Run the full release flow
#   --remote <name>      Git remote name (default: origin)
#   --dev <branch>       Dev branch name (default: dev)
#   --main <branch>      Main branch name (default: main)
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

# ── colour helpers ────────────────────────────────────────────────────────────
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
NC=$'\033[0m'

step()    { printf "\n${BOLD}${BLUE}[%-12s]${NC} %s\n" "$1" "$2"; }
ok()      { printf "  ${GREEN}✓${NC}  %s\n" "$1"; }
warn()    { printf "  ${YELLOW}⚠${NC}  %s\n" "$1"; }
info()    { printf "  ${CYAN}→${NC}  %s\n" "$1"; }
fail()    { printf "\n${RED}${BOLD}✗ ERROR:${NC} %s\n" "$1" >&2; }
cmd_echo(){ printf "  ${YELLOW}$${NC} %s\n" "$*"; }

die() {
  fail "$1"
  exit 1
}

# ── argument parsing ──────────────────────────────────────────────────────────
TARGET_VERSION=""
MODE=""
REMOTE="origin"
DEV_BRANCH="dev"
MAIN_BRANCH="main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)  [[ $# -gt 1 ]] || die "--version requires a value"; TARGET_VERSION="$2"; shift 2 ;;
    --dry-run)  MODE="dry-run"; shift ;;
    --execute)  MODE="execute"; shift ;;
    --remote)   [[ $# -gt 1 ]] || die "--remote requires a value";  REMOTE="$2"; shift 2 ;;
    --dev)      [[ $# -gt 1 ]] || die "--dev requires a value";     DEV_BRANCH="$2"; shift 2 ;;
    --main)     [[ $# -gt 1 ]] || die "--main requires a value";    MAIN_BRANCH="$2"; shift 2 ;;
    --help|-h)
      sed -n '/^# Usage:/,/^# =====/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)  die "Unknown option: $1. Use --help for usage." ;;
  esac
done

[[ -n "$TARGET_VERSION" ]] || die "--version is required."
[[ -n "$MODE" ]]           || die "Specify --dry-run or --execute."

TAG_NAME="v${TARGET_VERSION}"

# ── semver-ish validation ─────────────────────────────────────────────────────
# Accepts: MAJOR.MINOR.PATCH[-prerelease]
if ! printf '%s' "$TARGET_VERSION" \
     | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._-]+)?$'; then
  die "Invalid version '${TARGET_VERSION}'. Expected format: MAJOR.MINOR.PATCH[-prerelease]  (e.g. 0.1.0-beta.4)"
fi

# =============================================================================
# SAFETY CHECKS
# =============================================================================
step "check" "Running safety checks…"

# 1. Repository root
if [[ ! -f "package.json" ]] || \
   [[ ! -f "services/loom-service/Cargo.toml" ]] || \
   [[ ! -d ".git" ]]; then
  die "Script must be run from the repository root (package.json, services/loom-service/Cargo.toml, and .git/ must exist)."
fi
ok "Running from repository root"

# 2. No merge / rebase / cherry-pick in progress
for state_file in .git/MERGE_HEAD .git/REBASE_HEAD .git/CHERRY_PICK_HEAD .git/REVERT_HEAD; do
  if [[ -f "$state_file" ]]; then
    die "Repository has an in-progress operation (${state_file} exists). Resolve it before releasing."
  fi
done
ok "No in-progress merge/rebase/cherry-pick"

# 3. Working tree is clean
DIRTY=$(git status --porcelain 2>/dev/null)
if [[ -n "$DIRTY" ]]; then
  fail "Working tree is not clean. Commit or stash changes first:"
  printf '%s\n' "$DIRTY" >&2
  exit 1
fi
ok "Working tree is clean"

# 4. Local branches exist
git rev-parse --verify "${DEV_BRANCH}"  >/dev/null 2>&1 \
  || die "Local branch '${DEV_BRANCH}' not found."
git rev-parse --verify "${MAIN_BRANCH}" >/dev/null 2>&1 \
  || die "Local branch '${MAIN_BRANCH}' not found."
ok "Local branches '${DEV_BRANCH}' and '${MAIN_BRANCH}' exist"

# 5. Remote exists
git remote get-url "${REMOTE}" >/dev/null 2>&1 \
  || die "Remote '${REMOTE}' not found. Use --remote to specify a different remote."
ok "Remote '${REMOTE}' reachable"

# 6. Fetch remote refs (read-only — safe in both modes)
info "Fetching ${REMOTE} to check remote state…"
git fetch "${REMOTE}" --tags --quiet
ok "Remote refs updated"

# 7. Tag must not exist locally or remotely
if git tag -l "${TAG_NAME}" | grep -q "^${TAG_NAME}$"; then
  die "Tag '${TAG_NAME}' already exists locally. Choose a different version or delete the existing tag."
fi
if git ls-remote --tags "${REMOTE}" "refs/tags/${TAG_NAME}" | grep -q "${TAG_NAME}"; then
  die "Tag '${TAG_NAME}' already exists on remote '${REMOTE}'. Choose a different version."
fi
ok "Tag '${TAG_NAME}' does not exist yet"

# 8. dev is up to date with origin/dev
DEV_LOCAL=$(git  rev-parse "${DEV_BRANCH}")
DEV_REMOTE=$(git rev-parse "${REMOTE}/${DEV_BRANCH}" 2>/dev/null \
             || die "Remote branch '${REMOTE}/${DEV_BRANCH}' not found. Push '${DEV_BRANCH}' first.")
if [[ "$DEV_LOCAL" != "$DEV_REMOTE" ]]; then
  fail "'${DEV_BRANCH}' (${DEV_LOCAL:0:8}) differs from '${REMOTE}/${DEV_BRANCH}' (${DEV_REMOTE:0:8})."
  info "Run: git push ${REMOTE} ${DEV_BRANCH}   (if dev is ahead)"
  info "  or: git pull --ff-only ${REMOTE} ${DEV_BRANCH}   (if remote is ahead)"
  exit 1
fi
ok "'${DEV_BRANCH}' is in sync with '${REMOTE}/${DEV_BRANCH}' (${DEV_LOCAL:0:8})"

# 9. main is up to date with origin/main
MAIN_LOCAL=$(git  rev-parse "${MAIN_BRANCH}")
MAIN_REMOTE=$(git rev-parse "${REMOTE}/${MAIN_BRANCH}" 2>/dev/null \
              || die "Remote branch '${REMOTE}/${MAIN_BRANCH}' not found.")
if [[ "$MAIN_LOCAL" != "$MAIN_REMOTE" ]]; then
  fail "'${MAIN_BRANCH}' (${MAIN_LOCAL:0:8}) differs from '${REMOTE}/${MAIN_BRANCH}' (${MAIN_REMOTE:0:8})."
  info "Run: git pull --ff-only ${REMOTE} ${MAIN_BRANCH}"
  exit 1
fi
ok "'${MAIN_BRANCH}' is in sync with '${REMOTE}/${MAIN_BRANCH}' (${MAIN_LOCAL:0:8})"

# =============================================================================
# VERSION FILE INSPECTION
# =============================================================================
step "version" "Inspecting version references…"

# Read current version from package.json (pure shell, no jq required)
CURRENT_VERSION=$(grep '"version"' package.json \
  | head -1 \
  | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

[[ -n "$CURRENT_VERSION" ]] \
  || die "Could not read current version from package.json."

if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
  die "Target version '${TARGET_VERSION}' equals current version. Nothing to bump."
fi

ok "Current version: ${CURRENT_VERSION}"
ok "Target version:  ${TARGET_VERSION}  (tag: ${TAG_NAME})"

# ── approved version files ────────────────────────────────────────────────────
# Only package.json is bumped in every release.
# All other files containing the version string are allowlisted below or
# flagged as unexpected.
APPROVED_FILES=("package.json")

# ── allowlisted files (known, intentionally not bumped) ──────────────────────
# package-lock.json  — lockfile drifted from package.json intentionally;
#                      regenerated by `npm install`, not part of the manual flow.
# Cargo.toml         — loom-service uses an independent version scheme (0.1.0, no beta).
# Cargo.lock         — follows Cargo.toml, not the app version.
# electron/package-dev.mjs — hardcoded "0.1.0" manifest, independent of app version.
ALLOWLISTED_FILES=(
  "package-lock.json"
  "services/loom-service/Cargo.toml"
  "services/loom-service/Cargo.lock"
  "electron/package-dev.mjs"
)

# ── scan for current version string across the repo ──────────────────────────
# grep may return non-zero if nothing found; treat that as "no matches"
SCAN_HITS=$(git grep -l --fixed-strings "${CURRENT_VERSION}" \
            -- ':!node_modules' ':!dist/' ':!dist-electron/' ':!release/' \
               ':!target/' ':!*.png' ':!*.jpg' ':!*.ico' ':!*.icns' ':!*.dmg' \
            2>/dev/null || true)

UNEXPECTED_FILES=()
while IFS= read -r hit; do
  [[ -z "$hit" ]] && continue
  is_approved=false
  is_allowlisted=false
  for f in "${APPROVED_FILES[@]}";     do [[ "$hit" == "$f" ]] && is_approved=true;     break; done
  for f in "${ALLOWLISTED_FILES[@]}";  do [[ "$hit" == "$f" ]] && is_allowlisted=true;  break; done
  if ! $is_approved && ! $is_allowlisted; then
    UNEXPECTED_FILES+=("$hit")
  fi
done <<< "$SCAN_HITS"

info "Files containing '${CURRENT_VERSION}':"
while IFS= read -r hit; do
  [[ -z "$hit" ]] && continue
  is_approved=false
  for f in "${APPROVED_FILES[@]}"; do [[ "$hit" == "$f" ]] && is_approved=true; break; done
  if $is_approved; then
    ok "  ${hit}  [will bump]"
  else
    warn "  ${hit}  [allowlisted / not bumped]"
  fi
done <<< "$SCAN_HITS"

if [[ ${#UNEXPECTED_FILES[@]} -gt 0 ]]; then
  fail "Unexpected files contain the current version string. Review and add them to the allowlist in this script if intentional:"
  for f in "${UNEXPECTED_FILES[@]}"; do
    printf "    %s\n" "$f" >&2
  done
  exit 1
fi
ok "Version file audit passed"

# =============================================================================
# DRY-RUN REPORT
# =============================================================================
if [[ "$MODE" == "dry-run" ]]; then
  CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "(detached HEAD)")

  step "dry-run" "Dry-run report — no changes will be made"
  printf "\n"
  printf "  %-28s %s\n" "Current branch:"        "$CURRENT_BRANCH"
  printf "  %-28s %s\n" "${DEV_BRANCH} HEAD:"    "${DEV_LOCAL:0:8}  $(git log -1 --format='%s' "${DEV_BRANCH}")"
  printf "  %-28s %s\n" "${MAIN_BRANCH} HEAD:"   "${MAIN_LOCAL:0:8}  $(git log -1 --format='%s' "${MAIN_BRANCH}")"
  printf "  %-28s %s\n" "${REMOTE}/${DEV_BRANCH} HEAD:"  "${DEV_REMOTE:0:8}"
  printf "  %-28s %s\n" "${REMOTE}/${MAIN_BRANCH} HEAD:" "${MAIN_REMOTE:0:8}"
  printf "  %-28s %s\n" "Current version:"       "$CURRENT_VERSION"
  printf "  %-28s %s\n" "Target version:"        "$TARGET_VERSION"
  printf "  %-28s %s\n" "Tag:"                   "$TAG_NAME"
  printf "  %-28s %s\n" "Tag already exists:"    "no"
  printf "  %-28s %s\n" "Files that would bump:" "${APPROVED_FILES[*]}"
  printf "\n"

  step "dry-run" "Commands that would run in --execute mode"
  printf '%s\n' "" "${BOLD}  [validate]${NC}"
  cmd_echo "git checkout ${DEV_BRANCH}"
  cmd_echo "git pull --ff-only ${REMOTE} ${DEV_BRANCH}"
  cmd_echo "npm run build"
  cmd_echo "npx vitest run"
  cmd_echo "cargo check --manifest-path services/loom-service/Cargo.toml"
  cmd_echo "cargo test --manifest-path services/loom-service/Cargo.toml"
  cmd_echo "npm run service:test"
  cmd_echo "git diff --check"
  printf '%s\n' "" "${BOLD}  [merge]${NC}"
  cmd_echo "git checkout ${MAIN_BRANCH}"
  cmd_echo "git pull --ff-only ${REMOTE} ${MAIN_BRANCH}"
  cmd_echo "git merge --no-ff ${DEV_BRANCH} -m \"Release ${TAG_NAME}\""
  printf '%s\n' "" "${BOLD}  [version]${NC}"
  for f in "${APPROVED_FILES[@]}"; do
    cmd_echo "sed: bump ${CURRENT_VERSION} → ${TARGET_VERSION} in ${f}"
  done
  cmd_echo "git add ${APPROVED_FILES[*]}"
  cmd_echo "git commit -m \"chore: bump version to ${TARGET_VERSION}\""
  printf '%s\n' "" "${BOLD}  [tag]${NC}"
  cmd_echo "git tag -a \"${TAG_NAME}\" -m \"Loom ${TAG_NAME}\""
  printf '%s\n' "" "${BOLD}  [push]${NC}"
  cmd_echo "git push ${REMOTE} ${MAIN_BRANCH}"
  cmd_echo "git push ${REMOTE} ${TAG_NAME}"
  printf '%s\n' "" "${BOLD}  [back-merge]${NC}"
  cmd_echo "git checkout ${DEV_BRANCH}"
  cmd_echo "git pull --ff-only ${REMOTE} ${DEV_BRANCH}"
  cmd_echo "git merge --no-ff ${MAIN_BRANCH} -m \"Merge version bump ${TARGET_VERSION} back to ${DEV_BRANCH}\""
  cmd_echo "git push ${REMOTE} ${DEV_BRANCH}"

  printf '%s\n' "" "${GREEN}${BOLD}Dry run complete. No changes made.${NC}" ""
  exit 0
fi

# =============================================================================
# EXECUTE MODE
# =============================================================================
ORIGINAL_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

cleanup_on_error() {
  local exit_code=$?
  [[ $exit_code -eq 0 ]] && return
  printf '%s\n' "" "${RED}${BOLD}Release failed at the step above.${NC}" >&2
  if [[ -n "$ORIGINAL_BRANCH" ]]; then
    printf "  Original branch: %s\n" "$ORIGINAL_BRANCH" >&2
    printf "  Current branch:  %s\n" "$(git symbolic-ref --short HEAD 2>/dev/null || echo '(detached)')" >&2
    printf "\n  Recovery: git checkout %s\n" "$ORIGINAL_BRANCH" >&2
  fi
}
trap cleanup_on_error EXIT

# ── step 1 + 2: checkout dev, pull, validate ─────────────────────────────────
step "validate" "Checking out '${DEV_BRANCH}' and validating…"

git checkout "${DEV_BRANCH}"
git pull --ff-only "${REMOTE}" "${DEV_BRANCH}"

info "npm run build"
npm run build

info "npx vitest run"
npx vitest run

info "cargo check"
cargo check --manifest-path services/loom-service/Cargo.toml

info "cargo test"
cargo test --manifest-path services/loom-service/Cargo.toml

info "npm run service:test"
npm run service:test

info "git diff --check"
git diff --check

ok "All validation checks passed"

# ── step 3 + 4: checkout main, pull, merge dev ───────────────────────────────
step "merge" "Merging '${DEV_BRANCH}' into '${MAIN_BRANCH}'…"

git checkout "${MAIN_BRANCH}"
git pull --ff-only "${REMOTE}" "${MAIN_BRANCH}"

MERGE_MSG="Release ${TAG_NAME}"
if ! git merge --no-ff "${DEV_BRANCH}" -m "${MERGE_MSG}"; then
  fail "Merge conflict detected. Resolve conflicts manually, then:"
  info "git add <resolved files>"
  info "git commit"
  info "Then continue from the version bump step (or re-run the script after merging manually)."
  exit 1
fi

MERGE_COMMIT=$(git rev-parse HEAD)
ok "Merged '${DEV_BRANCH}' into '${MAIN_BRANCH}' — ${MERGE_COMMIT:0:8}"

# ── step 5: bump version files ────────────────────────────────────────────────
step "version" "Bumping version ${CURRENT_VERSION} → ${TARGET_VERSION}…"

MACOS_SED=false
if sed --version 2>&1 | grep -q GNU; then
  MACOS_SED=false
else
  MACOS_SED=true
fi

bump_file() {
  local file="$1"
  if $MACOS_SED; then
    sed -i '' "s/${CURRENT_VERSION}/${TARGET_VERSION}/g" "$file"
  else
    sed -i "s/${CURRENT_VERSION}/${TARGET_VERSION}/g" "$file"
  fi
}

for f in "${APPROVED_FILES[@]}"; do
  bump_file "$f"
  ok "Bumped ${f}"
done

# Verify the bump applied correctly
for f in "${APPROVED_FILES[@]}"; do
  if grep -q "${CURRENT_VERSION}" "$f"; then
    die "Bump failed: '${CURRENT_VERSION}' still found in ${f} after substitution."
  fi
  if ! grep -q "${TARGET_VERSION}" "$f"; then
    die "Bump failed: '${TARGET_VERSION}' not found in ${f} after substitution."
  fi
done
ok "Version bump verified in all approved files"

# ── step 6: commit version bump ───────────────────────────────────────────────
step "version" "Committing version bump…"

git add "${APPROVED_FILES[@]}"

BUMP_MSG="chore: bump version to ${TARGET_VERSION}"$'\n\n'"Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git commit -m "$BUMP_MSG"

VERSION_COMMIT=$(git rev-parse HEAD)
ok "Version bump commit: ${VERSION_COMMIT:0:8}"

# ── step 7: annotated tag ─────────────────────────────────────────────────────
step "tag" "Creating annotated tag '${TAG_NAME}'…"

git tag -a "${TAG_NAME}" -m "Loom ${TAG_NAME}"
TAG_SHA=$(git rev-parse "${TAG_NAME}^{}")
ok "Tag '${TAG_NAME}' → commit ${TAG_SHA:0:8}"

# ── step 8: push main + tag ───────────────────────────────────────────────────
step "push" "Pushing '${MAIN_BRANCH}' and tag '${TAG_NAME}'…"

git push "${REMOTE}" "${MAIN_BRANCH}"
ok "Pushed ${REMOTE}/${MAIN_BRANCH}"

git push "${REMOTE}" "${TAG_NAME}"
ok "Pushed tag ${TAG_NAME}  ← GitHub Actions release workflow should trigger now"

# ── step 9 + 10: merge version bump back to dev ──────────────────────────────
step "back-merge" "Merging version bump back into '${DEV_BRANCH}'…"

git checkout "${DEV_BRANCH}"
git pull --ff-only "${REMOTE}" "${DEV_BRANCH}"

BACK_MSG="Merge version bump ${TARGET_VERSION} back to ${DEV_BRANCH}"$'\n\n'"Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
if ! git merge --no-ff "${MAIN_BRANCH}" -m "$BACK_MSG"; then
  fail "Back-merge conflict. Main and tag are already pushed. Resolve manually:"
  info "git add <resolved files>"
  info "git commit"
  info "git push ${REMOTE} ${DEV_BRANCH}"
  exit 1
fi

BACK_MERGE_COMMIT=$(git rev-parse HEAD)
ok "Back-merge commit: ${BACK_MERGE_COMMIT:0:8}"

# ── step 11: push dev ─────────────────────────────────────────────────────────
step "push" "Pushing '${DEV_BRANCH}'…"

git push "${REMOTE}" "${DEV_BRANCH}"
ok "Pushed ${REMOTE}/${DEV_BRANCH}"

# Disable the error trap — we completed successfully
trap - EXIT

# ── final report ─────────────────────────────────────────────────────────────
step "done" "Release ${TAG_NAME} completed"

printf '%s\n' "" "${GREEN}${BOLD}Release ${TAG_NAME} completed successfully${NC}" ""

printf '%s\n' "  ${BOLD}${MAIN_BRANCH}:${NC}"
printf "    merge commit:   %s\n" "${MERGE_COMMIT:0:8}"
printf "    version commit: %s\n" "${VERSION_COMMIT:0:8}"
printf '%s\n' "" "  ${BOLD}tag:${NC}"
printf "    %s → %s\n" "${TAG_NAME}" "${TAG_SHA:0:8}"
printf '%s\n' "" "  ${BOLD}${DEV_BRANCH}:${NC}"
printf "    back-merge commit: %s\n" "${BACK_MERGE_COMMIT:0:8}"
printf '%s\n' "" "  ${BOLD}workflow:${NC}"
printf "    tag push should trigger GitHub Actions release workflow (push: tags: v*)\n"
printf '%s\n' "" "  ${BOLD}version files bumped:${NC}"
for f in "${APPROVED_FILES[@]}"; do
  printf "    %s  (%s → %s)\n" "$f" "$CURRENT_VERSION" "$TARGET_VERSION"
done
printf "\n"
