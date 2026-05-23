# Release Branch Flow

This document defines the safe branch, version, tag, and artifact flow for Loom macOS arm64 releases.

## Release Authority

The version source is `package.json`.

All release identifiers must derive from that version:

```text
package.json version: 0.1.0
tag: v0.1.0
DMG: release/Loom-0.1.0-mac-arm64.dmg
```

The app bundle should use the same version when bundle-version metadata is added. Until then, the release workflow treats `package.json` as the source of truth and verifies the DMG filename from it.

## Branch Flow

Use this order:

1. Validate the current working branch.
2. Commit only the intended release files.
3. Merge the current branch into `dev`.
4. Validate `dev`.
5. Merge `dev` into `main`.
6. Validate `main`.
7. Tag `main` with `v<package.json version>`.
8. Push the tag.
9. Let GitHub Actions build the macOS arm64 artifact.
10. Publish the release manually after reviewing the workflow artifact.

Do not tag from feature branches. Do not publish a release before the artifact from the tag workflow has been reviewed.

## Intended Commit Scope

Release packaging commit:

```text
package.json
electron/sidecar-manager.mjs
electron/package-mac-arm64.mjs
electron/dist-mac-arm64.mjs
docs/electron_runtime.md
.gitignore
docs/release.md
.github/workflows/macos-arm64-release.yml
README.md
docs/release_branch_flow.md
```

Keep unrelated STT, product UI, E2E, and service behavior changes in separate commits unless they are intentionally part of the release.

## Files to Exclude

Generated artifacts and local runtime state must not be committed:

```text
dist/
dist-electron/
release/
services/loom-service/target/
services/loom-service/.data/
public/LoomMacIcon.iconset/
*.rw.dmg
*.dmg
```

Do not upload or commit local SQLite databases, service config, logs, Electron user data, model files, or local provider stores.

## Manual Commands

Start on the current working branch.

```sh
git status --short
npm run build
git diff --check
npm run electron:package:dev
npm run electron:package:mac:arm64
npm run electron:dist:mac:arm64
```

Stage only the intended release files:

```sh
git add package.json
git add electron/sidecar-manager.mjs
git add electron/package-mac-arm64.mjs
git add electron/dist-mac-arm64.mjs
git add docs/electron_runtime.md
git add .gitignore
git add docs/release.md
git add .github/workflows/macos-arm64-release.yml
git add README.md
git add docs/release_branch_flow.md
git diff --cached --stat
git commit -m "Add macOS arm64 release packaging"
```

Merge to `dev` and validate:

```sh
git switch dev
git pull --ff-only
git merge --no-ff <validated-branch>
npm run build
git diff --check
npm run electron:package:mac:arm64
npm run electron:dist:mac:arm64
```

Merge to `main` and validate:

```sh
git switch main
git pull --ff-only
git merge --no-ff dev
npm run build
git diff --check
npm run electron:package:mac:arm64
npm run electron:dist:mac:arm64
```

Tag only after `main` validation passes:

```sh
VERSION=$(node -p "require('./package.json').version")
test "$VERSION" = "0.1.0"
git tag -a "v$VERSION" -m "Loom v$VERSION"
git push origin main
git push origin "v$VERSION"
```

## CI Relationship

`.github/workflows/macos-arm64-release.yml` runs on:

```text
workflow_dispatch
push tags matching v*
```

The workflow:

- installs Node dependencies with `npm ci`
- installs Rust stable with `aarch64-apple-darwin`
- builds the frontend
- checks and tests `loom-service`
- packages `Loom.app`
- creates the DMG
- uploads `release/Loom-*-mac-arm64.dmg` as a workflow artifact

It does not publish a GitHub Release, notarize the app, create tags, or use Apple signing credentials.

## Branch Protection Recommendations

Protect `main`:

- require pull request or explicit maintainer merge
- require linear history or reviewed merge commits by project policy
- require the macOS arm64 release workflow for release tags once stable
- block force pushes
- block branch deletion

Protect `dev`:

- require build validation before merge to `main`
- block force pushes
- keep release-candidate commits reviewable

## Rollback Plan

If validation fails before tagging:

1. Do not tag.
2. Fix on the current branch or revert the merge on `dev`.
3. Re-run the validation commands.

If validation fails after merging to `main` but before pushing a tag:

1. Do not tag.
2. Revert the merge commit on `main` or apply a forward fix.
3. Re-run validation on `main`.

If a tag was pushed but the CI artifact is bad:

1. Do not publish a release.
2. Leave the bad tag in place unless project policy explicitly allows deleting unreleased tags.
3. Create a forward fix.
4. Bump `package.json` to the next patch version.
5. Tag a new version from validated `main`.

If a release was published with a bad artifact:

1. Mark the release as withdrawn or pre-release in GitHub.
2. Attach a note explaining the issue.
3. Build a fixed patch release from `main`.
