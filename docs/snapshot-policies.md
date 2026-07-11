# Snapshot policies

Snapshot policies reduce cumulative snapshot work, including JSON serialization for `parse()`, when
a consumer does not need an update for every source chunk. They are optional. Omitting
`snapshotPolicy` retains the 4.0 behavior: one snapshot for every input chunk.

The same options work with both `parse()` and `iterate()`:

```typescript
parser.parse({ snapshotPolicy: { mode: "bytes", bytes: 256 * 1024 } })

for await (const snapshot of parser.iterate(source, {
  snapshotPolicy: { mode: "value" }
})) {
  renderProgress(snapshot)
}
```

## Modes

### `chunk`

```typescript
{
  mode: "chunk"
}
```

Emits after every input chunk. This is the default and is snapshot-for-snapshot compatible with
omitting the option. The default `stringBufferSize` is `0`, so SchemaStream adds no fixed-size string
buffer, but source chunks remain the cadence boundary. A provider or network chunk can contain one
or many characters; character-by-character snapshots require the upstream source itself to emit one
Unicode code point per chunk.

### `value`

```typescript
{
  mode: "value"
}
```

Emits after an input chunk completes at least one primitive JSON value. Several values completed in
one source chunk produce one snapshot. This is useful for long streamed strings because incomplete
characters do not repeatedly materialize or serialize the entire accumulated object.

### `bytes`

```typescript
{ mode: "bytes", bytes: 256 * 1024 }
```

Emits when source bytes received since the previous snapshot meet or exceed the positive integer
threshold. Thresholds are evaluated at source-chunk boundaries; SchemaStream does not split input
chunks. At flush, parser state not represented by the previous snapshot is emitted below the
threshold; structural-only trailing bytes do not create a duplicate snapshot.

### `final`

```typescript
{
  mode: "final"
}
```

Emits once after the JSON parser reaches a complete document. As in 4.0, SchemaStream does not apply
the Zod schema as authoritative output validation. Validate the result explicitly or use the settled,
validated output from the producing SDK.

## Errors, callbacks, and backpressure

- `parse()` rejects invalid byte thresholds synchronously. `iterate()` rejects on first advancement,
  before locking the source.
- Malformed and truncated JSON reject under every policy.
- `onValueComplete` and legacy `onKeyComplete` cadence are independent of snapshot cadence. See
  [Completion events](./completion-events.md) for their different cost and ordering contracts.
- `iterate()` preserves source backpressure at emission boundaries and cancels its source when the
  consumer returns early.
- Every yielded `iterate()` value is an independent JSON-equivalent copy, so consumer mutation
  cannot affect later snapshots. Parser-owned JSON-domain state is cloned directly; exotic custom
  defaults retain the exact stringify/parse fallback behavior.
- Timer-based policies are intentionally excluded because asynchronous controller lifetime,
  cancellation, and deterministic backpressure semantics require a separate design.

## Benchmark

Run the public cross-runtime benchmark:

```bash
bun run benchmark
```

The default run quietly builds the package, then benchmarks Bun and Node against the same ESM entry
point. Each runtime receives separate long-string and object-heavy fixtures targeting 2 MiB, split
into 64 KiB source chunks. Measurements run sequentially with one warmup and five recorded samples.
The round-trip and direct-iteration operations alternate order within paired samples to reduce JIT
and measurement-order bias. The compact terminal tables report medians; `--verbose` adds ranges and
detailed emission metrics, while `--json` includes every recorded sample.

### What is compared

The native JSON reference table isolates `JSON.stringify`, both `Buffer.from` and browser-compatible
`TextEncoder.encode` UTF-8 paths, and `TextDecoder` plus `JSON.parse`.
Its time column is normalized to milliseconds per operation even though each recorded sample repeats
the operation over at least 16 MiB. These rows expose component costs; they are not
feature-equivalent alternatives to SchemaStream.

The streaming tables exercise `chunk`, `value`, 256 KiB, 1 MiB, and `final` policies through three
paths:

- `parse` incrementally parses the source and emits serialized UTF-8 snapshots.
- `roundtrip` runs the same parser and policy, then decodes and applies `JSON.parse` to every
  emitted snapshot. This is the feature-aligned baseline for the former serialized
  object-materialization path.
- `iterate` incrementally parses the same source and emits independent object snapshots directly.

`speedup` is the round-trip median divided by the `iterate` median. Serialized and avoided MiB are
cumulative across every snapshot, which makes amplification from frequent progressive updates
visible. Fixture construction, post-measurement correctness checks, and worker startup remain
outside timed windows. Every final result is compared deeply with the complete canonical fixture;
stream construction, parsing, snapshot materialization, and consumer iteration remain inside the
timed windows.

This comparison isolates materialization strategy on the current parser. It does not claim to
reproduce every implementation detail of an older release, and it does not compare SchemaStream to
`JSON.stringify` as though they performed the same work.

### Options and evidence

Show the complete option reference or include timing ranges:

```bash
bun run benchmark --help
bun run benchmark --verbose
```

Completion callbacks have a separate scaling mode so callback bookkeeping does not lengthen the
default materialization benchmark:

```bash
bun run benchmark --completion-scaling
bun run benchmark --completion-scaling --verbose
```

It parses 250, 500, 1,000, and 2,000 nested records with a single final snapshot and compares no
callback, delta-based `onValueComplete`, and cumulative-history `onKeyComplete`. The compact table
shows median time and the growth factor as record counts double. Verbose output adds callback event
counts, timing ranges, input size, and records per second. This mode uses the current built module
because older modules may not expose `onValueComplete`.

Use flags to narrow investigations or emit machine-readable evidence:

```bash
bun run benchmark --size-mb 1 --warmups 2 --repeats 7
bun run benchmark --runtimes node --fixtures object-heavy --policies chunk,final
bun run benchmark --size-mb 1 --json > /tmp/schema-stream-benchmark.json
bun run benchmark --module /tmp/baseline/dist/index.mjs \
  --iterate-materialization json-roundtrip --json > /tmp/schema-stream-before.json
```

An explicit `--module` is not built by the harness. Prepare that ESM entry point first.
`--iterate-materialization` labels the imported module's behavior for reports; it does not alter the
module. The default `direct-json-domain` label describes the current implementation.

The benchmark is a local synthetic comparison, not a production latency claim. Run it on an idle
machine and compare multiple medians. Keep fixture size, chunk size, runtime versions, policies,
warmups, and repetitions identical when evaluating a change or publishing representative results.
