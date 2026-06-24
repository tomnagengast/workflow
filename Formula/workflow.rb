# typed: false
# frozen_string_literal: true

# Homebrew formula for the `workflow` CLI — a standalone runner for Claude Code
# dynamic workflow scripts. A formula (NOT a cask) so the one tap covers macOS
# and Linux, arm64 and x64, through a single Hardware::CPU.arm? × OS matrix.
#
# This file is RENDERED by scripts/release/render-formula.ts from
# scripts/release/formula.tmpl and pushed to tomnagengast/homebrew-workflow by
# the release workflow. Do not hand-edit the copy in the tap.
#
# NOTE: the copy checked into THIS repo (Formula/workflow.rb) is a placeholder
# committed for reference — its version is 0.0.0 and its sha256s are all-zero.
# The real, installable formula is the one the release job renders with the
# tagged version + real asset checksums and pushes to the tap. Do not `brew
# install` from this checked-in copy.
class Workflow < Formula
  desc "Standalone runner for Claude Code dynamic workflow scripts"
  homepage "https://github.com/tomnagengast/workflow"
  version "0.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/tomnagengast/workflow/releases/download/v0.0.0/workflow-darwin-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_intel do
      url "https://github.com/tomnagengast/workflow/releases/download/v0.0.0/workflow-darwin-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/tomnagengast/workflow/releases/download/v0.0.0/workflow-linux-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_intel do
      url "https://github.com/tomnagengast/workflow/releases/download/v0.0.0/workflow-linux-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  def install
    bin.install Dir["workflow-*"].first => "workflow"
  end

  def caveats
    <<~EOS
      workflow runs your workflow scripts against the `claude` and/or `codex`
      CLIs. Those are runtime prerequisites and are NOT installed by this
      formula. Install whichever backend(s) you use and make sure they are on
      your PATH:

        claude --version
        codex --version

      `workflow doctor` reports which backends it can find.
    EOS
  end

  test do
    assert_match "workflow", shell_output("#{bin}/workflow --help")
    assert_match version.to_s, shell_output("#{bin}/workflow --version")
  end
end
