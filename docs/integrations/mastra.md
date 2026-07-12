# Mastra

Mastra's documented progressive structured-output surface is `objectStream`. Prefer it directly when
its partial-object cadence is sufficient, and use `result.object` as the validated final value.

```ts
import { Agent } from "@mastra/core/agent"
import { z } from "zod"

const itinerarySchema = z.object({
  title: z.string(),
  stops: z.array(z.object({ name: z.string(), note: z.string().nullable() }))
})

const agent = new Agent({
  id: "itinerary",
  name: "Itinerary",
  model: "openai/gpt-5.6-luna",
  instructions: "Return the requested structured itinerary."
})
const result = await agent.stream("Plan a weekend.", {
  structuredOutput: { errorStrategy: "strict", schema: itinerarySchema }
})

for await (const partial of result.objectStream) {
  renderProgress(partial)
}

const finalOutput = await result.object
```

## Guard the compatibility path

Mastra describes `textStream` as natural-language text, not a general raw-JSON contract. A pinned
Mastra/provider combination can currently expose the structured response as JSON text. Schema Stream
can add incomplete-string updates, completion events, and snapshot policies only when that contract
is checked and allowed to fail closed.

```ts
import { SchemaStream, type SchemaStreamSource } from "schema-stream"

async function* requireJsonObjectText(
  source: SchemaStreamSource<string>
): AsyncIterable<string> {
  let sawJsonStart = false

  for await (const chunk of source) {
    if (!sawJsonStart) {
      const candidate = chunk.trimStart()
      if (candidate.length > 0) {
        if (!candidate.startsWith("{")) {
          throw new Error("Mastra textStream did not begin with a JSON object")
        }
        sawJsonStart = true
      }
    }
    yield chunk
  }

  if (!sawJsonStart) {
    throw new Error("Mastra textStream did not contain a JSON object")
  }
}

const parser = new SchemaStream(itinerarySchema)
for await (const snapshot of parser.iterate(requireJsonObjectText(result.textStream))) {
  renderFineGrainedProgress(snapshot)
}

const finalOutput = await result.object
```

This guard only checks that the stream starts like a JSON object; the parser and final Mastra result
still provide the meaningful end-to-end checks. Do not silently fall back from prose to partial JSON
parsing.

## Verify the pinned lane

[`examples/mastra.ts`](../../examples/mastra.ts) is the executable compatibility canary. Its
credential-free model runs through Mastra's real `Agent.stream()` orchestration, verifies a nested
completion-driven decision, and compares the final Schema Stream snapshot with `result.object`:

```sh
bun run example:mastra
bun test tests/sdk-runtime.test.ts
```

The repository's weekly live lane pins the tested Mastra and OpenAI model combination:

```sh
SCHEMA_STREAM_LIVE_E2E=1 \
SCHEMA_STREAM_LIVE_PROVIDER=mastra \
SCHEMA_STREAM_MASTRA_MODEL=openai/gpt-5.6-luna \
bun run test:live
```

That lane requires `OPENAI_API_KEY` in the server environment. It is a canary for the pinned path,
not a promise that every Mastra provider emits JSON through `textStream`.
