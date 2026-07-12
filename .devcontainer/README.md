# Schema Stream development container

This container pins Node.js 24.18.0 and Bun 1.3.14, installs the lockfile with
`bun install --frozen-lockfile`, and forwards the WebSocket example on port 3400. It works with
GitHub Codespaces or a local editor that supports the Development Container specification.

Create an editor and terminal workspace at
[codespaces.new/hack-dance/schema-stream](https://codespaces.new/hack-dance/schema-stream), or open
the repository locally with your editor's **Reopen in Container** command. Codespaces availability
and included usage depend on the developer's GitHub plan; the local container path has no hosted
workspace charge.

The safe default is credential-free: live E2E is disabled and the WebSocket UI opens in Fixture
mode. Run the deterministic checks from the repository root:

```sh
bun run examples
bun test tests/sdk-runtime.test.ts
```

Run the browser example locally:

```sh
bun run example:websocket
```

Then open <http://127.0.0.1:3400>. In Codespaces, start it with the exact private forwarded origin:

```sh
SCHEMA_STREAM_EXAMPLE_ORIGIN="https://${CODESPACE_NAME}-3400.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}" \
bun run example:websocket
```

Open the forwarded port from the **Ports** panel. Keep it private. The example validates this exact
origin rather than accepting arbitrary proxy hosts.

`OPENAI_API_KEY` is an optional [recommended Codespaces
secret](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/configuring-dev-containers/specifying-recommended-secrets-for-a-repository).
Associate a personal secret with the repository before creating the codespace to enable the
explicit OpenAI mode. Never paste a key into the documentation website, browser UI, source files,
or terminal history.
