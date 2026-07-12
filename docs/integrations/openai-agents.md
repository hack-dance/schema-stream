# OpenAI Agents SDK

The OpenAI Agents SDK exposes model text as an async stream through `toTextStream()`. Pass that
stream to `SchemaStream.iterate()` on the server, render the progressive snapshots, then treat the
Agents SDK result as authoritative after the run completes.

```ts
import { Agent, run } from "@openai/agents"
import { SchemaStream } from "schema-stream"
import { z } from "zod"

const analysisSchema = z.object({
  summary: z.string(),
  triage: z.object({
    requiresApproval: z.boolean(),
    rationale: z.string()
  }),
  tags: z.array(z.string())
})

const agent = new Agent({
  name: "Analyst",
  model: "gpt-5.6-luna",
  instructions: "Return a structured analysis.",
  outputType: analysisSchema
})

const result = await run(agent, "Assess the release plan.", { stream: true })
const parser = new SchemaStream(analysisSchema, {
  onValueComplete({ path, value }) {
    const isApproval =
      path.length === 2 && path[0] === "triage" && path[1] === "requiresApproval"

    if (isApproval && value === true) {
      notifyReleaseOwner()
    }
  }
})

for await (const snapshot of parser.iterate(result.toTextStream())) {
  renderProgress(snapshot)
}

await result.completed
const finalOutput = analysisSchema.parse(result.finalOutput)
```

`onValueComplete` runs after the boolean is syntactically complete, so the branch does not inspect a
partial value. Keep callback work short and reversible; final model validation can still fail. See
[Completion events](../completion-events.md) for ordering and container-value semantics.

## Server boundary

- Keep `OPENAI_API_KEY`, the Agents SDK, and Schema Stream in a trusted server process.
- Forward complete snapshots, patches, or completion events to the browser. Do not forward the key
  or make the browser understand provider event envelopes.
- Wire the request's `AbortSignal` through the Agents SDK and stop producing snapshots when no
  authorized consumer remains.
- Use the SDK's `finalOutput` only after `completed` resolves, and validate it before durable writes.

## Verify the integration

The repository's [`examples/sdk-mocks.ts`](../../examples/sdk-mocks.ts) runs the real Agents SDK
Runner against a deterministic model implementation. It verifies progressive snapshots, a nested
completion-driven decision, and final-result equality without credentials:

```sh
bun run example:sdk
bun test tests/sdk-runtime.test.ts
```

The opt-in live lane requires an already injected key and an explicit model:

```sh
SCHEMA_STREAM_LIVE_E2E=1 \
SCHEMA_STREAM_LIVE_PROVIDER=agents \
SCHEMA_STREAM_AGENTS_MODEL=gpt-5.6-luna \
bun run test:live
```

The live suite uses bounded output, timeouts, disabled tracing, varied nested schemas, and sanitized
failures. Never place a key in a command, source file, client bundle, or documentation form.
