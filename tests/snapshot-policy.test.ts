import { describe, expect, test } from "bun:test"
import * as z from "zod"

import { SchemaStream, type SchemaStreamParseOptions, type SnapshotPolicy } from "@/index"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function collectSnapshots({
  chunks,
  options
}: {
  chunks: Uint8Array[]
  options?: SchemaStreamParseOptions
}): Promise<unknown[]> {
  const schema = z.object({ first: z.string(), second: z.number() })
  const transform = new SchemaStream(schema).parse(options)
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })
  const snapshots: unknown[] = []

  for await (const output of source.pipeThrough(transform)) {
    snapshots.push(JSON.parse(decoder.decode(output)))
  }
  return snapshots
}

function splitBytes(json: string, chunkSize: number): Uint8Array[] {
  const encoded = encoder.encode(json)
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    chunks.push(encoded.slice(offset, offset + chunkSize))
  }
  return chunks
}

describe("snapshot policies", () => {
  test("keeps omitted policy identical to explicit chunk behavior", async () => {
    const chunks = splitBytes(JSON.stringify({ first: "same", second: 2 }), 3)

    const implicit = await collectSnapshots({ chunks })
    const explicit = await collectSnapshots({
      chunks,
      options: { snapshotPolicy: { mode: "chunk" } }
    })

    expect(explicit).toEqual(implicit)
    expect(explicit).toHaveLength(chunks.length)
  })

  test("emits at completed-value boundaries", async () => {
    const json = JSON.stringify({ first: "streaming", second: 2 })

    const snapshots = await collectSnapshots({
      chunks: splitBytes(json, 1),
      options: { snapshotPolicy: { mode: "value" } }
    })

    expect(snapshots).toEqual([
      { first: "streaming", second: null },
      { first: "streaming", second: 2 }
    ])
  })

  test("coalesces multiple completed values in one input chunk", async () => {
    const json = JSON.stringify({ first: "complete", second: 2 })

    const snapshots = await collectSnapshots({
      chunks: [encoder.encode(json)],
      options: { snapshotPolicy: { mode: "value" } }
    })

    expect(snapshots).toEqual([{ first: "complete", second: 2 }])
  })

  test("handles byte thresholds, overshoot, and a smaller final tail", async () => {
    const json = JSON.stringify({ first: "threshold", second: 2 })
    const chunks = splitBytes(json, 5)

    const snapshots = await collectSnapshots({
      chunks,
      options: { snapshotPolicy: { bytes: 12, mode: "bytes" } }
    })

    expect(snapshots).toHaveLength(Math.ceil(chunks.length / 3))
    expect(snapshots.at(-1)).toEqual({ first: "threshold", second: 2 })
  })

  test("emits only the final parser state in final mode", async () => {
    const json = JSON.stringify({ first: "final", second: 2 })

    const snapshots = await collectSnapshots({
      chunks: splitBytes(json, 1),
      options: { snapshotPolicy: { mode: "final" } }
    })

    expect(snapshots).toEqual([{ first: "final", second: 2 }])
  })

  test("emits empty containers in every mode", async () => {
    const schema = z.object({ items: z.array(z.string()), metadata: z.object({}) })
    const json = encoder.encode('{"items":[],"metadata":{}}')
    const policies: SnapshotPolicy[] = [
      { mode: "chunk" },
      { mode: "value" },
      { bytes: 1024, mode: "bytes" },
      { mode: "final" }
    ]

    for (const snapshotPolicy of policies) {
      const outputs = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(json)
          controller.close()
        }
      }).pipeThrough(new SchemaStream(schema).parse({ snapshotPolicy }))
      const snapshots: unknown[] = []
      for await (const output of outputs) {
        snapshots.push(JSON.parse(decoder.decode(output)))
      }
      expect(snapshots.at(-1)).toEqual({ items: [], metadata: {} })
    }
  })

  test("rejects invalid byte thresholds synchronously", () => {
    const parser = new SchemaStream(z.object({ value: z.string() }))

    for (const bytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parser.parse({ snapshotPolicy: { bytes, mode: "bytes" } })).toThrow(
        "snapshotPolicy.bytes must be a positive, finite integer"
      )
    }
  })

  test("propagates malformed and truncated JSON in every mode", async () => {
    const policies: SnapshotPolicy[] = [
      { mode: "chunk" },
      { mode: "value" },
      { bytes: 8, mode: "bytes" },
      { mode: "final" }
    ]

    for (const snapshotPolicy of policies) {
      await expect(
        collectSnapshots({
          chunks: [encoder.encode('{"first": nope}')],
          options: { snapshotPolicy }
        })
      ).rejects.toBeInstanceOf(Error)
      await expect(
        collectSnapshots({
          chunks: [encoder.encode('{"first":"unfinished')],
          options: { snapshotPolicy }
        })
      ).rejects.toBeInstanceOf(Error)
    }
  })

  test("rejects trailing content in every mode", async () => {
    const policies: SnapshotPolicy[] = [
      { mode: "chunk" },
      { mode: "value" },
      { bytes: 8, mode: "bytes" },
      { mode: "final" }
    ]

    for (const snapshotPolicy of policies) {
      await expect(
        collectSnapshots({
          chunks: [encoder.encode('{"first":"done","second":2}'), encoder.encode("garbage")],
          options: { snapshotPolicy }
        })
      ).rejects.toThrow('Unexpected "g"')
    }
  })

  test("parses every byte split, including UTF-8 boundaries, under every policy", async () => {
    const expected = { first: 'héllo 🌊 "quoted" \\ escaped', second: -1250.5 }
    const encoded = encoder.encode(JSON.stringify(expected))
    const policies: SnapshotPolicy[] = [
      { mode: "chunk" },
      { mode: "value" },
      { bytes: 7, mode: "bytes" },
      { mode: "final" }
    ]

    for (const snapshotPolicy of policies) {
      for (let split = 1; split < encoded.length; split += 1) {
        const snapshots = await collectSnapshots({
          chunks: [encoded.slice(0, split), encoded.slice(split)],
          options: { snapshotPolicy }
        })

        expect(snapshots.at(-1)).toEqual(expected)
      }
    }
  })

  test("parses multi-megabyte JSON with one final snapshot", async () => {
    const schema = z.object({
      content: z.string(),
      records: z.array(z.object({ id: z.number(), active: z.boolean() }))
    })
    const expected = {
      content: "x".repeat(2 * 1024 * 1024),
      records: Array.from({ length: 1_000 }, (_, id) => ({ id, active: id % 2 === 0 }))
    }
    const chunks = splitBytes(JSON.stringify(expected), 64 * 1024)
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      }
    })
    const outputs = source.pipeThrough(
      new SchemaStream(schema).parse({ snapshotPolicy: { mode: "final" } })
    )
    const snapshots: unknown[] = []

    for await (const output of outputs) {
      snapshots.push(JSON.parse(decoder.decode(output)))
    }

    expect(snapshots).toEqual([expected])
  })
})
