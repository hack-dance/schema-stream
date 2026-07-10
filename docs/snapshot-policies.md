# Snapshot policies

Snapshot policies reduce cumulative JSON serialization when a consumer does not need an update for
every source chunk. They are optional. Omitting `snapshotPolicy` retains the 4.0 behavior: one
snapshot for every input chunk.

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
omitting the option.

### `value`

```typescript
{
  mode: "value"
}
```

Emits after an input chunk completes at least one primitive JSON value. Several values completed in
one source chunk produce one snapshot. This is useful for long streamed strings because incomplete
characters do not repeatedly serialize the entire accumulated object.

### `bytes`

```typescript
{ mode: "bytes", bytes: 256 * 1024 }
```

Emits when source bytes received since the previous snapshot meet or exceed the positive integer
threshold. Thresholds are evaluated at source-chunk boundaries; SchemaStream does not split input
chunks. A final tail smaller than the threshold is still emitted.

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

- Invalid byte thresholds throw synchronously.
- Malformed and truncated JSON reject under every policy.
- `onKeyComplete` cadence is independent of snapshot cadence.
- `iterate()` preserves source backpressure at emission boundaries and cancels its source when the
  consumer returns early.
- Every yielded `iterate()` value is decoded from serialized output, so consumer mutation cannot
  affect later snapshots.
- Timer-based policies are intentionally excluded because asynchronous controller lifetime,
  cancellation, and deterministic backpressure semantics require a separate design.

## Benchmark

Run the policy comparison with an optional payload size in megabytes:

```bash
bun tests/snapshot-policy.benchmark.ts 25
```

The benchmark combines one long string with 10,000 nested records and reports source throughput,
snapshot count, and total emitted bytes for `chunk`, `value`, 256 KB, 1 MB, and `final` policies.
