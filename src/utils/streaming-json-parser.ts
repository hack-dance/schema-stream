import JSONParser from "./json-parser"
import type {
  ParsedTokenInfo,
  StackElement,
  TokenParserMode,
  TokenParserState
} from "./token-parser"
import {
  getObjectShape,
  getSchemaNode,
  type SchemaStreamChunk,
  type SchemaStreamDefaultData,
  type ZodObjectSchema,
  type ZodSchema
} from "./zod-compat"

/** Primitive placeholders used until streamed JSON supplies a value. */
export type TypeDefaults = {
  string?: string | null | undefined
  number?: number | null | undefined
  boolean?: boolean | null | undefined
}

/** Object keys and array indexes locating a value in the streamed document. */
export type SchemaPath = (string | number | undefined)[]

/** Completion state reported after a streamed value changes. */
export type OnKeyCompleteCallbackParams = {
  /** The value currently receiving streamed content, or an empty path after parsing finishes. */
  activePath: SchemaPath
  /** Unique value paths that have completed at least once, in completion order. */
  completedPaths: SchemaPath[]
}

/** Receives immutable path snapshots as streamed values progress and complete. */
export type OnKeyCompleteCallback = (data: OnKeyCompleteCallbackParams) => void

/** Configures schema-derived placeholders and completion reporting. */
export type SchemaStreamOptions<TSchema extends ZodObjectSchema> = {
  /** Field-level placeholders that take precedence over schema and primitive defaults. */
  defaultData?: SchemaStreamDefaultData<TSchema>
  /** Fallback placeholders for primitive schema nodes. Defaults to `null`. */
  typeDefaults?: TypeDefaults
  /** Called as values progress and once more with an empty active path after completion. */
  onKeyComplete?: OnKeyCompleteCallback
}

/** Configures JSON tokenization and snapshot cadence for `parse()` and `iterate()`. */
export type SchemaStreamParseOptions = {
  /** Buffers string bytes in fixed-size blocks instead of emitting every incremental string. */
  stringBufferSize?: number
  /** Converts unescaped newlines inside strings to `\n`; enabled by default. */
  handleUnescapedNewLines?: boolean
  /** Selects when cumulative schema-shaped snapshots are emitted. */
  snapshotPolicy?: SnapshotPolicy
}

/** Controls when cumulative JSON snapshots are serialized and emitted. The default is `chunk`. */
export type SnapshotPolicy =
  | {
      /** Emits after every input chunk. */
      mode: "chunk"
    }
  | {
      /** Emits when an input chunk completes one or more primitive values. */
      mode: "value"
    }
  | {
      /** Emits after this many or more source bytes have arrived. */
      bytes: number
      mode: "bytes"
    }
  | {
      /** Emits one snapshot after the complete JSON document is parsed. */
      mode: "final"
    }

/** A text or UTF-8 byte chunk accepted by `iterate()`. */
export type SchemaStreamInputChunk = string | Uint8Array

/** A Web Stream or async iterable that supplies JSON text or UTF-8 bytes. */
export type SchemaStreamSource<TChunk extends SchemaStreamInputChunk = SchemaStreamInputChunk> =
  ReadableStream<TChunk> | AsyncIterable<TChunk>

type OpenSource<TChunk extends SchemaStreamInputChunk> = {
  iterator: AsyncIterator<TChunk>
  finish(cancel: boolean): Promise<void>
}

type JsonContainer = Record<string | number, unknown>

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function setOwnValue(target: JsonContainer, key: string | number, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}

function setPathValue(target: Record<string, unknown>, path: SchemaPath, value: unknown): void {
  if (path.length === 0) {
    return
  }

  let current: JsonContainer = target

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]
    const nextSegment = path[index + 1]

    if (segment === undefined) {
      continue
    }

    const existing = hasOwn(current, segment) ? current[segment] : undefined
    if (typeof existing === "object" && existing !== null) {
      current = existing as JsonContainer
      continue
    }

    const nextValue = (typeof nextSegment === "number" ? [] : {}) as JsonContainer
    setOwnValue(current, segment, nextValue)
    current = nextValue
  }

  const finalSegment = path[path.length - 1]
  if (finalSegment !== undefined) {
    setOwnValue(current, finalSegment, value)
  }
}

function getPathKey(path: SchemaPath): string {
  return path
    .map(segment => {
      if (segment === undefined) return "u"
      if (typeof segment === "number") return `n:${segment}`
      return `s:${segment.length}:${segment}`
    })
    .join("|")
}

function openSource<TChunk extends SchemaStreamInputChunk>(
  source: SchemaStreamSource<TChunk>
): OpenSource<TChunk> {
  const asyncIterable = source as AsyncIterable<TChunk>
  if (typeof asyncIterable[Symbol.asyncIterator] === "function") {
    const iterator = asyncIterable[Symbol.asyncIterator]()

    return {
      iterator,
      async finish(cancel): Promise<void> {
        if (cancel) {
          await iterator.return?.()
        }
      }
    }
  }

  const readable = source as ReadableStream<TChunk>
  if (typeof readable.getReader !== "function") {
    throw new TypeError("SchemaStream.iterate() requires a ReadableStream or AsyncIterable")
  }

  const reader = readable.getReader()
  let released = false

  return {
    iterator: {
      async next(): Promise<IteratorResult<TChunk>> {
        const next = await reader.read()
        return next.done ? { done: true, value: undefined } : { done: false, value: next.value }
      }
    },
    async finish(cancel): Promise<void> {
      try {
        if (cancel) {
          await reader.cancel()
        }
      } finally {
        if (!released) {
          released = true
          reader.releaseLock()
        }
      }
    }
  }
}

/**
 * Parses chunked JSON into schema-shaped intermediate values. SchemaStream does not
 * validate chunks; consumers should validate the final value with their Zod schema.
 *
 * @typeParam TSchema - Object schema that determines placeholders and snapshot inference.
 */
export class SchemaStream<TSchema extends ZodObjectSchema> {
  private schemaInstance: Record<string, unknown>
  private activePath: SchemaPath = []
  private completedPaths: SchemaPath[] = []
  private completedPathKeys = new Set<string>()
  private readonly onKeyComplete?: OnKeyCompleteCallback
  private readonly typeDefaults?: TypeDefaults

  /**
   * Creates parser state and schema-derived placeholders for one streamed JSON document.
   *
   * @param schema - Zod 3, Zod 4, or Zod Mini object schema used for types and placeholders.
   * @param options - Placeholder defaults and completion reporting.
   */
  public constructor(schema: TSchema, options: SchemaStreamOptions<TSchema> = {}) {
    this.typeDefaults = options.typeDefaults
    this.schemaInstance = this.createBlankObject(
      schema,
      options.defaultData as Record<string, unknown> | undefined
    )
    this.onKeyComplete = options.onKeyComplete
  }

  private getTypeDefault(type: keyof TypeDefaults): unknown {
    return this.typeDefaults && hasOwn(this.typeDefaults, type) ? this.typeDefaults[type] : null
  }

  private createStubValue(
    schema: ZodSchema,
    explicitDefault: unknown,
    hasExplicitDefault: boolean,
    ancestors: ReadonlySet<ZodSchema>
  ): unknown {
    if (ancestors.has(schema)) {
      return null
    }

    const nextAncestors = new Set(ancestors).add(schema)
    const node = getSchemaNode(schema)

    if (node.type === "transparent") {
      return this.createStubValue(
        node.innerType,
        explicitDefault,
        hasExplicitDefault,
        nextAncestors
      )
    }

    if (hasExplicitDefault) {
      if (node.type === "object" && isObject(explicitDefault)) {
        return this.createBlankObjectFromShape(node.shape, explicitDefault, nextAncestors)
      }

      return explicitDefault
    }

    switch (node.type) {
      case "default":
      case "prefault":
        return node.value
      case "string":
      case "number":
      case "boolean":
        return this.getTypeDefault(node.type)
      case "array":
        return []
      case "record":
        return {}
      case "object":
        return this.createBlankObjectFromShape(node.shape, undefined, nextAncestors)
      case "enum":
      case "null":
      case "unknown":
        return null
    }
  }

  private createBlankObjectFromShape(
    shape: Readonly<Record<string, ZodSchema>>,
    defaultData?: Record<string, unknown>,
    ancestors: ReadonlySet<ZodSchema> = new Set()
  ): Record<string, unknown> {
    const object: Record<string, unknown> = {}

    for (const [key, schema] of Object.entries(shape)) {
      const hasExplicitDefault = defaultData !== undefined && hasOwn(defaultData, key)
      setOwnValue(
        object,
        key,
        this.createStubValue(schema, defaultData?.[key], hasExplicitDefault, ancestors)
      )
    }

    return object
  }

  private createBlankObject(
    schema: ZodObjectSchema,
    defaultData?: Record<string, unknown>
  ): Record<string, unknown> {
    return this.createBlankObjectFromShape(getObjectShape(schema), defaultData, new Set([schema]))
  }

  private getPathFromStack(
    stack: StackElement[] = [],
    key: string | number | undefined
  ): SchemaPath {
    return [...stack.map(element => element.key), key].slice(1)
  }

  private emitCompletion(): void {
    this.onKeyComplete?.({
      activePath: [...this.activePath],
      completedPaths: this.completedPaths.map(path => [...path])
    })
  }

  private handleToken({
    parser: { key, stack },
    tokenizer: { value, partial }
  }: {
    parser: {
      state: TokenParserState
      key: string | number | undefined
      mode: TokenParserMode | undefined
      stack: StackElement[]
    }
    tokenizer: ParsedTokenInfo
  }): boolean {
    const valuePath = this.getPathFromStack(stack, key)
    this.activePath = valuePath

    if (!partial && valuePath.length > 0) {
      const pathKey = getPathKey(valuePath)
      if (!this.completedPathKeys.has(pathKey)) {
        this.completedPathKeys.add(pathKey)
        this.completedPaths.push([...valuePath])
      }
    }

    setPathValue(this.schemaInstance, valuePath, value)

    this.emitCompletion()
    return !partial && valuePath.length > 0
  }

  /**
   * Returns a new schema-derived stub using this instance's primitive defaults.
   *
   * @typeParam TStubSchema - Object schema whose input type determines the returned stub.
   * @param schema - Schema used to derive nested placeholders.
   * @param defaultData - Field-level placeholders that override derived defaults.
   * @returns A new partial, schema-shaped value that is independent of parser state.
   */
  public getSchemaStub<TStubSchema extends ZodObjectSchema>(
    schema: TStubSchema,
    defaultData?: SchemaStreamDefaultData<TStubSchema>
  ): SchemaStreamChunk<TStubSchema> {
    return this.createBlankObject(
      schema,
      defaultData as Record<string, unknown> | undefined
    ) as SchemaStreamChunk<TStubSchema>
  }

  private createTransform(
    options: SchemaStreamParseOptions,
    onSnapshot?: (snapshot: Uint8Array) => void
  ): TransformStream<Uint8Array, Uint8Array> {
    const textEncoder = new TextEncoder()
    const snapshotPolicy = options.snapshotPolicy ?? { mode: "chunk" }
    if (
      snapshotPolicy.mode === "bytes" &&
      (!Number.isFinite(snapshotPolicy.bytes) ||
        !Number.isInteger(snapshotPolicy.bytes) ||
        snapshotPolicy.bytes <= 0)
    ) {
      throw new TypeError("snapshotPolicy.bytes must be a positive, finite integer")
    }
    const parser = new JSONParser({
      stringBufferSize: options.stringBufferSize ?? 0,
      handleUnescapedNewLines: options.handleUnescapedNewLines ?? true
    })
    let bytesSinceEmission = 0
    let completedValuesSinceEmission = 0
    let parserRevision = 0
    let emittedRevision = -1

    parser.onToken = parsedToken => {
      const completedValue = this.handleToken(parsedToken)
      parserRevision += 1
      if (completedValue) {
        completedValuesSinceEmission += 1
      }
    }
    parser.onValue = () => undefined

    const emitSnapshot = (controller: TransformStreamDefaultController<Uint8Array>): void => {
      const snapshot = textEncoder.encode(JSON.stringify(this.schemaInstance))
      controller.enqueue(snapshot)
      onSnapshot?.(snapshot)
      bytesSinceEmission = 0
      completedValuesSinceEmission = 0
      emittedRevision = parserRevision
    }

    const shouldEmit = (): boolean => {
      if (snapshotPolicy.mode === "chunk") {
        return true
      }
      if (snapshotPolicy.mode === "value") {
        return completedValuesSinceEmission > 0
      }
      if (snapshotPolicy.mode === "bytes") {
        return bytesSinceEmission >= snapshotPolicy.bytes
      }
      return false
    }

    return new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller): void => {
        try {
          parser.write(chunk)
          bytesSinceEmission += chunk.byteLength
          if (shouldEmit()) {
            emitSnapshot(controller)
          }
        } catch (error) {
          controller.error(error)
        }
      },
      flush: controller => {
        if (!parser.isEnded) {
          parser.end()
        }
        if (snapshotPolicy.mode !== "chunk" && emittedRevision !== parserRevision) {
          emitSnapshot(controller)
        }
        this.activePath = []
        this.emitCompletion()
      }
    })
  }

  /**
   * Creates a transform that emits cumulative JSON snapshots at the selected cadence.
   * Omitting `snapshotPolicy` preserves the existing one-snapshot-per-input-chunk behavior.
   *
   * @param options - Tokenizer behavior and snapshot cadence.
   * @returns A byte transform whose outputs are serialized schema-shaped snapshots.
   * @throws {TypeError} When a byte snapshot threshold is not a positive finite integer.
   */
  public parse(options: SchemaStreamParseOptions = {}): TransformStream<Uint8Array, Uint8Array> {
    return this.createTransform(options)
  }

  /**
   * Consumes streamed JSON text or bytes and yields immutable schema-shaped snapshots.
   * The completed value is still unvalidated; use the producing SDK's settled output or
   * validate the final snapshot with the schema.
   *
   * @typeParam TChunk - Source chunk type, inferred from the stream or async iterable.
   * @param source - JSON text or UTF-8 bytes supplied with source backpressure.
   * @param options - Tokenizer behavior and snapshot cadence.
   * @returns An async generator of independent schema-shaped values.
   * @throws {TypeError} When the source or byte snapshot threshold is invalid.
   * @throws {Error} When the source fails or the JSON is malformed or truncated.
   */
  public async *iterate<TChunk extends SchemaStreamInputChunk>(
    source: SchemaStreamSource<TChunk>,
    options: SchemaStreamParseOptions = {}
  ): AsyncGenerator<SchemaStreamChunk<TSchema>, void, void> {
    const decoder = new TextDecoder()
    const outputQueue: SchemaStreamChunk<TSchema>[] = []
    const transform = this.createTransform(options, snapshot => {
      outputQueue.push(JSON.parse(decoder.decode(snapshot)) as SchemaStreamChunk<TSchema>)
    })
    const sourceHandle = openSource(source)
    const reader = transform.readable.getReader()
    const writer = transform.writable.getWriter()
    const encoder = new TextEncoder()
    let sourceDone = false
    let parserDone = false
    const outputPump = (async () => {
      while (!(await reader.read()).done) {
        // Reading relieves TransformStream backpressure; createTransform owns snapshot decoding.
      }
    })()

    try {
      while (true) {
        const next = await sourceHandle.iterator.next()
        if (next.done) {
          sourceDone = true
          break
        }

        const input: SchemaStreamInputChunk = next.value
        const bytes = typeof input === "string" ? encoder.encode(input) : input
        await writer.write(bytes)
        while (outputQueue.length > 0) {
          yield outputQueue.shift() as SchemaStreamChunk<TSchema>
        }
      }

      await writer.close()
      await outputPump
      while (outputQueue.length > 0) {
        yield outputQueue.shift() as SchemaStreamChunk<TSchema>
      }
      parserDone = true
    } finally {
      const cleanup: Promise<unknown>[] = [sourceHandle.finish(!sourceDone)]

      if (!parserDone) {
        cleanup.push(writer.abort(), reader.cancel())
      }

      cleanup.push(outputPump.catch(() => undefined))
      await Promise.allSettled(cleanup)
      writer.releaseLock()
      reader.releaseLock()
    }
  }
}
