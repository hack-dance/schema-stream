import { basename, join } from "node:path"
import { benchmarkOutputPath, type GeneratedDocument, repositoryRoot } from "./config"

type BenchmarkRow = {
  avoidedSerializedBytes: number
  fixture: string
  iterateMedianMs: number
  policy: string
  roundtripMedianMs: number
  runtime: string
  speedup: number
}

type BenchmarkEvidence = {
  capturedAt: string
  configuration: {
    chunkSizeBytes: number
    fixtures: string[]
    payloadSizeMiB: number
    policies: string[]
    repeats: number
    runtimes: string[]
    warmups: number
  }
  host: {
    architecture: string
    chip: string
    operatingSystem: string
  }
  method: {
    baseline: string
    candidate: string
    resultValidation: string
    sampleOrdering: string
    speedup: string
  }
  representativeRows: BenchmarkRow[]
}

type EvidenceFile = {
  evidence: BenchmarkEvidence
  path: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`Benchmark evidence field "${field}" must be an object`)
  }
  return value
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Benchmark evidence field "${field}" must be a non-empty string`)
  }
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Benchmark evidence field "${field}" must be a finite number`)
  }
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Benchmark evidence field "${field}" must be an array`)
  }
  return value.map((entry, index) => requireString(entry, `${field}[${index}]`))
}

/**
 * Narrows machine-readable benchmark evidence before any values are rendered into documentation.
 * This intentionally validates the summary contract instead of accepting arbitrary JSON casts.
 */
function parseBenchmarkEvidence(value: unknown): BenchmarkEvidence {
  const root = requireRecord(value, "root")
  const configuration = requireRecord(root.configuration, "configuration")
  const host = requireRecord(root.host, "host")
  const method = requireRecord(root.method, "method")

  if (!Array.isArray(root.representativeRows) || root.representativeRows.length === 0) {
    throw new TypeError('Benchmark evidence field "representativeRows" must be a non-empty array')
  }

  const capturedAt = requireString(root.capturedAt, "capturedAt")
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new TypeError('Benchmark evidence field "capturedAt" must be an ISO date')
  }

  const representativeRows = root.representativeRows.map((valueRow, index): BenchmarkRow => {
    const row = requireRecord(valueRow, `representativeRows[${index}]`)
    return {
      avoidedSerializedBytes: requireNumber(
        row.avoidedSerializedBytes,
        `representativeRows[${index}].avoidedSerializedBytes`
      ),
      fixture: requireString(row.fixture, `representativeRows[${index}].fixture`),
      iterateMedianMs: requireNumber(
        row.iterateMedianMs,
        `representativeRows[${index}].iterateMedianMs`
      ),
      policy: requireString(row.policy, `representativeRows[${index}].policy`),
      roundtripMedianMs: requireNumber(
        row.roundtripMedianMs,
        `representativeRows[${index}].roundtripMedianMs`
      ),
      runtime: requireString(row.runtime, `representativeRows[${index}].runtime`),
      speedup: requireNumber(row.speedup, `representativeRows[${index}].speedup`)
    }
  })

  return {
    capturedAt,
    configuration: {
      chunkSizeBytes: requireNumber(configuration.chunkSizeBytes, "configuration.chunkSizeBytes"),
      fixtures: requireStringArray(configuration.fixtures, "configuration.fixtures"),
      payloadSizeMiB: requireNumber(configuration.payloadSizeMiB, "configuration.payloadSizeMiB"),
      policies: requireStringArray(configuration.policies, "configuration.policies"),
      repeats: requireNumber(configuration.repeats, "configuration.repeats"),
      runtimes: requireStringArray(configuration.runtimes, "configuration.runtimes"),
      warmups: requireNumber(configuration.warmups, "configuration.warmups")
    },
    host: {
      architecture: requireString(host.architecture, "host.architecture"),
      chip: requireString(host.chip, "host.chip"),
      operatingSystem: requireString(host.operatingSystem, "host.operatingSystem")
    },
    method: {
      baseline: requireString(method.baseline, "method.baseline"),
      candidate: requireString(method.candidate, "method.candidate"),
      resultValidation: requireString(method.resultValidation, "method.resultValidation"),
      sampleOrdering: requireString(method.sampleOrdering, "method.sampleOrdering"),
      speedup: requireString(method.speedup, "method.speedup")
    },
    representativeRows
  }
}

async function readEvidenceFiles(): Promise<EvidenceFile[]> {
  const benchmarkDirectory = join(repositoryRoot, "docs/benchmarks")
  const glob = new Bun.Glob("*.json")
  const paths = [
    ...glob.scanSync({ absolute: true, cwd: benchmarkDirectory, onlyFiles: true })
  ].sort((left, right) => left.localeCompare(right))

  if (paths.length === 0) {
    throw new Error("No checked-in benchmark JSON was found in docs/benchmarks")
  }

  return await Promise.all(
    paths.map(async path => {
      const value: unknown = await Bun.file(path).json()
      return { evidence: parseBenchmarkEvidence(value), path }
    })
  )
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(2)} ms`
}

function formatMebibytes(value: number): string {
  return `${(value / 1_048_576).toFixed(2)} MiB`
}

function renderBenchmarkSummary({ evidence, path }: EvidenceFile): string {
  const sourceName = basename(path)
  const capturedDate = new Date(evidence.capturedAt)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC")
  const rows = evidence.representativeRows
    .map(
      row =>
        `| ${row.runtime} | ${row.fixture} | \`${row.policy}\` | ${formatMilliseconds(row.roundtripMedianMs)} | ${formatMilliseconds(row.iterateMedianMs)} | **${row.speedup.toFixed(2)}x** | ${formatMebibytes(row.avoidedSerializedBytes)} |`
    )
    .join("\n")

  return `<!-- Generated by scripts/docs/generate.ts. Do not edit directly. -->

# Latest benchmark

This summary is generated from the newest checked-in [machine-readable benchmark evidence](./${sourceName}). Results are local measurements, not universal performance guarantees.

## Environment

| Property | Value |
| --- | --- |
| Captured | ${capturedDate} |
| Host | ${evidence.host.chip} (${evidence.host.architecture}) |
| Operating system | ${evidence.host.operatingSystem} |
| Runtimes | ${evidence.configuration.runtimes.join(", ")} |
| Payload | ${evidence.configuration.payloadSizeMiB} MiB |
| Input chunk | ${formatMebibytes(evidence.configuration.chunkSizeBytes)} |
| Warmups / samples | ${evidence.configuration.warmups} / ${evidence.configuration.repeats} |
| Fixtures | ${evidence.configuration.fixtures.join(", ")} |
| Policies | ${evidence.configuration.policies.map(policy => `\`${policy}\``).join(", ")} |

## Representative results

The baseline is ${evidence.method.baseline}. The candidate is ${evidence.method.candidate}. Speedup is calculated as ${evidence.method.speedup}. This is not a claim that SchemaStream is faster than standalone \`JSON.parse\` or \`JSON.stringify\`; those isolated operations do different work.

| Runtime | Fixture | Policy | Serialized round-trip median | Direct object median | Speedup | Serialized bytes avoided |
| --- | --- | --- | ---: | ---: | ---: | ---: |
${rows}

Each result is validated with ${evidence.method.resultValidation}. Samples use this ordering: ${evidence.method.sampleOrdering}.

## Reproduce

Run the checked-in benchmark harness from the repository root:

\`\`\`sh
bun run benchmark
\`\`\`

See [\`tests/snapshot-policy.benchmark.mts\`](../../tests/snapshot-policy.benchmark.mts) for the harness and [snapshot policies](../snapshot-policies.md#benchmark) for the methodology.
`
}

/**
 * Generates a stable Markdown summary from the evidence with the newest capture timestamp.
 *
 * @returns Canonical output path and deterministic Markdown content.
 */
export async function generateBenchmarkDocument(): Promise<GeneratedDocument> {
  const files = await readEvidenceFiles()
  files.sort((left, right) => {
    const timestampDifference =
      Date.parse(right.evidence.capturedAt) - Date.parse(left.evidence.capturedAt)
    return timestampDifference === 0 ? right.path.localeCompare(left.path) : timestampDifference
  })
  const [latest] = files
  if (!latest) {
    throw new Error("No valid benchmark evidence was available")
  }

  return {
    content: renderBenchmarkSummary(latest),
    path: benchmarkOutputPath
  }
}
