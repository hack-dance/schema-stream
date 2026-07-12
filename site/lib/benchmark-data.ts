import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { REPOSITORY_ROOT } from "@/lib/repository"

const benchmarkRowSchema = z.object({
  avoidedSerializedBytes: z.number(),
  fixture: z.string(),
  iterateMedianMs: z.number(),
  policy: z.string(),
  roundtripMedianMs: z.number(),
  runtime: z.string(),
  speedup: z.number()
})

const benchmarkSchema = z.object({
  capturedAt: z.string(),
  configuration: z.object({
    chunkSizeBytes: z.number(),
    payloadSizeMiB: z.number(),
    repeats: z.number(),
    runtimes: z.array(z.string()),
    warmups: z.number()
  }),
  host: z.object({
    architecture: z.string(),
    chip: z.string(),
    operatingSystem: z.string()
  }),
  method: z.object({
    baseline: z.string(),
    candidate: z.string(),
    resultValidation: z.string(),
    sampleOrdering: z.string(),
    speedup: z.string()
  }),
  representativeRows: z.array(benchmarkRowSchema)
})

export type BenchmarkData = z.infer<typeof benchmarkSchema>
export type BenchmarkRow = z.infer<typeof benchmarkRowSchema>

/** Reads the newest committed benchmark artifact without rerunning noisy timing work at build time. */
export async function loadLatestBenchmark(): Promise<BenchmarkData> {
  const directory = join(REPOSITORY_ROOT, "docs", "benchmarks")
  const files = (await readdir(directory))
    .filter(file => file.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left))
  const [latest] = files

  if (!latest) {
    throw new Error("No committed benchmark artifact was found")
  }

  const contents = await readFile(join(directory, latest), "utf8")
  return benchmarkSchema.parse(JSON.parse(contents))
}
