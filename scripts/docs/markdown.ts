import { stat } from "node:fs/promises"
import { dirname, extname, relative, resolve } from "node:path"
import { repositoryRoot } from "./config"

/** Result counts from validating canonical Markdown references. */
export type MarkdownValidation = {
  exampleReferences: number
  files: number
  links: number
}

const inlineLinkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g
const referenceLinkPattern = /^\[[^\]]+\]:\s+(\S+)/gm
const exampleReferencePattern = /(?<![A-Za-z0-9_.-])(?:\.\/)?examples\/[A-Za-z0-9_./-]+/g
const externalTargetPattern = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
const codeFencePattern = /^\s*```/
const headingPattern = /^(?: {0,3})#{1,6}\s+(.+?)\s*#*\s*$/
const headingHtmlPattern = /<[^>]+>/g
const headingLinkPattern = /!?\[([^\]]+)\]\([^)]+\)/g
const headingFormattingPattern = /[`*_~]/g
const headingPunctuationPattern = /[^\p{L}\p{N} _-]/gu
const whitespacePattern = /\s+/g
const angleBracketPattern = /^<|>$/g
const examplePrefixPattern = /^\.\//
const examplePunctuationPattern = /[.,;:]+$/

function isExternalTarget(target: string): boolean {
  return externalTargetPattern.test(target)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length
}

/**
 * Approximates GitHub's documented heading slugs, including duplicate suffixes, so checked anchor
 * links fail when their canonical heading disappears.
 */
function getMarkdownAnchors(content: string): Set<string> {
  const anchors = new Set<string>()
  const occurrences = new Map<string, number>()
  let inFence = false

  for (const line of content.split("\n")) {
    if (codeFencePattern.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }

    const match = headingPattern.exec(line)
    const heading = match?.[1]
    if (!heading) {
      continue
    }

    const base = heading
      .toLowerCase()
      .replace(headingHtmlPattern, "")
      .replace(headingLinkPattern, "$1")
      .replace(headingFormattingPattern, "")
      .replace(headingPunctuationPattern, "")
      .trim()
      .replace(whitespacePattern, "-")
    const count = occurrences.get(base) ?? 0
    occurrences.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }

  return anchors
}

function collectCanonicalMarkdown(): string[] {
  const paths = ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "MIGRATION.md"].map(path =>
    resolve(repositoryRoot, path)
  )
  for (const pattern of ["docs/**/*.md", "examples/**/*.md"]) {
    const glob = new Bun.Glob(pattern)
    for (const path of glob.scanSync({ absolute: true, cwd: repositoryRoot, onlyFiles: true })) {
      paths.push(path)
    }
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

async function validateTarget({
  content,
  errors,
  file,
  index,
  rawTarget
}: {
  content: string
  errors: string[]
  file: string
  index: number
  rawTarget: string
}): Promise<void> {
  const target = rawTarget.replace(angleBracketPattern, "")
  if (isExternalTarget(target)) {
    return
  }

  const hashIndex = target.indexOf("#")
  const pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex)
  const rawAnchor = hashIndex === -1 ? "" : target.slice(hashIndex + 1)
  let anchor = ""
  let decodedPath = pathPart
  try {
    anchor = decodeURIComponent(rawAnchor).toLowerCase()
    decodedPath = decodeURIComponent(pathPart)
  } catch {
    errors.push(
      `${relative(repositoryRoot, file)}:${getLineNumber(content, index)} invalid URL encoding in ${rawTarget}`
    )
    return
  }

  const resolvedPath = decodedPath ? resolve(dirname(file), decodedPath) : file
  if (!(await pathExists(resolvedPath))) {
    errors.push(
      `${relative(repositoryRoot, file)}:${getLineNumber(content, index)} missing ${rawTarget}`
    )
    return
  }

  if (anchor && [".md", ".mdx"].includes(extname(resolvedPath).toLowerCase())) {
    const targetContent = await Bun.file(resolvedPath).text()
    if (!getMarkdownAnchors(targetContent).has(anchor)) {
      errors.push(
        `${relative(repositoryRoot, file)}:${getLineNumber(content, index)} missing anchor ${rawTarget}`
      )
    }
  }
}

async function validateExampleReference({
  content,
  errors,
  file,
  index,
  reference
}: {
  content: string
  errors: string[]
  file: string
  index: number
  reference: string
}): Promise<void> {
  if (!(await pathExists(resolve(repositoryRoot, reference)))) {
    errors.push(
      `${relative(repositoryRoot, file)}:${getLineNumber(content, index)} missing ${reference}`
    )
  }
}

/**
 * Validates local Markdown links, linked anchors, and repository-root example path references across
 * the canonical documentation set.
 *
 * @returns Counts suitable for a concise CI success message.
 * @throws {Error} When a link, anchor, or referenced example path is missing.
 */
export async function validateCanonicalMarkdown(): Promise<MarkdownValidation> {
  const files = collectCanonicalMarkdown()
  const errors: string[] = []
  const validationTasks: Promise<void>[] = []
  let links = 0
  let exampleReferences = 0
  const canonicalFiles = await Promise.all(
    files.map(async file => ({ content: await Bun.file(file).text(), file }))
  )

  for (const { content, file } of canonicalFiles) {
    for (const pattern of [inlineLinkPattern, referenceLinkPattern]) {
      pattern.lastIndex = 0
      for (const match of content.matchAll(pattern)) {
        const [, rawTarget] = match
        if (!rawTarget) {
          continue
        }
        links += 1
        validationTasks.push(
          validateTarget({ content, errors, file, index: match.index, rawTarget })
        )
      }
    }

    exampleReferencePattern.lastIndex = 0
    const checkedExamples = new Set<string>()
    for (const match of content.matchAll(exampleReferencePattern)) {
      const reference = match[0]
        .replace(examplePrefixPattern, "")
        .replace(examplePunctuationPattern, "")
      if (checkedExamples.has(reference)) {
        continue
      }
      checkedExamples.add(reference)
      exampleReferences += 1
      validationTasks.push(
        validateExampleReference({
          content,
          errors,
          file,
          index: match.index,
          reference
        })
      )
    }
  }

  await Promise.all(validationTasks)

  if (errors.length > 0) {
    throw new Error(
      `Canonical Markdown validation failed:\n${errors
        .sort((left, right) => left.localeCompare(right))
        .map(error => `- ${error}`)
        .join("\n")}`
    )
  }

  return { exampleReferences, files: files.length, links }
}
