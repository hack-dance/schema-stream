# Integrations

Schema Stream consumes an async sequence of JSON text or UTF-8 bytes. Provider SDKs remain
responsible for generation, structured-output validation, retries, cancellation, and the
authoritative final result.

Choose the guide for the stream surface you already use:

- [OpenAI Agents SDK](./openai-agents.md) uses `result.toTextStream()`.
- [Vercel AI SDK](./vercel-ai-sdk.md) uses `streamText().textStream` with `Output.object()`.
- [Mastra](./mastra.md) explains when to prefer `objectStream` and how the guarded compatibility
  path works.
- [Bun WebSocket](./bun-websocket.md) keeps parsing and credentials on the server and sends complete
  application messages to the browser.
- [Provider portability](./provider-portability.md) defines the tested boundary for OpenAI,
  Anthropic, and Gemini models without claiming untested native adapters.

The executable fixtures are the source of truth. From a repository checkout, run:

```sh
bun run examples
bun test tests/sdk-runtime.test.ts
bun run test:packed
```

Those commands are credential-free. Opt-in live tests and their environment contract are described
in [Integration testing](../integration-testing.md). Schema Stream does not validate intermediate
snapshots; validate or await the producing SDK's final structured result before committing data or
triggering irreversible work.
