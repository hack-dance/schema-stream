# schema-stream

[![npm](https://img.shields.io/npm/v/schema-stream.svg)](https://www.npmjs.com/package/schema-stream)
[![CI](https://github.com/hack-dance/schema-stream/actions/workflows/ci.yml/badge.svg)](https://github.com/hack-dance/schema-stream/actions/workflows/ci.yml)
[![Follow @dimitrikennedy](https://img.shields.io/twitter/follow/dimitrikennedy?style=social&labelColor=000000)](https://twitter.com/dimitrikennedy)

[Documentation](https://schema.stream/docs) · [Examples](https://schema.stream/examples) ·
[Benchmarks](https://schema.stream/benchmarks) · [Playground](https://schema.stream/playground)

Parse JSON while it is still arriving. `schema-stream` turns a Web Stream or async iterable into
typed, schema-shaped snapshots, so a UI can render partial strings, nested objects, and arrays
before the response is complete.

- SDK-neutral `iterate()` API for Web Streams and async iterables
- Schema-derived placeholders, progressive nested values, and low-overhead completion events
- Opt-in snapshot policies for per-value, byte-threshold, and final-only updates
- OpenAI Agents and Vercel AI SDK text streams, plus a live-tested Mastra compatibility canary
- Zod 4 Classic, Zod Mini, and Zod 3.25+
- ESM and CommonJS builds with no runtime dependency beyond the Zod peer

Snapshots are progressive parser output, not validation results. `schema-stream` uses the schema for
types and initial placeholders, but it does not validate partial or final values. Validate the
settled value with your schema or use the producing SDK's validated result.

![Terminal demo of schema-stream filling a typed object as JSON arrives](https://raw.githubusercontent.com/hack-dance/schema-stream/main/docs/assets/schema-stream-demo.gif)

## One stream, many snapshots

Every value yielded by `iterate()` is a complete, independent snapshot. If this JSON arrives in
small chunks:

```json
{"title":"Hello","details":{"score":42}}
```

the snapshots can progress like this:

```json
{"title":"Hel","details":{"score":null}}
{"title":"Hello","details":{"score":null}}
{"title":"Hello","details":{"score":42}}
```

The default cadence follows the source chunks with `snapshotPolicy: { mode: "chunk" }` and
`stringBufferSize: 0`. That disables the fixed-size byte buffer; the decoded value is still
accumulated. It is not necessarily one character per snapshot: an SDK or network chunk may contain
part of a Unicode code point or many complete code points. Opt-in snapshot policies can instead emit
at completed-value boundaries, byte thresholds, or only once at the end.

## Install

```bash
npm install schema-stream zod
```

```bash
bun add schema-stream zod
```

## Progressive JSON

```typescript
import { SchemaStream, type SchemaStreamChunk } from "schema-stream"
import { z } from "zod"

const schema = z.object({
  summary: z.string(),
  details: z.object({ score: z.number() }),
  tags: z.array(z.string())
})

const parser = new SchemaStream(schema, {
  onValueComplete({ path, value }) {
    if (path[0] === "details" && path[1] === "score") {
      routeScore(value)
    }
  }
})

for await (const partial of parser.iterate(response.body!)) {
  const update: SchemaStreamChunk<typeof schema> = partial
  renderProgress(update)
}
```

`iterate()` accepts `ReadableStream<string | Uint8Array>` or
`AsyncIterable<string | Uint8Array>`. It preserves backpressure, handles UTF-8 code points split
across byte chunks, cancels the source when iteration ends early, and yields an independent snapshot
for every input chunk.

Snapshot cadence is opt-in and shared with `parse()`. Omitting the option retains one snapshot per
input chunk:

```typescript
parser.iterate(source, { snapshotPolicy: { mode: "value" } })
parser.iterate(source, { snapshotPolicy: { mode: "bytes", bytes: 256 * 1024 } })
parser.iterate(source, { snapshotPolicy: { mode: "final" } })
```

See [snapshot policies](./docs/snapshot-policies.md) for exact semantics and performance tradeoffs.
See [completion events](./docs/completion-events.md) for nested path ordering, filtering, and the
legacy progress callback.

## Server-to-browser streaming

Provider text deltas and raw response chunks are not standalone JSON documents. A raw Fetch response
can split a UTF-8 code point or JSON token anywhere. SSE and WebSocket add application framing:
`EventSource` assembles a complete SSE event, and WebSocket exposes a complete logical message after
protocol-frame reassembly. Either can carry a complete server-materialized snapshot.

For most provider-backed applications, keep the API key, SDK, and SchemaStream on the server. Parse
the provider text once, choose an intentional snapshot cadence, then send each selected snapshot as
one versioned JSON message. The browser can use ordinary `JSON.parse` on every message without
understanding partial JSON or provider event formats.

```typescript
for await (const snapshot of parser.iterate(providerTextStream, {
  snapshotPolicy: { mode: "value" }
})) {
  socket.send(JSON.stringify({ type: "snapshot", revision: revision++, value: snapshot }))
}
```

Browser-side parsing remains supported for local-first, offline, and client-only cases. Server-side
placement is usually preferable when it centralizes secrets, validation, cancellation, coalescing,
and backpressure. WebSocket is often the cleaner browser hop when start, cancel, policy changes, and
progress should share one connection; SSE remains a sound choice for one-way progress and automatic
reconnect. Do not blindly send a growing full snapshot for every token: repeated serialization and
network bytes can become the new bottleneck.

From a repository checkout, run the interactive comparison at <http://127.0.0.1:3400>:

```bash
bun run example:websocket
```

See the [transport guide](./docs/transports.md) and the repository's
[Bun WebSocket UI](./examples/websocket-ui/) for an interactive localhost visualization of the
message protocol and snapshot-policy controls.

## Performance

Run the repeatable Bun and Node benchmark from a repository checkout:

```bash
bun run benchmark
```

The benchmark compares three feature-aligned paths for each snapshot policy. `parse()` materializes
each byte snapshot through `JSON.stringify` and UTF-8 encoding. The serialized baseline then
decodes each snapshot and applies `JSON.parse`; the direct candidate uses `iterate()` to emit the
same independent object snapshot without that round trip. The terminal summary reports the speedup
of the direct candidate over the serialized baseline and the cumulative serialization it avoids.

It also reports normalized `JSON.stringify`, UTF-8 encoding, and `JSON.parse` costs as native
runtime references. Those isolated operations are not presented as equivalent alternatives to
progressive schema-shaped parsing, and the benchmark does not claim SchemaStream is faster than
standalone `JSON.parse` or `JSON.stringify`. Results are local synthetic measurements; the runtime
versions, fixture size, chunk size, warmups, and sample count printed by the command define each
result.

Representative local results from an Apple M5 Max arm64 host on July 11, 2026 are shown below.
These are medians from the default 2 MiB fixtures, 64 KiB chunks, one warmup, and five measured
runs. The [machine-readable evidence](./docs/benchmarks/2026-07-11-apple-m5-max.json) retains the raw
samples, host, baseline revision, validation method, and benchmark configuration.

| Runtime | Fixture / policy | Serialized round trip | Direct object | Speedup | Serialization avoided |
| --- | --- | ---: | ---: | ---: | ---: |
| Bun 1.3.14 | long string / chunk | 11.94 ms | 1.53 ms | 7.80x | 33.00 MiB |
| Bun 1.3.14 | long string / final | 1.95 ms | 1.29 ms | 1.52x | 2.00 MiB |
| Bun 1.3.14 | object heavy / chunk | 310.36 ms | 298.24 ms | 1.04x | 35.00 MiB |
| Bun 1.3.14 | object heavy / final | 93.33 ms | 87.88 ms | 1.06x | 2.00 MiB |
| Node 24.18.0 | long string / chunk | 100.60 ms | 2.73 ms | 36.83x | 33.00 MiB |
| Node 24.18.0 | long string / final | 7.64 ms | 2.63 ms | 2.91x | 2.00 MiB |
| Node 24.18.0 | object heavy / chunk | 339.35 ms | 245.88 ms | 1.38x | 35.00 MiB |
| Node 24.18.0 | object heavy / final | 55.63 ms | 52.18 ms | 1.07x | 2.00 MiB |

Use `bun run benchmark --help` for filters, verbose ranges, and machine-readable JSON. See the
[benchmark methodology](./docs/snapshot-policies.md#benchmark) for the fixtures and timing
boundaries.

Completion callback scaling is measured separately so the normal suite stays quick:

```bash
bun run benchmark --completion-scaling
```

That mode doubles nested record counts and compares parsing with no callback, delta-based
`onValueComplete`, and cumulative-history `onKeyComplete`.

## OpenAI Agents SDK

Pass the Agents SDK text stream directly to `iterate()`:

```typescript
import { Agent, run } from "@openai/agents"
import { SchemaStream } from "schema-stream"
import { z } from "zod"

const outputSchema = z.object({
  summary: z.string(),
  details: z.object({ score: z.number() }),
  tags: z.array(z.string())
})

const agent = new Agent({
  name: "Analyst",
  model: "gpt-5.6-luna",
  instructions: "Return a structured analysis.",
  outputType: outputSchema
})

const result = await run(agent, input, { stream: true })
const parser = new SchemaStream(outputSchema)

for await (const partial of parser.iterate(result.toTextStream())) {
  renderProgress(partial)
}

await result.completed
const finalOutput = result.finalOutput
```

The progressive chunks are for immediate UX. After `completed` resolves, `finalOutput` is the
Agents SDK's authoritative schema-validated result.

## Vercel AI SDK

Pass `streamText().textStream` to SchemaStream to receive schema-shaped defaults and updates inside
incomplete strings and nested values:

```typescript
import { Output, streamText } from "ai"
import { SchemaStream } from "schema-stream"
import { z } from "zod"

const outputSchema = z.object({
  summary: z.string(),
  details: z.object({ score: z.number() }),
  tags: z.array(z.string())
})

const result = streamText({
  model: "openai/gpt-5.6-luna",
  output: Output.object({ schema: outputSchema }),
  prompt: input
})

const parser = new SchemaStream(outputSchema)

for await (const partial of parser.iterate(result.textStream)) {
  renderProgress(partial)
}

const finalOutput = await result.output
```

AI SDK's `partialOutputStream` is a good fit when its partial-object semantics are sufficient.
SchemaStream consumes the raw text stream when you need schema-derived stubs or finer-grained
updates. `result.output` remains the authoritative validated result.

## Mastra

Mastra's documented progressive structured-output surface is `objectStream`; its `textStream` is a
natural-language stream and is not generally a raw-JSON contract. Use `objectStream` directly when
its partial-object cadence is sufficient, and keep `object` as the authoritative validated result:

```typescript
import { Agent } from "@mastra/core/agent"
import { z } from "zod"

const outputSchema = z.object({
  summary: z.string(),
  details: z.object({ score: z.number() }),
  tags: z.array(z.string())
})

const agent = new Agent({
  id: "analyst",
  name: "Analyst",
  model: "openai/gpt-5.6-luna",
  instructions: "Return a structured analysis."
})

const result = await agent.stream(input, {
  structuredOutput: {
    schema: outputSchema,
    errorStrategy: "strict"
  }
})

for await (const partial of result.objectStream) {
  renderProgress(partial)
}

const finalOutput = await result.object
```

Some pinned Mastra/provider combinations currently expose direct structured JSON through
`textStream` because the schema is forwarded as the model's response format. That behavior is not
Mastra's public cross-provider contract. The repository's [executable Mastra compatibility
example](./examples/mastra.ts) guards the stream before passing it to SchemaStream, and the weekly
live test verifies `@mastra/core@1.50.1` with `openai/gpt-5.6-luna`. This optional lane provides
SchemaStream's incomplete-string updates, completion events, and snapshot policies, while failing
closed if an upstream version begins emitting prose.

The repository runs credential-free runtime integrations against all three surfaces and provides
an opt-in live-provider matrix for the OpenAI Agents SDK, Mastra, and Vercel AI SDK with varied
prompts and schemas. See
[integration testing](./docs/integration-testing.md) for the commands and environment contract.

## Zod compatibility

The peer range is `zod@^3.25.0 || ^4.0.0`.

```typescript
// Zod 4 Classic
import { z } from "zod"

// Zod Mini
import * as z from "zod/mini"

// Zod 3.25+
import { z } from "zod/v3"
```

Schema-derived stubs support objects, arrays, records, strings, numbers, booleans, enums, defaults,
prefaults, optionals, nullables, readonly/catch wrappers, lazy schemas, and transform/pipe inputs.
Ambiguous or non-JSON schema nodes begin as `null` and are replaced when streamed JSON arrives.

## Defaults and completion events

```typescript
const parser = new SchemaStream(schema, {
  defaultData: {
    summary: "Waiting for the model..."
  },
  typeDefaults: {
    string: "",
    number: null,
    boolean: null
  },
  onValueComplete({ path, value }) {
    routeCompletedValue(path, value)
  }
})
```

Zod defaults are used when present. `defaultData` overrides individual fields, including falsy
values. `onValueComplete` emits the completed value with its path, reports leaves before their
containers, and uses an empty path for the completed root document. Event values are syntactically
complete but not schema-validated. The legacy `onKeyComplete` callback remains available when a
consumer needs character-level string progress and cumulative completion history; new completion
listeners should use `onValueComplete` to avoid repeatedly copying that history.

## Low-level transform

`parse()` remains available for pipelines that need serialized JSON snapshots:

```typescript
const transform = new SchemaStream(schema).parse()
const snapshots = response.body!.pipeThrough(transform)

for await (const bytes of snapshots) {
  const partial = JSON.parse(new TextDecoder().decode(bytes))
  renderProgress(partial)
}
```

`parse()` accepts the same `snapshotPolicy` option as `iterate()`.

## Development

```bash
mise install
bun install
bun run format
bun run lint
bun run examples
bun run benchmark
bun run docs:dev
bun run docs:check
bun run docs:build
bun run check
```

`mise.toml` pins Bun 1.3.14 and the current Node 24 release. Maintainers type-check and emit
declarations with TypeScript 7.0.2. TypeScript is a development-only dependency, so installing
`schema-stream` does not install or require TypeScript 7.

Ultracite and Biome own formatting and linting. `bun run format` applies safe fixes, `bun run lint`
checks the repository without writing, and `bun run check` includes linting before type checks,
tests, packed-consumer verification, generated-doc drift checks, and the production docs build.

The checked-in Markdown in `README.md`, `docs/`, `CHANGELOG.md`, and `CONTRIBUTING.md` is the
documentation source of truth for both GitHub and [schema.stream](https://schema.stream). Public API
reference Markdown is generated from exported TSDoc, benchmark summaries are generated from the
latest checked-in JSON evidence, and `site/content/docs` is an ignored build-stage copy. Run
`bun run docs:generate` after changing exports, public TSDoc, or benchmark evidence; never edit the
staged site content directly.

`test:packed` installs the generated tarball into clean consumers and verifies ESM, CommonJS,
Zod 4/Mini, Zod 3, OpenAI Agents SDK, Mastra, and Vercel AI SDK compatibility with TypeScript 5.9
under Node and Bun without contacting a model. This protects the declaration surface from
accidental TS7-only syntax.

## License

MIT
