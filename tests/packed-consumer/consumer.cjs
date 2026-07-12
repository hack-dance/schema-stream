"use strict"
const schemaStream = require("schema-stream")
const { z } = require("zod")

if (typeof schemaStream.SchemaStream !== "function") {
  throw new Error("schema-stream packed CommonJS export mismatch")
}

async function main() {
  const schema = z.object({ title: z.string(), nested: z.object({ count: z.number() }) })
  const events = []
  let completedCount
  const parser = new schemaStream.SchemaStream(schema, {
    onValueComplete({ path, value }) {
      events.push(path)
      if (path.join(".") === "nested.count") {
        completedCount = value
      }
    }
  })
  const snapshots = []

  for await (const snapshot of parser.iterate(
    (async function* () {
      yield '{"title":"common'
      yield 'js","nested":{"count":4}}'
    })(),
    { snapshotPolicy: { mode: "final" } }
  )) {
    snapshots.push(snapshot)
  }

  const finalSnapshot = snapshots.at(-1)
  if (finalSnapshot?.title !== "commonjs" || finalSnapshot?.nested?.count !== 4) {
    throw new Error("schema-stream packed CommonJS runtime mismatch")
  }
  if (!events.some(path => path.join(".") === "nested.count") || completedCount !== 4) {
    throw new Error("schema-stream packed CommonJS completion event mismatch")
  }

  const byteSource = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"title":"bytes","nested":{"count":5}}'))
      controller.close()
    }
  })
  const byteReader = byteSource
    .pipeThrough(new schemaStream.SchemaStream(schema).parse({ snapshotPolicy: { mode: "final" } }))
    .getReader()
  const { value: byteSnapshot } = await byteReader.read()
  if (
    byteSnapshot?.byteOffset !== 0 ||
    byteSnapshot.buffer.byteLength !== byteSnapshot.byteLength
  ) {
    throw new Error("schema-stream packed byte snapshot exposed a pooled backing store")
  }

  console.log("packed CommonJS runtime passed")
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
