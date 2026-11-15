#!/bin/sh
# Publish the Specplane CLI to npm from your own machine (the CI publish needs a token that can skip 2FA).
#
#   sh scripts/release-local.sh             # check, test, publish
#   DRY_RUN=1 sh scripts/release-local.sh   # everything except the real publish
#   SKIP_TESTS=1 sh scripts/release-local.sh
#
# Run it in a normal terminal window: npm asks you to approve the publish with your security key or passkey.
set -eu

root=$(git rev-parse --show-toplevel)
cd "$root"
pkg="$root/packages/cli"
version=$(node -p "require('$pkg/package.json').version")
name=$(node -p "require('$pkg/package.json').name")
tag="v$version"

say() { printf '\n== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

say "Checking the repository"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "tracked files have uncommitted changes; commit or stash them first"
git fetch -q origin
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = main ] || die "you are on '$branch'; switch to main first"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  die "main is not at origin/main; run 'git pull --ff-only' (or push your commits) first"
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  [ "$(git rev-parse "$tag^{commit}")" = "$(git rev-parse HEAD)" ] || die "tag $tag does not point at this commit; the package would not match the tag"
else
  echo "note: no local tag $tag; continuing"
fi

say "Checking npm"
if ! npm whoami >/dev/null 2>&1; then
  echo "Not logged in to npm; starting 'npm login' (approve it with your security key or passkey)."
  npm login
fi
echo "Logged in as: $(npm whoami)"
if published=$(npm view "$name@$version" version 2>/dev/null) && [ -n "$published" ]; then
  die "$name@$version is already on npm"
fi

say "Installing and testing $name@$version"
cd "$pkg"
npm ci
if [ "${SKIP_TESTS:-0}" = 1 ]; then echo "skipping tests (SKIP_TESTS=1)"; else npm test; fi

say "Publishing"
if [ "${DRY_RUN:-0}" = 1 ]; then
  npm publish --access public --dry-run
  echo
  echo "Dry run only; nothing was published. Run it again without DRY_RUN=1 to publish."
else
  npm publish --access public
  say "Waiting for the registry (npm can take a few minutes to show a new version)"
  i=0
  until [ "$(npm view "$name@$version" version 2>/dev/null || true)" = "$version" ]; do
    i=$((i + 1))
    [ "$i" -le 36 ] || die "$name@$version was published but is not visible yet; check 'npm view $name versions' in a few minutes"
    sleep 10
  done
  echo "Published $name@$version. Install it with: npm install -g $name"
fi
