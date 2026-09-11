#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_BASE:?}"
: "${AMD64_DIGEST:?}"
: "${ARM64_DIGEST:?}"
: "${VERSION_TAG:?}"
: "${SHA_TAG:?}"
if [[ -n "${DOCKER_BIN:-}" ]]; then
	docker() { "${DOCKER_BIN}" "$@"; }
else
	docker() { command docker "$@"; }
fi

cleanup() { status=$?; docker rm -f gateship-release-amd64 gateship-release-arm64 >/dev/null 2>&1 || true; exit "${status}"; }
trap cleanup EXIT

for arch in amd64 arm64; do
	digest="${AMD64_DIGEST}"
	if [[ "${arch}" == arm64 ]]; then digest="${ARM64_DIGEST}"; fi
	image="${IMAGE_BASE}@${digest}"
	docker pull "${image}"
	docker run --rm --entrypoint claude "${image}" --version
	docker run --rm --entrypoint codex "${image}" --version
	name="gateship-release-${arch}"
	port=$([[ "${arch}" == amd64 ]] && echo 17778 || echo 17779)
	docker run --rm -d --name "${name}" -p "127.0.0.1:${port}:7777" "${image}"
	for attempt in {1..30}; do
		if curl --fail --silent "http://127.0.0.1:${port}/api/snapshot" >/dev/null \
			&& [[ "$(docker inspect --format '{{.State.Health.Status}}' "${name}")" == healthy ]]; then
			break
		fi
		sleep 1
		if [[ "${attempt}" == 30 ]]; then docker logs "${name}"; exit 1; fi
	done
	docker rm -f "${name}" >/dev/null
done

docker buildx imagetools create \
	--tag "${IMAGE_BASE}:${VERSION_TAG}" \
	"${IMAGE_BASE}@${AMD64_DIGEST}" \
	"${IMAGE_BASE}@${ARM64_DIGEST}"
docker buildx imagetools create \
	--tag "${IMAGE_BASE}:${SHA_TAG}" \
	"${IMAGE_BASE}@${AMD64_DIGEST}" \
	"${IMAGE_BASE}@${ARM64_DIGEST}"

digest_output="$(docker buildx imagetools inspect "${IMAGE_BASE}:${VERSION_TAG}")"
digest_output="${digest_output#*Digest: }"
echo "digest=${digest_output%%$'\n'*}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
