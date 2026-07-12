import { mkdir, rm, stat } from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path"
import { repositoryRoot } from "./config"

type StagedDocument = {
  destination: string
  destinationRelative: string
  source: string
}

const canonicalDocsRoot = join(repositoryRoot, "docs")
const stagedDocsRoot = join(repositoryRoot, "site/content/docs")
const generatedAssetsRoot = join(repositoryRoot, "site/public/generated")
const excludedCanonicalDocuments = new Set([join(canonicalDocsRoot, "island-ai-follow-up.md")])
const githubRepositoryUrl = "https://github.com/hack-dance/schema-stream"
const headingPattern = /^#\s+(.+?)\s*#?\s*$/m
const titleFormattingPattern = /[`*_]/g
const markdownImagePattern = /!\[[^\]]*\]\([^)]+\)/g
const markdownLinkPattern = /\[([^\]]+)\]\([^)]+\)/g
const markdownFormattingPattern = /[`*_~]/g
const whitespacePattern = /\s+/g
const frontmatterPattern = /^---\r?\n[\s\S]*?\r?\n---\r?\n/
const unixFrontmatterPattern = /^---\n[\s\S]*?\n---\n/
const paragraphPattern = /\n\s*\n/
const nonProsePattern = /^(?:#|<!--|\[!|!\[|```|~~~|[-*+]\s|\d+\.\s|\|)/
const leadingWhitespacePattern = /^\s+/
const canonicalLinkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g
const nonLocalTargetPattern = /^(?:#|[a-z][a-z0-9+.-]*:|\/\/)/i
const markdownExtensionPattern = /\.md$/i
const indexRoutePattern = /(?:^|\/)index$/
const stagedLinkPattern = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+["'][^)]*["'])?\))/g
const currentDirectoryPattern = /^\.$/
const linkedImageLinePattern = /^\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)\r?\n/gm
const canonicalDemoImageUrl =
  "https://raw.githubusercontent.com/hack-dance/schema-stream/main/docs/assets/schema-stream-demo.gif"

const preferredNavigationOrder: Readonly<Record<string, readonly string[]>> = {
  "": [
    "index",
    "guides",
    "integrations",
    "snapshot-policies",
    "completion-events",
    "transports",
    "integration-testing",
    "reference",
    "benchmarks",
    "changelog",
    "contributing"
  ],
  benchmarks: ["index", "latest"],
  guides: ["index", "snapshot-policies", "completion-events", "transports"],
  integrations: [
    "index",
    "openai-agents",
    "vercel-ai-sdk",
    "mastra",
    "bun-websocket",
    "provider-portability"
  ],
  reference: ["index", "api"]
}

const fallbackDescriptions: Readonly<Record<string, string>> = {
  "CHANGELOG.md": "Release history and versioned changes for Schema Stream.",
  "CONTRIBUTING.md":
    "Development, verification, benchmarking, and release guidance for contributors.",
  "README.md": "Progressively parse streamed JSON into typed, schema-shaped snapshots.",
  "docs/benchmarks/latest.md":
    "The latest checked-in Schema Stream performance measurements and methodology.",
  "docs/reference/api.md": "Generated TypeScript reference for every public Schema Stream export."
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/")
}

function normalizeDestination(relativePath: string): string {
  const parsedBasename =
    basename(relativePath).toLowerCase() === "readme.md" ? "index.md" : basename(relativePath)
  return toPosixPath(join(dirname(relativePath), parsedBasename))
}

function collectCanonicalDocuments(): Array<{ destinationRelative: string; source: string }> {
  const documents = [
    { destinationRelative: "index.md", source: join(repositoryRoot, "README.md") },
    { destinationRelative: "changelog.md", source: join(repositoryRoot, "CHANGELOG.md") },
    { destinationRelative: "contributing.md", source: join(repositoryRoot, "CONTRIBUTING.md") }
  ]
  const glob = new Bun.Glob("**/*.md")
  for (const source of glob.scanSync({ absolute: true, cwd: canonicalDocsRoot, onlyFiles: true })) {
    if (excludedCanonicalDocuments.has(source)) {
      continue
    }
    documents.push({
      destinationRelative: normalizeDestination(relative(canonicalDocsRoot, source)),
      source
    })
  }

  const sortedDocuments = documents.sort((left, right) =>
    left.destinationRelative.localeCompare(right.destinationRelative)
  )
  const seenDestinations = new Map<string, string>()
  for (const document of sortedDocuments) {
    const existingSource = seenDestinations.get(document.destinationRelative)
    if (existingSource) {
      throw new Error(
        `Canonical documents ${relative(repositoryRoot, existingSource)} and ${relative(repositoryRoot, document.source)} both stage to ${document.destinationRelative}`
      )
    }
    seenDestinations.set(document.destinationRelative, document.source)
  }
  return sortedDocuments
}

function extractTitle(content: string, source: string): string {
  const match = headingPattern.exec(content)
  if (!match?.[1]) {
    throw new Error(`Canonical document ${relative(repositoryRoot, source)} needs an H1 title`)
  }
  return match[1].replace(titleFormattingPattern, "").trim()
}

function stripMarkdown(value: string): string {
  return value
    .replace(markdownImagePattern, "")
    .replace(markdownLinkPattern, "$1")
    .replace(markdownFormattingPattern, "")
    .replace(whitespacePattern, " ")
    .trim()
}

/**
 * Finds the first prose paragraph instead of badges, generated notices, headings, tables, lists, or
 * fenced examples. The result becomes staging-only page metadata.
 */
function extractDescription(content: string, source: string): string {
  const sourceRelative = toPosixPath(relative(repositoryRoot, source))
  const fallback = fallbackDescriptions[sourceRelative]
  if (fallback) {
    return fallback
  }

  const paragraphs = content.replace(unixFrontmatterPattern, "").split(paragraphPattern)
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (!trimmed || nonProsePattern.test(trimmed)) {
      continue
    }
    const description = stripMarkdown(trimmed)
    if (description.length > 0) {
      return description
    }
  }

  return `${extractTitle(content, source)} documentation for Schema Stream.`
}

function hasFrontmatter(content: string): boolean {
  return frontmatterPattern.test(content)
}

function addStagingFrontmatter(content: string, source: string): string {
  if (hasFrontmatter(content)) {
    return content
  }

  const title = extractTitle(content, source)
  const description = extractDescription(content, source)
  const withoutFirstHeading = content
    .replace(headingPattern, "")
    .replace(leadingWhitespacePattern, "")
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n${withoutFirstHeading}`
}

/** Removes repository badges and points the README demo at the locally staged asset. */
function normalizeStagedMedia(content: string, source: string): string {
  if (source !== join(repositoryRoot, "README.md")) {
    return content
  }

  return content
    .replace(linkedImageLinePattern, "")
    .replace(canonicalDemoImageUrl, "/generated/schema-stream-demo.gif")
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function buildRepositoryTargets(
  documents: Array<{ source: string }>
): Promise<Map<string, boolean>> {
  const sourceDocuments = await Promise.all(
    documents.map(async ({ source }) => ({ content: await Bun.file(source).text(), source }))
  )
  const targetPaths = new Set<string>()
  for (const { content, source } of sourceDocuments) {
    canonicalLinkPattern.lastIndex = 0
    for (const match of content.matchAll(canonicalLinkPattern)) {
      const [, rawTarget] = match
      if (!(rawTarget && !nonLocalTargetPattern.test(rawTarget))) {
        continue
      }
      const [pathPart] = rawTarget.split("#", 1)
      if (!pathPart) {
        continue
      }
      targetPaths.add(resolve(dirname(source), decodeURIComponent(pathPart)))
    }
  }
  const targets = await Promise.all(
    [...targetPaths].map(async target => [target, await isDirectory(target)] as const)
  )
  return new Map(targets)
}

function routeRelativePath(from: string, to: string): string {
  const withoutExtension = toPosixPath(relative(dirname(from), to)).replace(
    markdownExtensionPattern,
    ""
  )
  const withoutIndex = withoutExtension.replace(indexRoutePattern, "")
  if (!withoutIndex) {
    return "."
  }
  return withoutIndex.startsWith(".") ? withoutIndex : `./${withoutIndex}`
}

/**
 * Rewrites only staging links. Canonical documents keep repository-relative links, while relocated
 * site pages point to staged routes or to a stable GitHub source URL for non-page artifacts.
 */
function rewriteLinks({
  content,
  destination,
  repositoryTargets,
  source,
  sourceToDestination
}: {
  content: string
  destination: string
  repositoryTargets: ReadonlyMap<string, boolean>
  source: string
  sourceToDestination: ReadonlyMap<string, string>
}): string {
  return content.replace(
    stagedLinkPattern,
    (match, prefix: string, rawTarget: string, suffix: string): string => {
      if (nonLocalTargetPattern.test(rawTarget)) {
        return match
      }

      const hashIndex = rawTarget.indexOf("#")
      const pathPart = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex)
      const hash = hashIndex === -1 ? "" : rawTarget.slice(hashIndex)
      if (!pathPart) {
        return match
      }

      const target = resolve(dirname(source), decodeURIComponent(pathPart))
      const stagedTarget =
        sourceToDestination.get(target) ?? sourceToDestination.get(join(target, "README.md"))
      if (stagedTarget) {
        return `${prefix}${routeRelativePath(destination, stagedTarget)}${hash}${suffix}`
      }

      const repositoryRelative = toPosixPath(relative(repositoryRoot, target))
      if (repositoryRelative.startsWith("..") || !repositoryTargets.has(target)) {
        return match
      }
      const view = repositoryTargets.get(target) ? "tree" : "blob"
      return `${prefix}${githubRepositoryUrl}/${view}/main/${repositoryRelative}${hash}${suffix}`
    }
  )
}

function navigationRank(directory: string, page: string): number {
  const order = preferredNavigationOrder[directory] ?? []
  const rank = order.indexOf(page)
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank
}

function directoryTitle(directory: string): string {
  if (!directory) {
    return "Schema Stream"
  }
  return basename(directory)
    .split("-")
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function getNavigationDirectories(documents: StagedDocument[]): Map<string, Set<string>> {
  const directories = new Map<string, Set<string>>()
  for (const document of documents) {
    const documentDirectory = toPosixPath(dirname(document.destinationRelative)).replace(
      currentDirectoryPattern,
      ""
    )
    const page = basename(document.destinationRelative, extname(document.destinationRelative))
    const pages = directories.get(documentDirectory) ?? new Set<string>()
    pages.add(page)
    directories.set(documentDirectory, pages)

    if (documentDirectory) {
      const parts = documentDirectory.split("/")
      for (let index = 0; index < parts.length; index += 1) {
        const parent = parts.slice(0, index).join("/")
        const children = directories.get(parent) ?? new Set<string>()
        children.add(parts[index] ?? "")
        directories.set(parent, children)
      }
    }
  }
  return directories
}

async function writeNavigation(documents: StagedDocument[]): Promise<number> {
  const directories = getNavigationDirectories(documents)
  await Promise.all(
    [...directories].map(async ([directory, pageSet]) => {
      const pages = [...pageSet].filter(Boolean).sort((left, right) => {
        const rankDifference = navigationRank(directory, left) - navigationRank(directory, right)
        return rankDifference === 0 ? left.localeCompare(right) : rankDifference
      })
      const metadata = `${JSON.stringify({ pages, title: directoryTitle(directory) }, null, 2)}\n`
      const outputDirectory = join(stagedDocsRoot, directory)
      await mkdir(outputDirectory, { recursive: true })
      await Bun.write(join(outputDirectory, "meta.json"), metadata)
    })
  )
  return directories.size
}

/**
 * Rebuilds the ignored Fumadocs content tree from canonical repository Markdown and public assets.
 * The canonical files remain untouched; only this staging tree receives frontmatter and link edits.
 */
async function main(): Promise<void> {
  const canonicalDocuments = collectCanonicalDocuments()
  const sourceToDestination = new Map(
    canonicalDocuments.map(document => [
      document.source,
      join(stagedDocsRoot, document.destinationRelative)
    ])
  )
  const repositoryTargets = await buildRepositoryTargets(canonicalDocuments)

  await rm(stagedDocsRoot, { force: true, recursive: true })
  await rm(generatedAssetsRoot, { force: true, recursive: true })
  await mkdir(stagedDocsRoot, { recursive: true })
  await mkdir(generatedAssetsRoot, { recursive: true })

  const documents = await Promise.all(
    canonicalDocuments.map(async canonical => {
      const destination = join(stagedDocsRoot, canonical.destinationRelative)
      const sourceContent = await Bun.file(canonical.source).text()
      const normalizedSourceContent = normalizeStagedMedia(sourceContent, canonical.source)
      const content = rewriteLinks({
        content: addStagingFrontmatter(normalizedSourceContent, canonical.source),
        destination,
        repositoryTargets,
        source: canonical.source,
        sourceToDestination
      })
      await mkdir(dirname(destination), { recursive: true })
      await Bun.write(destination, content)
      return { ...canonical, destination }
    })
  )

  const navigationFiles = await writeNavigation(documents)
  const demoSource = join(canonicalDocsRoot, "assets/schema-stream-demo.gif")
  const demoDestination = join(generatedAssetsRoot, "schema-stream-demo.gif")
  await Bun.write(demoDestination, Bun.file(demoSource))

  console.info(
    `Documentation staging: ${documents.length} pages, ${navigationFiles} navigation files, and 1 generated asset`
  )
}

await main()
