# Schema Stream Agent Guide

## Project contract

Schema Stream is a small, public, standalone TypeScript library for progressively parsing streamed JSON into typed, schema-shaped snapshots. Keep changes focused on the library, its tests, its documentation, and its release tooling.

- Treat this as a public OSS repository. Never add private URLs, credentials, customer data, internal project names, local absolute paths, transcripts, or personal information beyond the public package metadata already committed.
- Preserve consumer compatibility across Node.js and Bun, ESM and CommonJS, Zod 3, Zod 4, and Zod Mini.
- Do not edit generated output in `dist/`; regenerate it with `bun run build`.
- Prefer small, reviewable changes. Preserve unrelated user changes in a dirty worktree.

## Toolchain

Use the versions declared by the repository:

- `mise install` provisions Bun 1.3.14 and Node.js 24.
- `bun install` installs dependencies from `bun.lock`.
- TypeScript 7 is the authoritative development compiler.
- Published declarations must remain consumable by supported TypeScript 5.x projects; `bun run test:packed` verifies this with TypeScript 5.9.
- Ultracite with Biome is the repository's formatter and linter. Keep `biome.jsonc`, package scripts, CI, and existing source synchronized when changing formatting or lint rules.

Run repository scripts through Bun:

```sh
bun run format
bun run format:check
bun run lint
bun run lint:fix
bun run type-check
bun run test
bun run test:coverage
bun run build
bun run test:packed
bun run check
```

`bun run check` is the minimum completion gate. It includes Ultracite linting and formatting checks. Run `bun run build` when exports, declarations, build configuration, or package metadata change. Run `bun run test:coverage` when behavior changes.

## Code style and architecture

- Use strict TypeScript. Never introduce `any`; use `unknown`, narrowing, discriminated unions, generics, and schema-derived types.
- Preserve precise consumer inference. Avoid widening literals, unnecessary assertions, broad index signatures, or generic defaults that erase information.
- Prefer named options objects when a function has multiple inputs or is likely to grow. Do not churn a stable public signature solely to satisfy this preference.
- Prefer focused functions, composition, early returns, immutable values, and clear module boundaries.
- Use function declarations for named reusable functions and arrow functions for callbacks or concise local closures.
- Avoid hidden mutable global state and unnecessary allocation in streaming hot paths.
- Keep parser state transitions explicit. Preserve chunk-boundary correctness, incremental UTF-8 decoding, backpressure, cancellation, and useful error context.
- Do not add dependencies when a platform primitive or a small local implementation is sufficient.
- Follow the configured format: two spaces, double quotes, no semicolons, and a 100-column print width.

## Documentation and comments

- Add useful TSDoc block comments to public classes, functions, methods, exported types, and non-obvious internal boundaries.
- Describe behavior, invariants, streaming semantics, failure modes, and inference guarantees—not a restatement of the identifier.
- Include `@param`, `@returns`, `@throws`, `@typeParam`, or examples when they add information for consumers or maintainers.
- Avoid narration-style inline comments. Use an inline comment only for a subtle invariant, protocol detail, compatibility workaround, or actionable TODO with context.
- Update README or focused files under `docs/` when public behavior, configuration, performance tradeoffs, or compatibility changes.
- Keep examples executable, type-correct, and representative of the published API.

## Testing expectations

Behavior changes should include the narrowest regression test plus broader coverage where the risk warrants it. Exercise relevant combinations of:

- chunks split at every meaningful token and UTF-8 boundary;
- empty, partial, malformed, deeply nested, and very large JSON values;
- objects, arrays, primitives, nullable and optional fields, unions, records, and recursive schemas;
- snapshot policies, final snapshot behavior, cancellation, and parser errors;
- Zod 3, Zod 4, and Zod Mini;
- ESM, CommonJS, Node.js, Bun, and packed-package declaration consumption;
- sustained high-throughput streams and allocation-sensitive paths.

Performance tests must be deterministic enough to detect major regressions without asserting fragile machine-specific timings. Prefer reporting throughput, snapshot count, and peak-memory-relevant behavior; keep correctness assertions alongside benchmarks.

## Public API and releases

- Treat every export and emitted declaration as public API.
- Favor additive changes. Clearly document intentional breaking changes and add a changeset with the appropriate version bump.
- Keep `package.json` exports, `files`, runtime requirements, README installation guidance, and packed-consumer tests synchronized.
- Verify the packed tarball rather than assuming a successful source build proves publishability.

## Repository map

- `src/`: library source and public entry points
- `tests/`: unit, integration, benchmark, and packed-consumer verification
- `docs/`: focused design and behavior documentation
- `.changeset/`: release notes and version intent
- `.github/workflows/`: CI and release automation
