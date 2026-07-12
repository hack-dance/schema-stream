export interface ExampleDefinition {
  command: string
  description: string
  docsHref: string
  file: string
  liveProvider: boolean
  title: string
}

export const examples: readonly ExampleDefinition[] = [
  {
    command: "bun run example:progressive",
    description:
      "Core progressive iteration, completion events, Unicode, and a mid-stream decision.",
    docsHref: "/docs/integrations/provider-portability",
    file: "examples/progressive-json.ts",
    liveProvider: false,
    title: "Progressive JSON"
  },
  {
    command: "bun run example:sdk",
    description: "OpenAI Agents SDK and Vercel AI SDK streams against deterministic mock models.",
    docsHref: "/docs/integrations/openai-agents",
    file: "examples/sdk-mocks.ts",
    liveProvider: false,
    title: "SDK compatibility"
  },
  {
    command: "bun run example:mastra",
    description: "Mastra structured output with the same SchemaStream materialization boundary.",
    docsHref: "/docs/integrations/mastra",
    file: "examples/mastra.ts",
    liveProvider: true,
    title: "Mastra"
  },
  {
    command: "bun run example:websocket",
    description:
      "Bun WebSocket transport, selectable snapshot policies, and the live dashboard UI.",
    docsHref: "/docs/integrations/bun-websocket",
    file: "examples/websocket-ui/server.ts",
    liveProvider: true,
    title: "WebSocket dashboard"
  }
] as const

export const CODESPACES_URL =
  "https://codespaces.new/hack-dance/schema-stream?quickstart=1&devcontainer_path=.devcontainer%2Fdevcontainer.json"
