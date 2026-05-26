# Release Builds

This document describes the current release artifact path for Loom.

## macOS arm64

macOS arm64 is the first desktop distribution target. The release workflow builds:

- React production bundle
- Rust `loom-service` for `aarch64-apple-darwin`
- Electron `Loom.app`
- drag-to-Applications DMG

The local commands are:

```sh
npm run electron:package:mac:arm64
npm run electron:dist:mac:arm64
```

The DMG output is:

```text
release/Loom-<version>-mac-arm64.dmg
```

## GitHub Actions

The workflow is:

```text
.github/workflows/macos-arm64-release.yml
```

It runs on `workflow_dispatch` and `v*` tag pushes. It validates the frontend, Rust service, Electron package, and DMG creation, then uploads the DMG as a GitHub Actions artifact.

For `v*` tag pushes, the workflow also verifies that the tag matches `package.json`:

```text
package.json version: X.Y.Z
tag: vX.Y.Z
```

If the tag and version do not match, the workflow fails before creating release artifacts.

After a successful tag build, the workflow creates or updates a draft GitHub Release and uploads:

```text
release/Loom-X.Y.Z-mac-arm64.dmg
```

`workflow_dispatch` remains artifact-only by default. It can create or update a draft release only when the `createDraftRelease` input is explicitly enabled and the workflow is run from the matching `vX.Y.Z` tag.

The workflow does not create tags, publish a GitHub Release, notarize the app, or use Apple signing credentials.

## Artifact Hygiene

Generated release outputs stay out of git:

```text
dist/
dist-electron/
release/
services/loom-service/target/
services/loom-service/.data/
```

The workflow uploads the DMG as a GitHub Actions artifact and, on tag builds, attaches the same DMG to a draft GitHub Release:

```text
release/Loom-*-mac-arm64.dmg
```

Local service databases, local service config, model files, and Electron user data must not be committed or uploaded as release artifacts.

## Current Limitations

- The app is ad-hoc signed only.
- The app is not notarized yet.
- Ollama remains an external runtime.
- Model files are not bundled.
- Windows and Linux packages are future work.
