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
# One at a time: concurrent uploads that share dependencies have deadlocked
# GitLab's package processing. Already-published versions are skipped. The
# checkout is a detached HEAD, which pnpm's branch check would reject.
pnpm -r --workspace-concurrency=1 publish --no-git-checks

# GitLab processes uploads in the background, so a failure there still looks
# like a successful publish to npm. Confirm every version is installable.
for pkg in ${unpublished}; do
  tries=0
  until [ -n "$(npm view --prefer-online "${pkg}" version 2>/dev/null)" ]; do
    tries=$((tries + 1))
    if [ "${tries}" -ge 12 ]; then
      echo "release: ${pkg} was uploaded but is not in the registry. Check the project's package registry for an errored entry." >&2
      exit 1
    fi
    sleep 5
  done
  echo "release: ${pkg} is published"
done
