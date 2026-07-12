import { mkdir } from "node:fs/promises"
import { dirname, relative } from "node:path"
import { generateBenchmarkDocument } from "./benchmark"
import { type GeneratedDocument, repositoryRoot } from "./config"
import { validateCanonicalMarkdown } from "./markdown"
import { generatePublicApiDocument } from "./public-api"

function parseCheckMode(arguments_: string[]): boolean {
  const unknownArguments = arguments_.filter(argument => argument !== "--check")
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown documentation generator arguments: ${unknownArguments.join(", ")}`)
  }
  return arguments_.includes("--check")
}

async function isCurrent(document: GeneratedDocument): Promise<boolean> {
  const file = Bun.file(document.path)
  return (await file.exists()) && (await file.text()) === document.content
}

async function writeDocument(document: GeneratedDocument): Promise<boolean> {
  if (await isCurrent(document)) {
    return false
  }
  await mkdir(dirname(document.path), { recursive: true })
  await Bun.write(document.path, document.content)
  return true
}

/**
 * Generates canonical documentation or verifies that checked-in generated files have no drift.
 * Link validation always runs against the complete canonical Markdown set after generation checks.
 */
async function main(): Promise<void> {
  const check = parseCheckMode(Bun.argv.slice(2))
  const documents = [await generatePublicApiDocument(), await generateBenchmarkDocument()]

  if (check) {
    const documentStates = await Promise.all(
      documents.map(async document => ({ current: await isCurrent(document), document }))
    )
    const stale = documentStates
      .filter(state => !state.current)
      .map(state => relative(repositoryRoot, state.document.path))
    if (stale.length > 0) {
      throw new Error(
        `Generated documentation is stale:\n${stale.map(path => `- ${path}`).join("\n")}\nRun bun scripts/docs/generate.ts.`
      )
    }
  } else {
    const documentStates = await Promise.all(
      documents.map(async document => ({ changed: await writeDocument(document), document }))
    )
    const changed = documentStates
      .filter(state => state.changed)
      .map(state => relative(repositoryRoot, state.document.path))
    const status = changed.length > 0 ? `updated ${changed.join(", ")}` : "no generated changes"
    console.info(`Documentation generation: ${status}`)
  }

  const validation = await validateCanonicalMarkdown()
  console.info(
    `Documentation check: ${documents.length} generated files current; ${validation.links} links and ${validation.exampleReferences} example references valid across ${validation.files} Markdown files`
  )
}

await main()
