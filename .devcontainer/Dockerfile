FROM oven/bun:1.3.14 AS bun-runtime

FROM node:24.18.0-bookworm-slim

ARG BUN_VERSION=1.3.14

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && ln --symbolic /usr/local/bin/bun /usr/local/bin/bunx \
  && test "$(bun --version)" = "${BUN_VERSION}" \
  && test "$(node --version)" = "v24.18.0"

USER node
