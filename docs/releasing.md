# Desktop Release Process

## Release Asset Naming Convention

GitHub Releases are the canonical source of truth for desktop downloads and updater signatures in `DESKTOP_RELEASE_SOURCE=github` mode.

Each tagged release should contain these assets:

- `ai-operator-desktop_<version>_windows_x86_64.msi`
- `ai-operator-desktop_<version>_windows_x86_64.msi.sig`
- `ai-operator-desktop_<version>_macos_x86_64.dmg`
- `ai-operator-desktop_<version>_macos_x86_64.dmg.sig`
- `ai-operator-desktop_<version>_macos_aarch64.dmg`
- `ai-operator-desktop_<version>_macos_aarch64.dmg.sig`

The `<version>` segment must match the git tag without the leading `v` (for example `v0.1.0` produces `0.1.0` asset names).

## Create a Release

Create and push a version tag to trigger the desktop release workflow:

```bash
git tag v0.1.0
git push --tags
```

You can also run the `Desktop Release` workflow manually with `workflow_dispatch`. On non-tag runs it builds normalized artifacts and uploads them as workflow artifacts, but it does not attach them to a GitHub Release.

The workflow supports `release_mode`:

- `unsigned` (default): builds artifacts without enforcing signing secrets.
- `signed`: requires updater signing secrets before build.

For safety, tags prefixed with `prod-` always force `signed` mode.

For normal development safety gates, `.github/workflows/desktop-ci.yml` runs on pull requests and pushes to `main`. It compiles the desktop app on macOS and Windows, while `.github/workflows/desktop-release.yml` remains the tag-driven publishing workflow.

## GitHub Secrets

For signed release mode and updater signature generation, configure:

- `TAURI_PRIVATE_KEY`
- `TAURI_KEY_PASSWORD`

If you run with `release_mode=signed` and these are missing, the workflow fails fast.

If you run with `release_mode=unsigned`, artifacts are still produced and release notes include `Release mode: UNSIGNED`.

### Signing/Notarization TODO Gates

These are still explicit TODOs and must be configured before treating desktop artifacts as production-trusted installers:

- Windows Authenticode signing certificate and secure signing step in workflow.
- macOS code signing identity (Developer ID Application) in workflow.
- macOS notarization credentials (Apple API key / notary profile) and notarization submit/staple steps.
- Verification step that fails production release if platform trust-chain checks are missing.

Current guardrail:

- `prod-*` tags force signed updater artifacts and fail if required updater key secrets are absent.
- They do not yet guarantee full OS trust chain (Authenticode + notarization) until TODOs above are implemented.

## API Configuration

Set these values in `apps/api/.env` for GitHub-backed desktop releases:

- `DESKTOP_RELEASE_SOURCE=github`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_TOKEN` (optional, only needed for private repositories or higher rate limits)
- `DESKTOP_RELEASE_CACHE_TTL_SECONDS=60`
- `DESKTOP_RELEASE_TAG=latest`

If you want to keep the deterministic local stub mode, set:

- `DESKTOP_RELEASE_SOURCE=file`

In file mode, the API keeps using the existing `apps/api/updates` manifests and `DESKTOP_*` URL environment variables from Iteration 13.

## Verifying Release-Backed Downloads

After a release is published:

1. Start the API with `DESKTOP_RELEASE_SOURCE=github`.
2. Call:
   ```bash
   curl http://localhost:3001/updates/desktop/darwin/aarch64/0.0.0.json
   ```
3. Confirm the returned JSON includes the latest release `version`, release notes, and a `platforms` entry with a real installer URL and matching signature.
4. Log in as an active subscriber and open `/download`.
5. Confirm the displayed version and download buttons match the latest GitHub Release assets.

## Next Production Steps

- Add real Windows code signing.
- Add macOS notarization.
- Optionally move large binaries to S3 or R2 later while keeping GitHub Releases (or mirrored metadata) as the canonical manifest source.
- Validate tray and auto-start behavior in packaged macOS and Windows builds, since auto-start is only best-effort during local dev.
