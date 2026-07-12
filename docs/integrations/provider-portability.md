# Provider portability

Schema Stream is provider-agnostic at its input boundary: it consumes JSON text or UTF-8 bytes. A
provider integration is portable only when the surrounding SDK reliably exposes the structured
response as raw JSON text and separately validates an authoritative final result.

The Vercel AI SDK is the repository's portability boundary. Keep the parser function generic over
AI SDK's `LanguageModel` and configure the provider elsewhere:

```ts
import { type LanguageModel, Output, streamText } from "ai"
import { SchemaStream } from "schema-stream"
import { z } from "zod"

const schema = z.object({
  answer: z.string(),
  confidence: z.number(),
  sources: z.array(z.string())
})

async function runStructuredModel({
  model,
  prompt
}: {
  model: LanguageModel
  prompt: string
}): Promise<z.output<typeof schema>> {
  const result = streamText({ model, output: Output.object({ schema }), prompt })
  const parser = new SchemaStream(schema)

  for await (const snapshot of parser.iterate(result.textStream)) {
    renderProgress(snapshot)
  }

  return await result.output
}
```

The same function can receive an AI SDK model supplied by a gateway or a separately configured AI
SDK provider package. Credential loading, model identifiers, and provider options stay outside
Schema Stream.

## What is tested

| Path | Repository evidence | Support claim |
| --- | --- | --- |
| OpenAI Agents SDK | Deterministic runtime tests, packed types, and weekly live tests | Direct documented integration |
| Vercel AI SDK `LanguageModel` | Deterministic `streamText()` runtime tests and packed types | SDK-level integration |
| Vercel AI Gateway | Opt-in live test lane for an application-selected model id | Live harness available; model-specific behavior must be tested |
| Mastra with the pinned OpenAI path | Guarded deterministic example and weekly live canary | Pinned compatibility lane |
| Anthropic or Claude through the AI SDK interface | The same tested AI SDK `LanguageModel` boundary | Candidate integration; no native Anthropic adapter or live model is claimed |
| Google Gemini through the AI SDK interface | The same tested AI SDK `LanguageModel` boundary | Candidate integration; no native Gemini adapter or live model is claimed |

The repository does not currently install, execute, or promise direct Anthropic SDK or Google
GenAI SDK stream adapters. Do not pass provider-specific SSE events to Schema Stream unless an
adapter first extracts only the structured JSON text and has its own fixture and live canary.

## Qualify a model before shipping

1. Run the credential-free AI SDK fixtures with the exact package versions used by the application.
2. Add a provider-shaped deterministic fixture that splits JSON across strings, escapes, UTF-8
   boundaries, nested arrays, and completion boundaries.
3. Run the opt-in live Gateway lane with the exact model id and several structurally different
   schemas.
4. Assert meaningful intermediate snapshots, child-before-root completion ordering, and equality
   between the final snapshot and `result.output`.
5. Bound output, retries, and timeouts; sanitize failures so prompts, responses, headers, and keys do
   not enter logs.
6. Keep one scheduled canary for every provider/model combination the application depends on.

Provider behavior and structured-output support can change independently of Schema Stream. An AI SDK
type check proves the interface compiles; it does not prove a particular model emits useful or
correct incremental JSON. See [Integration testing](../integration-testing.md) for the existing
fixtures and live-test contract.
