import { Agent, run } from "@openai/agents"
import { Output, streamText } from "ai"
import { SchemaStream, type SchemaStreamChunk, type SnapshotPolicy } from "schema-stream"
import { z } from "zod"
import * as zm from "zod/mini"

const schema = z.object({
  title: z.string(),
  nested: z.object({ count: z.number() }),
  items: z.array(z.object({ label: z.string() }))
})

function chunkedJson(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const value = { title: "hello", nested: { count: 2 }, items: [{ label: "first" }] }

  return new ReadableStream({
    start(controller) {
      for (const character of JSON.stringify(value)) {
        controller.enqueue(encoder.encode(character))
      }
      controller.close()
    }
  })
}

const stub = new SchemaStream(schema).getSchemaStub(schema)
if (stub.title !== null || stub.nested?.count !== null || stub.items?.length !== 0) {
  throw new Error("schema-stream packed Zod 4 stub mismatch")
}

const emissions: SchemaStreamChunk<typeof schema>[] = []
for await (const partial of new SchemaStream(schema).iterate(chunkedJson())) {
  emissions.push(partial)
}

if (!emissions.some(partial => partial.title === "hel") || emissions.at(-1)?.nested?.count !== 2) {
  throw new Error("schema-stream packed iterate mismatch")
}

const finalPolicy = { mode: "final" } satisfies SnapshotPolicy
const finalEmissions: SchemaStreamChunk<typeof schema>[] = []
for await (const partial of new SchemaStream(schema).iterate(chunkedJson(), {
  snapshotPolicy: finalPolicy
})) {
  finalEmissions.push(partial)
}
if (finalEmissions.length !== 1 || finalEmissions[0]?.nested?.count !== 2) {
  throw new Error("schema-stream packed snapshot policy mismatch")
}

const miniSchema = zm.object({
  title: zm.string(),
  nested: zm.optional(zm.object({ count: zm.number() }))
})
const miniStub = new SchemaStream(miniSchema).getSchemaStub(miniSchema)
if (miniStub.title !== null || miniStub.nested?.count !== null) {
  throw new Error("schema-stream packed Zod Mini stub mismatch")
}

/** Compile-only fixture; it is never called and cannot contact a model. */
async function openAiAgentsCompatibility(): Promise<void> {
  const agent = new Agent({
    name: "Packed SchemaStream fixture",
    model: "gpt-5.5",
    instructions: "Return structured data.",
    outputType: schema
  })
  const result = await run(agent, "Extract data.", { stream: true })

  for await (const partial of new SchemaStream(schema).iterate(result.toTextStream())) {
    const typedPartial: SchemaStreamChunk<typeof schema> = partial
    void typedPartial.nested?.count
  }

  await result.completed
  const finalOutput: z.output<typeof schema> | undefined = result.finalOutput
  void finalOutput
}

/** Compile-only fixture; it is never called and cannot contact a model. */
async function vercelAiSdkCompatibility(): Promise<void> {
  const result = streamText({
    model: "openai/gpt-5.5",
    output: Output.object({ schema }),
    prompt: "Extract data."
  })

  for await (const partial of new SchemaStream(schema).iterate(result.textStream)) {
    const typedPartial: SchemaStreamChunk<typeof schema> = partial
    void typedPartial.items?.at(-1)?.label
  }

  const finalOutput: z.output<typeof schema> = await result.output
  void finalOutput
}

void openAiAgentsCompatibility
void vercelAiSdkCompatibility

console.log("packed ESM, Zod 4/Mini, and SDK compatibility passed")
