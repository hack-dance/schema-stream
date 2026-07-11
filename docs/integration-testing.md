# Integration testing

Schema Stream tests both parser correctness and the SDK stream shapes consumers use in production.
The default suite never needs credentials or network access.

## Deterministic SDK runtime tests

Run the SDK integration suite directly:

```sh
bun test tests/sdk-runtime.test.ts
```

These tests execute Vercel AI SDK `streamText()` with `Output.object()`, the OpenAI Agents SDK
`Runner` with `toTextStream()`, and Mastra `Agent.stream()` with `structuredOutput`. Deterministic
model implementations supply provider-shaped stream events, so the tests exercise the real SDK
orchestration without contacting a provider.

The fixtures cover two distinct schema families with nested arrays and objects, records, nullable
and optional fields, Unicode, escaped punctuation, and long progressive strings. Each run verifies
meaningful intermediate snapshots, independent object identity, prompt forwarding, final schema
validation, and equality with the SDK's authoritative output.

## Runnable examples

These development commands require a repository checkout and its dev dependencies; examples are not
part of the published package tarball. Run every credential-free example with:

```sh
bun run examples
```

Run any example independently:

```sh
bun run example:progressive
bun run example:sdk
bun run example:mastra
```

`example:progressive` streams complex JSON directly. `example:sdk` runs both supported SDKs through
their deterministic model interfaces. `example:mastra` is a guarded compatibility canary for a
Mastra one-model path whose mock emits JSON text. Every example verifies its final snapshots, and
the SDK examples also compare them with the producing framework's authoritative structured result.

Mastra officially documents `objectStream` for progressive structured output and describes
`textStream` as natural-language text. The compatibility example therefore checks for raw JSON
before parsing. The opt-in live lane is a weekly canary for the pinned Mastra/OpenAI combination,
not a general promise that every Mastra provider exposes structured JSON text.

The WebSocket UI is a long-running server example rather than part of `bun run examples`:

```sh
bun run example:websocket
```

It keeps SchemaStream and provider credentials on Bun, then sends versioned, fully valid JSON
messages to a browser client. See [`examples/websocket-ui`](../examples/websocket-ui/) for its
fixed Fixture and model-backed OpenAI modes.

## Live provider matrix

Live tests are disabled unless `SCHEMA_STREAM_LIVE_E2E=1` and a provider is selected. Inject secrets
through a secure process environment such as a 1Password Developer Environment; do not commit a
credential file.

For deliberately local development, the repository ignores `.env.local`. Bun normally loads it;
the following direct command makes the credential source explicit and reproducible:

```sh
SCHEMA_STREAM_LIVE_E2E=1 \
SCHEMA_STREAM_LIVE_PROVIDER=agents \
SCHEMA_STREAM_AGENTS_MODEL=gpt-5.6-luna \
bun --env-file=.env.local test tests/live-model.e2e.test.ts --timeout=300000
```

Keep `.env.local` local and use runtime-injected secrets in CI.

OpenAI Agents SDK requires `OPENAI_API_KEY` to already be present through the authorized runtime:

```sh
SCHEMA_STREAM_LIVE_E2E=1 \
SCHEMA_STREAM_LIVE_PROVIDER=agents \
SCHEMA_STREAM_AGENTS_MODEL=<model> \
bun run test:live
```

Vercel AI Gateway requires `AI_GATEWAY_API_KEY` to already be present through the authorized
runtime:

```sh
SCHEMA_STREAM_LIVE_E2E=1 \
SCHEMA_STREAM_LIVE_PROVIDER=gateway \
SCHEMA_STREAM_GATEWAY_MODEL=<provider/model> \
bun run test:live
```

Mastra uses the same `OPENAI_API_KEY` with a provider-qualified model id:

```sh
SCHEMA_STREAM_LIVE_E2E=1 \
SCHEMA_STREAM_LIVE_PROVIDER=mastra \
SCHEMA_STREAM_MASTRA_MODEL=openai/<model> \
bun run test:live
```

Use `SCHEMA_STREAM_LIVE_PROVIDER=all` with all three model variables and both credential variables
to run every provider. When live E2E is explicitly enabled, an invalid provider or missing
selected-provider variable is a test failure rather than a skip. Without
`SCHEMA_STREAM_LIVE_E2E=1`, all live cases skip normally. The matrix uses three varied schemas: an
escape-heavy Unicode summary, a multilevel inventory, and a schedule with nullable branches and
repeated nested entries.

Live assertions avoid model-specific wording and provider-specific chunk counts. They require at
least one snapshot, child-before-root completion events, schema-valid authoritative output,
case-specific semantic constraints, and agreement between the last Schema Stream snapshot and the
SDK result. Requests use bounded output and explicit timeouts. Agents tracing is disabled, and
failures print only a fixed case identifier, sanitized error class, and numeric status when
available; prompts, outputs, headers, and credentials are never logged.

The `Live model E2E` GitHub Actions workflow runs the Agents and Mastra lanes weekly and on manual
dispatch. It is intentionally excluded from pull requests so forked code cannot access the
repository secret and routine contributions do not incur provider cost.

## Packed consumers

```sh
bun run test:packed
```

The packed gate installs the generated tarball into clean TypeScript 5.9 consumers. It executes ESM,
CommonJS, Zod 4, Zod Mini, and Zod 3 parsing under Node and Bun, checks completion events, and compiles
the OpenAI Agents SDK, Mastra, and Vercel AI SDK integration surfaces without contacting a model.
