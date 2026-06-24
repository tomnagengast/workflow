# Releasing

`workflow` ships as four prebuilt single-file binaries distributed through a
Homebrew tap. A semver tag drives the whole pipeline; nothing is published from
a developer machine.

## Targets

One macOS host cross-compiles all four targets with `bun build --compile`
(`--minify --bytecode`, version injected via `--define`). The matrix lives in
[`scripts/release/targets.ts`](../scripts/release/targets.ts):

| Asset | `bun --target` | Notes |
| --- | --- | --- |
| `workflow-darwin-arm64` | `bun-darwin-arm64` | Apple Silicon. |
| `workflow-darwin-x64` | `bun-darwin-x64-baseline` | Intel Mac. Baseline triple for pre-2013 CPUs — avoids SSE4/AVX2 illegal-instruction crashes. |
| `workflow-linux-x64` | `bun-linux-x64` | |
| `workflow-linux-arm64` | `bun-linux-arm64` | |

## Signing

1.0 uses **ad-hoc** codesigning (`codesign --sign -`) on the darwin artifacts —
no paid Apple Developer ID cert, so it ships today. Ad-hoc signing is enough to
clear the Gatekeeper SIGKILL (exit 137) that an unsigned arm64 binary hits on a
modern macOS. A future tier (Developer ID + `notarytool` staple) is a drop-in
swap of the `codesign` step once a cert exists; it does not change the formula.

## The pre-publish dry-run

The risk a real release would otherwise surface late is a Gatekeeper SIGKILL or
a broken cross-compile. So that exact rung runs **on every PR** and again inside
the release build, without publishing:

```
bun run release:dry-run
```

This builds all four targets, ad-hoc signs the darwin artifacts, runs
`codesign -dv` (asserts the ad-hoc seal), then launches the host-native artifact
and asserts it is **not** exit 137. On CI's `macos-14` (arm64) runner that
exercises the real darwin-arm64 Gatekeeper launch. See
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) `release-dry-run`.

## Cutting a release

1. Update `CHANGELOG.md` (move `Unreleased` into a `[x.y.z]` section) **and**
   bump `version` in `package.json` to the same `x.y.z`. The release build hard-
   fails if the tag and `package.json` version disagree.
2. Commit, then tag and push:
   ```
   git tag vx.y.z
   git push origin vx.y.z
   ```
3. The tag triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml):
   - **build** — cross-compile + sign + Gatekeeper launch-test (the same
     dry-run), then `shasum -a 256` the four assets.
   - **release** — `gh release create vx.y.z` with the four binaries and
     `SHA256SUMS`.
   - **publish-formula** — render `Formula/workflow.rb`
     ([`scripts/release/render-formula.ts`](../scripts/release/render-formula.ts)
     from [`formula.tmpl`](../scripts/release/formula.tmpl)) with the tag version
     + real checksums, then push it to the tap.

## Required secrets

| Secret | Used by | Purpose |
| --- | --- | --- |
| `HOMEBREW_TAP_TOKEN` | `publish-formula` job only | PAT with push access to `tomnagengast/homebrew-workflow`. Everything upstream is secret-free. |

No signing secret is needed for the ad-hoc tier. A Developer ID tier would add a
cert + password secret to the build job.

## Post-publish verification

```
brew tap tomnagengast/workflow
brew install workflow
workflow --version    # prints the released version
workflow --help       # renders (not a Gatekeeper SIGKILL)
workflow list
```

## Partial publish (fix-forward)

The jobs are ordered so a failure is recoverable without re-tagging. The build
is secret-free; only the final tap push needs the PAT.

- **GitHub Release succeeded, formula push failed** (bad/expired
  `HOMEBREW_TAP_TOKEN`, tap repo missing): the assets are already published. Fix
  the secret/repo, then re-render and push the formula by hand from a checkout:
  ```
  gh release download vx.y.z --pattern 'workflow-*' --dir /tmp/rel
  ( cd /tmp/rel && shasum -a 256 workflow-* > checksums.txt )
  bun run release:formula --version vx.y.z --checksums /tmp/rel/checksums.txt \
    --repo tomnagengast/workflow --out /tmp/workflow.rb
  # commit /tmp/workflow.rb to tomnagengast/homebrew-workflow as Formula/workflow.rb
  ```
  Do **not** re-run the whole release — the GitHub Release already exists and
  `gh release create` would fail on the duplicate tag.
- **Release creation failed** (e.g. duplicate tag from a partial prior run):
  delete the half-made release (`gh release delete vx.y.z`) and re-run the
  workflow, or bump to `vx.y.(z+1)`.

## The checked-in `Formula/workflow.rb`

[`Formula/workflow.rb`](../Formula/workflow.rb) in this repo is a **placeholder**
committed for reference (version `0.0.0`, all-zero sha256s). The real installable
formula is the one the release job renders and pushes to the tap. Do not `brew
install` from the checked-in copy.
