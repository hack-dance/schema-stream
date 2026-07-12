import { describe, expect, test } from "bun:test"
import { join, sep } from "node:path"
import {
  collectCanonicalDocuments,
  rewriteStagedLinks,
  stagedDemoAssetNames
} from "../scripts/docs/prepare"

const repositoryRoot = join(import.meta.dir, "..")
const source = join(repositoryRoot, "docs", "integrations", "link-probe.md")
const destination = join(repositoryRoot, "site", "content", "docs", "integrations", "link-probe.md")
const exampleTarget = join(repositoryRoot, "examples", "progressive-json.ts")
const canonicalTarget = join(repositoryRoot, "docs", "snapshot-policies.md")
const stagedTarget = join(repositoryRoot, "site", "content", "docs", "snapshot-policies.md")

function rewrite(content: string): string {
  return rewriteStagedLinks({
    content,
    destination,
    repositoryTargets: new Map([[exampleTarget, false]]),
    source,
    sourceToDestination: new Map([[canonicalTarget, stagedTarget]])
  })
}

describe("documentation staging links", () => {
  test("rewrites reference definitions for repository artifacts", () => {
    const content = [
      "Read the [progressive example][example].",
      "",
      '[example]: ../../examples/progressive-json.ts "Runnable source"'
    ].join("\n")

    expect(rewrite(content)).toContain(
      '[example]: https://github.com/hack-dance/schema-stream/blob/main/examples/progressive-json.ts "Runnable source"'
    )
  })

  test("rewrites angle-wrapped definitions for staged pages", () => {
    const content = [
      "Read [snapshot policies][policies].",
      "",
      "[policies]: <../snapshot-policies.md#modes>"
    ].join("\n")

    expect(rewrite(content)).toContain("[policies]: <../snapshot-policies#modes>")
  })

  test("preserves external reference definitions", () => {
    const content = "[repository]: https://github.com/hack-dance/schema-stream"

    expect(rewrite(content)).toBe(content)
  })
})

describe("public documentation corpus", () => {
  test("excludes contributor and benchmark engineering material", () => {
    const sources = collectCanonicalDocuments().map(document => document.source)
    const benchmarkRoot = `${join(repositoryRoot, "docs", "benchmarks")}${sep}`

    expect(sources).not.toContain(join(repositoryRoot, "CONTRIBUTING.md"))
    expect(sources.some(path => path.startsWith(benchmarkRoot))).toBe(false)
    expect(sources).toContain(join(repositoryRoot, "README.md"))
  })

  test("stages the README loop and docs video from canonical media", async () => {
    expect(stagedDemoAssetNames).toEqual([
      "schema-stream-demo.gif",
      "schema-stream-demo.mp4",
      "schema-stream-demo-poster.jpg"
    ])

    for (const assetName of stagedDemoAssetNames) {
      expect(Bun.file(join(repositoryRoot, "docs", "assets", assetName)).size).toBeGreaterThan(0)
    }
  })
})
