import { describe, expect, test } from "bun:test"
import * as z from "zod"

import {
  SchemaStream,
  type SchemaStreamChunk,
  type SchemaStreamOptions,
  type SchemaStreamParseOptions,
  type ZodObjectSchema
} from "@/index"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function collectIterate<TSchema extends ZodObjectSchema>({
  chunks,
  options,
  parseOptions,
  schema
}: {
  chunks: string[]
  options?: SchemaStreamOptions<TSchema>
  parseOptions?: SchemaStreamParseOptions
  schema: TSchema
}): Promise<SchemaStreamChunk<TSchema>[]> {
  const snapshots: SchemaStreamChunk<TSchema>[] = []
  const source = (async function* () {
    for (const chunk of chunks) {
      yield chunk
    }
  })()

  for await (const snapshot of new SchemaStream(schema, options).iterate(source, parseOptions)) {
    snapshots.push(snapshot)
  }
  return snapshots
}

async function collectParse<TSchema extends ZodObjectSchema>({
  chunks,
  options,
  parseOptions,
  schema
}: {
  chunks: string[]
  options?: SchemaStreamOptions<TSchema>
  parseOptions?: SchemaStreamParseOptions
  schema: TSchema
}): Promise<SchemaStreamChunk<TSchema>[]> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    }
  })
  const snapshots: SchemaStreamChunk<TSchema>[] = []
  const output = source.pipeThrough(new SchemaStream(schema, options).parse(parseOptions))

  for await (const snapshot of output) {
    snapshots.push(JSON.parse(decoder.decode(snapshot)) as SchemaStreamChunk<TSchema>)
  }
  return snapshots
}

function createExoticDefaults(): Record<string, unknown> {
  const getter = {}
  Object.defineProperty(getter, "answer", {
    enumerable: true,
    get() {
      return 42
    }
  })
  const holes = new Array<unknown>(3)
  holes[1] = -0
  const callable = Object.assign(() => undefined, {
    toJSON() {
      return "callable"
    }
  })

  return {
    boxed: Reflect.construct(Number, [7]),
    callable,
    custom: {
      toJSON() {
        return { normalized: true }
      }
    },
    date: new Date("2024-01-02T03:04:05.000Z"),
    getter,
    holes,
    map: new Map([["ignored", true]]),
    typed: new Uint8Array([1, 2])
  }
}

describe("iterate snapshot materialization", () => {
  test("matches serialized snapshots across every policy", async () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string() })),
      pending: z.string(),
      text: z.string(),
      value: z.number()
    })
    const chunks = [
      '{"text":"hel',
      'lo","value":-0,"items":[{"name":"a"}],"__proto__":{"safe":true}}'
    ]
    const policies: SchemaStreamParseOptions["snapshotPolicy"][] = [
      undefined,
      { mode: "chunk" },
      { mode: "value" },
      { bytes: 8, mode: "bytes" },
      { mode: "final" }
    ]

    for (const snapshotPolicy of policies) {
      const input = {
        chunks,
        options: { typeDefaults: { string: undefined } },
        parseOptions: { snapshotPolicy },
        schema
      }
      const parsed = await collectParse(input)
      const iterated = await collectIterate(input)

      expect(iterated).toEqual(parsed)
      expect(iterated.at(-1)?.value).toBe(0)
      expect(Object.hasOwn(iterated.at(-1) ?? {}, "pending")).toBe(false)
      expect(Object.hasOwn(iterated.at(-1) ?? {}, "__proto__")).toBe(true)
    }
  })

  test("retains JSON normalization for external and exotic defaults", async () => {
    const schema = z.object({
      boxed: z.unknown(),
      callable: z.unknown(),
      custom: z.unknown(),
      date: z.unknown(),
      getter: z.unknown(),
      holes: z.unknown(),
      map: z.unknown(),
      streamed: z.string(),
      typed: z.unknown()
    })
    const chunks = ['{"streamed":"a', 'b"}']
    const parsed = await collectParse({
      chunks,
      options: { defaultData: createExoticDefaults() },
      schema
    })
    const iterated = await collectIterate({
      chunks,
      options: { defaultData: createExoticDefaults() },
      schema
    })

    expect(iterated).toEqual(parsed)
    expect(iterated.at(-1)).toEqual({
      boxed: 7,
      callable: "callable",
      custom: { normalized: true },
      date: "2024-01-02T03:04:05.000Z",
      getter: { answer: 42 },
      holes: [null, 0, null],
      map: {},
      streamed: "ab",
      typed: { 0: 1, 1: 2 }
    })
  })

  test("honors inherited toJSON behavior", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON")
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() {
        return { inherited: true }
      }
    })
    const schema = z.object({ value: z.string() })

    try {
      const input = { chunks: ['{"value":"parsed"}'], schema }
      const parsed = await collectParse(input)
      const iterated = await collectIterate(input)

      expect(iterated).toEqual(parsed)
      expect(iterated as unknown).toEqual([{ inherited: true }])
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Object.prototype, "toJSON", originalDescriptor)
      } else {
        delete (Object.prototype as { toJSON?: unknown }).toJSON
      }
    }
  })

  test("preserves JSON errors for BigInt and circular defaults", async () => {
    const schema = z.object({ streamed: z.string(), value: z.unknown() })
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle

    for (const value of [1n, cycle]) {
      const input = {
        chunks: ['{"streamed":"ready"}'],
        options: { defaultData: { value } },
        schema
      }

      await expect(collectParse(input)).rejects.toBeInstanceOf(TypeError)
      await expect(collectIterate(input)).rejects.toBeInstanceOf(TypeError)
    }
  })

  test("honors custom BigInt JSON behavior", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(BigInt.prototype, "toJSON")
    Object.defineProperty(BigInt.prototype, "toJSON", {
      configurable: true,
      value() {
        return String(this)
      }
    })
    const schema = z.object({ streamed: z.string(), value: z.unknown() })

    try {
      const input = {
        chunks: ['{"streamed":"ready"}'],
        options: { defaultData: { value: 1n } },
        schema
      }
      const parsed = await collectParse(input)
      const iterated = await collectIterate(input)

      expect(iterated).toEqual(parsed)
      expect(iterated.at(-1)?.value).toBe("1")
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(BigInt.prototype, "toJSON", originalDescriptor)
      } else {
        delete (BigInt.prototype as { toJSON?: unknown }).toJSON
      }
    }
  })

  test("clones deeply nested parser-owned graphs with bounded recursion", async () => {
    const depth = 2048
    const schema = z.object({ value: z.unknown() })
    const json = `{"value":${"[".repeat(depth)}0${"]".repeat(depth)}}`
    const snapshots = await collectIterate({
      chunks: [json],
      parseOptions: { snapshotPolicy: { mode: "final" } },
      schema
    })
    let value = snapshots.at(-1)?.value

    for (let index = 0; index < depth; index += 1) {
      expect(Array.isArray(value)).toBe(true)
      const [nestedValue] = value as unknown[]
      value = nestedValue
    }
    expect(value).toBe(0)
  })
})
