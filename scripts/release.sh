#!/usr/bin/env bash
set -euo pipefail

# Publishes the versions currently in package.json and plugins/package.json to npm, then
# tags the CLI version in git and opens a matching GitHub release with the notes taken from
# CHANGELOG.md.
#
# Versions are never bumped here: edit the manifests and CHANGELOG.md first, then run this.
# Each package is published only when its version is not on npm yet, so a release that
# changes one package leaves the other alone. Everything that can be checked is checked
# before the first publish, because a publish cannot be undone and a half-done release
# leaves npm and GitHub disagreeing.
#
#   pnpm release            publish, tag, release
#   pnpm release --dry-run  run every check and pack the tarballs, changing nothing

dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
elif [[ -n "${1:-}" ]]; then
  printf 'error: unknown argument %s (expected --dry-run)\n' "$1" >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

name="$(node -p "require('./package.json').name")"
version="$(node -p "require('./package.json').version")"
tag="v$version"
plugins_name="$(node -p "require('./plugins/package.json').name")"
plugins_version="$(node -p "require('./plugins/package.json').version")"

# --- preconditions: everything below must hold before anything is published ---

command -v gh >/dev/null 2>&1 || fail "gh is not installed; the GitHub release needs it."
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated. Run: gh auth login"
npm whoami >/dev/null 2>&1 || fail "not logged in to npm. Run: npm login"
git remote get-url origin >/dev/null 2>&1 || fail "no 'origin' remote; nowhere to push $tag."
[[ -d plugins/node_modules ]] || fail "plugins/ is not installed. Run: cd plugins && pnpm install --ignore-workspace"

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
  fail "tag $tag already exists locally. Bump the version or delete the tag."
fi

if git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1; then
  fail "tag $tag already exists on origin. Bump the version."
fi

if npm view "$name@$version" version >/dev/null 2>&1; then
  fail "$name@$version is already on npm. Bump the version."
fi

# The plugin package is released on its own cadence: an unchanged version is skipped, not
# an error, so a CLI-only release does not have to touch it.
publish_plugins=true
if npm view "$plugins_name@$plugins_version" version >/dev/null 2>&1; then
  publish_plugins=false
fi

# Release notes are the CHANGELOG section for this exact version, so a missing or
# misnumbered entry stops the release instead of publishing an unannotated one.
notes_file="$(mktemp)"
trap 'rm -f "$notes_file"' EXIT

awk -v ver="$version" '
  $0 ~ "^## \\[" ver "\\]" { capturing = 1; next }
  capturing && /^## / { exit }
  capturing { print }
' CHANGELOG.md >"$notes_file"

[[ -s "$notes_file" ]] || fail "CHANGELOG.md has no '## [$version]' section."

# --- the release itself ---

if [[ "$dry_run" == true ]]; then
  printf '\ndry run for %s@%s (tag %s)\n\n' "$name" "$version" "$tag"
  pnpm publish --access public --no-git-checks --dry-run
  if [[ "$publish_plugins" == true ]]; then
    printf '\ndry run for %s@%s\n\n' "$plugins_name" "$plugins_version"
    pnpm --dir plugins publish --access public --no-git-checks --dry-run
  else
    printf '\n%s@%s is already on npm; it would not be published.\n' "$plugins_name" "$plugins_version"
  fi
  printf '\n--- release notes ---\n'
  cat "$notes_file"
  exit 0
fi

# Both prepublishOnly hooks run their tree's full check suite and build. The plugins go
# first: the CLI names the plugin package in the configs it writes, so a CLI that ships
# without its plugins is worse than the reverse.
if [[ "$publish_plugins" == true ]]; then
  pnpm --dir plugins publish --access public --no-git-checks
fi
pnpm publish --access public --no-git-checks

# From here npm is already published; a failure below needs the tag pushed by hand.
git tag -a "$tag" -m "$name $version"
git push origin "$tag"
gh release create "$tag" --title "$tag" --notes-file "$notes_file"

printf '\npublished %s@%s and released %s\n' "$name" "$version" "$tag"
if [[ "$publish_plugins" == true ]]; then
  printf 'published %s@%s\n' "$plugins_name" "$plugins_version"
fi
