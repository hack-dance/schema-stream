import { getLLMFullText } from "../../lib/get-llm-text"

export const revalidate = false

/** Serves one build-derived Markdown corpus containing every published documentation page. */
export async function GET(): Promise<Response> {
  return new Response(await getLLMFullText(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: '<https://schema.stream/llms-full.txt>; rel="canonical"',
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex"
    }
  })
}
