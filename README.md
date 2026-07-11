# schema-stream

[![npm](https://img.shields.io/npm/v/schema-stream.svg)](https://www.npmjs.com/package/schema-stream)
[![CI](https://github.com/hack-dance/schema-stream/actions/workflows/ci.yml/badge.svg)](https://github.com/hack-dance/schema-stream/actions/workflows/ci.yml)

Progressively parse streamed JSON into typed, schema-shaped snapshots. `schema-stream` is useful
when a model or HTTP response is still arriving but the UI should render partial nested values
immediately.

- SDK-neutral `iterate()` API for Web Streams and async iterables
- Progressive strings, nested objects, arrays, defaults, and completion paths
- OpenAI Agents SDK and Vercel AI SDK text-stream compatibility
- Zod 4 Classic, Zod Mini, and Zod 3.25+
- ESM and CommonJS builds with no runtime dependency beyond the Zod peer

`schema-stream` derives types and initial placeholders from the schema. It does not validate partial
or final values; use your schema or the producing SDK's settled output for authoritative validation.

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
  onKeyComplete({ activePath, completedPaths }) {
    console.log({ activePath, completedPaths })
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
  model: "gpt-5.5",
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
  model: "openai/gpt-5.5",
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

## Defaults and completion paths

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
  onKeyComplete({ activePath, completedPaths }) {
    updateLoadingState(activePath, completedPaths)
  }
})
```

Zod defaults are used when present. `defaultData` overrides individual fields, including falsy
values. The final completion callback has an empty `activePath`.

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
bun run check
```

`mise.toml` pins Bun 1.3.14 and the current Node 24 release. Maintainers type-check and emit
declarations with TypeScript 7.0.2. TypeScript is a development-only dependency, so installing
`schema-stream` does not install or require TypeScript 7.

Ultracite and Biome own formatting and linting. `bun run format` applies safe fixes, `bun run lint`
checks the repository without writing, and `bun run check` includes linting before type checks,
tests, and packed-consumer verification.

`test:packed` installs the generated tarball into clean consumers and verifies ESM, CommonJS,
Zod 4/Mini, Zod 3, OpenAI Agents SDK, and Vercel AI SDK compatibility with TypeScript 5.9 without
contacting a model. This protects the declaration surface from accidental TS7-only syntax.

## License

MIT
