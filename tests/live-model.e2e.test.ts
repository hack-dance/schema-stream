import { describe, test } from "bun:test"
import { isDeepStrictEqual } from "node:util"
import { Agent as MastraAgent } from "@mastra/core/agent"
import { Agent, Runner, setTraceProcessors, setTracingDisabled } from "@openai/agents"
import { Output, streamText } from "ai"
import * as z from "zod"

import {
  SchemaStream,
  type SchemaStreamChunk,
  type SchemaStreamSource,
  type SchemaStreamValuePath
} from "@/index"

const liveRequestTimeoutMs = 90_000
const liveSuiteTimeoutMs = 300_000
const liveMaxOutputTokens = 2048
const unsafeErrorTokenPattern = /[^A-Za-z0-9_.-]/g

setTraceProcessors([])
setTracingDisabled(true)

interface LiveCase<TSchema extends z.ZodObject> {
  id: string
  prompt: string
  schema: TSchema
  validate: (value: z.output<TSchema>) => boolean
}

interface LiveResult<TSchema extends z.ZodObject> {
  authoritative: unknown
  completedPaths: SchemaStreamValuePath[]
  snapshots: SchemaStreamChunk<TSchema>[]
}

const summarySchema = z.object({
  headline: z.string(),
  abstract: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  note: z.string().nullable(),
  tags: z.array(z.string())
})
const summaryCase: LiveCase<typeof summarySchema> = {
  id: "unicode-summary",
  prompt:
    "Create a concise structured summary about safe ocean research. Include the exact phrase 日本語, a quoted phrase, a line break in the abstract, at least three tags, and use null for note.",
  schema: summarySchema,
  validate: value =>
    value.abstract.includes("日本語") && value.note === null && value.tags.length >= 3
}

const inventorySchema = z.object({
  collection: z.string(),
  groups: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          active: z.boolean(),
          count: z.number(),
          label: z.string()
        })
      )
    })
  ),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })),
  totals: z.object({ active: z.number(), items: z.number() })
})
const inventoryCase: LiveCase<typeof inventorySchema> = {
  id: "nested-inventory",
  prompt:
    "Build a structured inventory named summer. Include two groups with two items each, three key-value attributes, and numeric totals consistent with the item arrays.",
  schema: inventorySchema,
  validate: value =>
    value.groups.length === 2 &&
    value.groups.every(group => group.items.length === 2) &&
    value.attributes.length === 3 &&
    value.totals.items === 4
}

const scheduleSchema = z.object({
  timezone: z.string(),
  owner: z.object({ email: z.string().nullable(), name: z.string() }),
  windows: z.array(
    z.object({
      end: z.string(),
      label: z.string(),
      start: z.string()
    })
  ),
  warnings: z.array(z.string())
})
const scheduleCase: LiveCase<typeof scheduleSchema> = {
  id: "schedule-branches",
  prompt:
    "Return a UTC schedule owned by Casey with null email, exactly three non-overlapping ISO-8601 windows, and two short warning strings. Keep every field present.",
  schema: scheduleSchema,
  validate: value =>
    value.timezone === "UTC" &&
    value.owner.email === null &&
    value.windows.length === 3 &&
    value.warnings.length === 2
}

const liveEnabled = process.env.SCHEMA_STREAM_LIVE_E2E === "1"
const selectedProvider = process.env.SCHEMA_STREAM_LIVE_PROVIDER
const selectsAgents = selectedProvider === "agents" || selectedProvider === "all"
const selectsGateway = selectedProvider === "gateway" || selectedProvider === "all"
const selectsMastra = selectedProvider === "mastra" || selectedProvider === "all"

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Live E2E configuration is missing ${name}`)
  }
  return value
}

/** Returns one configuration failure before any selected provider can make a live request. */
function getLiveConfigurationError(): string | undefined {
  if (!liveEnabled) {
    return
  }
  if (!(selectsAgents || selectsGateway || selectsMastra)) {
    return "SCHEMA_STREAM_LIVE_PROVIDER must be agents, gateway, mastra, or all when live E2E is enabled"
  }
  const requiredVariables: string[] = []
  if (selectsAgents) {
    requiredVariables.push("OPENAI_API_KEY", "SCHEMA_STREAM_AGENTS_MODEL")
  }
  if (selectsGateway) {
    requiredVariables.push("AI_GATEWAY_API_KEY", "SCHEMA_STREAM_GATEWAY_MODEL")
  }
  if (selectsMastra) {
    requiredVariables.push("OPENAI_API_KEY", "SCHEMA_STREAM_MASTRA_MODEL")
  }
  const missingVariable = requiredVariables.find(name => !process.env[name]?.trim())
  return missingVariable ? `Live E2E configuration is missing ${missingVariable}` : undefined
}

const liveConfigurationError = getLiveConfigurationError()
const liveConfigurationValid = liveEnabled && liveConfigurationError === undefined

async function collect<TSchema extends z.ZodObject>(
  source: AsyncIterable<SchemaStreamChunk<TSchema>>
): Promise<SchemaStreamChunk<TSchema>[]> {
  const snapshots: SchemaStreamChunk<TSchema>[] = []
  for await (const snapshot of source) {
    snapshots.push(snapshot)
  }
  return snapshots
}

/** Records real completion ordering without assuming any provider-specific text chunk cadence. */
function createObservedParser<TSchema extends z.ZodObject>(
  schema: TSchema
): {
  completedPaths: SchemaStreamValuePath[]
  parser: SchemaStream<TSchema>
} {
  const completedPaths: SchemaStreamValuePath[] = []
  const parser = new SchemaStream(schema, {
    onValueComplete({ path }) {
      completedPaths.push(path)
    }
  })
  return { completedPaths, parser }
}

/** Fails the pinned Mastra compatibility lane if textStream stops carrying raw JSON text. */
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

async function withAbortTimeout<TResult>({
  task
}: {
  task: (signal: AbortSignal) => Promise<TResult>
}): Promise<TResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), liveRequestTimeoutMs)

  try {
    return await task(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

function sanitizeError(error: unknown): string {
  const rawName = error instanceof Error ? error.name : "UnknownError"
  const name = rawName.replace(unsafeErrorTokenPattern, "").slice(0, 48) || "Error"
  if (typeof error !== "object" || error === null) {
    return name
  }

  const record = error as Record<string, unknown>
  const { status: responseStatus, statusCode } = record
  let status: number | undefined
  if (typeof responseStatus === "number") {
    status = responseStatus
  } else if (typeof statusCode === "number") {
    status = statusCode
  }
  return status === undefined ? name : `${name}:status-${status}`
}

function failLive({
  caseId,
  detail,
  provider
}: {
  caseId: string
  detail: string
  provider: "agents" | "gateway" | "mastra"
}): never {
  throw new Error(`[live:${provider}:${caseId}] ${detail}`)
}

function verifyLiveResult<TSchema extends z.ZodObject>({
  authoritative,
  completedPaths,
  fixture,
  provider,
  snapshots
}: {
  authoritative: unknown
  completedPaths: SchemaStreamValuePath[]
  fixture: LiveCase<TSchema>
  provider: "agents" | "gateway" | "mastra"
  snapshots: SchemaStreamChunk<TSchema>[]
}): void {
  const parsed = fixture.schema.safeParse(authoritative)
  if (!parsed.success) {
    failLive({
      caseId: fixture.id,
      detail: "authoritative output failed schema validation",
      provider
    })
  }
  if (!fixture.validate(parsed.data)) {
    failLive({
      caseId: fixture.id,
      detail: "authoritative output failed semantic checks",
      provider
    })
  }
  if (snapshots.length === 0) {
    failLive({ caseId: fixture.id, detail: "stream produced no snapshots", provider })
  }
  if (!isDeepStrictEqual(snapshots.at(-1), parsed.data)) {
    failLive({
      caseId: fixture.id,
      detail: "final snapshot differed from authoritative output",
      provider
    })
  }
  const rootCompletionIndex = completedPaths.findIndex(path => path.length === 0)
  const hasNestedCompletion = completedPaths.some(path => path.length > 0)
  if (!(hasNestedCompletion && rootCompletionIndex === completedPaths.length - 1)) {
    failLive({ caseId: fixture.id, detail: "completion event ordering was invalid", provider })
  }
}

async function verifyAgentsLive<TSchema extends z.ZodObject>({
  fixture,
  model
}: {
  fixture: LiveCase<TSchema>
  model: string
}): Promise<void> {
  let liveResult: LiveResult<TSchema>
  try {
    liveResult = await withAbortTimeout({
      task: async signal => {
        const agent = new Agent({
          instructions: "Return only structured output matching the supplied schema.",
          model,
          modelSettings: { maxTokens: liveMaxOutputTokens, store: false },
          name: `SchemaStream live ${fixture.id}`,
          outputType: fixture.schema
        })
        const result = await new Runner({
          traceIncludeSensitiveData: false,
          tracingDisabled: true
        }).run(agent, fixture.prompt, { signal, stream: true })
        const { completedPaths, parser } = createObservedParser(fixture.schema)
        const streamed = await collect<TSchema>(parser.iterate(result.toTextStream()))
        await result.completed
        return { authoritative: result.finalOutput, completedPaths, snapshots: streamed }
      }
    })
  } catch (error) {
    failLive({
      caseId: fixture.id,
      detail: `request failed (${sanitizeError(error)})`,
      provider: "agents"
    })
  }
  verifyLiveResult({
    authoritative: liveResult.authoritative,
    completedPaths: liveResult.completedPaths,
    fixture,
    provider: "agents",
    snapshots: liveResult.snapshots
  })
}

async function verifyGatewayLive<TSchema extends z.ZodObject>({
  fixture,
  model
}: {
  fixture: LiveCase<TSchema>
  model: string
}): Promise<void> {
  let liveResult: LiveResult<TSchema>
  try {
    liveResult = await withAbortTimeout({
      task: async signal => {
        const result = streamText({
          abortSignal: signal,
          maxOutputTokens: liveMaxOutputTokens,
          maxRetries: 0,
          model,
          output: Output.object({ schema: fixture.schema }),
          prompt: fixture.prompt,
          timeout: { chunkMs: 30_000, totalMs: liveRequestTimeoutMs }
        })
        const { completedPaths, parser } = createObservedParser(fixture.schema)
        const streamed = await collect<TSchema>(parser.iterate(result.textStream))
        return { authoritative: await result.output, completedPaths, snapshots: streamed }
      }
    })
  } catch (error) {
    failLive({
      caseId: fixture.id,
      detail: `request failed (${sanitizeError(error)})`,
      provider: "gateway"
    })
  }
  verifyLiveResult({
    authoritative: liveResult.authoritative,
    completedPaths: liveResult.completedPaths,
    fixture,
    provider: "gateway",
    snapshots: liveResult.snapshots
  })
}

async function verifyMastraLive<TSchema extends z.ZodObject>({
  fixture,
  model
}: {
  fixture: LiveCase<TSchema>
  model: string
}): Promise<void> {
  let liveResult: LiveResult<TSchema>
  try {
    liveResult = await withAbortTimeout({
      task: async signal => {
        const agent = new MastraAgent({
          id: `schema-stream-live-${fixture.id}`,
          name: `SchemaStream live ${fixture.id}`,
          instructions: "Return only structured output matching the supplied schema.",
          model
        })
        const result = await agent.stream(fixture.prompt, {
          abortSignal: signal,
          modelSettings: { maxOutputTokens: liveMaxOutputTokens, maxRetries: 0 },
          structuredOutput: { errorStrategy: "strict", schema: fixture.schema }
        })
        const { completedPaths, parser } = createObservedParser(fixture.schema)
        const streamed = await collect<TSchema>(
          parser.iterate(requireJsonObjectText(result.textStream))
        )
        return { authoritative: await result.object, completedPaths, snapshots: streamed }
      }
    })
  } catch (error) {
    failLive({
      caseId: fixture.id,
      detail: `request failed (${sanitizeError(error)})`,
      provider: "mastra"
    })
  }
  verifyLiveResult({
    authoritative: liveResult.authoritative,
    completedPaths: liveResult.completedPaths,
    fixture,
    provider: "mastra",
    snapshots: liveResult.snapshots
  })
}

describe("opt-in live model integration", () => {
  test.skipIf(!liveEnabled)(
    "uses a recognized provider selection",
    () => {
      if (liveConfigurationError) {
        throw new Error(liveConfigurationError)
      }
    },
    liveSuiteTimeoutMs
  )

  test.skipIf(!(liveConfigurationValid && selectsAgents))(
    "streams varied schemas through OpenAI Agents",
    async () => {
      const model = readRequiredEnvironmentVariable("SCHEMA_STREAM_AGENTS_MODEL")
      await verifyAgentsLive({ fixture: summaryCase, model })
      await verifyAgentsLive({ fixture: inventoryCase, model })
      await verifyAgentsLive({ fixture: scheduleCase, model })
    },
    liveSuiteTimeoutMs
  )

  test.skipIf(!(liveConfigurationValid && selectsGateway))(
    "streams varied schemas through Vercel AI Gateway",
    async () => {
      const model = readRequiredEnvironmentVariable("SCHEMA_STREAM_GATEWAY_MODEL")
      await verifyGatewayLive({ fixture: summaryCase, model })
      await verifyGatewayLive({ fixture: inventoryCase, model })
      await verifyGatewayLive({ fixture: scheduleCase, model })
    },
    liveSuiteTimeoutMs
  )

  test.skipIf(!(liveConfigurationValid && selectsMastra))(
    "checks pinned Mastra JSON text compatibility across varied schemas",
    async () => {
      const model = readRequiredEnvironmentVariable("SCHEMA_STREAM_MASTRA_MODEL")
      await verifyMastraLive({ fixture: summaryCase, model })
      await verifyMastraLive({ fixture: inventoryCase, model })
      await verifyMastraLive({ fixture: scheduleCase, model })
    },
    liveSuiteTimeoutMs
  )
})
