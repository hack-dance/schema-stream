# Vercel AI SDK

Use Schema Stream with the Vercel AI SDK when you need finer updates than
`partialOutputStream` provides, schema-derived placeholders before fields arrive, or completion
events for individual JSON values. Feed `streamText().textStream` to the parser and keep
`result.output` as the authoritative structured result.

```ts
import { type LanguageModel, Output, streamText } from "ai"
import { SchemaStream } from "schema-stream"
import { z } from "zod"

const analysisSchema = z.object({
  summary: z.string(),
  details: z.object({ score: z.number() }),
  tags: z.array(z.string())
})

async function streamAnalysis({
  input,
  model
}: {
  input: string
  model: LanguageModel
}): Promise<z.output<typeof analysisSchema>> {
  const result = streamText({
    model,
    output: Output.object({ schema: analysisSchema }),
    prompt: input
  })
  const parser = new SchemaStream(analysisSchema)

  for await (const snapshot of parser.iterate(result.textStream)) {
    renderProgress(snapshot)
  }

  return await result.output
}
```

The `LanguageModel` input keeps the parsing code independent of how the application configures an AI
SDK provider or gateway. Schema Stream integrates with the normalized AI SDK text stream; it does
not configure provider credentials or replace the SDK's structured-output validation.

## Choose the native partial stream when it is enough

Prefer AI SDK's `partialOutputStream` when its object cadence already meets the interface's needs.
Use Schema Stream on `textStream` when one or more of these matter:

- incomplete strings should visibly grow;
- nested placeholders should exist before the provider reaches them;
- `onValueComplete` should trigger a conditional branch as soon as one value settles;
- snapshot cadence should use Schema Stream's `chunk`, `value`, `bytes`, or `final` policy.

Regardless of the progress path, await `result.output` before treating the generation as valid.

## Verify the integration

[`examples/sdk-mocks.ts`](../../examples/sdk-mocks.ts) and
[`tests/sdk-runtime.test.ts`](../../tests/sdk-runtime.test.ts) exercise `streamText()`,
`Output.object()`, and `textStream` with provider-shaped deterministic events:

```sh
bun run example:sdk
bun test tests/sdk-runtime.test.ts
```

The test suite covers Unicode, escaped content, optional and nullable fields, records, and deeply
nested arrays. The packed-consumer gate also compiles the integration against the generated package:

```sh
bun run test:packed
```

An opt-in Vercel AI Gateway lane exists for an application-selected `provider/model` id:

```sh
SCHEMA_STREAM_LIVE_E2E=1 \
SCHEMA_STREAM_LIVE_PROVIDER=gateway \
SCHEMA_STREAM_GATEWAY_MODEL=<provider/model> \
bun run test:live
```

It requires `AI_GATEWAY_API_KEY` through the server environment. See [Provider
portability](./provider-portability.md) before generalizing the deterministic AI SDK coverage to a
specific Anthropic or Gemini model.
