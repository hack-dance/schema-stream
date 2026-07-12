import { join, resolve } from "node:path"

/** Absolute repository root derived from this script directory. */
export const repositoryRoot = resolve(import.meta.dir, "../..")

/** Public source entry point used to discover the package API. */
export const publicEntryPath = join(repositoryRoot, "src/index.ts")

/** Canonical generated public API reference. */
export const publicApiOutputPath = join(repositoryRoot, "docs/reference/api.md")

/** Canonical generated summary of the newest checked-in benchmark evidence. */
export const benchmarkOutputPath = join(repositoryRoot, "docs/benchmarks/latest.md")

/** A generated file and the deterministic content expected at its canonical path. */
export type GeneratedDocument = {
  content: string
  path: string
}
