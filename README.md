> [!WARNING]
> The source for this package has moved to a central mono-repo located here: [island-ai](https://github.com/hack-dance/island-ai/tree/main/public-packages/schemaStream)


# schema-stream

![GitHub Actions Status](https://github.com/github/docs/actions/workflows/test.yml/badge.svg?branch=main) [![NPM Version](https://img.shields.io/npm/v/schema-stream.svg)](https://www.npmjs.com/package/schema-stream)


`schema-stream` is a utility for parsing streams of JSON data. It provides a safe-to-read-from stubbed version of the data before the stream has fully completed. This utility is essential for handling large JSON streams efficiently and is built on top of Zod schema validation.

## Features

- Stream JSON data parsing with partial data availability.
- Zod schema validation for robust data handling.
- Extensible configuration for customized parsing needs.


## Installation

```bash
npm install schema-stream zod
```

## Basic Usage

To use `schema-stream`, create a new instance of the class, passing in a Zod schema and optional default data. Then, call the `parse` method on the instance to parse a JSON stream.

```typescript
import { SchemaStream } from 'schema-stream';
import { z } from 'zod';

const schema = z.object({
  someString: z.string(),
  someNumber: z.number()
});

const response = await getSomeStreamOfJson();

const parser = new SchemaStream(schema, {
  someString: "default string"
});

const streamParser = parser.parse({});

response.body?.pipeThrough(parser);

const reader = streamParser.readable.getReader();
const decoder = new TextDecoder();
let result = {};

while (!done) {
  const { value, done: doneReading } = await reader.read();
  done = doneReading;

  if (done) {
    console.log(result);
    break;
  }

  const chunkValue = decoder.decode(value);
  result = JSON.parse(chunkValue);
}
```

MIT © [hack-dance](https://hack.dance)
