#!/usr/bin/env bash
set -euo pipefail

manifest_version="$(node -p "require('./package.json').version")"
expected_tag="v${manifest_version}"
if [[ "${GITHUB_REF_NAME}" != "${expected_tag}" ]]; then
  echo "Tag ${GITHUB_REF_NAME} does not match package version ${manifest_version}" >&2
  exit 1
fi

git fetch origin main --no-tags
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "Release tag must point to the current main commit" >&2
  exit 1
fi

notes="docs/releases/${GITHUB_REF_NAME}.md"
if [[ ! -f "${notes}" ]]; then
  echo "Missing release notes: ${notes}" >&2
  exit 1
fi
