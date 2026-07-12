# Contributing to Schema Stream

Thanks for helping improve Schema Stream.

## Setup

Install the repository toolchain with [mise](https://mise.jdx.dev/) and install dependencies with
Bun:

```sh
mise install
bun install
```

The repository develops with Bun 1.3.14, Node.js 24, and TypeScript 7. Consumers do not need
TypeScript 7; the packed-package test verifies the published declarations with TypeScript 5.9.

## Development checks

Run the full local gate before opening a pull request:

```sh
bun run check
bun run build
```

For behavior changes, also inspect coverage:

```sh
bun run test:coverage
```

`bun run test:packed` builds and installs the package tarball into isolated ESM and CommonJS
consumers. It verifies Zod 3, Zod 4, Zod Mini, OpenAI Agents SDK, Mastra, Vercel AI SDK, and
TypeScript 5.9 compatibility.

Run the credential-free examples and SDK runtime integrations when changing stream adapters or
public examples:

```sh
bun run examples
bun test tests/sdk-runtime.test.ts
```

The opt-in live provider matrix fails closed when explicitly enabled without its required model and
credential variables. See [`docs/integration-testing.md`](./docs/integration-testing.md) for secure
runtime injection, provider selection, and the exact verification contract.

## Documentation

Edit `README.md`, `docs/**/*.md`, `CHANGELOG.md`, and `CONTRIBUTING.md` as the canonical sources for
both GitHub and [schema.stream](https://schema.stream/). Do not edit the ignored
`site/content/docs/` staging directory directly.

Regenerate checked-in API and benchmark reference pages after changing exported TSDoc, public
exports, or benchmark evidence:

```sh
bun run docs:generate
```

Verify generated-file drift and Markdown links, then build the package and production docs site:

```sh
bun run docs:check
bun run docs:build
```

For local documentation work, `bun run docs:dev` prepares the canonical Markdown and serves the
site at `http://127.0.0.1:3401`. Browser examples must remain credential-free; live-provider
examples read user-owned secrets only from the server or Codespaces environment.

## Benchmarking

Run the Bun and Node snapshot benchmark after changes to parser hot paths, snapshot materialization,
or emission policies:

```sh
bun run benchmark
```

The default command builds the local package, validates every measured result, and prints compact
median comparisons. Use `bun run benchmark --verbose` for ranges and emission details, or
`bun run benchmark --json` to retain raw samples. Use `bun run benchmark --help` to narrow fixtures,
policies, runtimes, and payload sizes.

Use `bun run benchmark --completion-scaling` when completion callback behavior changes. It compares
no callback, `onValueComplete`, and legacy `onKeyComplete` as nested record counts double without
adding the cumulative-history workload to the default benchmark.

Keep runtime versions, fixture size, source chunk size, warmups, repetitions, and policy selection
identical when comparing revisions. Do not present isolated `JSON.stringify` or `JSON.parse` timings
as feature-equivalent SchemaStream competitors. Publish representative numbers only with their full
configuration and retain machine-readable evidence when making a performance claim.

## Changes

- Include focused tests for fixes and new behavior.
- Preserve strong public type inference and supported runtime/schema compatibility.
- Add or update TSDoc for public APIs and document meaningful user-facing behavior.
- Add a changeset for changes that should appear in a release:

```sh
bun run changeset
```

See [`AGENTS.md`](./AGENTS.md) for the complete project conventions, testing matrix, and public-OSS
privacy rules.
