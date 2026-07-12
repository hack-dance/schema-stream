/**
 * This file has been modified -  but the majority pulled directly from
 *  https://www.npmjs.com/package/@streamparser/json
 *  https://github.com/juanjoDiaz/streamparser-json
 *
 *  Copyright (c) 2020 Juanjo Diaz
 *  https://github.com/juanjoDiaz
 *
 */

export interface StringBuilder {
  appendBuf: (buf: Uint8Array, start?: number, end?: number) => void
  appendChar: (char: number) => void
  appendString: (value: string) => void
  byteLength: number
  flushPending: () => void
  reset: () => void
  toString: () => string
}

/**
 * Accumulates an unbounded decoded string while optionally coalescing incremental updates.
 * Deferred mode records every mutation but publishes at most once per tokenizer input chunk.
 */
export class NonBufferedString implements StringBuilder {
  private readonly decoder = new TextDecoder("utf-8")
  private readonly encoder = new TextEncoder()
  private string = ""
  private updateRevision = 0
  private flushedRevision = 0
  private readonly deferIncrementalUpdates: boolean
  private readonly onIncrementalString?: (str: string) => void

  public byteLength = 0

  constructor({
    deferIncrementalUpdates = false,
    onIncrementalString
  }: {
    deferIncrementalUpdates?: boolean
    onIncrementalString?: (str: string) => void
  }) {
    this.deferIncrementalUpdates = deferIncrementalUpdates
    this.onIncrementalString = onIncrementalString ?? undefined
  }

  public appendChar(char: number): void {
    this.string += String.fromCharCode(char)
    this.byteLength += 1
    this.update()
  }

  public appendBuf(buf: Uint8Array, start = 0, end: number = buf.length): void {
    this.string += this.decoder.decode(buf.subarray(start, end))
    this.byteLength += end - start
    this.update()
  }

  public appendString(value: string): void {
    this.string += value
    this.byteLength += this.encoder.encode(value).byteLength
    this.update()
  }

  private update(): void {
    if (!this.onIncrementalString) {
      return
    }
    if (this.deferIncrementalUpdates) {
      this.updateRevision += 1
      return
    }
    this.onIncrementalString(this.string)
  }

  /** Publishes a deferred incremental value once when the accumulated string has changed. */
  public flushPending(): void {
    if (this.flushedRevision === this.updateRevision || !this.onIncrementalString) {
      return
    }
    this.flushedRevision = this.updateRevision
    this.onIncrementalString(this.string)
  }

  public reset(): void {
    this.string = ""
    this.updateRevision = 0
    this.flushedRevision = 0
    this.byteLength = 0
  }

  public toString(): string {
    this.flushedRevision = this.updateRevision
    return this.string
  }
}

/** Accumulates string bytes in fixed-size blocks before decoding and publishing them. */
export class BufferedString implements StringBuilder {
  private readonly decoder = new TextDecoder("utf-8")
  private readonly encoder = new TextEncoder()
  private readonly buffer: Uint8Array
  private bufferOffset = 0
  private string = ""
  private readonly onIncrementalString?: (str: string) => void

  public byteLength = 0

  public constructor(bufferSize: number, onIncrementalString?: (str: string) => void) {
    this.buffer = new Uint8Array(bufferSize)
    this.onIncrementalString = onIncrementalString ?? undefined
  }

  public appendChar(char: number): void {
    if (this.bufferOffset >= this.buffer.length) {
      this.flushStringBuffer()
    }
    this.buffer[this.bufferOffset] = char
    this.bufferOffset += 1
    this.byteLength += 1
  }

  public appendBuf(buf: Uint8Array, start = 0, end: number = buf.length): void {
    const size = end - start
    if (this.bufferOffset + size > this.buffer.length) {
      this.flushStringBuffer()
    }

    if (size > this.buffer.length) {
      this.string += this.decoder.decode(buf.subarray(start, end))
      this.byteLength += size
      this.update()
      return
    }

    this.buffer.set(buf.subarray(start, end), this.bufferOffset)
    this.bufferOffset += size
    this.byteLength += size
  }

  public appendString(value: string): void {
    this.flushStringBuffer()
    this.string += value
    this.byteLength += this.encoder.encode(value).byteLength
    this.update()
  }

  private flushStringBuffer(): void {
    if (this.bufferOffset === 0) {
      return
    }

    this.string += this.decoder.decode(this.buffer.subarray(0, this.bufferOffset))
    this.bufferOffset = 0
    this.update()
  }

  private update(): void {
    if (this.onIncrementalString) {
      this.onIncrementalString(this.string)
    }
  }

  /** Leaves buffered publication to the configured byte threshold and final string read. */
  public flushPending(): void {
    // Intentionally empty: BufferedString publishes through its byte-threshold flush.
  }

  public reset(): void {
    this.string = ""
    this.bufferOffset = 0
    this.byteLength = 0
  }
  public toString(): string {
    this.flushStringBuffer()
    return this.string
  }
}
