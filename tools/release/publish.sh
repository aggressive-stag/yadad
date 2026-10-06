#!/bin/sh
# Publishes every workspace package whose version is not yet in this GitLab
# project's npm registry. Runs in GitLab CI on main (see .gitlab-ci.yml).
#
# Skips without publishing when changesets are pending: those changes have not
# been versioned yet, so the versions in package.json are the last release's.
set -eu

: "${CI_API_V4_URL:?run this in GitLab CI}"
: "${CI_PROJECT_ID:?run this in GitLab CI}"
: "${CI_JOB_TOKEN:?run this in GitLab CI}"

# Publishing goes to the project-level endpoint; consumers read through the
# instance-level one (/api/v4/packages/npm/), which works because the group
# name matches the @yadad scope.
registry="${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/npm/"
cat > "${HOME}/.npmrc" <<EOF
@yadad:registry=${registry}
${registry#https:}:_authToken=${CI_JOB_TOKEN}
EOF

pending=$(find .changeset -name '*.md' ! -name README.md | wc -l)
if [ "${pending}" -gt 0 ]; then
  echo "release: ${pending} pending changeset(s). Run 'pnpm changeset version' locally, commit and push to release. Nothing published."
  exit 0
fi

unpublished=""
for manifest in packages/*/package.json testing/package.json; do
  if [ "$(node -p "require('./${manifest}').private === true")" = "true" ]; then
    continue
  fi
  name=$(node -p "require('./${manifest}').name")
  version=$(node -p "require('./${manifest}').version")
  if [ "${version}" = "0.0.0" ]; then
    echo "release: ${name} is still 0.0.0. Version it with changesets first." >&2
    exit 1
  fi
  # Empty output means the package exists but not this version; E404 means the
  # package does not exist yet. Anything else (auth, network) is a failure.
  if found=$(npm view "${name}@${version}" version 2>/tmp/npm-view.err); then
    [ -n "${found}" ] && continue
  elif ! grep -q E404 /tmp/npm-view.err; then
    cat /tmp/npm-view.err >&2
    exit 1
  fi
  unpublished="${unpublished} ${name}@${version}"
done

if [ -z "${unpublished}" ]; then
  echo "release: every package version is already published. Nothing to do."
  exit 0
fi
echo "release: publishing${unpublished}"

corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm depcruise
pnpm test
# Tags would only live in this throwaway checkout, so do not create them.
pnpm changeset publish --no-git-tag
