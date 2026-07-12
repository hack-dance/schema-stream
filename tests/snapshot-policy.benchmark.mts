import { Buffer } from "node:buffer"
import { type ExecFileException, execFile } from "node:child_process"
import { resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { array, boolean, number, object, string } from "zod"
import type { SnapshotPolicy, ZodObjectSchema } from "@/index"

type RuntimeName = "bun" | "node"
type FixtureName = "long-string" | "object-heavy"
type PolicyName = "chunk" | "value" | "bytes-256kb" | "bytes-1mb" | "final"
type CompletionCallbackName = "none" | "onValueComplete" | "onKeyComplete"
type IterateMaterialization = "direct-json-domain" | "json-roundtrip"
type Materialization = IterateMaterialization | "serialized-utf8"
type MicroPhase =
  | "JSON.stringify"
  | "Buffer.from (UTF-8)"
  | "TextEncoder.encode"
  | "TextDecoder + JSON.parse"
type StreamPhase = "parse" | "roundtrip" | "iterate"

interface BenchmarkOptions {
  chunkSizeBytes: number
  completionScaling: boolean
  fixtureNames: FixtureName[]
  iterateMaterialization: IterateMaterialization
  json: boolean
  modulePath: string
  payloadSizeMb: number
  policyNames: PolicyName[]
  repeats: number
  runtimeNames: RuntimeName[]
  verbose: boolean
  warmups: number
  worker: boolean
  workerRuntime?: RuntimeName
}

interface BenchmarkFixture {
  assertFinal: (value: unknown) => void
  chunks: Uint8Array[]
  encodedJson: Uint8Array
  expected: Record<string, unknown>
  json: string
  name: FixtureName
  schema: ZodObjectSchema
}

interface BenchmarkStats {
  maximumMs: number
  medianMs: number
  minimumMs: number
  samplesMs: number[]
}

interface MeasurementSpec<TValue> {
  assertValue: (value: TValue) => void
  operation: () => Promise<TValue> | TValue
  signature: (value: TValue) => string
}

interface MeasurementResult {
  signature: string
  stats: BenchmarkStats
}

interface MicroBenchmarkRow extends BenchmarkStats {
  fixture: FixtureName
  inputBytes: number
  medianMsPerOperation: number
  operationsPerSample: number
  phase: MicroPhase
  processedMbPerSecond: number
  runtime: RuntimeName
  runtimeVersion: string
}

interface StreamBenchmarkRow extends BenchmarkStats {
  actualEmittedBytes: number
  emittedSnapshots: number
  equivalentSerializationAmplification: number
  equivalentSerializedBytes: number
  fixture: FixtureName
  inputBytes: number
  materialization: Materialization
  phase: StreamPhase
  policy: PolicyName
  runtime: RuntimeName
  runtimeVersion: string
  serializationAvoidedBytes: number
  sourceMbPerSecond: number
  speedupVsRoundTrip: number
}

interface CompletionScalingRow extends BenchmarkStats {
  callback: CompletionCallbackName
  callbackEvents: number
  inputBytes: number
  recordCount: number
  recordsPerSecond: number
  runtime: RuntimeName
  runtimeVersion: string
}

interface WorkerOutput {
  completionScaling: CompletionScalingRow[]
  micro: MicroBenchmarkRow[]
  runtime: RuntimeName
  runtimeVersion: string
  streaming: StreamBenchmarkRow[]
}

interface ChildProcessOutput {
  error: ExecFileException | null
  stderr: string
  stdout: string
}

interface BenchmarkOutput {
  completionScaling: CompletionScalingRow[]
  configuration: {
    chunkSizeBytes: number
    completionScaling: boolean
    fixtures: FixtureName[]
    iterateMaterialization: IterateMaterialization
    modulePath: string
    payloadSizeMb: number
    policies: PolicyName[]
    repeats: number
    runtimes: RuntimeName[]
    warmups: number
  }
  micro: MicroBenchmarkRow[]
  streaming: StreamBenchmarkRow[]
}

interface ParseResult {
  emittedBytes: number
  emittedSnapshots: number
  finalSnapshot: Uint8Array
}

interface IterateResult {
  emittedSnapshots: number
  finalSnapshot: unknown
}

interface RoundTripResult extends IterateResult {
  emittedBytes: number
}

interface CompletionScalingResult {
  callbackEvents: number
  checksum: number
  finalRecordCount: number
}

interface CompletionCallbackState {
  callbackEvents: number
  checksum: number
}

interface PolicyDefinition {
  name: PolicyName
  snapshotPolicy: SnapshotPolicy
}

const bytesPerMegabyte = 1024 * 1024
const defaultChunkSizeBytes = 64 * 1024
const completionScalingRecordCounts = [250, 500, 1000, 2000] as const
const defaultModulePath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url))
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const minimumMicroPhaseBytes = 16 * bytesPerMegabyte
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const policyDefinitions: Record<PolicyName, PolicyDefinition> = {
  chunk: { name: "chunk", snapshotPolicy: { mode: "chunk" } },
  value: { name: "value", snapshotPolicy: { mode: "value" } },
  "bytes-256kb": {
    name: "bytes-256kb",
    snapshotPolicy: { bytes: 256 * 1024, mode: "bytes" }
  },
  "bytes-1mb": {
    name: "bytes-1mb",
    snapshotPolicy: { bytes: bytesPerMegabyte, mode: "bytes" }
  },
  final: { name: "final", snapshotPolicy: { mode: "final" } }
}
const fixtureNames = ["long-string", "object-heavy"] as const
const policyNames = ["chunk", "value", "bytes-256kb", "bytes-1mb", "final"] as const
const runtimeNames = ["bun", "node"] as const
const maximumChildProcessOutputBytes = 16 * 1024 * 1024

const helpText = `schema-stream snapshot benchmark

Usage:
  bun run benchmark [size-mib] [options]

Options:
  --size-mb <number>              Target MiB per fixture (default: 2)
  --chunk-kb <number>             Source chunk size in KiB (default: 64)
  --fixtures <list>               long-string,object-heavy
  --policies <list>               chunk,value,bytes-256kb,bytes-1mb,final
  --runtimes <list>               bun,node
  --warmups <number>              Warmup samples (default: 1)
  --repeats <number>              Measured samples (default: 5)
  --completion-scaling            Compare completion callbacks across 250-2000 records
  --verbose                       Include ranges and detailed emission metrics
  --json                          Emit full machine-readable evidence
  --module <path>                 Benchmark another built ESM entry point
  --iterate-materialization <id>  Label imported iterate as direct-json-domain or json-roundtrip
  -h, --help                      Show this help

The default module is built before measurement. Native JSON operations are reference
costs, not feature-equivalent alternatives. The serialized baseline uses parse()
(JSON.stringify + UTF-8 encode) followed by decode + JSON.parse for each snapshot.
The direct candidate uses iterate() to emit the same object snapshot without that round trip.`

function parseNumberFlag({ name, value }: { name: string; value: string | undefined }): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${name} must be a finite number`)
  }
  return parsed
}

/**
 * Runs benchmark subprocesses through the callback API so Node and Bun share one buffered output
 * contract. The explicit buffer cap prevents an unexpected worker from consuming unbounded memory.
 */
function executeFile({
  args,
  executable
}: {
  args: string[]
  executable: string
}): Promise<ChildProcessOutput> {
  return new Promise(resolve => {
    execFile(
      executable,
      args,
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: maximumChildProcessOutputBytes
      },
      (error, stdout, stderr) => {
        resolve({ error, stderr, stdout })
      }
    )
  })
}

function parseListFlag<TName extends string>({
  allowed,
  name,
  value
}: {
  allowed: readonly TName[]
  name: string
  value: string | undefined
}): TName[] {
  const values = value?.split(",").filter(Boolean) ?? []
  if (values.length === 0 || values.some(item => !allowed.includes(item as TName))) {
    throw new TypeError(`${name} must contain only: ${allowed.join(", ")}`)
  }
  return values as TName[]
}

function validateOptions(options: BenchmarkOptions): void {
  if (options.payloadSizeMb <= 0) {
    throw new TypeError("payload size must be greater than zero")
  }
  if (!(Number.isInteger(options.chunkSizeBytes) && options.chunkSizeBytes > 0)) {
    throw new TypeError("chunk size must resolve to a positive integer number of bytes")
  }
  if (!(Number.isInteger(options.warmups) && options.warmups >= 0)) {
    throw new TypeError("warmups must be a non-negative integer")
  }
  if (!(Number.isInteger(options.repeats) && options.repeats > 0)) {
    throw new TypeError("repeats must be a positive integer")
  }
  if (options.worker && options.workerRuntime === undefined) {
    throw new TypeError("worker mode requires --runtime")
  }
  if (
    options.completionScaling &&
    !options.worker &&
    resolvePath(options.modulePath) !== resolvePath(defaultModulePath)
  ) {
    throw new TypeError("--completion-scaling only supports the current built module")
  }
}

function applyOption({
  flag,
  options,
  value
}: {
  flag: string
  options: BenchmarkOptions
  value: string | undefined
}): void {
  const handlers: Record<string, () => void> = {
    "--chunk-kb": () => {
      options.chunkSizeBytes = Math.round(parseNumberFlag({ name: flag, value }) * 1024)
    },
    "--fixtures": () => {
      options.fixtureNames = parseListFlag({ allowed: fixtureNames, name: flag, value })
    },
    "--iterate-materialization": () => {
      options.iterateMaterialization = parseListFlag({
        allowed: ["direct-json-domain", "json-roundtrip"] as const,
        name: flag,
        value
      })[0]
    },
    "--module": () => {
      if (!value) {
        throw new TypeError(`${flag} requires a path`)
      }
      options.modulePath = resolvePath(value)
    },
    "--policies": () => {
      options.policyNames = parseListFlag({ allowed: policyNames, name: flag, value })
    },
    "--repeats": () => {
      options.repeats = parseNumberFlag({ name: flag, value })
    },
    "--runtime": () => {
      options.workerRuntime = parseListFlag({ allowed: runtimeNames, name: flag, value })[0]
    },
    "--runtimes": () => {
      options.runtimeNames = parseListFlag({ allowed: runtimeNames, name: flag, value })
    },
    "--size-mb": () => {
      options.payloadSizeMb = parseNumberFlag({ name: flag, value })
    },
    "--warmups": () => {
      options.warmups = parseNumberFlag({ name: flag, value })
    }
  }
  const handler = handlers[flag]
  if (handler === undefined) {
    throw new TypeError(`Unknown benchmark option: ${flag}`)
  }
  handler()
}

function parseArguments(args: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = {
    chunkSizeBytes: defaultChunkSizeBytes,
    completionScaling: false,
    fixtureNames: [...fixtureNames],
    iterateMaterialization: "direct-json-domain",
    json: false,
    modulePath: defaultModulePath,
    payloadSizeMb: 2,
    policyNames: [...policyNames],
    repeats: 5,
    runtimeNames: [...runtimeNames],
    verbose: false,
    warmups: 1,
    worker: false
  }
  let positionalSizeSeen = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--json") {
      options.json = true
      continue
    }
    if (argument === "--completion-scaling") {
      options.completionScaling = true
      continue
    }
    if (argument === "--worker") {
      options.worker = true
      continue
    }
    if (argument === "--verbose") {
      options.verbose = true
      continue
    }
    if (!argument.startsWith("--")) {
      if (positionalSizeSeen) {
        throw new TypeError(`Unexpected positional argument: ${argument}`)
      }
      options.payloadSizeMb = parseNumberFlag({ name: "payload size", value: argument })
      positionalSizeSeen = true
      continue
    }

    const [flag, inlineValue] = argument.split("=", 2)
    const value = inlineValue ?? args[index + 1]
    if (inlineValue === undefined) {
      index += 1
    }

    applyOption({ flag, options, value })
  }

  validateOptions(options)
  return options
}

/**
 * Builds the local package without mixing successful build logs into benchmark tables or JSON.
 * An explicit `--module` is assumed to have been prepared by the caller.
 */
async function buildDefaultModule(options: BenchmarkOptions): Promise<void> {
  if (resolvePath(options.modulePath) !== resolvePath(defaultModulePath)) {
    return
  }

  const result = await executeFile({
    args: ["run", "build"],
    executable: process.env.BUN_BINARY ?? "bun"
  })
  if (result.error) {
    throw new Error(`benchmark build failed:\n${result.stdout}${result.stderr}`, {
      cause: result.error
    })
  }
}

function serializeJson(value: Record<string, unknown>): string {
  const json = JSON.stringify(value)
  if (json === undefined) {
    throw new TypeError("benchmark fixture must serialize to JSON")
  }
  return json
}

function splitBytes(bytes: Uint8Array, chunkSizeBytes: number): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSizeBytes) {
    chunks.push(bytes.subarray(offset, offset + chunkSizeBytes))
  }
  return chunks
}

function assertRecord(
  value: unknown,
  fixture: FixtureName
): asserts value is Record<string, unknown> {
  if (!(typeof value === "object" && value !== null && !Array.isArray(value))) {
    throw new Error(`${fixture} emitted a non-object final snapshot`)
  }
}

function createLongStringFixture({
  chunkSizeBytes,
  targetBytes
}: {
  chunkSizeBytes: number
  targetBytes: number
}): BenchmarkFixture {
  const metadata = { active: true, id: 42, source: "benchmark" }
  const fixedJsonBytes = encoder.encode(serializeJson({ content: "", metadata })).byteLength
  const contentLength = Math.max(1, targetBytes - fixedJsonBytes)
  const expected = { content: "x".repeat(contentLength), metadata }
  const json = serializeJson(expected)
  const encodedJson = encoder.encode(json)

  return {
    assertFinal(value) {
      assertRecord(value, "long-string")
      if (!isDeepStrictEqual(value, expected)) {
        throw new Error("long-string emitted an incorrect final snapshot")
      }
    },
    chunks: splitBytes(encodedJson, chunkSizeBytes),
    encodedJson,
    expected,
    json,
    name: "long-string",
    schema: object({
      content: string(),
      metadata: object({ active: boolean(), id: number(), source: string() })
    })
  }
}

function createObjectRecord(id: number): Record<string, unknown> {
  return {
    active: id % 2 === 0,
    id,
    label: `record-${id.toString().padStart(8, "0")}`,
    metadata: { region: `region-${id % 8}`, tier: id % 4 },
    score: (id % 1000) / 10,
    tags: [`group-${id % 16}`, `bucket-${id % 32}`, "streaming"]
  }
}

function createObjectHeavyFixture({
  chunkSizeBytes,
  targetBytes
}: {
  chunkSizeBytes: number
  targetBytes: number
}): BenchmarkFixture {
  const sampleBytes = encoder.encode(serializeJson({ records: [createObjectRecord(1)] })).byteLength
  let recordCount = Math.max(1, Math.round(targetBytes / sampleBytes))
  let expected: { records: Record<string, unknown>[] } = { records: [] }
  let json = ""

  for (let attempt = 0; attempt < 3; attempt += 1) {
    expected = {
      records: Array.from({ length: recordCount }, (_, id) => createObjectRecord(id))
    }
    json = serializeJson(expected)
    const actualBytes = encoder.encode(json).byteLength
    const adjustedCount = Math.max(1, Math.round((recordCount * targetBytes) / actualBytes))
    if (adjustedCount === recordCount) {
      break
    }
    recordCount = adjustedCount
  }

  const encodedJson = encoder.encode(json)
  return {
    assertFinal(value) {
      assertRecord(value, "object-heavy")
      if (!isDeepStrictEqual(value, expected)) {
        throw new Error("object-heavy emitted an incorrect final snapshot")
      }
    },
    chunks: splitBytes(encodedJson, chunkSizeBytes),
    encodedJson,
    expected,
    json,
    name: "object-heavy",
    schema: object({
      records: array(
        object({
          active: boolean(),
          id: number(),
          label: string(),
          metadata: object({ region: string(), tier: number() }),
          score: number(),
          tags: array(string())
        })
      )
    })
  }
}

function createFixtures(options: BenchmarkOptions): BenchmarkFixture[] {
  const targetBytes = Math.round(options.payloadSizeMb * bytesPerMegabyte)
  const available: Record<FixtureName, () => BenchmarkFixture> = {
    "long-string": () =>
      createLongStringFixture({ chunkSizeBytes: options.chunkSizeBytes, targetBytes }),
    "object-heavy": () =>
      createObjectHeavyFixture({ chunkSizeBytes: options.chunkSizeBytes, targetBytes })
  }
  return options.fixtureNames.map(name => available[name]())
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function summarizeSamples(samplesMs: number[]): BenchmarkStats {
  return {
    maximumMs: Math.max(...samplesMs),
    medianMs: median(samplesMs),
    minimumMs: Math.min(...samplesMs),
    samplesMs
  }
}

async function measure<TValue>({
  assertValue,
  operation,
  repeats,
  signature,
  warmups
}: {
  assertValue: (value: TValue) => void
  operation: () => Promise<TValue> | TValue
  repeats: number
  signature: (value: TValue) => string
  warmups: number
}): Promise<MeasurementResult> {
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    const value = await operation()
    assertValue(value)
  }

  const samplesMs: number[] = []
  let expectedSignature: string | undefined
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const startedAt = performance.now()
    const value = await operation()
    const durationMs = performance.now() - startedAt
    assertValue(value)
    const actualSignature = signature(value)
    if (expectedSignature !== undefined && actualSignature !== expectedSignature) {
      throw new Error(`benchmark result changed between repeats: ${actualSignature}`)
    }
    expectedSignature = actualSignature
    samplesMs.push(durationMs)
  }

  if (expectedSignature === undefined) {
    throw new Error("benchmark did not collect a measured sample")
  }
  return {
    signature: expectedSignature,
    stats: summarizeSamples(samplesMs)
  }
}

/** Alternates two feature-aligned operations within every sample to reduce order and JIT bias. */
async function measurePair<TLeft, TRight>({
  left,
  repeats,
  right,
  startWithLeft,
  warmups
}: {
  left: MeasurementSpec<TLeft>
  repeats: number
  right: MeasurementSpec<TRight>
  startWithLeft: boolean
  warmups: number
}): Promise<{ left: MeasurementResult; right: MeasurementResult }> {
  const leftSamplesMs: number[] = []
  const rightSamplesMs: number[] = []
  let leftSignature: string | undefined
  let rightSignature: string | undefined

  const runLeft = async (record: boolean): Promise<void> => {
    const startedAt = performance.now()
    const value = await left.operation()
    const durationMs = performance.now() - startedAt
    left.assertValue(value)
    if (!record) {
      return
    }
    const signature = left.signature(value)
    if (leftSignature !== undefined && signature !== leftSignature) {
      throw new Error(`paired left benchmark result changed between repeats: ${signature}`)
    }
    leftSignature = signature
    leftSamplesMs.push(durationMs)
  }
  const runRight = async (record: boolean): Promise<void> => {
    const startedAt = performance.now()
    const value = await right.operation()
    const durationMs = performance.now() - startedAt
    right.assertValue(value)
    if (!record) {
      return
    }
    const signature = right.signature(value)
    if (rightSignature !== undefined && signature !== rightSignature) {
      throw new Error(`paired right benchmark result changed between repeats: ${signature}`)
    }
    rightSignature = signature
    rightSamplesMs.push(durationMs)
  }
  const runCycle = async (leftFirst: boolean, record: boolean): Promise<void> => {
    if (leftFirst) {
      await runLeft(record)
      await runRight(record)
      return
    }
    await runRight(record)
    await runLeft(record)
  }

  for (let warmup = 0; warmup < warmups; warmup += 1) {
    await runCycle(startWithLeft === (warmup % 2 === 0), false)
  }
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    await runCycle(startWithLeft === (repeat % 2 === 0), true)
  }

  if (leftSignature === undefined || rightSignature === undefined) {
    throw new Error("paired benchmark did not collect a measured sample")
  }
  return {
    left: { signature: leftSignature, stats: summarizeSamples(leftSamplesMs) },
    right: { signature: rightSignature, stats: summarizeSamples(rightSamplesMs) }
  }
}

function createSource(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      index += 1
      if (chunk === undefined) {
        controller.close()
        return
      }
      controller.enqueue(chunk)
    }
  })
}

function getRuntimeVersion(runtime: RuntimeName): string {
  return runtime === "bun" ? `Bun ${Bun.version}` : `Node ${process.version}`
}

/**
 * Measures native JSON and UTF-8 operations independently. Each timed sample processes at least
 * 16 MiB so sub-millisecond operations remain measurable; terminal output normalizes back to one
 * fixture operation.
 */
async function runMicroBenchmarks({
  fixture,
  options,
  runtime,
  runtimeVersion
}: {
  fixture: BenchmarkFixture
  options: BenchmarkOptions
  runtime: RuntimeName
  runtimeVersion: string
}): Promise<MicroBenchmarkRow[]> {
  const operationsPerSample = Math.max(
    1,
    Math.ceil(minimumMicroPhaseBytes / fixture.encodedJson.byteLength)
  )
  const processedBytes = fixture.encodedJson.byteLength * operationsPerSample
  const rows: MicroBenchmarkRow[] = []

  const stringify = await measure({
    assertValue(value: string) {
      if (value !== fixture.json) {
        throw new Error(`${fixture.name} JSON.stringify produced incorrect JSON`)
      }
    },
    operation() {
      let value = ""
      for (let operation = 0; operation < operationsPerSample; operation += 1) {
        value = serializeJson(fixture.expected)
      }
      return value
    },
    repeats: options.repeats,
    signature: value => String(value.length),
    warmups: options.warmups
  })
  rows.push({
    ...stringify.stats,
    fixture: fixture.name,
    inputBytes: fixture.encodedJson.byteLength,
    medianMsPerOperation: stringify.stats.medianMs / operationsPerSample,
    operationsPerSample,
    phase: "JSON.stringify",
    processedMbPerSecond: processedBytes / bytesPerMegabyte / (stringify.stats.medianMs / 1000),
    runtime,
    runtimeVersion
  })

  const encode = await measure({
    assertValue(value: Uint8Array) {
      if (value.byteLength !== fixture.encodedJson.byteLength) {
        throw new Error(`${fixture.name} TextEncoder produced an incorrect byte count`)
      }
    },
    operation() {
      let value = new Uint8Array()
      for (let operation = 0; operation < operationsPerSample; operation += 1) {
        value = encoder.encode(fixture.json)
      }
      return value
    },
    repeats: options.repeats,
    signature: value => String(value.byteLength),
    warmups: options.warmups
  })
  rows.push({
    ...encode.stats,
    fixture: fixture.name,
    inputBytes: fixture.encodedJson.byteLength,
    medianMsPerOperation: encode.stats.medianMs / operationsPerSample,
    operationsPerSample,
    phase: "TextEncoder.encode",
    processedMbPerSecond: processedBytes / bytesPerMegabyte / (encode.stats.medianMs / 1000),
    runtime,
    runtimeVersion
  })

  const bufferFrom = await measure({
    assertValue(value: Uint8Array) {
      if (value.byteLength !== fixture.encodedJson.byteLength) {
        throw new Error(`${fixture.name} Buffer.from produced an incorrect byte count`)
      }
    },
    operation() {
      let value = new Uint8Array()
      for (let operation = 0; operation < operationsPerSample; operation += 1) {
        value = Buffer.from(fixture.json)
      }
      return value
    },
    repeats: options.repeats,
    signature: value => String(value.byteLength),
    warmups: options.warmups
  })
  rows.push({
    ...bufferFrom.stats,
    fixture: fixture.name,
    inputBytes: fixture.encodedJson.byteLength,
    medianMsPerOperation: bufferFrom.stats.medianMs / operationsPerSample,
    operationsPerSample,
    phase: "Buffer.from (UTF-8)",
    processedMbPerSecond: processedBytes / bytesPerMegabyte / (bufferFrom.stats.medianMs / 1000),
    runtime,
    runtimeVersion
  })

  const decodeAndParse = await measure({
    assertValue: fixture.assertFinal,
    operation() {
      let value: unknown
      for (let operation = 0; operation < operationsPerSample; operation += 1) {
        value = JSON.parse(decoder.decode(fixture.encodedJson)) as unknown
      }
      return value
    },
    repeats: options.repeats,
    signature(value) {
      fixture.assertFinal(value)
      return fixture.name === "long-string"
        ? String((value as { content: string }).content.length)
        : String((value as { records: unknown[] }).records.length)
    },
    warmups: options.warmups
  })
  rows.push({
    ...decodeAndParse.stats,
    fixture: fixture.name,
    inputBytes: fixture.encodedJson.byteLength,
    medianMsPerOperation: decodeAndParse.stats.medianMs / operationsPerSample,
    operationsPerSample,
    phase: "TextDecoder + JSON.parse",
    processedMbPerSecond:
      processedBytes / bytesPerMegabyte / (decodeAndParse.stats.medianMs / 1000),
    runtime,
    runtimeVersion
  })

  return rows
}

/**
 * Compares byte snapshots, serialized object materialization, and direct object snapshots while
 * holding the parser, fixture, chunking, and snapshot cadence constant. The round-trip row is the
 * feature-aligned baseline used for direct-iteration speedups.
 */
async function runStreamingBenchmarks({
  SchemaStream,
  fixture,
  options,
  runtime,
  runtimeVersion
}: {
  SchemaStream: typeof import("@/index").SchemaStream
  fixture: BenchmarkFixture
  options: BenchmarkOptions
  runtime: RuntimeName
  runtimeVersion: string
}): Promise<StreamBenchmarkRow[]> {
  const rows: StreamBenchmarkRow[] = []

  for (const [policyIndex, policyName] of options.policyNames.entries()) {
    const policy = policyDefinitions[policyName]
    const parse = await measure({
      assertValue(result: ParseResult) {
        fixture.assertFinal(JSON.parse(decoder.decode(result.finalSnapshot)) as unknown)
      },
      async operation(): Promise<ParseResult> {
        const parser = new SchemaStream(fixture.schema)
        const output = createSource(fixture.chunks).pipeThrough(
          parser.parse({ snapshotPolicy: policy.snapshotPolicy })
        )
        let emittedBytes = 0
        let parseSnapshots = 0
        let finalSnapshot: Uint8Array | undefined
        for await (const snapshot of output) {
          emittedBytes += snapshot.byteLength
          parseSnapshots += 1
          finalSnapshot = snapshot
        }
        if (finalSnapshot === undefined) {
          throw new Error(`${fixture.name}/${policy.name}/parse did not emit a final snapshot`)
        }
        return { emittedBytes, emittedSnapshots: parseSnapshots, finalSnapshot }
      },
      repeats: options.repeats,
      signature: result => `${result.emittedSnapshots}:${result.emittedBytes}`,
      warmups: options.warmups
    })
    const [emittedSnapshotsText, emittedBytesText] = parse.signature.split(":")
    const emittedSnapshots = Number(emittedSnapshotsText)
    const emittedBytes = Number(emittedBytesText)

    const { left: roundTrip, right: iterate } = await measurePair<RoundTripResult, IterateResult>({
      left: {
        assertValue(result) {
          fixture.assertFinal(result.finalSnapshot)
          if (
            result.emittedSnapshots !== emittedSnapshots ||
            result.emittedBytes !== emittedBytes
          ) {
            throw new Error(
              `${fixture.name}/${policy.name}/roundtrip did not match parse emissions`
            )
          }
        },
        async operation(): Promise<RoundTripResult> {
          const parser = new SchemaStream(fixture.schema)
          const output = createSource(fixture.chunks).pipeThrough(
            parser.parse({ snapshotPolicy: policy.snapshotPolicy })
          )
          let roundTripBytes = 0
          let roundTripSnapshots = 0
          let finalSnapshot: unknown
          for await (const snapshot of output) {
            roundTripBytes += snapshot.byteLength
            roundTripSnapshots += 1
            finalSnapshot = JSON.parse(decoder.decode(snapshot)) as unknown
          }
          if (finalSnapshot === undefined) {
            throw new Error(
              `${fixture.name}/${policy.name}/roundtrip did not emit a final snapshot`
            )
          }
          return {
            emittedBytes: roundTripBytes,
            emittedSnapshots: roundTripSnapshots,
            finalSnapshot
          }
        },
        signature: result => `${result.emittedSnapshots}:${result.emittedBytes}`
      },
      repeats: options.repeats,
      right: {
        assertValue(result) {
          fixture.assertFinal(result.finalSnapshot)
          if (result.emittedSnapshots !== emittedSnapshots) {
            throw new Error(
              `${fixture.name}/${policy.name}/iterate emitted ${result.emittedSnapshots} snapshots; ` +
                `parse emitted ${emittedSnapshots}`
            )
          }
        },
        async operation(): Promise<IterateResult> {
          const parser = new SchemaStream(fixture.schema)
          let iterateSnapshots = 0
          let finalSnapshot: unknown
          for await (const snapshot of parser.iterate(createSource(fixture.chunks), {
            snapshotPolicy: policy.snapshotPolicy
          })) {
            iterateSnapshots += 1
            finalSnapshot = snapshot
          }
          if (finalSnapshot === undefined) {
            throw new Error(`${fixture.name}/${policy.name}/iterate did not emit a final snapshot`)
          }
          return { emittedSnapshots: iterateSnapshots, finalSnapshot }
        },
        signature: result => String(result.emittedSnapshots)
      },
      startWithLeft: policyIndex % 2 === 0,
      warmups: options.warmups
    })

    rows.push({
      ...parse.stats,
      actualEmittedBytes: emittedBytes,
      emittedSnapshots,
      equivalentSerializedBytes: emittedBytes,
      equivalentSerializationAmplification: emittedBytes / fixture.encodedJson.byteLength,
      fixture: fixture.name,
      inputBytes: fixture.encodedJson.byteLength,
      materialization: "serialized-utf8",
      phase: "parse",
      policy: policy.name,
      runtime,
      runtimeVersion,
      serializationAvoidedBytes: 0,
      sourceMbPerSecond:
        fixture.encodedJson.byteLength / bytesPerMegabyte / (parse.stats.medianMs / 1000),
      speedupVsRoundTrip: roundTrip.stats.medianMs / parse.stats.medianMs
    })
    rows.push({
      ...roundTrip.stats,
      actualEmittedBytes: emittedBytes,
      emittedSnapshots,
      equivalentSerializedBytes: emittedBytes,
      equivalentSerializationAmplification: emittedBytes / fixture.encodedJson.byteLength,
      fixture: fixture.name,
      inputBytes: fixture.encodedJson.byteLength,
      materialization: "json-roundtrip",
      phase: "roundtrip",
      policy: policy.name,
      runtime,
      runtimeVersion,
      serializationAvoidedBytes: 0,
      sourceMbPerSecond:
        fixture.encodedJson.byteLength / bytesPerMegabyte / (roundTrip.stats.medianMs / 1000),
      speedupVsRoundTrip: 1
    })

    rows.push({
      ...iterate.stats,
      actualEmittedBytes: 0,
      emittedSnapshots,
      equivalentSerializedBytes: emittedBytes,
      equivalentSerializationAmplification: emittedBytes / fixture.encodedJson.byteLength,
      fixture: fixture.name,
      inputBytes: fixture.encodedJson.byteLength,
      materialization: options.iterateMaterialization,
      phase: "iterate",
      policy: policy.name,
      runtime,
      runtimeVersion,
      serializationAvoidedBytes:
        options.iterateMaterialization === "direct-json-domain" ? emittedBytes : 0,
      sourceMbPerSecond:
        fixture.encodedJson.byteLength / bytesPerMegabyte / (iterate.stats.medianMs / 1000),
      speedupVsRoundTrip: roundTrip.stats.medianMs / iterate.stats.medianMs
    })
  }

  return rows
}

function createCompletionBenchmarkParser({
  SchemaStream,
  callback,
  schema,
  state
}: {
  SchemaStream: typeof import("@/index").SchemaStream
  callback: CompletionCallbackName
  schema: ZodObjectSchema
  state: CompletionCallbackState
}) {
  if (callback === "onValueComplete") {
    return new SchemaStream(schema, {
      onValueComplete({ path }) {
        state.callbackEvents += 1
        state.checksum += path.length
      }
    })
  }
  if (callback === "onKeyComplete") {
    return new SchemaStream(schema, {
      onKeyComplete({ activePath, completedPaths }) {
        state.callbackEvents += 1
        state.checksum += activePath.length + completedPaths.length
      }
    })
  }
  return new SchemaStream(schema)
}

/**
 * Isolates completion-callback bookkeeping with one final snapshot per document. Doubling record
 * counts makes cumulative-history copying visible without adding that cost to the default suite.
 */
async function runCompletionScalingBenchmarks({
  SchemaStream,
  options,
  runtime,
  runtimeVersion
}: {
  SchemaStream: typeof import("@/index").SchemaStream
  options: BenchmarkOptions
  runtime: RuntimeName
  runtimeVersion: string
}): Promise<CompletionScalingRow[]> {
  const schema = object({ records: array(object({ id: number(), score: number() })) })
  const callbacks: CompletionCallbackName[] = ["none", "onValueComplete", "onKeyComplete"]
  const rows: CompletionScalingRow[] = []

  for (const recordCount of completionScalingRecordCounts) {
    const value = {
      records: Array.from({ length: recordCount }, (_, id) => ({ id, score: id % 100 }))
    }
    const encodedJson = encoder.encode(serializeJson(value))

    for (const callback of callbacks) {
      const measured = await measure({
        assertValue(result: CompletionScalingResult) {
          if (result.finalRecordCount !== recordCount) {
            throw new Error(`${callback}/${recordCount} emitted an incorrect final record count`)
          }
          let expectedEvents = 0
          if (callback === "onValueComplete") {
            expectedEvents = recordCount * 3 + 2
          } else if (callback === "onKeyComplete") {
            expectedEvents = recordCount * 2 + 1
          }
          if (result.callbackEvents !== expectedEvents) {
            throw new Error(
              `${callback}/${recordCount} emitted ${result.callbackEvents} callbacks; ` +
                `expected ${expectedEvents}`
            )
          }
        },
        async operation(): Promise<CompletionScalingResult> {
          const state: CompletionCallbackState = { callbackEvents: 0, checksum: 0 }
          const parser = createCompletionBenchmarkParser({
            SchemaStream,
            callback,
            schema,
            state
          })
          let finalSnapshot: unknown
          for await (const snapshot of parser.iterate(createSource([encodedJson]), {
            snapshotPolicy: { mode: "final" }
          })) {
            finalSnapshot = snapshot
          }
          if (!(typeof finalSnapshot === "object" && finalSnapshot !== null)) {
            throw new Error(`${callback}/${recordCount} did not emit a final object snapshot`)
          }
          const { records } = finalSnapshot as { records?: unknown }
          return {
            callbackEvents: state.callbackEvents,
            checksum: state.checksum,
            finalRecordCount: Array.isArray(records) ? records.length : -1
          }
        },
        repeats: options.repeats,
        signature: result =>
          `${result.finalRecordCount}:${result.callbackEvents}:${result.checksum}`,
        warmups: options.warmups
      })
      const [, callbackEventsText] = measured.signature.split(":")
      rows.push({
        ...measured.stats,
        callback,
        callbackEvents: Number(callbackEventsText),
        inputBytes: encodedJson.byteLength,
        recordCount,
        recordsPerSecond: recordCount / (measured.stats.medianMs / 1000),
        runtime,
        runtimeVersion
      })
    }
  }

  return rows
}

async function runWorker(options: BenchmarkOptions): Promise<WorkerOutput> {
  const runtime = options.workerRuntime
  if (runtime === undefined) {
    throw new TypeError("worker runtime is required")
  }
  const actualRuntime: RuntimeName = typeof Bun === "undefined" ? "node" : "bun"
  if (runtime !== actualRuntime) {
    throw new Error(`expected ${runtime} worker, running under ${actualRuntime}`)
  }

  const distModuleUrl = pathToFileURL(options.modulePath).href
  const { SchemaStream } = (await import(distModuleUrl)) as typeof import("@/index")
  const runtimeVersion = getRuntimeVersion(runtime)
  if (options.completionScaling) {
    return {
      completionScaling: await runCompletionScalingBenchmarks({
        SchemaStream,
        options,
        runtime,
        runtimeVersion
      }),
      micro: [],
      runtime,
      runtimeVersion,
      streaming: []
    }
  }
  const fixtures = createFixtures(options)
  const micro: MicroBenchmarkRow[] = []
  const streaming: StreamBenchmarkRow[] = []

  for (const fixture of fixtures) {
    micro.push(...(await runMicroBenchmarks({ fixture, options, runtime, runtimeVersion })))
    streaming.push(
      ...(await runStreamingBenchmarks({
        SchemaStream,
        fixture,
        options,
        runtime,
        runtimeVersion
      }))
    )
  }

  return { completionScaling: [], micro, runtime, runtimeVersion, streaming }
}

/**
 * Runs each runtime in a fresh process so Bun and Node execute the same built module in isolation.
 */
async function spawnWorker({
  options,
  runtime
}: {
  options: BenchmarkOptions
  runtime: RuntimeName
}): Promise<WorkerOutput> {
  const executable =
    runtime === "bun" ? (process.env.BUN_BINARY ?? "bun") : (process.env.NODE_BINARY ?? "node")
  const benchmarkPath = fileURLToPath(import.meta.url)
  const args = [
    benchmarkPath,
    "--worker",
    "--runtime",
    runtime,
    "--size-mb",
    String(options.payloadSizeMb),
    "--chunk-kb",
    String(options.chunkSizeBytes / 1024),
    "--warmups",
    String(options.warmups),
    "--repeats",
    String(options.repeats),
    "--fixtures",
    options.fixtureNames.join(","),
    "--iterate-materialization",
    options.iterateMaterialization,
    "--module",
    options.modulePath,
    "--policies",
    options.policyNames.join(","),
    "--json"
  ]
  if (options.completionScaling) {
    args.push("--completion-scaling")
  }

  const result = await executeFile({ args, executable })
  if (result.error) {
    throw new Error(`${runtime} benchmark failed:\n${result.stderr}`, { cause: result.error })
  }
  try {
    return JSON.parse(result.stdout) as WorkerOutput
  } catch (error) {
    throw new Error(
      `${runtime} benchmark returned invalid JSON:\n${result.stdout}\n${result.stderr}`,
      { cause: error }
    )
  }
}

function formatMebibytes(bytes: number): string {
  return (bytes / bytesPerMegabyte).toFixed(2)
}

function formatMilliseconds(milliseconds: number): string {
  const magnitude = Math.abs(milliseconds)
  if (magnitude < 0.01) {
    return milliseconds.toFixed(4)
  }
  if (magnitude < 1) {
    return milliseconds.toFixed(3)
  }
  return milliseconds.toFixed(2)
}

function getStreamRow({
  phase,
  policy,
  rows
}: {
  phase: StreamPhase
  policy: PolicyName
  rows: StreamBenchmarkRow[]
}): StreamBenchmarkRow {
  const row = rows.find(candidate => candidate.phase === phase && candidate.policy === policy)
  if (row === undefined) {
    throw new Error(`missing ${policy}/${phase} benchmark result`)
  }
  return row
}

function printNativeReference(output: BenchmarkOutput): void {
  console.log("\nNative JSON reference (isolated costs; not feature-equivalent parsers)")
  for (const runtime of output.configuration.runtimes) {
    const rows = output.micro.filter(row => row.runtime === runtime)
    const runtimeVersion = rows[0]?.runtimeVersion ?? runtime
    console.log(`\n${runtimeVersion}`)
    console.table(
      rows.map(row => ({
        fixture: row.fixture,
        operation: row.phase,
        "median ms/op": formatMilliseconds(row.medianMsPerOperation),
        "MiB/s": row.processedMbPerSecond.toFixed(2)
      }))
    )
  }
}

function printStreamingSummary(output: BenchmarkOutput): void {
  console.log("\nStreaming object snapshots")
  console.log("baseline   parse() [JSON.stringify + UTF-8 encode] -> decode -> JSON.parse")
  console.log("candidate  iterate() -> direct independent object snapshot")
  console.log("speedup    serialized baseline / direct candidate (same parser, fixture, policy)")
  console.log("            not a standalone JSON.parse or JSON.stringify comparison")

  for (const runtime of output.configuration.runtimes) {
    for (const fixture of output.configuration.fixtures) {
      const rows = output.streaming.filter(
        row => row.runtime === runtime && row.fixture === fixture
      )
      if (rows.length === 0) {
        continue
      }

      const runtimeVersion = rows[0]?.runtimeVersion ?? runtime
      console.log(
        `\n${runtimeVersion} / ${fixture} / ${formatMebibytes(rows[0]?.inputBytes ?? 0)} MiB ` +
          `(iterate: ${output.configuration.iterateMaterialization})`
      )
      console.table(
        output.configuration.policies.map(policy => {
          const parse = getStreamRow({ phase: "parse", policy, rows })
          const roundTrip = getStreamRow({ phase: "roundtrip", policy, rows })
          const iterate = getStreamRow({ phase: "iterate", policy, rows })
          return {
            policy,
            snapshots: iterate.emittedSnapshots,
            "parse ms": formatMilliseconds(parse.medianMs),
            "serialized ms": formatMilliseconds(roundTrip.medianMs),
            "direct ms": formatMilliseconds(iterate.medianMs),
            "direct speedup": `${iterate.speedupVsRoundTrip.toFixed(2)}x`,
            "serialized MiB": formatMebibytes(roundTrip.actualEmittedBytes),
            "avoided MiB": formatMebibytes(iterate.serializationAvoidedBytes)
          }
        })
      )
    }
  }
}

function printVerboseEvidence(output: BenchmarkOutput): void {
  console.log("\nVerbose configuration")
  console.log({
    chunkKiB: output.configuration.chunkSizeBytes / 1024,
    fixtures: output.configuration.fixtures.join(", "),
    iterateMaterialization: output.configuration.iterateMaterialization,
    modulePath: output.configuration.modulePath,
    payloadMiBPerFixture: output.configuration.payloadSizeMb,
    policies: output.configuration.policies.join(", "),
    repeats: output.configuration.repeats,
    runtimes: output.configuration.runtimes.join(", "),
    warmups: output.configuration.warmups
  })

  console.log("\nNative JSON sample ranges")
  console.table(
    output.micro.map(row => ({
      runtime: row.runtimeVersion,
      fixture: row.fixture,
      operation: row.phase,
      "ops/sample": row.operationsPerSample,
      "min ms/sample": formatMilliseconds(row.minimumMs),
      "median ms/sample": formatMilliseconds(row.medianMs),
      "max ms/sample": formatMilliseconds(row.maximumMs),
      "median ms/op": formatMilliseconds(row.medianMsPerOperation)
    }))
  )

  console.log("\nStreaming timing ranges")
  console.table(
    output.streaming.map(row => ({
      runtime: row.runtimeVersion,
      fixture: row.fixture,
      policy: row.policy,
      API: row.phase,
      materialization: row.materialization,
      "min ms": formatMilliseconds(row.minimumMs),
      "median ms": formatMilliseconds(row.medianMs),
      "max ms": formatMilliseconds(row.maximumMs),
      "MiB/s": row.sourceMbPerSecond.toFixed(2),
      "vs roundtrip": `${row.speedupVsRoundTrip.toFixed(2)}x`
    }))
  )

  console.log("\nStreaming emission details")
  console.table(
    output.streaming
      .filter(row => row.phase === "iterate")
      .map(row => ({
        runtime: row.runtimeVersion,
        fixture: row.fixture,
        policy: row.policy,
        snapshots: row.emittedSnapshots,
        "serialized MiB": formatMebibytes(row.equivalentSerializedBytes),
        amplification: `${row.equivalentSerializationAmplification.toFixed(2)}x`,
        "avoided MiB": formatMebibytes(row.serializationAvoidedBytes)
      }))
  )
}

function getCompletionRow({
  callback,
  recordCount,
  rows
}: {
  callback: CompletionCallbackName
  recordCount: number
  rows: CompletionScalingRow[]
}): CompletionScalingRow {
  const row = rows.find(
    candidate => candidate.callback === callback && candidate.recordCount === recordCount
  )
  if (row === undefined) {
    throw new Error(`missing ${callback}/${recordCount} completion benchmark result`)
  }
  return row
}

function printCompletionScaling(output: BenchmarkOutput, verbose: boolean): void {
  console.log("schema-stream completion callback scaling")
  console.log(
    `one final snapshot | ${output.configuration.warmups} warmup(s) | ` +
      `median of ${output.configuration.repeats}`
  )
  console.log("growth compares each row with the preceding doubled record count")

  for (const runtime of output.configuration.runtimes) {
    const rows = output.completionScaling.filter(row => row.runtime === runtime)
    const runtimeVersion = rows[0]?.runtimeVersion ?? runtime
    let previousValueComplete: CompletionScalingRow | undefined
    let previousKeyComplete: CompletionScalingRow | undefined
    console.log(`\n${runtimeVersion}`)
    console.table(
      completionScalingRecordCounts.map(recordCount => {
        const none = getCompletionRow({ callback: "none", recordCount, rows })
        const valueComplete = getCompletionRow({
          callback: "onValueComplete",
          recordCount,
          rows
        })
        const keyComplete = getCompletionRow({
          callback: "onKeyComplete",
          recordCount,
          rows
        })
        const valueGrowth = previousValueComplete
          ? `${(valueComplete.medianMs / previousValueComplete.medianMs).toFixed(2)}x`
          : "-"
        const keyGrowth = previousKeyComplete
          ? `${(keyComplete.medianMs / previousKeyComplete.medianMs).toFixed(2)}x`
          : "-"
        previousValueComplete = valueComplete
        previousKeyComplete = keyComplete
        return {
          records: recordCount,
          "none ms": formatMilliseconds(none.medianMs),
          "complete ms": formatMilliseconds(valueComplete.medianMs),
          "complete delta": valueGrowth,
          "legacy ms": formatMilliseconds(keyComplete.medianMs),
          "legacy delta": keyGrowth,
          "legacy/none": `${(keyComplete.medianMs / none.medianMs).toFixed(2)}x`
        }
      })
    )
  }

  if (!verbose) {
    return
  }

  console.log("\nCompletion callback evidence")
  console.table(
    output.completionScaling.map(row => ({
      runtime: row.runtimeVersion,
      records: row.recordCount,
      callback: row.callback,
      events: row.callbackEvents,
      "input KiB": (row.inputBytes / 1024).toFixed(2),
      "min ms": formatMilliseconds(row.minimumMs),
      "median ms": formatMilliseconds(row.medianMs),
      "max ms": formatMilliseconds(row.maximumMs),
      "records/s": row.recordsPerSecond.toFixed(2)
    }))
  )
}

function printResults(output: BenchmarkOutput, verbose: boolean): void {
  if (output.configuration.completionScaling) {
    printCompletionScaling(output, verbose)
    return
  }

  console.log("schema-stream benchmark")
  console.log(
    `${output.configuration.payloadSizeMb} MiB/fixture target | ` +
      `${output.configuration.chunkSizeBytes / 1024} KiB chunks | ` +
      `${output.configuration.warmups} warmup(s) | median of ${output.configuration.repeats}`
  )
  printNativeReference(output)
  printStreamingSummary(output)
  if (verbose) {
    printVerboseEvidence(output)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    console.log(helpText)
    return
  }

  const options = parseArguments(args)
  if (options.worker) {
    console.log(JSON.stringify(await runWorker(options)))
    return
  }

  await buildDefaultModule(options)

  const workers: WorkerOutput[] = []
  for (const runtime of options.runtimeNames) {
    workers.push(await spawnWorker({ options, runtime }))
  }
  const output: BenchmarkOutput = {
    configuration: {
      chunkSizeBytes: options.chunkSizeBytes,
      completionScaling: options.completionScaling,
      fixtures: options.fixtureNames,
      iterateMaterialization: options.iterateMaterialization,
      modulePath: options.modulePath,
      payloadSizeMb: options.payloadSizeMb,
      policies: options.policyNames,
      repeats: options.repeats,
      runtimes: options.runtimeNames,
      warmups: options.warmups
    },
    completionScaling: workers.flatMap(worker => worker.completionScaling),
    micro: workers.flatMap(worker => worker.micro),
    streaming: workers.flatMap(worker => worker.streaming)
  }

  if (options.json) {
    console.log(JSON.stringify(output, null, 2))
    return
  }
  printResults(output, options.verbose)
}

await main()
