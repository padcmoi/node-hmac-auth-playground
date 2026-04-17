#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mapfile -t API_PROJECTS < <(
	find "$ROOT_DIR/express" "$ROOT_DIR/nestjs" \
		-mindepth 2 \
		-maxdepth 2 \
		-type f \
		-name "package.json" \
		-exec dirname {} \; |
		sort -u
)

if [ "${#API_PROJECTS[@]}" -eq 0 ]; then
	echo "No API projects found (no package.json under express/ and nestjs/)."
	exit 0
fi

echo "Found ${#API_PROJECTS[@]} API projects."

FAILED=0

for project in "${API_PROJECTS[@]}"; do
	echo "-> Removing node_modules in ${project}"
	rm -rf "${project}/node_modules"

	echo "-> Installing dependencies in ${project}"
	if (
		cd "${project}"
		npm install
	); then
		continue
	fi

	echo "   npm install failed in ${project}, retrying with lock reset (handles moving branch tarballs)..."
	if (
		cd "${project}"
		rm -f package-lock.json
		npm install --no-package-lock
	); then
		continue
	fi

	echo "   ERROR: install failed in ${project} even after retry."
	FAILED=1
done

if [ "$FAILED" -ne 0 ]; then
	echo "Install finished with errors."
	exit 1
fi

echo "All API dependencies are installed."
