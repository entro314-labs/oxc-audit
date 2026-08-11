#!/usr/bin/env bash
set -euo pipefail

# Publishes the version currently in package.json to npm, then tags that version in git
# and opens a matching GitHub release with the notes taken from CHANGELOG.md.
#
# The version is never bumped here: edit package.json and CHANGELOG.md first, then run
# this. Everything that can be checked is checked before the publish, because a publish
# cannot be undone and a half-done release leaves npm and GitHub disagreeing.
#
#   pnpm release            publish, tag, release
#   pnpm release --dry-run  run every check and pack the tarball, changing nothing

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

# --- preconditions: everything below must hold before anything is published ---

command -v gh >/dev/null 2>&1 || fail "gh is not installed; the GitHub release needs it."
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated. Run: gh auth login"
npm whoami >/dev/null 2>&1 || fail "not logged in to npm. Run: npm login"
git remote get-url origin >/dev/null 2>&1 || fail "no 'origin' remote; nowhere to push $tag."

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
  fail "tag $tag already exists locally. Bump the version or delete the tag."
fi

if git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1; then
  fail "tag $tag already exists on origin. Bump the version."
fi

if npm view "$name@$version" version >/dev/null 2>&1; then
  fail "$name@$version is already on npm. Bump the version."
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
  printf '\n--- release notes ---\n'
  cat "$notes_file"
  exit 0
fi

# prepublishOnly runs the full check suite and the build.
pnpm publish --access public --no-git-checks

# From here npm is already published; a failure below needs the tag pushed by hand.
git tag -a "$tag" -m "$name $version"
git push origin "$tag"
gh release create "$tag" --title "$tag" --notes-file "$notes_file"

printf '\npublished %s@%s and released %s\n' "$name" "$version" "$tag"
