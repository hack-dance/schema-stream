import { cloneJsonSnapshot } from "./json-clone"
import JSONParser from "./json-parser"
import type {
  ParsedElementInfo,
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

/** Legacy progress state reported after a streamed value changes. */
export type OnKeyCompleteCallbackParams = {
  /** The value currently receiving streamed content, or an empty path after parsing finishes. */
  activePath: SchemaPath
  /** Unique value paths that have completed at least once, in completion order. */
  completedPaths: SchemaPath[]
}

/** Receives independent path snapshots as streamed values progress and complete. */
export type OnKeyCompleteCallback = (data: OnKeyCompleteCallbackParams) => void

/** Object keys and array indexes locating a syntactically complete JSON value. */
export type SchemaStreamValuePath = readonly (string | number)[]

/** A single completed-value event without cumulative completion history. */
export type OnValueCompleteCallbackParams = {
  /**
   * Path of the value that just completed. Children complete before their containers, and an empty
   * path identifies the completed root document.
   */
  path: SchemaStreamValuePath
  /**
   * The syntactically complete JSON value at `path`. The parser does not clone container values for
   * this callback; consumers should treat objects and arrays as read-only because mutations can be
   * visible in later ancestor and root completion events.
   */
  value: unknown
}

/** Receives the path and value when each primitive or container finishes parsing. */
export type OnValueCompleteCallback = (event: OnValueCompleteCallbackParams) => void

/** Configures schema-derived placeholders and completion reporting. */
export type SchemaStreamOptions<TSchema extends ZodObjectSchema> = {
  /** Field-level placeholders that take precedence over schema and primitive defaults. */
  defaultData?: SchemaStreamDefaultData<TSchema>
  /** Fallback placeholders for primitive schema nodes. Defaults to `null`. */
  typeDefaults?: TypeDefaults
  /** Called as values progress and once more with an empty active path after completion. */
  onKeyComplete?: OnKeyCompleteCallback
  /**
   * Called once for each completed JSON value, including containers and the root document. Unlike
   * `onKeyComplete`, this callback emits a path delta and does not copy cumulative history.
   */
  onValueComplete?: OnValueCompleteCallback
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

/** Controls when cumulative JSON snapshots are emitted. The default is `chunk`. */
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
  | ReadableStream<TChunk>
  | AsyncIterable<TChunk>

type OpenSource<TChunk extends SchemaStreamInputChunk> = {
  iterator: AsyncIterator<TChunk>
  finish: (cancel: boolean) => Promise<void>
}

type ParserSession = {
  finish: () => boolean
  write: (chunk: Uint8Array) => boolean
}

type JsonContainer = Record<string | number, unknown>

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Writes schema-shaped values without invoking inherited setters or the legacy `__proto__`
 * mutator. Compatible own properties retain the assignment fast path used by progressive updates.
 */
function setOwnValue(target: JsonContainer, key: string | number, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  const hasCompatibleOwnDataProperty =
    descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.configurable === true &&
    descriptor.enumerable === true &&
    descriptor.writable === true
  const canCreateWithAssignment = descriptor === undefined && !(key in target)

  if (hasCompatibleOwnDataProperty || canCreateWithAssignment) {
    target[key] = value
    return
  }

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

  const finalSegment = path.at(-1)
  if (finalSegment !== undefined) {
    setOwnValue(current, finalSegment, value)
  }
}

function getPathValue(target: Record<string, unknown>, path: SchemaPath): unknown {
  let current: unknown = target

  for (const segment of path) {
    if (segment === undefined) {
      continue
    }
    if (typeof current !== "object" || current === null || !hasOwn(current, segment)) {
      return
    }
    current = (current as JsonContainer)[segment]
  }

  return current
}

function getPathKey(path: SchemaPath): string {
  return path
    .map(segment => {
      if (segment === undefined) {
        return "u"
      }
      if (typeof segment === "number") {
        return `n:${segment}`
      }
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
  private readonly schemaInstance: Record<string, unknown>
  private activePath: SchemaPath = []
  private readonly completedPaths: SchemaPath[] = []
  private readonly completedPathKeys = new Set<string>()
  private readonly onKeyComplete?: OnKeyCompleteCallback
  private readonly onValueComplete?: OnValueCompleteCallback
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
    this.onValueComplete = options.onValueComplete
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
      default:
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

  private getPathFromStack(stack: StackElement[], key: string | number | undefined): SchemaPath {
    if (stack.length === 0) {
      return []
    }

    const path: SchemaPath = new Array(stack.length)
    for (let index = 1; index < stack.length; index += 1) {
      path[index - 1] = stack[index].key
    }
    path[stack.length - 1] = key
    return path
  }

  private emitCompletion(): void {
    this.onKeyComplete?.({
      activePath: [...this.activePath],
      completedPaths: this.completedPaths.map(path => [...path])
    })
  }

  private recordCompletedPath(valuePath: SchemaPath): void {
    if (valuePath.length === 0) {
      return
    }

    const pathKey = getPathKey(valuePath)
    if (!this.completedPathKeys.has(pathKey)) {
      this.completedPathKeys.add(pathKey)
      this.completedPaths.push([...valuePath])
    }
  }

  private handleEmptyContainer({
    parsedValue: { key, stack, value },
    valuePath
  }: {
    parsedValue: ParsedElementInfo
    valuePath?: SchemaPath
  }): boolean {
    const emptyArray = Array.isArray(value) && value.length === 0
    const emptyObject = isObject(value) && Object.keys(value).length === 0
    if (!(emptyArray || emptyObject)) {
      return false
    }

    const resolvedPath = valuePath ?? this.getPathFromStack(stack, key)
    const existingValue = getPathValue(this.schemaInstance, resolvedPath)
    const alreadyPresent = emptyArray
      ? Array.isArray(existingValue) && existingValue.length === 0
      : isObject(existingValue) && Object.keys(existingValue).length === 0
    if (alreadyPresent) {
      return false
    }

    if (resolvedPath.length > 0) {
      if (this.onKeyComplete) {
        this.activePath = resolvedPath
        this.recordCompletedPath(resolvedPath)
      }
      setPathValue(this.schemaInstance, resolvedPath, emptyArray ? [] : {})
      if (this.onKeyComplete) {
        this.emitCompletion()
      }
    }

    return true
  }

  /**
   * Handles TokenParser's canonical completed-value boundary. Completion deltas are dispatched only
   * here so partial string tokens cannot emit them and primitives cannot be reported twice.
   *
   * @param parsedValue - Completed primitive or container with its parser stack location.
   * @returns Whether an empty container changed the schema-shaped parser state.
   */
  private handleCompletedValue(parsedValue: ParsedElementInfo): boolean {
    const callback = this.onValueComplete
    const valuePath = callback
      ? this.getPathFromStack(parsedValue.stack, parsedValue.key)
      : undefined
    const changedParserState = this.handleEmptyContainer({ parsedValue, valuePath })

    if (callback && valuePath && valuePath.length > 0) {
      const path: (string | number)[] = []
      for (const segment of valuePath) {
        if (segment !== undefined) {
          path.push(segment)
        }
      }
      callback({ path, value: parsedValue.value })
    }

    return changedParserState
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
    if (this.onKeyComplete) {
      this.activePath = valuePath
      if (!partial && valuePath.length > 0) {
        this.recordCompletedPath(valuePath)
      }
    }

    setPathValue(this.schemaInstance, valuePath, value)

    if (this.onKeyComplete) {
      this.emitCompletion()
    }
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

  /**
   * Creates tokenizer state and emission accounting for one parse operation. Legacy progress events
   * retain character-level string cadence, while completed-value events use TokenParser's single
   * `onValue` boundary and therefore keep chunk-batched tokenization.
   *
   * @param options - Tokenizer behavior and snapshot cadence for this operation.
   * @returns Stateful write and finish operations shared by `parse()` and `iterate()`.
   */
  private createParserSession(options: SchemaStreamParseOptions): ParserSession {
    const snapshotPolicy = options.snapshotPolicy ?? { mode: "chunk" }
    if (
      snapshotPolicy.mode === "bytes" &&
      (!(Number.isFinite(snapshotPolicy.bytes) && Number.isInteger(snapshotPolicy.bytes)) ||
        snapshotPolicy.bytes <= 0)
    ) {
      throw new TypeError("snapshotPolicy.bytes must be a positive, finite integer")
    }
    const parser = new JSONParser({
      stringBufferSize: options.stringBufferSize ?? 0,
      handleUnescapedNewLines: options.handleUnescapedNewLines ?? true,
      partialStringTokenMode: this.onKeyComplete ? "character" : "chunk"
    })
    let bytesSinceEmission = 0
    let completedValuesSinceEmission = 0
    let parserRevision = 0
    let emittedRevision = -1
    let hasParsedValue = false
    let rootCompletionPending = false
    let rootCompletionValue: unknown

    parser.onToken = parsedToken => {
      const completedValue = this.handleToken(parsedToken)
      parserRevision += 1
      if (completedValue) {
        completedValuesSinceEmission += 1
      }
    }
    parser.onValue = parsedValue => {
      hasParsedValue = true
      if (this.onValueComplete && parsedValue.stack.length === 0) {
        rootCompletionPending = true
        rootCompletionValue = parsedValue.value
      }
      if (this.handleCompletedValue(parsedValue)) {
        parserRevision += 1
      }
    }

    const recordEmission = (): void => {
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

    return {
      finish: (): boolean => {
        if (!parser.isEnded) {
          parser.end()
        }
        const emitFinalSnapshot =
          snapshotPolicy.mode !== "chunk" && hasParsedValue && emittedRevision !== parserRevision
        if (emitFinalSnapshot) {
          recordEmission()
        }
        if (rootCompletionPending) {
          rootCompletionPending = false
          this.onValueComplete?.({ path: [], value: rootCompletionValue })
          rootCompletionValue = undefined
        }
        this.activePath = []
        this.emitCompletion()
        return emitFinalSnapshot
      },
      write: (chunk): boolean => {
        parser.write(chunk)
        bytesSinceEmission += chunk.byteLength
        if (!shouldEmit()) {
          return false
        }
        recordEmission()
        return true
      }
    }
  }

  /**
   * Materializes an independent object snapshot without serialized UTF-8. Parser-owned JSON data
   * uses the direct clone; custom serializers and exotic values dynamically retain the native
   * stringify/parse contract.
   */
  private createObjectSnapshot(): SchemaStreamChunk<TSchema> {
    return cloneJsonSnapshot({ value: this.schemaInstance }) as SchemaStreamChunk<TSchema>
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
    const session = this.createParserSession(options)
    const textEncoder = new TextEncoder()
    const createSnapshot = (): Uint8Array => {
      const json = JSON.stringify(this.schemaInstance)
      if (json === undefined) {
        return new Uint8Array()
      }
      return textEncoder.encode(json)
    }

    return new TransformStream<Uint8Array, Uint8Array>({
      flush: controller => {
        if (session.finish()) {
          controller.enqueue(createSnapshot())
        }
      },
      transform: (chunk, controller): void => {
        try {
          if (session.write(chunk)) {
            controller.enqueue(createSnapshot())
          }
        } catch (error) {
          controller.error(error)
        }
      }
    })
  }

  /**
   * Consumes streamed JSON text or bytes and yields independent schema-shaped snapshots.
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
    const session = this.createParserSession(options)
    const sourceHandle = openSource(source)
    const encoder = new TextEncoder()
    let sourceDone = false

    try {
      while (true) {
        const next = await sourceHandle.iterator.next()
        if (next.done) {
          sourceDone = true
          break
        }

        const input: SchemaStreamInputChunk = next.value
        const bytes = typeof input === "string" ? encoder.encode(input) : input
        if (session.write(bytes)) {
          yield this.createObjectSnapshot()
        }
      }

      if (session.finish()) {
        yield this.createObjectSnapshot()
      }
    } finally {
      await Promise.allSettled([sourceHandle.finish(!sourceDone)])
    }
  }
}
