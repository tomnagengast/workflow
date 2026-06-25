# Releasing

`workflow` ships as four prebuilt single-file binaries distributed as a Homebrew
**cask** (`workflow-cli`) through the shared tap
[`tomnagengast/homebrew-tap`](https://github.com/tomnagengast/homebrew-tap),
alongside the sibling tools (`scout-cli`, `memoryd-cli`, ...). A semver tag drives
the pipeline.

## Targets

One macOS host cross-compiles all four targets with `bun build --compile`
(`--minify --bytecode`, version injected via `--define`), ad-hoc signs the darwin
artifacts, and packages each as a `.tar.gz` holding a single `workflow` binary.
The matrix lives in [`scripts/release/targets.ts`](../scripts/release/targets.ts):

| Asset | `bun --target` | Notes |
| --- | --- | --- |
| `workflow_<v>_darwin_arm64.tar.gz` | `bun-darwin-arm64` | Apple Silicon. |
| `workflow_<v>_darwin_amd64.tar.gz` | `bun-darwin-x64-baseline` | Intel Mac. Baseline triple for pre-2013 CPUs — avoids SSE4/AVX2 illegal-instruction crashes. |
| `workflow_<v>_linux_amd64.tar.gz` | `bun-linux-x64` | |
| `workflow_<v>_linux_arm64.tar.gz` | `bun-linux-arm64` | |

[`scripts/release/package.ts`](../scripts/release/package.ts) does the build +
sign + package + checksum (`bun run release:package`).

## Signing + Gatekeeper

1.0 uses **ad-hoc** codesigning (`codesign --sign -`) on the darwin artifacts —
no paid Apple Developer ID cert, so it ships today. Ad-hoc signing clears the
Gatekeeper SIGKILL (exit 137) an unsigned arm64 binary hits on a modern macOS.
The cask's `postflight` also strips the `com.apple.quarantine` xattr on install
(same as the sibling casks). A future Developer ID + `notarytool` staple tier is
a drop-in swap of the `codesign` step; it does not change the cask.

## The pre-publish dry-run

The risk a real release would otherwise surface late is a Gatekeeper SIGKILL or a
broken cross-compile. That exact rung runs **on every PR** and again inside the
release build, without publishing:

```
bun run release:dry-run
```

It builds all four targets, ad-hoc signs the darwin artifacts, runs `codesign -dv`
(asserts the ad-hoc seal), then launches the host-native artifact and asserts it
is **not** exit 137. On CI's `macos-14` (arm64) runner that exercises the real
darwin-arm64 Gatekeeper launch. See
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) `release-dry-run`.

## Cutting a release

1. Update `CHANGELOG.md` (move `Unreleased` into a `[x.y.z]` section) **and** bump
   `version` in `package.json` to the same `x.y.z`. The release build hard-fails
   if the tag and `package.json` version disagree.
2. Commit, then tag and push:
   ```
   git tag vx.y.z
   git push origin vx.y.z
   ```
3. The tag triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml):
   - **build** — `bun run release:package`: cross-compile + sign + Gatekeeper
     launch-test, then `shasum -a 256` the four `.tar.gz` assets.
   - **release** — `gh release create vx.y.z` with the four tarballs and
     `SHA256SUMS` (idempotent: skips if the release already exists).
   - **publish-cask** — render `workflow-cli.rb`
     ([`scripts/release/render-cask.ts`](../scripts/release/render-cask.ts) from
     [`cask.tmpl`](../scripts/release/cask.tmpl)) with the tag version + real
     checksums, then push it to `tomnagengast/homebrew-tap` under `Casks/`. Without
     the tap token the cask is still rendered and the push is **skipped** (green)
     for a manual push.

## Required secrets

| Secret | Used by | Purpose |
| --- | --- | --- |
| `HOMEBREW_TAP_GITHUB_TOKEN` | `publish-cask` job only | PAT with push access to `tomnagengast/homebrew-tap`. Everything upstream is secret-free; without it the job renders the cask and skips the push. |

No signing secret is needed for the ad-hoc tier. A Developer ID tier would add a
cert + password secret to the build job.

## Post-publish verification

```
brew tap tomnagengast/tap
brew install --cask workflow-cli
workflow --version    # prints the released version
workflow --help       # renders (not a Gatekeeper SIGKILL)
workflow list
```

## Partial publish (fix-forward)

The jobs are ordered so a failure is recoverable without re-tagging. The build is
secret-free; only the final cask push needs the PAT.

- **GitHub Release succeeded, cask push failed/skipped** (missing/expired
  `HOMEBREW_TAP_GITHUB_TOKEN`): the assets are already published. Render and push
  the cask by hand from a checkout:
  ```
  gh release download vx.y.z --pattern 'workflow_*.tar.gz' --dir /tmp/rel
  ( cd /tmp/rel && shasum -a 256 workflow_*.tar.gz > checksums.txt )
  bun run release:cask --version vx.y.z --checksums /tmp/rel/checksums.txt \
    --repo tomnagengast/workflow --out /tmp/workflow-cli.rb
  # commit /tmp/workflow-cli.rb to tomnagengast/homebrew-tap as Casks/workflow-cli.rb
  ```
  Do **not** re-run the whole release — the GitHub Release already exists and a
  non-idempotent `gh release create` would fail on the duplicate tag.
- **Release creation failed** (e.g. duplicate tag from a partial prior run):
  delete the half-made release (`gh release delete vx.y.z`) and re-run the
  workflow, or bump to `vx.y.(z+1)`.
