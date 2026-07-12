import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const { rewrite: rewriteDocsPath } = rewritePath("/docs{/*path}", "/llms.mdx/docs{/*path}")

/**
 * Serves Markdown from canonical docs URLs without exposing the internal route hierarchy.
 * Explicit `.md` paths take precedence; content negotiation handles extensionless URLs.
 */
export function proxy(request: NextRequest): NextResponse {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.next()
  }

  const requestedPath = getRequestedMarkdownPath(request.nextUrl.pathname)
  const shouldNegotiateMarkdown = requestedPath === null && isMarkdownPreferred(request)
  const sourcePath = requestedPath ?? (shouldNegotiateMarkdown ? request.nextUrl.pathname : null)

  if (!sourcePath) {
    return NextResponse.next()
  }

  const destination = rewriteDocsPath(sourcePath)

  if (!destination) {
    return NextResponse.next()
  }

  const rewriteUrl = request.nextUrl.clone()
  rewriteUrl.pathname = destination
  return NextResponse.rewrite(rewriteUrl)
}

export const config = {
  matcher: ["/docs", "/docs/:path*", "/docs.md"]
}

function getRequestedMarkdownPath(pathname: string): string | null {
  if (pathname === "/docs.md") {
    return "/docs"
  }

  if (!(pathname.startsWith("/docs/") && pathname.endsWith(".md"))) {
    return null
  }

  return pathname.slice(0, -3)
}
