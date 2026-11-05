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

# Reads and publishes do NOT share an endpoint, and pinning both to one is
# what killed jobs 12126 and 12130. Pinning the @yadad scope to
# projects/9/... 404s @yadad/components (published by the yadad-components
# project) on the metadata fetch pnpm does even under --frozen-lockfile:
# "ERR_PNPM_RESOLVING_NPM_RESOLVER_NETWORK_ERROR ... @yadad%2Fcomponents:
# HTTP status client error (404 Not Found)" (12126). Pinning the scope to
# the instance endpoint instead fixes reads but hijacks publishes: pnpm's
# scope entry beats `publish --registry`, so the upload went to the
# read-only instance endpoint and died 404 (12130, see the
# "📦 @yadad/core@0.18.1 -> /api/v4/packages/npm/" line in the trace).
# So: NO @yadad scope entry at all. The default registry is the
# instance-level endpoint, which serves every @yadad package in the group
# (engine packages live here, components in yadad-components); publishing
# names this project's endpoint with --registry, which pnpm only honours
# when no scope claims the package.
publish_registry="${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/npm/"
cat > "${HOME}/.npmrc" <<EOF
registry=${CI_API_V4_URL}/packages/npm/
${CI_API_V4_URL#https:}/packages/npm/:_authToken=${CI_JOB_TOKEN}
${publish_registry#https:}:_authToken=${CI_JOB_TOKEN}
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

# The runner's helper container owns the checkout; this container runs as
# root, so git (run by `prepare`) would refuse it as "dubious ownership".
git config --global --add safe.directory "${CI_PROJECT_DIR}"
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm depcruise
pnpm test
# One at a time: concurrent uploads that share dependencies have deadlocked
# GitLab's package processing. Already-published versions are skipped. The
# checkout is a detached HEAD, which pnpm's branch check would reject.
# --registry is load-bearing: @yadad:registry now names the (read-only)
# instance endpoint for installs, so publishing must name this project's
# endpoint explicitly or the uploads 405.
pnpm -r --workspace-concurrency=1 publish --no-git-checks --registry="${publish_registry}"

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
