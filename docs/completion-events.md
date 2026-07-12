# Completion events

`onValueComplete` reports one path and value when each JSON value finishes parsing. It is the
low-overhead way to trigger work for completed fields, array entries, objects, or the whole
document.

```ts
import { SchemaStream } from "schema-stream"
import { z } from "zod"

const sectionSummarySchema = z.string()
const schema = z.object({
  sections: z.array(
    z.object({
      heading: z.string(),
      summary: sectionSummarySchema
    })
  )
})

const parser = new SchemaStream(schema, {
  onValueComplete({ path, value }) {
    const completedSectionSummary =
      path.length === 3 &&
      path[0] === "sections" &&
      typeof path[1] === "number" &&
      path[2] === "summary"

    if (completedSectionSummary) {
      const summary = sectionSummarySchema.safeParse(value)
      if (summary.success) {
        routeCompletedSummary(path[1], summary.data)
      }
    }
  }
})
```

The callback receives the completed path and its syntactically complete JSON value. It does not
copy the full history of prior events, so its bookkeeping scales with path depth instead of
accumulated completion count. Container values are parser-owned and are not cloned for the event;
treat objects and arrays as read-only.

## Ordering

Values complete from the leaves outward. Given this input:

```json
{"profile":{"name":"Ada"},"scores":[4,8]}
```

the callback receives:

```text
["profile", "name"]
["profile"]
["scores", 0]
["scores", 1]
["scores"]
[]
```

The empty path is the completed root document. Every callback receives a fresh path array, so
mutating that path cannot affect parser state or a later event.

## Filtering paths

Use ordinary path checks when only one field matters:

```ts
const parser = new SchemaStream(schema, {
  onValueComplete({ path }) {
    if (path.length === 2 && path[0] === "profile" && path[1] === "name") {
      markNameComplete()
    }
  }
})
```

## Conditional decisions

Use the completed value to make decisions only after the field is syntactically settled:

```ts
const planSchema = z.object({
  plan: z.object({ risk: z.enum(["low", "high"]) })
})
const riskSchema = planSchema.shape.plan.shape.risk

const parser = new SchemaStream(planSchema, {
  onValueComplete({ path, value }) {
    if (path.length === 2 && path[0] === "plan" && path[1] === "risk") {
      const risk = riskSchema.safeParse(value)
      if (!risk.success || risk.data === "high") {
        requireHumanReview()
      } else {
        continueAutomatically()
      }
    }
  }
})
```

This is different from reacting to a partial string snapshot. A value event fires once, after its
closing quote, number delimiter, literal, or container boundary has parsed.

For several listeners, dispatch from one callback without adding parser work:

```ts
const listeners = new Map<string, () => void>([
  ['["profile","name"]', markNameComplete],
  ['["profile"]', markProfileComplete]
])

const parser = new SchemaStream(schema, {
  onValueComplete({ path }) {
    listeners.get(JSON.stringify(path))?.()
  }
})
```

Array indexes are numbers. Object keys remain strings even when they contain dots, brackets, or
numeric text, so `["items", 0]` and `["items", "0"]` stay distinct.

## Semantics

- Primitives, empty containers, and non-empty containers each emit once when syntactically complete.
- Children emit before their containing object or array.
- The root value emits as `[]` only after the complete document parses successfully.
- Duplicate object keys emit once per occurrence even though the last value wins in the snapshot.
- Paths describe the JSON input, including keys that are not declared by the schema.
- `value` is the completed primitive or container at that path; the root event carries the complete
  document.
- Objects and arrays are provided without cloning. Do not mutate them inside the callback: a change
  can be visible in later ancestor or root completion values, though it does not change emitted
  schema-shaped snapshots.
- Partial string characters do not emit completion events.
- Event cadence is the same for `parse()` and `iterate()` and does not depend on snapshot policy.
- Callbacks run synchronously with parsing. A thrown callback error fails the stream and cancels an
  `iterate()` source through its normal error path.

## Legacy progress callback

`onKeyComplete` remains available for compatibility. Despite its historical name, it reports
partial string progress as well as completions and includes a fresh copy of every previously
completed path on each call. That shape is useful when a consumer needs both the active path and a
cumulative history, but it becomes expensive on large documents.

Prefer `onValueComplete` for new completion listeners. Keep `onKeyComplete` only when the UI needs
its character-level progress or complete history contract.

Compare callback scaling locally with:

```sh
bun run benchmark --completion-scaling
```

Snapshot emission is configured separately. See [Snapshot policies](./snapshot-policies.md).
