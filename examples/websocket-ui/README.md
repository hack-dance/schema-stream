# Bun WebSocket UI example

This example keeps incomplete model JSON on the server. A Bun WebSocket server runs an OpenAI
Agents SDK structured-output stream through `SchemaStream`, makes a conditional workflow decision
when `triage.requiresApproval` completes, and sends the browser only complete JSON messages.

## Run it

From the repository root:

```sh
bun examples/websocket-ui/server.ts
```

Open <http://127.0.0.1:3400>. **Fixture** replays a fixed structured response through an Agents SDK
`Runner` and SchemaStream without credentials. It keeps the source bytes identical when comparing
snapshot policies. **OpenAI** enables the editable dashboard request and makes a fresh model call
when the server process has `OPENAI_API_KEY`; Bun loads a gitignored root `.env.local` automatically.
The renderer and output schema are intentionally fixed: OpenAI generates the values that materialize
inside the dashboard, not HTML, components, or page layout.

Use the **Chunk**, **Value**, **Bytes**, and **Final** controls to compare snapshot cadence. Each
OpenAI run is not a controlled policy benchmark because the model can change its output and chunking.
**Chunk** is SchemaStream's default: it emits once per source chunk
with `stringBufferSize: 0`. A source chunk can contain part of a Unicode code point or many complete
code points. Literal character cadence requires re-chunking upstream and is usually too expensive
for production UI updates.

The console reports input chunk and byte totals alongside emitted snapshot counts. Its lower raw
JSON pane shows one cumulative schema-shaped snapshot as valid JSON and updates that object in place
for each WebSocket snapshot message. The event log and JSON panes split the inspector height
evenly and collapse independently. Generated sections and list rows enter only when their values
first materialize, while the operating system's reduced-motion preference disables those
transitions.

Optional settings:

```sh
SCHEMA_STREAM_EXAMPLE_MODEL=gpt-5.6-luna
SCHEMA_STREAM_EXAMPLE_PORT=3401
```

Do not put API keys in browser code. The server binds to `127.0.0.1`, tracing is disabled, and
the server requires an exact local Host and Origin plus a per-process WebSocket capability. This is
still a localhost visualization, not production authentication or authorization.

## Data flow

1. The Agents SDK yields incomplete JSON text through `result.toTextStream()`.
2. `SchemaStream` parses it on the server with the selected snapshot policy; omitted policy options
   use the public chunk default.
3. `onValueComplete` reports the completed path and value. When `triage.requiresApproval` completes,
   the server selects either `approval-gate` or `auto-stage` without waiting for a snapshot or the
   full dashboard.
4. Each WebSocket message is one `JSON.stringify()`-encoded protocol envelope containing a complete
   schema-shaped snapshot, decision, status, error, or final output.
5. The browser uses only DOM text APIs to render cumulative snapshots into the dashboard and event
   log. It never parses partial model JSON or receives raw model chunks.

The server also validates that the final SchemaStream snapshot is deeply equivalent to the Agents
SDK authoritative structured output before it sends the `complete` event.

WebSocket is used here because start, cancel, snapshot-policy selection, conditional decisions, and
progress all share one connection. SSE could carry the same complete server-materialized snapshots,
but interactive commands would use separate HTTP requests. A raw Fetch response would also need an
explicit record decoder in the browser because response chunks are not message boundaries. See the
[transport guide](../../docs/transports.md) for the full steelman and adversarial comparison.

For visual clarity, this localhost demo sends every emission selected by the policy. A production
server should coalesce pending snapshots, watch socket backpressure, drop superseded progress, and
always deliver one authoritative final revision.
