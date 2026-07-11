import { isDeepStrictEqual } from "node:util"
import { z } from "zod"

import { SchemaStream, type SchemaStreamChunk } from "../src"

const schema = z.object({
  title: z.string(),
  summary: z.string(),
  details: z.object({ score: z.number(), note: z.string().nullable() }),
  tags: z.array(z.string()),
  metrics: z.record(z.string(), z.number())
})
const expected: z.output<typeof schema> = {
  title: "Progressive JSON",
  summary: 'Unicode 🌊 日本語, quotes "like this", and newlines\narrive incrementally.',
  details: { note: null, score: 0.98 },
  tags: ["streaming", "typed"],
  metrics: { chunks: 9, records: 2 }
}

function splitJson(json: string, targetChunks = 9): string[] {
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

const source = new ReadableStream<string>({
  start(controller) {
    for (const chunk of splitJson(JSON.stringify(expected))) {
      controller.enqueue(chunk)
    }
    controller.close()
  }
})

type PublicationDecision = "publish" | "review"

/**
 * Completion events expose syntactically finished values before later fields arrive. This score
 * gate can therefore choose the publication route without inspecting a partial number or waiting
 * for the complete document.
 */
let publicationDecision: PublicationDecision | undefined
let decisionPrecededMetrics = false
let decisionPrecededRoot = false
let metricsRecordsCompleted = false
let rootCompleted = false
const parser = new SchemaStream(schema, {
  onValueComplete({ path, value }) {
    const isScore = path.length === 2 && path[0] === "details" && path[1] === "score"
    const isMetricsRecords = path.length === 2 && path[0] === "metrics" && path[1] === "records"

    if (isScore) {
      if (typeof value !== "number") {
        throw new TypeError("The completed score must be a number")
      }
      publicationDecision = value >= 0.95 ? "publish" : "review"
      decisionPrecededMetrics = !metricsRecordsCompleted
      decisionPrecededRoot = !rootCompleted
    }
    if (isMetricsRecords) {
      metricsRecordsCompleted = true
    }
    if (path.length === 0) {
      rootCompleted = true
    }
  }
})

let finalSnapshot: SchemaStreamChunk<typeof schema> | undefined
let snapshotCount = 0
for await (const snapshot of parser.iterate(source)) {
  finalSnapshot = snapshot
  snapshotCount += 1
  process.stdout.write(`snapshot ${snapshotCount}: ${JSON.stringify(snapshot)}\n`)
}

if (!isDeepStrictEqual(finalSnapshot, expected)) {
  throw new Error("Progressive example did not reconstruct the expected value")
}
if (
  publicationDecision !== "publish" ||
  !decisionPrecededMetrics ||
  !decisionPrecededRoot ||
  !rootCompleted
) {
  throw new Error("Progressive example did not make its score decision before later JSON arrived")
}

process.stdout.write(
  `decision: ${publicationDecision} (before metrics.records and root completion)\n`
)
