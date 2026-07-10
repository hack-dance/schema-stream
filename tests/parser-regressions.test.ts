import { describe, expect, test } from "bun:test"
import * as z from "zod"
import { SchemaStream } from "@/index"

import { collectEmissions } from "./helpers"

describe("stream parser regressions", () => {
  test("parses deep objects, object arrays, unicode, and JSON punctuation in strings", async () => {
    const schema = z.object({
      layer1: z.object({
        layer2: z.object({
          layer3: z.object({
            layer4: z.object({ value: z.string() })
          })
        })
      }),
      users: z.array(z.object({ name: z.string(), score: z.number() })),
      punctuation: z.array(z.string())
    })
    const data = {
      layer1: { layer2: { layer3: { layer4: { value: "héllo 🌊" } } } },
      users: [
        { name: "Ada", score: 10 },
        { name: "Grace", score: 20 }
      ],
      punctuation: ["]", "{value", "[value", "value}", "value,", ":value"]
    }
    const json = JSON.stringify(data)
    const byteChunks = [json.slice(0, 17), json.slice(17, 31), json.slice(31, 48), json.slice(48)]
    const { emissions } = await collectEmissions({ schema, chunks: byteChunks })

    expect(emissions.length).toBe(byteChunks.length)
    expect(emissions.at(-1)).toEqual(data)
  })

  test("buffers strings without changing final output", async () => {
    const schema = z.object({ text: z.string() })
    const data = { text: "a long streamed value" }
    const json = JSON.stringify(data)
    const { emissions } = await collectEmissions({
      schema,
      chunks: [json.slice(0, 8), json.slice(8, 14), json.slice(14)],
      parseOptions: { stringBufferSize: 4 }
    })

    expect(emissions.at(-1)).toEqual(data)
  })

  test("buffers multi-byte strings when the buffer is smaller than a UTF-8 character", async () => {
    const schema = z.object({ text: z.string() })
    const data = { text: "🌊日本語" }

    for (const stringBufferSize of [1, 2, 3]) {
      const { emissions } = await collectEmissions({
        schema,
        chunks: [JSON.stringify(data)],
        parseOptions: { stringBufferSize }
      })

      expect(emissions).toEqual([data])
    }
  })

  test("preserves escaped lone, repeated, and paired UTF-16 surrogates", async () => {
    const schema = z.object({ text: z.string() })
    const highSurrogate = String.fromCharCode(0xd8_3d)
    const data = {
      text: `${highSurrogate}X|${highSurrogate}${highSurrogate}|🌊|${highSurrogate}\n`
    }
    const json = String.raw`{"text":"\ud83dX|\ud83d\ud83d|\ud83c\udf0a|\ud83d\n"}`
    for (const stringBufferSize of [0, 1]) {
      const { emissions } = await collectEmissions({
        schema,
        chunks: [json],
        parseOptions: { stringBufferSize }
      })

      expect(emissions).toEqual([data])
    }
  })

  test("preserves large progressively parsed strings", async () => {
    const schema = z.object({ text: z.string() })
    const data = { text: "a".repeat(64 * 1024) }
    const { emissions } = await collectEmissions({ schema, chunks: [JSON.stringify(data)] })

    expect(emissions).toEqual([data])
  })

  test("propagates malformed JSON errors to the readable stream", async () => {
    const schema = z.object({ value: z.number() })
    const parser = new SchemaStream(schema)
    const encoder = new TextEncoder()
    const transform = parser.parse()
    const reader = transform.readable.getReader()
    const writer = transform.writable.getWriter()
    const readResult = reader.read().then(
      () => undefined,
      (error: unknown) => error
    )

    await writer.write(encoder.encode('{"value": nope}'))
    const streamError = await readResult

    expect(streamError).toBeInstanceOf(Error)
  })

  test("rejects non-whitespace chunks after the top-level value completes", async () => {
    const schema = z.object({ value: z.number() })

    await expect(
      collectEmissions({
        schema,
        chunks: ['{"value":1}', "trailing garbage"]
      })
    ).rejects.toThrow('Unexpected "t"')
  })

  test("keeps prototype-named paths inside the parsed result graph", async () => {
    const schema = z.object({ safe: z.string() })
    const parser = new SchemaStream(schema)
    const source = (async function* () {
      yield '{"__proto__":{"polluted":"yes"},"safe":"ok"}'
    })()

    try {
      const emissions = []
      for await (const value of parser.iterate(source)) {
        emissions.push(value)
      }

      expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
      expect(emissions.at(-1)?.safe).toBe("ok")
      expect(Object.hasOwn(emissions.at(-1) ?? {}, "__proto__")).toBe(true)
    } finally {
      delete (Object.prototype as { polluted?: unknown }).polluted
    }
  })
})
