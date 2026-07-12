import { describe, expect, test } from "bun:test"
import { generatePublicApiDocument } from "./public-api"

describe("public API documentation", () => {
  test("preserves consumer-facing TSDoc tags", async () => {
    const document = await generatePublicApiDocument()

    expect(document.content).toContain(
      "**Type parameters**\n\n- `TSchema` - Object schema that determines placeholders and snapshot inference."
    )
    expect(document.content).toContain(
      "**Parameters**\n\n- `schema` - Zod 3, Zod 4, or Zod Mini object schema used for types and placeholders."
    )
    expect(document.content).toContain(
      "**Returns**\n\nA new partial, schema-shaped value that is independent of parser state."
    )
    expect(document.content).toContain(
      "**Throws**\n\n- `TypeError` - When a byte snapshot threshold is not a positive finite integer."
    )
    expect(document.content).toContain(
      "- `Error` - When the source fails or the JSON is malformed or truncated."
    )
  })
})
