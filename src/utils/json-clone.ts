type JsonContainer = Record<string, unknown> | unknown[]

type CloneFrame =
  | {
      index: number
      input: unknown[]
      output: unknown[]
      type: "array"
    }
  | {
      index: number
      input: Record<string, unknown>
      keys: string[]
      output: Record<string, unknown>
      type: "object"
    }

const omittedValue = Symbol("omitted JSON value")
const requiresJsonRoundTrip = Symbol("requires JSON round trip")
const maximumRecursiveDepth = 128

function cloneScalar(value: unknown): unknown | typeof omittedValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === "bigint") {
    throw requiresJsonRoundTrip
  }
  if (typeof value === "function" && "toJSON" in value) {
    throw requiresJsonRoundTrip
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return omittedValue
  }
  return value
}

function hasCustomJsonBehavior(value: object): boolean {
  return "toJSON" in value
}

/**
 * Creates one traversal frame for JSON-domain arrays and plain objects.
 * Custom `toJSON` behavior and exotic prototypes deliberately request the native JSON fallback.
 */
function createCloneFrame(input: JsonContainer): { frame: CloneFrame; output: JsonContainer } {
  if (hasCustomJsonBehavior(input)) {
    throw requiresJsonRoundTrip
  }
  if (Array.isArray(input)) {
    const output = new Array<unknown>(input.length)
    return { frame: { index: 0, input, output, type: "array" }, output }
  }

  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    throw requiresJsonRoundTrip
  }
  const output: Record<string, unknown> = {}
  return {
    frame: { index: 0, input, keys: Object.keys(input), output, type: "object" },
    output
  }
}

/** Writes clone keys without invoking inherited setters such as `Object.prototype.__proto__`. */
function setCloneValue(
  target: Record<string, unknown> | unknown[],
  key: string | number,
  value: unknown
): void {
  if (key in target) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    })
    return
  }
  const writableTarget = target as Record<string | number, unknown>
  writableTarget[key] = value
}

/**
 * Clones a deeply nested JSON container with explicit frames so adversarial depth cannot exhaust
 * the JavaScript call stack. The ancestor set preserves native `JSON.stringify` cycle failures.
 */
function cloneJsonContainerIterative(
  root: JsonContainer,
  inheritedAncestors: ReadonlySet<object>
): JsonContainer {
  const rootClone = createCloneFrame(root)
  const ancestors = new Set<object>(inheritedAncestors)
  if (ancestors.has(root)) {
    throw requiresJsonRoundTrip
  }
  ancestors.add(root)
  const frames: CloneFrame[] = [rootClone.frame]

  while (frames.length > 0) {
    const frame = frames.at(-1) as CloneFrame
    const isComplete =
      frame.type === "array" ? frame.index >= frame.input.length : frame.index >= frame.keys.length
    if (isComplete) {
      ancestors.delete(frame.input)
      frames.pop()
      continue
    }

    const key = frame.type === "array" ? frame.index : frame.keys[frame.index]
    const inputValue =
      frame.type === "array" ? frame.input[frame.index] : frame.input[frame.keys[frame.index]]
    frame.index += 1
    const value = cloneScalar(inputValue)
    if (value === omittedValue) {
      if (frame.type === "array") {
        setCloneValue(frame.output, key, null)
      }
      continue
    }
    if (typeof value !== "object" || value === null) {
      setCloneValue(frame.output, key, value)
      continue
    }
    if (ancestors.has(value)) {
      throw requiresJsonRoundTrip
    }

    const childClone = createCloneFrame(value as JsonContainer)
    setCloneValue(frame.output, key, childClone.output)
    ancestors.add(value)
    frames.push(childClone.frame)
  }

  return rootClone.output
}

/**
 * Clones shallow JSON-domain values recursively for the common JIT-friendly path, then switches
 * to explicit frames at the depth limit. JSON omissions and number normalization match a native
 * stringify/parse round trip.
 */
function cloneJsonValue(
  inputValue: unknown,
  ancestors: Set<object>,
  depth: number
): unknown | typeof omittedValue {
  const value = cloneScalar(inputValue)
  if (value === omittedValue || typeof value !== "object" || value === null) {
    return value
  }
  if (ancestors.has(value)) {
    throw requiresJsonRoundTrip
  }
  if (depth >= maximumRecursiveDepth) {
    return cloneJsonContainerIterative(value as JsonContainer, ancestors)
  }

  const clone = createCloneFrame(value as JsonContainer)
  ancestors.add(value)
  if (clone.frame.type === "array") {
    for (let index = 0; index < clone.frame.input.length; index += 1) {
      const child = cloneJsonValue(clone.frame.input[index], ancestors, depth + 1)
      setCloneValue(clone.frame.output, index, child === omittedValue ? null : child)
    }
  } else {
    for (const key of clone.frame.keys) {
      const child = cloneJsonValue(clone.frame.input[key], ancestors, depth + 1)
      if (child !== omittedValue) {
        setCloneValue(clone.frame.output, key, child)
      }
    }
  }
  ancestors.delete(value)
  return clone.output
}

/** Clones parser-owned JSON data without allocating serialized text or UTF-8 bytes. */
function cloneJsonDomain(root: Record<string, unknown>): Record<string, unknown> {
  return cloneJsonValue(root, new Set(), 0) as Record<string, unknown>
}

/** Preserves native JSON behavior for custom serializers, exotic values, and cyclic errors. */
function cloneWithJsonRoundTrip(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

/**
 * Creates an independent JSON-equivalent object without allocating UTF-8 snapshots.
 * Custom or exotic graphs retain the exact legacy stringify/parse behavior.
 */
export function cloneJsonSnapshot({
  value
}: {
  value: Record<string, unknown>
}): Record<string, unknown> {
  try {
    return cloneJsonDomain(value)
  } catch (error) {
    if (error === requiresJsonRoundTrip) {
      return cloneWithJsonRoundTrip(value)
    }
    throw error
  }
}
