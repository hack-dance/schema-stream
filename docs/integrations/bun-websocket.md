# Bun WebSocket

For an interactive browser application, keep the provider SDK, credentials, Schema Stream, and
authoritative validation on Bun. Send one complete application-level JSON document per WebSocket
message so the browser only needs ordinary `JSON.parse`, revision checks, and rendering.

```ts
type SnapshotMessage<TValue> = {
  revision: number
  type: "snapshot"
  value: TValue
}

function sendSnapshot<TValue>({
  revision,
  socket,
  value
}: {
  revision: number
  socket: Bun.ServerWebSocket<unknown>
  value: TValue
}): void {
  const message: SnapshotMessage<TValue> = { revision, type: "snapshot", value }
  socket.send(JSON.stringify(message))
}
```

A WebSocket message preserves the application message boundary even when the network transport uses
multiple frames. The browser must still parse the message, reject stale revisions, and handle
reconnects. WebSocket does not remove cancellation, backpressure, authorization, or replay work.

## Run the executable UI

The repository's [`examples/websocket-ui`](../../examples/websocket-ui/) is a complete Bun server and
browser client. Fixture mode is deterministic and credential-free:

```sh
bun run example:websocket
```

Open <http://127.0.0.1:3400>. The example lets you compare `chunk`, `value`, `bytes`, and `final`
snapshot policies while watching the dashboard, completion events, and one progressively
materialized JSON object.

In a development container or GitHub Codespace, port 3400 is forwarded. Codespaces uses a proxy
origin, so start the server with that exact private origin:

```sh
SCHEMA_STREAM_EXAMPLE_ORIGIN="https://${CODESPACE_NAME}-3400.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}" \
bun run example:websocket
```

Open the port from the editor's **Ports** panel. Do not make it public. The default remains
loopback-only when `SCHEMA_STREAM_EXAMPLE_ORIGIN` is absent.

If `OPENAI_API_KEY` is already injected into the server environment, the same page enables its
explicit OpenAI mode. The key never enters the browser or a socket message. Fixture mode remains the
right first run and is enough to inspect every transport and rendering behavior.

## What the example proves

- The Agents SDK stream is parsed on the server.
- Each accepted browser message is a complete, versioned JSON document.
- A nested completed boolean can select an application branch before the root document completes.
- The final progressive snapshot must equal the SDK's authoritative structured result.
- Start, cancel, policy selection, progress, and final state share one socket.

The localhost example also validates Host and Origin, requires a session token for the upgrade,
limits prompt length and byte thresholds, disables provider tracing, and aborts generation when the
socket closes. Its output queue is deliberately simple for a single-user visualization. A
production server still needs bounded per-client queues, authorization, rate limits, reconnect
state, and a policy for coalescing superseded snapshots without dropping the final result.

See [Transporting progressive JSON](../transports.md) for the SSE, NDJSON, Fetch stream, and
WebSocket tradeoffs. SSE also preserves event boundaries; WebSocket is attractive here because the
application needs bidirectional start, cancel, and policy controls on the same connection.
