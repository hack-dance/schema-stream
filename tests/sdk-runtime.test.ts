import { describe, test } from "bun:test"
import { isDeepStrictEqual } from "node:util"
import { Agent as MastraAgent } from "@mastra/core/agent"
import {
  Agent,
  type Model,
  type ModelRequest,
  type ModelResponse,
  Runner,
  type StreamEvent,
  setTraceProcessors,
  setTracingDisabled
} from "@openai/agents"
import { Output, simulateReadableStream, streamText } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import * as z from "zod"

import { SchemaStream, type SchemaStreamChunk } from "@/index"

setTraceProcessors([])
setTracingDisabled(true)

interface RuntimeCase<TSchema extends z.ZodObject> {
  hasMeaningfulProgress: (snapshots: SchemaStreamChunk<TSchema>[]) => boolean
  id: string
  prompt: string
  schema: TSchema
  value: SchemaStreamChunk<TSchema>
}

const reportSchema = z.object({
  title: z.string(),
  summary: z.string(),
  locale: z.enum(["en", "ja"]),
  confidence: z.number(),
  source: z.string().optional(),
  note: z.string().nullable(),
  sections: z.array(
    z.object({
      heading: z.string(),
      facts: z.array(z.object({ label: z.string(), value: z.string() }))
    })
  ),
  metrics: z.record(z.string(), z.number())
})
const reportValue: z.output<typeof reportSchema> = {
  title: "海辺 report",
  summary: 'Line one\n"quoted" \\ slash 🌊 with 日本語 and a long progressive ending.',
  locale: "ja",
  confidence: 0.97,
  source: "deterministic fixture",
  note: null,
  sections: [
    {
      heading: "Signals",
      facts: [
        { label: "temperature", value: "18°C" },
        { label: "condition", value: "clear" }
      ]
    },
    {
      heading: "Escapes",
      facts: [{ label: "literal", value: 'tab\tnewline\nquote"' }]
    }
  ],
  metrics: { accuracy: 99.5, citations: 3 }
}
const reportCase: RuntimeCase<typeof reportSchema> = {
  id: "unicode-report",
  prompt: "Extract the multilingual report with every requested field.",
  schema: reportSchema,
  value: reportValue,
  hasMeaningfulProgress: snapshots =>
    snapshots.some(
      snapshot =>
        typeof snapshot.summary === "string" &&
        snapshot.summary.startsWith("Line one") &&
        snapshot.summary !== reportValue.summary
    )
}

const workflowSchema = z.object({
  runId: z.string(),
  owner: z.object({ name: z.string(), alias: z.string().nullable() }),
  flags: z.record(z.string(), z.boolean()),
  batches: z.array(
    z.object({
      name: z.string(),
      note: z.string().optional(),
      entries: z.array(
        z.object({
          label: z.string(),
          score: z.number(),
          tags: z.array(z.string())
        })
      )
    })
  )
})
const workflowValue: z.output<typeof workflowSchema> = {
  runId: "run-0042",
  owner: { name: "Ada Lovelace", alias: null },
  flags: { dryRun: false, verified: true },
  batches: [
    {
      name: "primary",
      note: "Keep braces {like this} inside text.",
      entries: [
        { label: "first progressive record", score: 11, tags: ["alpha", "βeta"] },
        { label: "second record", score: 23, tags: ["ready"] }
      ]
    },
    {
      name: "fallback",
      note: "Use only after primary.",
      entries: [{ label: "third record", score: 5, tags: [] }]
    }
  ]
}
const workflowCase: RuntimeCase<typeof workflowSchema> = {
  id: "nested-workflow",
  prompt: "Build a nested workflow manifest from the supplied operational facts.",
  schema: workflowSchema,
  value: workflowValue,
  hasMeaningfulProgress: snapshots =>
    snapshots.some(snapshot => {
      const label = snapshot.batches?.[0]?.entries?.[0]?.label
      return (
        typeof label === "string" &&
        label.startsWith("first") &&
        label !== "first progressive record"
      )
    })
}

function splitJson(json: string, targetChunks = 12): string[] {
  const codePoints = Array.from(json)
  const chunkLength = Math.max(1, Math.ceil(codePoints.length / targetChunks))
  const chunks: string[] = []
  let offset = 0

  while (offset < codePoints.length) {
    chunks.push(codePoints.slice(offset, offset + chunkLength).join(""))
    offset += chunkLength
  }

  return chunks
}

async function collect<TSchema extends z.ZodObject>(
  stream: AsyncIterable<SchemaStreamChunk<TSchema>>
): Promise<SchemaStreamChunk<TSchema>[]> {
  const snapshots: SchemaStreamChunk<TSchema>[] = []
  for await (const snapshot of stream) {
    snapshots.push(snapshot)
  }
  return snapshots
}

function failRuntime({ detail, id }: { detail: string; id: string }): never {
  throw new Error(`[sdk-runtime:${id}] ${detail}`)
}

function verifyProgress<TSchema extends z.ZodObject>({
  fixture,
  snapshots,
  authoritative
}: {
  fixture: RuntimeCase<TSchema>
  snapshots: SchemaStreamChunk<TSchema>[]
  authoritative: unknown
}): void {
  if (snapshots.length <= 2) {
    failRuntime({ detail: "expected more than two snapshots", id: fixture.id })
  }
  if (!fixture.hasMeaningfulProgress(snapshots)) {
    failRuntime({ detail: "expected a meaningful intermediate value", id: fixture.id })
  }
  if (snapshots[0] === snapshots.at(-1)) {
    failRuntime({ detail: "snapshots reused the same object reference", id: fixture.id })
  }
  if (!isDeepStrictEqual(snapshots.at(-1), fixture.value)) {
    failRuntime({ detail: "final snapshot differed from the fixture", id: fixture.id })
  }
  if (!isDeepStrictEqual(authoritative, fixture.value)) {
    failRuntime({ detail: "authoritative output differed from the fixture", id: fixture.id })
  }
}

function createAiSdkModel(chunks: string[]): MockLanguageModelV4 {
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

async function verifyAiSdk<TSchema extends z.ZodObject>(
  fixture: RuntimeCase<TSchema>
): Promise<void> {
  const json = JSON.stringify(fixture.value)
  const model = createAiSdkModel(splitJson(json))
  const result = streamText({
    maxRetries: 0,
    model,
    output: Output.object({ schema: fixture.schema }),
    prompt: fixture.prompt
  })
  const snapshots = await collect(new SchemaStream(fixture.schema).iterate(result.textStream))
  const authoritative = await result.output

  if (model.doStreamCalls.length !== 1) {
    failRuntime({ detail: "AI SDK made an unexpected number of model calls", id: fixture.id })
  }
  if (!JSON.stringify(model.doStreamCalls[0]?.prompt).includes(fixture.prompt)) {
    failRuntime({ detail: "AI SDK did not forward the fixture prompt", id: fixture.id })
  }
  verifyProgress({ authoritative, fixture, snapshots })
}

async function verifyMastra<TSchema extends z.ZodObject>(
  fixture: RuntimeCase<TSchema>
): Promise<void> {
  const json = JSON.stringify(fixture.value)
  const model = createAiSdkModel(splitJson(json))
  const agent = new MastraAgent({
    id: `schema-stream-${fixture.id}`,
    name: `SchemaStream ${fixture.id} fixture`,
    instructions: "Return only the requested structured output.",
    model
  })
  const result = await agent.stream(fixture.prompt, {
    structuredOutput: { errorStrategy: "strict", schema: fixture.schema }
  })
  const snapshots = await collect(new SchemaStream(fixture.schema).iterate(result.textStream))
  const authoritative = await result.object

  if (model.doStreamCalls.length !== 1) {
    failRuntime({ detail: "Mastra made an unexpected number of model calls", id: fixture.id })
  }
  if (!JSON.stringify(model.doStreamCalls[0]?.prompt).includes(fixture.prompt)) {
    failRuntime({ detail: "Mastra did not forward the fixture prompt", id: fixture.id })
  }
  if (model.doStreamCalls[0]?.responseFormat?.type !== "json") {
    failRuntime({ detail: "Mastra did not forward the structured-output schema", id: fixture.id })
  }
  verifyProgress({ authoritative, fixture, snapshots })
}

function createAgentsModel({
  chunks,
  json,
  requests
}: {
  chunks: string[]
  json: string
  requests: ModelRequest[]
}): Model {
  return {
    getResponse(): Promise<ModelResponse> {
      return Promise.reject(new Error("Deterministic fixture unexpectedly used a non-stream call"))
    },
    async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      requests.push(request)
      yield { type: "response_started" }
      for (const delta of chunks) {
        yield { delta, type: "output_text_delta" }
      }
      yield {
        response: {
          id: "fixture-response",
          output: [
            {
              content: [{ text: json, type: "output_text" }],
              id: "fixture-message",
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

async function verifyAgentsSdk<TSchema extends z.ZodObject>(
  fixture: RuntimeCase<TSchema>
): Promise<void> {
  const json = JSON.stringify(fixture.value)
  const requests: ModelRequest[] = []
  const agent = new Agent({
    instructions: "Return only the requested structured output.",
    model: createAgentsModel({ chunks: splitJson(json), json, requests }),
    name: `SchemaStream ${fixture.id} fixture`,
    outputType: fixture.schema
  })
  const runner = new Runner({
    traceIncludeSensitiveData: false,
    tracingDisabled: true
  })
  const result = await runner.run(agent, fixture.prompt, { stream: true })
  const snapshots = await collect(new SchemaStream(fixture.schema).iterate(result.toTextStream()))
  await result.completed

  if (requests.length !== 1) {
    failRuntime({ detail: "Agents SDK made an unexpected number of model calls", id: fixture.id })
  }
  const expectedInput = [{ content: fixture.prompt, role: "user", type: "message" }]
  if (!isDeepStrictEqual(requests[0]?.input, expectedInput)) {
    failRuntime({ detail: "Agents SDK did not forward the normalized prompt", id: fixture.id })
  }
  verifyProgress({ authoritative: result.finalOutput, fixture, snapshots })
}

describe("SDK runtime integration", () => {
  test("consumes deterministic Vercel AI SDK structured-output streams", async () => {
    await verifyAiSdk(reportCase)
    await verifyAiSdk(workflowCase)
  })

  test("consumes deterministic OpenAI Agents SDK structured-output streams", async () => {
    await verifyAgentsSdk(reportCase)
    await verifyAgentsSdk(workflowCase)
  })

  test("consumes deterministic Mastra Agent structured-output streams", async () => {
    await verifyMastra(reportCase)
    await verifyMastra(workflowCase)
  })
})
