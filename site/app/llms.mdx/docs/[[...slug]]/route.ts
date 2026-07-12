import { notFound } from "next/navigation"
import { getCanonicalUrl, getLLMText } from "../../../../lib/get-llm-text"
import { source } from "../../../../lib/source"

export const revalidate = false

interface MarkdownRouteContext {
  params: Promise<{
    slug?: string[]
  }>
}

/**
 * Resolves the internal Markdown endpoint used by `.md` rewrites and Accept negotiation.
 * The internal `/llms.mdx` prefix keeps machine responses separate from canonical HTML routes.
 */
export async function GET(_request: Request, { params }: MarkdownRouteContext): Promise<Response> {
  const { slug } = await params
  const page = source.getPage(slug)

  if (!page) {
    notFound()
  }

  return new Response(await getLLMText({ page }), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${getCanonicalUrl(page.url)}>; rel="canonical"`,
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex"
    }
  })
}

/** Pre-renders a Markdown response for every page generated from the docs source. */
export function generateStaticParams(): ReturnType<typeof source.generateParams> {
  return source.generateParams()
}
