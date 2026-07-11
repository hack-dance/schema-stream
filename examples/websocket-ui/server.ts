import { isDeepStrictEqual } from "node:util"
import {
  Agent,
  type Model,
  type ModelResponse,
  Runner,
  type StreamEvent,
  setTraceProcessors,
  setTracingDisabled
} from "@openai/agents"
import { z } from "zod"

import {
  SchemaStream,
  type SchemaStreamChunk,
  type SchemaStreamSource,
  type SchemaStreamValuePath,
  type SnapshotPolicy
} from "../../src"

setTraceProcessors([])
setTracingDisabled(true)

const protocolVersion = 1 as const
const defaultPort = 3400
const defaultModel = "gpt-5.6-luna"
const maxPromptLength = 800
const decisionPath = ["triage", "requiresApproval"] as const
const fixtureBrief = "Customer-facing release with three open checks and an approval gate."

const dashboardSchema = z.object({
  brief: z.string(),
  triage: z.object({
    severity: z.enum(["low", "medium", "high"]),
    requiresApproval: z.boolean(),
    rationale: z.string()
  }),
  interface: z.object({
    title: z.string(),
    status: z.string(),
    accent: z.enum(["green", "amber", "coral"]),
    metrics: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        trend: z.enum(["up", "steady", "down"])
      })
    ),
    activity: z.array(
      z.object({
        time: z.string(),
        label: z.string(),
        state: z.enum(["done", "active", "queued"])
      })
    )
  }),
  readiness: z.object({
    score: z.number().min(0).max(100),
    checks: z.array(
      z.object({
        label: z.string(),
        status: z.enum(["pass", "watch", "blocker"])
      })
    )
  }),
  nextAction: z.string()
})

type Dashboard = z.output<typeof dashboardSchema>
type DashboardSnapshot = SchemaStreamChunk<typeof dashboardSchema>
type ExecutionMode = "fixture" | "openai"
type WorkflowBranch = "approval-gate" | "auto-stage"

type SocketData = {
  controller?: AbortController
  running: boolean
  runId: number
  task?: Promise<void>
}

type ServerEvent =
  | {
      openAiAvailable: boolean
      model: string
      type: "hello"
      version: typeof protocolVersion
    }
  | {
      mode: ExecutionMode
      phase: "generating" | "idle"
      runId: number
      type: "status"
      version: typeof protocolVersion
    }
  | {
      completedPaths: SchemaStreamValuePath[]
      completedValues: number
      inputBytes: number
      inputChunks: number
      policy: SnapshotPolicy
      runId: number
      sequence: number
      snapshot: DashboardSnapshot
      type: "snapshot"
      version: typeof protocolVersion
    }
  | {
      action: string
      branch: WorkflowBranch
      path: typeof decisionPath
      rationale: string
      runId: number
      type: "decision"
      version: typeof protocolVersion
    }
  | {
      durationMs: number
      inputBytes: number
      inputChunks: number
      output: Dashboard
      policy: SnapshotPolicy
      runId: number
      snapshots: number
      type: "complete"
      version: typeof protocolVersion
    }
  | {
      code: "bad-message" | "busy" | "cancelled" | "generation-failed" | "live-unavailable"
      message: string
      runId?: number
      type: "error"
      version: typeof protocolVersion
    }

type AgentExecution = {
  readFinalOutput: () => Promise<Dashboard>
  source: SchemaStreamSource<string>
}

const openAiModel = process.env.SCHEMA_STREAM_EXAMPLE_MODEL?.trim() || defaultModel
const openAiAvailable = Boolean(process.env.OPENAI_API_KEY?.trim())
const port = readPort(process.env.SCHEMA_STREAM_EXAMPLE_PORT)
const allowedHost = `127.0.0.1:${port}`
const allowedOrigin = `http://${allowedHost}`
const websocketToken = crypto.randomUUID()
const runner = new Runner({
  traceIncludeSensitiveData: false,
  tracingDisabled: true
})

const assets = new Map([
  ["/", { contentType: "text/html; charset=utf-8", file: "index.html" }],
  ["/app.js", { contentType: "text/javascript; charset=utf-8", file: "app.js" }],
  ["/styles.css", { contentType: "text/css; charset=utf-8", file: "styles.css" }]
])

/** Resolves the optional example port while rejecting ambiguous or privileged values. */
function readPort(rawPort: string | undefined): number {
  if (!rawPort) {
    return defaultPort
  }

  const parsed = Number(rawPort)
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error("SCHEMA_STREAM_EXAMPLE_PORT must be an integer from 1024 through 65535")
  }
  return parsed
}

/** Narrows decoded client frames before any property is trusted. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Compares a completion delta with the field that controls the server workflow branch. */
function isDecisionPath(path: SchemaStreamValuePath): boolean {
  return path.length === 2 && path[0] === decisionPath[0] && path[1] === decisionPath[1]
}

/** Parses a client-selected cadence into SchemaStream's public snapshot policy contract. */
function readSnapshotPolicy(value: unknown): SnapshotPolicy | null {
  if (value === undefined) {
    return { mode: "chunk" }
  }
  if (!isRecord(value) || typeof value.mode !== "string") {
    return null
  }
  if (value.mode === "chunk" || value.mode === "value" || value.mode === "final") {
    return { mode: value.mode }
  }
  if (
    value.mode === "bytes" &&
    typeof value.bytes === "number" &&
    Number.isInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= 1_000_000
  ) {
    return { bytes: value.bytes, mode: "bytes" }
  }
  return null
}

/** Sends exactly one complete, versioned JSON document per WebSocket message. */
function sendEvent(socket: Bun.ServerWebSocket<SocketData>, event: ServerEvent): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event))
  }
}

/** Rejects DNS-rebinding hosts before serving assets, session tokens, or WebSocket upgrades. */
function hasAllowedHost(request: Request, requestUrl: URL): boolean {
  return (
    request.headers.get("host") === allowedHost &&
    requestUrl.protocol === "http:" &&
    requestUrl.host === allowedHost
  )
}

/** Requires an exact browser origin for every WebSocket upgrade. */
function hasAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) {
    return false
  }

  try {
    return new URL(origin).origin === allowedOrigin
  } catch {
    return false
  }
}

/** Produces stable code-point chunks so the fixture exercises real incremental parsing. */
function splitJson(serialized: string, chunkSize = 13): string[] {
  const codePoints = Array.from(serialized)
  const chunks: string[] = []
  for (let offset = 0; offset < codePoints.length; offset += chunkSize) {
    chunks.push(codePoints.slice(offset, offset + chunkSize).join(""))
  }
  return chunks
}

/** Measures provider chunks before yielding them unchanged to SchemaStream. */
async function* measureSource({
  onChunk,
  source
}: {
  onChunk: (byteLength: number) => void
  source: SchemaStreamSource<string>
}): AsyncIterable<string> {
  const encoder = new TextEncoder()
  for await (const chunk of source) {
    onChunk(encoder.encode(chunk).byteLength)
    yield chunk
  }
}

/** Delays fixture chunks recursively so the browser can paint each progressive state. */
async function* paceChunks(chunks: string[], index = 0): AsyncIterable<string> {
  if (index >= chunks.length) {
    return
  }

  await Bun.sleep(38)
  yield chunks[index] ?? ""
  yield* paceChunks(chunks, index + 1)
}

/** Builds the fixed fixture used to compare snapshot policies without model variance. */
function createFixtureDashboard(): Dashboard {
  return {
    brief: fixtureBrief,
    triage: {
      severity: "high",
      requiresApproval: true,
      rationale: "The launch changes a customer-facing workflow and needs an explicit review."
    },
    interface: {
      title: "Launch control",
      status: "Review required",
      accent: "amber",
      metrics: [
        { label: "Readiness", trend: "up", value: "82%" },
        { label: "Open checks", trend: "down", value: "3" },
        { label: "Owners online", trend: "steady", value: "6" }
      ],
      activity: [
        { label: "Schema verified", state: "done", time: "09:41" },
        { label: "Approval requested", state: "active", time: "09:42" },
        { label: "Production stage", state: "queued", time: "09:45" }
      ]
    },
    readiness: {
      score: 82,
      checks: [
        { label: "Schema contract", status: "pass" },
        { label: "Release owner", status: "watch" },
        { label: "Rollback rehearsal", status: "blocker" }
      ]
    },
    nextAction: "Route the generated launch plan to the release owner for approval."
  }
}

/**
 * Implements the Agents SDK model contract without credentials. The SDK Runner still owns the
 * stream lifecycle, so Fixture and OpenAI exercise the same `toTextStream()` integration.
 */
function createFixtureModel(output: Dashboard): Model {
  const serialized = JSON.stringify(output)
  const chunks = splitJson(serialized)

  return {
    getResponse(): Promise<ModelResponse> {
      return Promise.reject(new Error("Fixture unexpectedly used a non-stream call"))
    },
    async *getStreamedResponse(): AsyncIterable<StreamEvent> {
      yield { type: "response_started" }
      for await (const delta of paceChunks(chunks)) {
        yield { delta, type: "output_text_delta" }
      }
      yield {
        response: {
          id: "websocket-example-response",
          output: [
            {
              content: [{ text: serialized, type: "output_text" }],
              id: "websocket-example-message",
              role: "assistant",
              status: "completed",
              type: "message"
            }
          ],
          usage: {
            inputTokens: 1,
            inputTokensDetails: {},
            outputTokens: chunks.length,
            outputTokensDetails: {},
            requests: 1,
            totalTokens: chunks.length + 1
          }
        },
        type: "response_done"
      }
    }
  }
}

/** Starts either model behind one Agents SDK structured-output stream. */
async function createAgentExecution({
  mode,
  prompt,
  signal
}: {
  mode: ExecutionMode
  prompt: string
  signal: AbortSignal
}): Promise<AgentExecution> {
  const model: Model | string =
    mode === "fixture" ? createFixtureModel(createFixtureDashboard()) : openAiModel
  const agent = new Agent({
    instructions:
      "Populate a compact operational dashboard. Put triage first. Set requiresApproval true when the request carries meaningful operational or customer risk. Return only the requested structured output.",
    model,
    modelSettings: { maxTokens: 1400, store: false },
    name: "SchemaStream WebSocket dashboard",
    outputType: dashboardSchema
  })
  const result = await runner.run(agent, prompt, { signal, stream: true })

  return {
    source: result.toTextStream(),
    async readFinalOutput(): Promise<Dashboard> {
      await result.completed
      return dashboardSchema.parse(result.finalOutput)
    }
  }
}

/** Converts the completed boolean into an application decision before generation has finished. */
function createWorkflowDecision(requiresApproval: boolean): {
  action: string
  branch: WorkflowBranch
  rationale: string
} {
  return requiresApproval
    ? {
        action: "Hold production staging and notify the release owner.",
        branch: "approval-gate",
        rationale: "The completed triage field requires an explicit approval."
      }
    : {
        action: "Stage the generated dashboard automatically.",
        branch: "auto-stage",
        rationale: "The completed triage field permits the low-risk path."
      }
}

/**
 * Parses model deltas on the server, emits only materialized snapshots, and branches immediately
 * when `triage.requiresApproval` becomes syntactically complete.
 */
async function streamDashboard({
  controller,
  mode,
  policy,
  prompt,
  runId,
  socket
}: {
  controller: AbortController
  mode: ExecutionMode
  policy: SnapshotPolicy
  prompt: string
  runId: number
  socket: Bun.ServerWebSocket<SocketData>
}): Promise<void> {
  const startedAt = performance.now()
  const pendingPaths: SchemaStreamValuePath[] = []
  let completedValues = 0
  let decisionSent = false
  let finalSnapshot: DashboardSnapshot | undefined
  let inputBytes = 0
  let inputChunks = 0
  let sequence = 0

  try {
    sendEvent(socket, {
      mode,
      phase: "generating",
      runId,
      type: "status",
      version: protocolVersion
    })
    const execution = await createAgentExecution({ mode, prompt, signal: controller.signal })
    const parser = new SchemaStream(dashboardSchema, {
      onValueComplete({ path, value }) {
        pendingPaths.push(path)
        completedValues += 1
        if (!decisionSent && isDecisionPath(path) && typeof value === "boolean") {
          decisionSent = true
          sendEvent(socket, {
            ...createWorkflowDecision(value),
            path: decisionPath,
            runId,
            type: "decision",
            version: protocolVersion
          })
        }
      }
    })
    const source = measureSource({
      onChunk(byteLength) {
        inputBytes += byteLength
        inputChunks += 1
      },
      source: execution.source
    })

    for await (const snapshot of parser.iterate(source, { snapshotPolicy: policy })) {
      sequence += 1
      finalSnapshot = snapshot
      const completedPaths = pendingPaths.splice(0)
      sendEvent(socket, {
        completedPaths,
        completedValues,
        inputBytes,
        inputChunks,
        policy,
        runId,
        sequence,
        snapshot,
        type: "snapshot",
        version: protocolVersion
      })
    }

    const output = await execution.readFinalOutput()
    if (!isDeepStrictEqual(finalSnapshot, output)) {
      throw new Error("The final progressive snapshot did not match the authoritative output")
    }
    sendEvent(socket, {
      durationMs: Math.round(performance.now() - startedAt),
      inputBytes,
      inputChunks,
      output,
      policy,
      runId,
      snapshots: sequence,
      type: "complete",
      version: protocolVersion
    })
  } catch (error) {
    const cancelled = controller.signal.aborted
    sendEvent(socket, {
      code: cancelled ? "cancelled" : "generation-failed",
      message: cancelled
        ? "Generation cancelled."
        : "Generation failed without exposing provider or credential details.",
      runId,
      type: "error",
      version: protocolVersion
    })
    if (!cancelled) {
      const errorName = error instanceof Error ? error.name : "UnknownError"
      const fixtureDetail = mode === "fixture" && error instanceof Error ? `: ${error.message}` : ""
      process.stderr.write(`WebSocket example generation failed (${errorName}${fixtureDetail})\n`)
    }
  } finally {
    if (socket.data.runId === runId) {
      socket.data.controller = undefined
      socket.data.running = false
    }
  }
}

/** Validates control frames and starts one cancellable generation per connection. */
function handleClientMessage({
  message,
  socket
}: {
  message: string | Buffer
  socket: Bun.ServerWebSocket<SocketData>
}): void {
  let decoded: unknown
  try {
    decoded = JSON.parse(typeof message === "string" ? message : message.toString("utf8"))
  } catch {
    sendEvent(socket, {
      code: "bad-message",
      message: "Client messages must be complete JSON documents.",
      type: "error",
      version: protocolVersion
    })
    return
  }

  if (!isRecord(decoded) || typeof decoded.type !== "string") {
    sendEvent(socket, {
      code: "bad-message",
      message: "Unknown client message.",
      type: "error",
      version: protocolVersion
    })
    return
  }

  if (decoded.type === "cancel") {
    socket.data.controller?.abort()
    return
  }
  if (decoded.type !== "start" || (decoded.mode !== "fixture" && decoded.mode !== "openai")) {
    sendEvent(socket, {
      code: "bad-message",
      message: "Expected a start message with a supported execution mode.",
      type: "error",
      version: protocolVersion
    })
    return
  }
  if (socket.data.running) {
    sendEvent(socket, {
      code: "busy",
      message: "This connection already has an active generation.",
      runId: socket.data.runId,
      type: "error",
      version: protocolVersion
    })
    return
  }
  if (decoded.mode === "openai" && !openAiAvailable) {
    sendEvent(socket, {
      code: "live-unavailable",
      message: "OpenAI mode requires OPENAI_API_KEY on the server.",
      type: "error",
      version: protocolVersion
    })
    return
  }

  const prompt = typeof decoded.prompt === "string" ? decoded.prompt.trim() : ""
  if (!prompt || prompt.length > maxPromptLength) {
    sendEvent(socket, {
      code: "bad-message",
      message: `Prompt length must be between 1 and ${maxPromptLength} characters.`,
      type: "error",
      version: protocolVersion
    })
    return
  }

  const policy = readSnapshotPolicy(decoded.snapshotPolicy)
  if (!policy) {
    sendEvent(socket, {
      code: "bad-message",
      message: "Snapshot policy must be chunk, value, final, or bytes with a valid threshold.",
      type: "error",
      version: protocolVersion
    })
    return
  }

  const controller = new AbortController()
  const runId = socket.data.runId + 1
  socket.data.controller = controller
  socket.data.running = true
  socket.data.runId = runId
  socket.data.task = streamDashboard({
    controller,
    mode: decoded.mode,
    policy,
    prompt,
    runId,
    socket
  })
}

const server = Bun.serve<SocketData>({
  fetch(request, bunServer) {
    const url = new URL(request.url)
    if (!hasAllowedHost(request, url)) {
      return new Response("Forbidden", { status: 403 })
    }
    if (url.pathname === "/session") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 })
      }
      return Response.json(
        { token: websocketToken },
        {
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff"
          }
        }
      )
    }
    if (url.pathname === "/ws") {
      if (!hasAllowedOrigin(request) || url.searchParams.get("token") !== websocketToken) {
        return new Response("Forbidden", { status: 403 })
      }
      const upgraded = bunServer.upgrade(request, {
        data: { running: false, runId: 0 }
      })
      return upgraded ? undefined : new Response("WebSocket upgrade required", { status: 426 })
    }

    const asset = assets.get(url.pathname)
    if (!asset || request.method !== "GET") {
      return new Response("Not found", { status: 404 })
    }
    return new Response(Bun.file(`${import.meta.dir}/${asset.file}`), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'self'; connect-src 'self' ws://${allowedHost}; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
        "Content-Type": asset.contentType,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      }
    })
  },
  hostname: "127.0.0.1",
  port,
  websocket: {
    close(socket) {
      socket.data.controller?.abort()
    },
    message(socket, message) {
      handleClientMessage({ message, socket })
    },
    open(socket) {
      sendEvent(socket, {
        model: openAiModel,
        openAiAvailable,
        type: "hello",
        version: protocolVersion
      })
    }
  }
})

process.stdout.write(`SchemaStream WebSocket UI: ${server.url}\n`)
process.stdout.write(
  `OpenAI mode: ${openAiAvailable ? `available (${openAiModel})` : "disabled"}\n`
)
