# schema-stream
`schema-stream` is a utility for parsing streams of JSON data. It provides a safe-to-read-from stubbed version of the data before the stream has fully completed.

## Basic Usage

To use `schema-stream`, you need to create a new instance of the class, passing in a Zod schema and optional default data.
Then, you can call the `parse` method on the instance to parse a JSON stream.

```typescript

const schema = z.object({
  someString: z.string(),
  someNumber: z.number()
})

const response = await getSomeStreamOfJson()

const parser = new SchemaStream(schema, {
  someString: "default string"
})

const streamParser = parser.parse({
  stringStreaming: true
})

response.body?.pipeThrough(parser)

const reader = streamParser.readable.getReader()
const decoder = new TextDecoder()
let result = {}

while (!done) {
  const { value, done: doneReading } = await reader.read()
  done = doneReading

  if (done) {
    console.log(result)
    break
  }

  const chunkValue = decoder.decode(value)
  result = JSON.parse(chunkValue)
}
```


## Note
A lot of the internal parser was forked from:
https://github.com/juanjoDiaz/streamparser-json

The primary difference is that this requires a zod schema and optional default data, to allow for a fully stubbed version of the expected data to be returned before the stream has completed. This allows for partially parsed data to be returned to the user asap, and for the user to be able to start working with the data before the stream has completed.


## Related Packages

### [@hackdance/hooks](https://github.com/hack-dance/agents/packages/hooks)
A set of react hooks for working with streams. Includes a use-json-stream hook that uses this package
to incrementally parse a stream of json data.

### [@hackdance/agents](https://github.com/hack-dance/agents/packages/agents)
A set of react hooks for working with streams. Includes a use-json-stream hook that uses this package
to incrementally parse a stream of json data.


## License
MIT © [hack-dance](https://hack.dance)