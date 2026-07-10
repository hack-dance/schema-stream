import { SchemaStream, type SnapshotPolicy } from "@/index"
import * as z from "zod"

interface BenchmarkResult {
  durationSeconds: string
  emittedMb: string
  emittedSnapshots: number
  mode: string
  throughputMbPerSecond: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const networkChunkSize = 64 * 1024
const payloadSizeMb = Number(Bun.argv[2] ?? 10)
const selectedMode = Bun.argv[3]

if (!Number.isFinite(payloadSizeMb) || payloadSizeMb <= 0) {
  throw new TypeError("Payload size must be a positive number of megabytes")
}

const schema = z.object({
  content: z.string(),
  records: z.array(z.object({ active: z.boolean(), id: z.number() }))
})
const expected = {
  content: "x".repeat(payloadSizeMb * 1024 * 1024),
  records: Array.from({ length: 10_000 }, (_, id) => ({ active: id % 2 === 0, id }))
}
const encodedJson = encoder.encode(JSON.stringify(expected))
const policies: Array<{ mode: string; snapshotPolicy: SnapshotPolicy }> = [
  { mode: "chunk", snapshotPolicy: { mode: "chunk" } },
  { mode: "value", snapshotPolicy: { mode: "value" } },
  { mode: "bytes-256kb", snapshotPolicy: { bytes: 256 * 1024, mode: "bytes" } },
  { mode: "bytes-1mb", snapshotPolicy: { bytes: 1024 * 1024, mode: "bytes" } },
  { mode: "final", snapshotPolicy: { mode: "final" } }
]

async function runPolicy({
  mode,
  snapshotPolicy
}: {
  mode: string
  snapshotPolicy: SnapshotPolicy
}): Promise<BenchmarkResult> {
  const parser = new SchemaStream(schema)
  const transform = parser.parse({ snapshotPolicy })
  const writer = transform.writable.getWriter()
  const reader = transform.readable.getReader()
  const startedAt = performance.now()
  let emittedBytes = 0
  let emittedSnapshots = 0
  let finalSnapshot: Uint8Array | undefined
  const readPromise = (async () => {
    while (true) {
      const output = await reader.read()
      if (output.done) return
      emittedBytes += output.value.byteLength
      emittedSnapshots += 1
      finalSnapshot = output.value
    }
  })()

  for (let offset = 0; offset < encodedJson.length; offset += networkChunkSize) {
    await writer.write(encodedJson.slice(offset, offset + networkChunkSize))
  }
  await writer.close()
  await readPromise

  if (!finalSnapshot) {
    throw new Error(`${mode} did not emit a final snapshot`)
  }
  const actual = JSON.parse(decoder.decode(finalSnapshot))
  if (actual.content !== expected.content || actual.records.length !== expected.records.length) {
    throw new Error(`${mode} emitted an incorrect final snapshot`)
  }

  const durationSeconds = (performance.now() - startedAt) / 1000
  return {
    durationSeconds: durationSeconds.toFixed(3),
    emittedMb: (emittedBytes / 1024 / 1024).toFixed(2),
    emittedSnapshots,
    mode,
    throughputMbPerSecond: (encodedJson.byteLength / 1024 / 1024 / durationSeconds).toFixed(2)
  }
}

if (selectedMode) {
  const policy = policies.find(({ mode }) => mode === selectedMode)
  if (!policy) {
    throw new TypeError(`Unknown snapshot policy benchmark: ${selectedMode}`)
  }
  console.log(JSON.stringify(await runPolicy(policy)))
} else {
  const results: BenchmarkResult[] = []
  for (const policy of policies) {
    const process = Bun.spawn(
      [Bun.argv[0] as string, import.meta.path, String(payloadSizeMb), policy.mode],
      { stderr: "inherit", stdout: "pipe" }
    )
    const output = await new Response(process.stdout).text()
    const exitCode = await process.exited
    if (exitCode !== 0) {
      throw new Error(`${policy.mode} benchmark exited with code ${exitCode}`)
    }
    results.push(JSON.parse(output) as BenchmarkResult)
  }

  console.log({
    networkChunkKb: networkChunkSize / 1024,
    payloadMb: (encodedJson.byteLength / 1024 / 1024).toFixed(2)
  })
  console.table(results)
}
