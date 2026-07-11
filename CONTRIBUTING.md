# Contributing to Schema Stream

Thanks for helping improve Schema Stream.

## Setup

Install the repository toolchain with [mise](https://mise.jdx.dev/) and install dependencies with Bun:

```sh
mise install
bun install
```

The repository develops with Bun 1.3.14, Node.js 24, and TypeScript 7. Consumers do not need TypeScript 7; the packed-package test verifies the published declarations with TypeScript 5.9.

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

`bun run test:packed` builds and installs the package tarball into isolated ESM and CommonJS consumers. It verifies Zod 3, Zod 4, Zod Mini, OpenAI Agents SDK, Vercel AI SDK, and TypeScript 5.9 compatibility.

## Changes

- Include focused tests for fixes and new behavior.
- Preserve strong public type inference and supported runtime/schema compatibility.
- Add or update TSDoc for public APIs and document meaningful user-facing behavior.
- Add a changeset for changes that should appear in a release:

```sh
bun run changeset
```

See [`AGENTS.md`](./AGENTS.md) for the complete project conventions, testing matrix, and public-OSS privacy rules.
