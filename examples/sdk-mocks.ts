import {
  Agent,
  type Model,
  type ModelResponse,
  Runner,
  type StreamEvent,
  setTraceProcessors,
  setTracingDisabled
} from "@openai/agents"
import { Output, simulateReadableStream, streamText } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { z } from "zod"

import { SchemaStream, type SchemaStreamChunk, type SchemaStreamSource } from "../src"

setTraceProcessors([])
setTracingDisabled(true)

const schema = z.object({
  headline: z.string(),
  locale: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      facts: z.array(z.object({ label: z.string(), value: z.string() }))
    })
  )
})
const expected: z.output<typeof schema> = {
  headline: "A deterministic 🌊 SDK stream",
  locale: "日本語 + English",
  sections: [
    {
      title: "Runtime",
      facts: [
        { label: "network", value: "disabled" },
        { label: "credentials", value: "not required" }
      ]
    }
  ]
}

function splitJson(serialized: string, targetChunks = 8): string[] {
  const codePoints = Array.from(serialized)
  const chunkLength = Math.max(1, Math.ceil(codePoints.length / targetChunks))
  const chunks: string[] = []
  let offset = 0

  while (offset < codePoints.length) {
    chunks.push(codePoints.slice(offset, offset + chunkLength).join(""))
    offset += chunkLength
  }

  return chunks
}

type DeliveryRoute = "local-cache" | "remote-review"

type DecisionRun = {
  decision: DeliveryRoute
  snapshots: SchemaStreamChunk<typeof schema>[]
}

/**
 * Routes the result as soon as the deeply nested network fact is complete. The assertions prove
 * the decision happens before the following credentials fact and before root completion, on both
 * SDK stream adapters.
 */
async function collectWithDecision(source: SchemaStreamSource<string>): Promise<DecisionRun> {
  const snapshots: SchemaStreamChunk<typeof schema>[] = []
  let decision: DeliveryRoute | undefined
  let credentialsCompleted = false
  let rootCompleted = false
  let decisionPrecededCredentials = false
  let decisionPrecededRoot = false
  const parser = new SchemaStream(schema, {
    onValueComplete({ path, value }) {
      const isNetworkFact =
        path.length === 5 &&
        path[0] === "sections" &&
        path[1] === 0 &&
        path[2] === "facts" &&
        path[3] === 0 &&
        path[4] === "value"
      const isCredentialsFact =
        path.length === 5 &&
        path[0] === "sections" &&
        path[1] === 0 &&
        path[2] === "facts" &&
        path[3] === 1 &&
        path[4] === "value"

      if (isNetworkFact) {
        if (typeof value !== "string") {
          throw new TypeError("The completed network fact must be a string")
        }
        decision = value === "disabled" ? "local-cache" : "remote-review"
        decisionPrecededCredentials = !credentialsCompleted
        decisionPrecededRoot = !rootCompleted
      }
      if (isCredentialsFact) {
        credentialsCompleted = true
      }
      if (path.length === 0) {
        rootCompleted = true
      }
    }
  })

  for await (const snapshot of parser.iterate(source)) {
    snapshots.push(snapshot)
  }

  if (
    decision === undefined ||
    !decisionPrecededCredentials ||
    !decisionPrecededRoot ||
    !credentialsCompleted ||
    !rootCompleted
  ) {
    throw new Error("SDK stream did not route from the nested fact before later JSON arrived")
  }

  return { decision, snapshots }
}

function createAiSdkModel(deltas: string[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunkDelayInMs: null,
          initialDelayInMs: null,
          chunks: [
            { id: "text-1", type: "text-start" as const },
            ...deltas.map(delta => ({ delta, id: "text-1", type: "text-delta" as const })),
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

function createAgentsModel({
  deltas,
  serialized
}: {
  deltas: string[]
  serialized: string
}): Model {
  return {
    getResponse(): Promise<ModelResponse> {
      return Promise.reject(new Error("Mock example unexpectedly used a non-stream call"))
    },
    async *getStreamedResponse(): AsyncIterable<StreamEvent> {
      await Promise.resolve()
      yield { type: "response_started" }
      for (const delta of deltas) {
        yield { delta, type: "output_text_delta" }
      }
      yield {
        response: {
          id: "example-response",
          output: [
            {
              content: [{ text: serialized, type: "output_text" }],
              id: "example-message",
              role: "assistant",
              status: "completed",
              type: "message"
            }
          ],
          usage: {
            inputTokens: 1,
            inputTokensDetails: {},
            outputTokens: 1,
            outputTokensDetails: {},
            requests: 1,
            totalTokens: 2
          }
        },
        type: "response_done"
      }
    }
  }
}

const serializedExpected = JSON.stringify(expected)
const streamDeltas = splitJson(serializedExpected)
const aiResult = streamText({
  maxRetries: 0,
  model: createAiSdkModel(streamDeltas),
  output: Output.object({ schema }),
  prompt: "Return the deterministic fixture."
})
const aiRun = await collectWithDecision(aiResult.textStream)
const aiFinal = await aiResult.output

const agent = new Agent({
  instructions: "Return the deterministic fixture.",
  model: createAgentsModel({ deltas: streamDeltas, serialized: serializedExpected }),
  name: "SchemaStream mock example",
  outputType: schema
})
const agentResult = await new Runner({
  traceIncludeSensitiveData: false,
  tracingDisabled: true
}).run(agent, "Return the deterministic fixture.", { stream: true })
const agentRun = await collectWithDecision(agentResult.toTextStream())
await agentResult.completed

const expectedJson = serializedExpected
const results = [
  { final: aiFinal, name: "Vercel AI SDK", ...aiRun },
  { final: agentResult.finalOutput, name: "OpenAI Agents SDK", ...agentRun }
]

for (const result of results) {
  if (
    JSON.stringify(result.final) !== expectedJson ||
    JSON.stringify(result.snapshots.at(-1)) !== expectedJson
  ) {
    throw new Error(`${result.name} mock example did not reconstruct the expected value`)
  }
  process.stdout.write(
    `${result.name}: ${result.snapshots.length} snapshots, ${result.decision} route selected ` +
      "before credentials and root completion, final output verified\n"
  )
}
