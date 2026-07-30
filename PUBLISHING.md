# Publishing

Releases are built and published to npm by the `publish` GitHub Action
(`.github/workflows/publish.yml`) when a version tag is pushed. Auth uses npm
**Trusted Publishing (OIDC)** — no `NPM_TOKEN` is stored, so there is nothing to
rotate.

## One-time setup (npmjs.com)

This is a TypeScript plugin (no per-platform binaries), so only **one** package
needs a trusted publisher:

- `@calebcall/camera-ui-amcrest`

The package must already exist on npm (publish once with a token first — done for
1.0.3). Then on npmjs.com:

1. Open the package → **Settings** → **Trusted Publisher** (GitHub Actions).
2. Set:
   - **Organization / user:** `calebcall`
   - **Repository:** `camera-ui-amcrest`
   - **Workflow filename:** `publish.yml`
   - **Environment:** leave blank.
3. Save.

After that, publishing needs no token — the workflow's OIDC identity is trusted,
and npm records a provenance attestation.

## Cutting a release

1. Bump `version` in `package.json` and add a matching `## <version>` entry to
   `CHANGELOG.md`. **Required** — the workflow fails the release if the changelog
   has no entry for the version being published.
2. Commit to `main`.
3. Tag and push:
   ```bash
   git tag v1.0.4     # must match package.json version exactly
   git push origin v1.0.4
   ```
4. The `publish` workflow builds and publishes to npm under `latest` (it fails
   fast if the tag doesn't match `package.json` version).

## Dry run (manual)

To exercise build + bundle **without publishing**: GitHub → **Actions** →
**publish** → **Run workflow**. The `dry_run` box is **checked by default**, so a
manual run builds and stops before `npm publish`. Uncheck it to publish
`package.json`'s current version via OIDC without a tag.

## Notes

- The workflow runs on Node 24, which the plugin requires: `@seydx/rtsp` ships
  explicit-resource-management syntax (`for await (using x of y)`) that Node 22
  cannot parse, so the plugin fails to load there. `engines.node` says `>=24.0.0`.
- The workflow upgrades npm before publishing — Trusted Publishing needs
  npm ≥ 11.5.1. Node 24 already ships 11.x, so this is a floor guard.
- `npm run bundle` runs format/lint/test before building; a failure there blocks
  the publish (intended quality gate).
- Local/manual publishing still works via `npm run publish:latest` with an npm
  token in `~/.npmrc`, but the Action is the token-free path.
