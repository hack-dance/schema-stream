import { DESCRIPTION, SITE_URL } from "./site"
import { source } from "./source"

type SourcePage = (typeof source)["$inferPage"]

interface GetLLMTextOptions {
  page: SourcePage
}

const frontmatterPattern = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

/**
 * Converts a generated docs page into the self-contained Markdown served to AI clients.
 *
 * Raw staged Markdown preserves standard fences such as Mermaid while keeping rewritten site links.
 *
 * @param options - The Fumadocs page whose staged Markdown should be exposed.
 * @returns Markdown with a stable title and canonical source URL.
 */
export async function getLLMText({ page }: GetLLMTextOptions): Promise<string> {
  const markdown = (await page.data.getText("raw")).replace(frontmatterPattern, "")
  const title = page.data.title ?? page.slugs.at(-1) ?? "Schema Stream"

  return [`# ${title}`, "", `Canonical: ${getCanonicalUrl(page.url)}`, "", markdown.trim()].join(
    "\n"
  )
}

/**
 * Builds the compact discovery index from the same generated pages used by the HTML docs.
 * Per-page links use the public `.md` form so clients never need to know the internal route.
 *
 * @returns An llms.txt-compatible Markdown index with absolute canonical links.
 */
export function getLLMIndexText(): string {
  const pages = getSortedPages()
  const links = pages.map(page => {
    const title = escapeInlineMarkdown(page.data.title ?? page.slugs.at(-1) ?? "Documentation")
    const description = page.data.description
      ? `: ${normalizeInlineText(page.data.description)}`
      : ""

    return `- [${title}](${getMarkdownUrl(page.url)})${description}`
  })

  return [
    "# Schema Stream",
    "",
    `> ${DESCRIPTION}`,
    "",
    "## Documentation",
    "",
    ...links,
    "",
    "## Complete corpus",
    "",
    `- [All documentation in one file](${SITE_URL}/llms-full.txt)`
  ].join("\n")
}

/**
 * Materializes every page into one deterministic Markdown document at build time.
 *
 * @returns The complete processed documentation corpus.
 */
export async function getLLMFullText(): Promise<string> {
  const pages = getSortedPages()
  const sections = await Promise.all(pages.map(page => getLLMText({ page })))

  return [
    "# Schema Stream documentation",
    DESCRIPTION,
    `Canonical: ${SITE_URL}/docs`,
    ...sections
  ].join("\n\n")
}

/** Returns a canonical public URL for an application-relative path. */
export function getCanonicalUrl(pathname: string): string {
  return new URL(pathname, SITE_URL).href
}

function getMarkdownUrl(pathname: string): string {
  const normalizedPath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
  return getCanonicalUrl(`${normalizedPath}.md`)
}

function getSortedPages(): SourcePage[] {
  return [...source.getPages()].sort((left, right) => left.url.localeCompare(right.url))
}

function escapeInlineMarkdown(value: string): string {
  return normalizeInlineText(value).replaceAll("[", "\\[").replaceAll("]", "\\]")
}

function normalizeInlineText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim()
}
