import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  SchemaStream,
  type SchemaStreamParseOptions,
  type SchemaStreamValuePath,
  type ZodObjectSchema
} from "@/index"

type CompletionPath = (string | number)[]
type StreamingApi = "iterate" | "parse"

function createByteSource(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })
}

async function collectCompletionEvents<TSchema extends ZodObjectSchema>({
  api,
  chunks,
  parseOptions,
  schema
}: {
  api: StreamingApi
  chunks: readonly Uint8Array[]
  parseOptions?: SchemaStreamParseOptions
  schema: TSchema
}): Promise<{
  eventPaths: CompletionPath[]
  eventReferences: SchemaStreamValuePath[]
  finalValue: unknown
}> {
  const eventPaths: CompletionPath[] = []
  const eventReferences: SchemaStreamValuePath[] = []
  const parser = new SchemaStream(schema, {
    onValueComplete({ path }) {
      eventPaths.push([...path])
      eventReferences.push(path)
    }
  })
  const source = createByteSource(chunks)

  if (api === "iterate") {
    let finalValue: unknown
    for await (const snapshot of parser.iterate(source, parseOptions)) {
      finalValue = snapshot
    }
    return { eventPaths, eventReferences, finalValue }
  }

  const decoder = new TextDecoder()
  let finalSnapshot: Uint8Array | undefined
  for await (const snapshot of source.pipeThrough(parser.parse(parseOptions))) {
    finalSnapshot = snapshot
  }
  if (finalSnapshot === undefined) {
    throw new Error("expected parse() to emit a final snapshot")
  }

  return {
    eventPaths,
    eventReferences,
    finalValue: JSON.parse(decoder.decode(finalSnapshot)) as unknown
  }
}

async function drain<TSchema extends ZodObjectSchema>({
  parser,
  source
}: {
  parser: SchemaStream<TSchema>
  source: AsyncIterable<string>
}): Promise<void> {
  for await (const _snapshot of parser.iterate(source, {
    snapshotPolicy: { mode: "final" }
  })) {
    // Drain the parser so callback and source lifecycle behavior can be asserted.
  }
}

const complexSchema = z.object({
  profile: z.object({
    name: z.string(),
    preferences: z.object({
      alerts: z.array(z.boolean()),
      emptyObject: z.object({}),
      emptyArray: z.array(z.unknown())
    })
  }),
  projects: z.array(
    z.object({
      id: z.string(),
      metrics: z.object({
        score: z.number(),
        tags: z.array(z.string())
      })
    })
  ),
  "a.b": z.object({ "0": z.string() }),
  ["__proto__"]: z.object({ safe: z.string() })
})

const complexValue = {
  profile: {
    name: `Ada ${String.fromCodePoint(127_757)}`,
    preferences: {
      alerts: [true, false],
      emptyObject: {},
      emptyArray: []
    }
  },
  projects: [
    { id: "alpha", metrics: { score: 98, tags: ["fast", "typed"] } },
    { id: "beta", metrics: { score: 87, tags: [] } }
  ],
  "a.b": { "0": "numeric object key" },
  ["__proto__"]: { safe: "yes" }
}

const expectedComplexPaths: CompletionPath[] = [
  ["profile", "name"],
  ["profile", "preferences", "alerts", 0],
  ["profile", "preferences", "alerts", 1],
  ["profile", "preferences", "alerts"],
  ["profile", "preferences", "emptyObject"],
  ["profile", "preferences", "emptyArray"],
  ["profile", "preferences"],
  ["profile"],
  ["projects", 0, "id"],
  ["projects", 0, "metrics", "score"],
  ["projects", 0, "metrics", "tags", 0],
  ["projects", 0, "metrics", "tags", 1],
  ["projects", 0, "metrics", "tags"],
  ["projects", 0, "metrics"],
  ["projects", 0],
  ["projects", 1, "id"],
  ["projects", 1, "metrics", "score"],
  ["projects", 1, "metrics", "tags"],
  ["projects", 1, "metrics"],
  ["projects", 1],
  ["projects"],
  ["a.b", "0"],
  ["a.b"],
  ["__proto__", "safe"],
  ["__proto__"],
  []
]

describe("completed-value events", () => {
  test("emits child-before-parent deltas across APIs, policies, and split UTF-8 bytes", async () => {
    const json = JSON.stringify(complexValue)
    const chunks = Array.from(new TextEncoder().encode(json), byte => Uint8Array.of(byte))
    const policies: Array<{
      name: string
      options?: SchemaStreamParseOptions
    }> = [
      { name: "implicit chunk" },
      { name: "chunk", options: { snapshotPolicy: { mode: "chunk" } } },
      { name: "value", options: { snapshotPolicy: { mode: "value" } } },
      { name: "bytes", options: { snapshotPolicy: { bytes: 7, mode: "bytes" } } },
      { name: "final", options: { snapshotPolicy: { mode: "final" } } }
    ]
    const apis: StreamingApi[] = ["parse", "iterate"]

    for (const api of apis) {
      for (const policy of policies) {
        const { eventPaths, eventReferences, finalValue } = await collectCompletionEvents({
          api,
          chunks,
          parseOptions: policy.options,
          schema: complexSchema
        })

        expect(eventPaths).toEqual(expectedComplexPaths)
        expect(new Set(eventReferences).size).toBe(eventReferences.length)
        expect(finalValue).toEqual(complexValue)
        expect(Object.hasOwn(finalValue as object, "__proto__")).toBe(true)
      }
    }
  })

  test("keeps completion deltas independent from legacy character progress", async () => {
    const valueEvents: CompletionPath[] = []
    const legacyEvents: CompletionPath[] = []
    const parser = new SchemaStream(z.object({ text: z.string() }), {
      onKeyComplete({ activePath }) {
        legacyEvents.push(activePath.filter(segment => segment !== undefined))
      },
      onValueComplete({ path }) {
        valueEvents.push([...path])
      }
    })

    for await (const _snapshot of parser.iterate(
      (async function* () {
        yield '{"text":"a'
        yield "b"
        yield 'c"}'
      })(),
      { snapshotPolicy: { mode: "final" } }
    )) {
      // Consume the final snapshot so both callback streams reach document completion.
    }

    expect(valueEvents).toEqual([["text"], []])
    expect(legacyEvents.filter(path => path[0] === "text")).toHaveLength(4)
    expect(legacyEvents.at(-1)).toEqual([])
  })

  test("emits fresh mutable-at-runtime paths without exposing parser state", async () => {
    const observedPaths: CompletionPath[] = []
    const references: SchemaStreamValuePath[] = []
    const parser = new SchemaStream(
      z.object({ outer: z.object({ first: z.number(), second: z.number() }) }),
      {
        onValueComplete({ path }) {
          observedPaths.push([...path])
          references.push(path)
          const consumerOwnedPath = path as CompletionPath
          consumerOwnedPath[0] = "consumer mutation"
          consumerOwnedPath.push("extra")
        }
      }
    )
    let finalValue: unknown

    for await (const snapshot of parser.iterate(
      (async function* () {
        yield '{"outer":{"first":1,"second":2}}'
      })(),
      { snapshotPolicy: { mode: "final" } }
    )) {
      finalValue = snapshot
    }

    expect(observedPaths).toEqual([["outer", "first"], ["outer", "second"], ["outer"], []])
    expect(new Set(references).size).toBe(references.length)
    expect(finalValue).toEqual({ outer: { first: 1, second: 2 } })
  })

  test("reports duplicate object-key occurrences without conflating array indexes", async () => {
    const schema = z.object({ same: z.number(), list: z.array(z.string()) })
    const json = '{"same":1,"same":2,"list":["zero"]}'
    const { eventPaths, finalValue } = await collectCompletionEvents({
      api: "iterate",
      chunks: [new TextEncoder().encode(json)],
      parseOptions: { snapshotPolicy: { mode: "final" } },
      schema
    })

    expect(eventPaths).toEqual([["same"], ["same"], ["list", 0], ["list"], []])
    expect(finalValue).toEqual({ same: 2, list: ["zero"] })
  })

  test("provides completed values for conditional decisions before the root completes", async () => {
    const decisions: string[] = []
    const rootValues: unknown[] = []
    const parser = new SchemaStream(
      z.object({ route: z.enum(["fast", "careful"]), score: z.number() }),
      {
        onValueComplete({ path, value }) {
          if (path.length === 1 && path[0] === "route" && value === "careful") {
            decisions.push("enable-review")
          }
          if (path.length === 1 && path[0] === "score" && value === 98) {
            decisions.push("publish-score")
          }
          if (path.length === 0) {
            rootValues.push(value)
          }
        }
      }
    )

    for await (const _snapshot of parser.iterate(
      (async function* () {
        yield '{"route":"careful",'
        yield '"score":98}'
      })()
    )) {
      // Drain snapshots so completion decisions run at their parser boundaries.
    }

    expect(decisions).toEqual(["enable-review", "publish-score"])
    expect(rootValues).toEqual([{ route: "careful", score: 98 }])
  })

  test("does not emit root completion for a truncated document", async () => {
    const events: CompletionPath[] = []
    const parser = new SchemaStream(
      z.object({ done: z.number(), open: z.object({ text: z.string() }) }),
      {
        onValueComplete({ path }) {
          events.push([...path])
        }
      }
    )

    await expect(
      drain({
        parser,
        source: (async function* () {
          yield '{"done":1,"open":{"text":"partial'
        })()
      })
    ).rejects.toThrow("Tokenizer ended in the middle of a token")
    expect(events).toEqual([["done"]])
    expect(events).not.toContainEqual([])
  })

  test("does not emit root completion before trailing input is rejected", async () => {
    for (const api of ["iterate", "parse"] as const) {
      const events: CompletionPath[] = []
      const parser = new SchemaStream(z.object({ done: z.number() }), {
        onValueComplete({ path }) {
          events.push([...path])
        }
      })
      const encoder = new TextEncoder()
      const source = createByteSource([encoder.encode('{"done":1}'), encoder.encode(" trailing")])

      if (api === "iterate") {
        await expect(
          (async () => {
            for await (const _snapshot of parser.iterate(source)) {
              // Consume until the parser rejects the trailing input.
            }
          })()
        ).rejects.toThrow('Unexpected "t"')
      } else {
        await expect(
          (async () => {
            for await (const _snapshot of source.pipeThrough(parser.parse())) {
              // Consume until the parser rejects the trailing input.
            }
          })()
        ).rejects.toThrow('Unexpected "t"')
      }

      expect(events).toEqual([["done"]])
    }
  })

  test("propagates callback failures and cancels the source", async () => {
    const callbackError = new Error("completion callback failed")
    let sourceClosed = false
    const parser = new SchemaStream(z.object({ value: z.number() }), {
      onValueComplete() {
        throw callbackError
      }
    })
    const source = (async function* () {
      try {
        yield '{"value":1}'
      } finally {
        sourceClosed = true
      }
    })()

    await expect(drain({ parser, source })).rejects.toBe(callbackError)
    expect(sourceClosed).toBe(true)
  })

  test("handles deeply nested completion paths without recursive event processing", async () => {
    const depth = 512
    const json = `{"nested":${"[".repeat(depth)}0${"]".repeat(depth)}}`
    const eventLengths: number[] = []
    const parser = new SchemaStream(z.object({ nested: z.unknown() }), {
      onValueComplete({ path }) {
        eventLengths.push(path.length)
      }
    })
    let finalValue: unknown

    for await (const snapshot of parser.iterate(
      (async function* () {
        yield json
      })(),
      { snapshotPolicy: { mode: "final" } }
    )) {
      finalValue = snapshot
    }

    expect(eventLengths).toEqual(
      Array.from({ length: depth + 2 }, (_value, index) => depth + 1 - index)
    )
    let nestedValue = (finalValue as { nested: unknown }).nested
    for (let level = 0; level < depth; level += 1) {
      if (!Array.isArray(nestedValue)) {
        throw new Error(`expected an array at nesting level ${level}`)
      }
      const [nextNestedValue] = nestedValue
      nestedValue = nextNestedValue
    }
    expect(nestedValue).toBe(0)
  })
})
