import { isDeepStrictEqual } from "node:util"
import { Agent } from "@mastra/core/agent"
import { simulateReadableStream } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { z } from "zod"

import { SchemaStream, type SchemaStreamChunk, type SchemaStreamSource } from "../src"

const schema = z.object({
  title: z.string(),
  locale: z.enum(["en", "ja"]),
  itinerary: z.array(
    z.object({
      day: z.number(),
      stops: z.array(
        z.object({
          name: z.string(),
          note: z.string().nullable(),
          tags: z.array(z.string())
        })
      )
    })
  ),
  metadata: z.record(z.string(), z.string())
})

const expected: z.output<typeof schema> = {
  title: "週末 plan 🌊",
  locale: "ja",
  itinerary: [
    {
      day: 1,
      stops: [
        {
          name: "Harbor museum",
          note: 'Ask for the "tide clock" exhibit.',
          tags: ["indoors", "family"]
        },
        { name: "海辺 café", note: null, tags: ["lunch"] }
      ]
    },
    {
      day: 2,
      stops: [{ name: "Cliff walk", note: "Bring a light jacket.", tags: ["outdoors"] }]
    }
  ],
  metadata: { network: "disabled", source: "deterministic fixture" }
}

function splitJson(json: string, targetChunks = 14): string[] {
  const codePoints = Array.from(json)
  const chunkLength = Math.max(1, Math.ceil(codePoints.length / targetChunks))
  const chunks: string[] = []

  for (let offset = 0; offset < codePoints.length; offset += chunkLength) {
    chunks.push(codePoints.slice(offset, offset + chunkLength).join(""))
  }

  return chunks
}

/** Guards the pinned compatibility path because Mastra does not generally promise JSON text. */
async function* requireJsonObjectText(source: SchemaStreamSource<string>): AsyncIterable<string> {
  let sawJsonStart = false
  for await (const chunk of source) {
    if (!sawJsonStart) {
      const candidate = chunk.trimStart()
      if (candidate.length > 0) {
        if (!candidate.startsWith("{")) {
          throw new Error("Mastra textStream did not begin with a JSON object")
        }
        sawJsonStart = true
      }
    }
    yield chunk
  }
  if (!sawJsonStart) {
    throw new Error("Mastra textStream did not contain a JSON object")
  }
}

/**
 * Mastra accepts AI SDK language models directly. This provider-shaped mock keeps the example
 * credential-free while still exercising Mastra's real Agent streaming and validation path.
 */
function createModel(chunks: string[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunkDelayInMs: null,
          initialDelayInMs: null,
          chunks: [
            { id: "text-1", type: "text-start" as const },
            ...chunks.map(delta => ({ delta, id: "text-1", type: "text-delta" as const })),
            { id: "text-1", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              logprobs: undefined,
              type: "finish" as const,
              usage: {
                inputTokens: {
                  cacheRead: undefined,
                  cacheWrite: undefined,
                  noCache: 1,
                  total: 1
                },
                outputTokens: { reasoning: undefined, text: 1, total: 1 }
              }
            }
          ]
        })
      })
  })
}

const serialized = JSON.stringify(expected)
const model = createModel(splitJson(serialized, 48))
const agent = new Agent({
  id: "schema-stream-mastra-example",
  name: "SchemaStream Mastra example",
  instructions: "Return only the requested structured itinerary.",
  model
})
const result = await agent.stream("Build the deterministic itinerary fixture.", {
  structuredOutput: { errorStrategy: "strict", schema }
})

/**
 * This pinned compatibility example first requires Mastra's text stream to contain raw JSON, then
 * uses SchemaStream for fine-grained snapshots. Mastra's documented `object` promise remains the
 * authoritative result, and a nested tag completion selects a plan before day two arrives.
 */
const snapshots: SchemaStreamChunk<typeof schema>[] = []
type WeatherPlan = "rain-safe" | "weather-dependent"

let weatherPlan: WeatherPlan | undefined
let secondDayStarted = false
let rootCompleted = false
let decisionPrecededSecondDay = false
let decisionPrecededRoot = false
const parser = new SchemaStream(schema, {
  onValueComplete({ path, value }) {
    const isFirstStopTags =
      path.length === 5 &&
      path[0] === "itinerary" &&
      path[1] === 0 &&
      path[2] === "stops" &&
      path[3] === 0 &&
      path[4] === "tags"
    const isSecondDay =
      path.length === 3 && path[0] === "itinerary" && path[1] === 1 && path[2] === "day"

    if (isFirstStopTags) {
      if (!(Array.isArray(value) && value.every(tag => typeof tag === "string"))) {
        throw new TypeError("The completed stop tags must be an array of strings")
      }
      weatherPlan = value.includes("indoors") ? "rain-safe" : "weather-dependent"
      decisionPrecededSecondDay = !secondDayStarted
      decisionPrecededRoot = !rootCompleted
    }
    if (isSecondDay) {
      secondDayStarted = true
    }
    if (path.length === 0) {
      rootCompleted = true
    }
  }
})

for await (const snapshot of parser.iterate(requireJsonObjectText(result.textStream))) {
  snapshots.push(snapshot)
}
const finalOutput = await result.object

if (snapshots.length <= 2) {
  throw new Error("Mastra example did not produce progressive snapshots")
}
if (
  !snapshots.some(
    snapshot =>
      typeof snapshot.title === "string" &&
      snapshot.title.length > 0 &&
      snapshot.title !== expected.title
  )
) {
  throw new Error("Mastra example did not expose a meaningful intermediate string")
}
if (!(isDeepStrictEqual(snapshots.at(-1), expected) && isDeepStrictEqual(finalOutput, expected))) {
  throw new Error("Mastra example did not reconstruct and validate the expected value")
}
if (model.doStreamCalls.length !== 1) {
  throw new Error("Mastra example made an unexpected number of model calls")
}
if (
  weatherPlan !== "rain-safe" ||
  !decisionPrecededSecondDay ||
  !decisionPrecededRoot ||
  !secondDayStarted ||
  !rootCompleted
) {
  throw new Error("Mastra example did not choose a weather plan before later JSON arrived")
}

process.stdout.write(
  `Mastra Agent: ${snapshots.length} snapshots, ${weatherPlan} plan selected before day 2 and ` +
    "root completion, final structured output verified\n"
)
