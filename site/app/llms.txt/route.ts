import { getLLMIndexText } from "../../lib/get-llm-text"

export const revalidate = false

/** Serves the compact, canonical discovery index for AI tools and documentation crawlers. */
export function GET(): Response {
  return new Response(getLLMIndexText(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: '<https://schema.stream/llms.txt>; rel="canonical"',
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex"
    }
  })
}
