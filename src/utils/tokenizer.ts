/**
 * This file has been modified -  but the majority pulled directly from
 *  https://www.npmjs.com/package/@streamparser/json
 *  https://github.com/juanjoDiaz/streamparser-json
 *
 *  Copyright (c) 2020 Juanjo Diaz
 *  https://github.com/juanjoDiaz
 *
 */

import { BufferedString, NonBufferedString, type StringBuilder } from "./buffered-string"
import type { ParsedTokenInfo } from "./token-parser"
import TokenType from "./token-type"
import { charset, escapedSequences } from "./utf-8.js"

// Tokenizer States
const enum TokenizerStates {
  START = 0,
  ENDED = 1,
  ERROR = 2,
  TRUE1 = 3,
  TRUE2 = 4,
  TRUE3 = 5,
  FALSE1 = 6,
  FALSE2 = 7,
  FALSE3 = 8,
  FALSE4 = 9,
  NULL1 = 10,
  NULL2 = 11,
  NULL3 = 12,
  STRING_DEFAULT = 13,
  STRING_AFTER_BACKSLASH = 14,
  STRING_UNICODE_DIGIT_1 = 15,
  STRING_UNICODE_DIGIT_2 = 16,
  STRING_UNICODE_DIGIT_3 = 17,
  STRING_UNICODE_DIGIT_4 = 18,
  STRING_INCOMPLETE_CHAR = 19,
  NUMBER_AFTER_INITIAL_MINUS = 20,
  NUMBER_AFTER_INITIAL_ZERO = 21,
  NUMBER_AFTER_INITIAL_NON_ZERO = 22,
  NUMBER_AFTER_FULL_STOP = 23,
  NUMBER_AFTER_DECIMAL = 24,
  NUMBER_AFTER_E = 25,
  NUMBER_AFTER_E_AND_SIGN = 26,
  NUMBER_AFTER_E_AND_DIGIT = 27,
  SEPARATOR = 28
}

function tokenizerStateToString(tokenizerState: TokenizerStates): string {
  return [
    "START",
    "ENDED",
    "ERROR",
    "TRUE1",
    "TRUE2",
    "TRUE3",
    "FALSE1",
    "FALSE2",
    "FALSE3",
    "FALSE4",
    "NULL1",
    "NULL2",
    "NULL3",
    "STRING_DEFAULT",
    "STRING_AFTER_BACKSLASH",
    "STRING_UNICODE_DIGIT_1",
    "STRING_UNICODE_DIGIT_2",
    "STRING_UNICODE_DIGIT_3",
    "STRING_UNICODE_DIGIT_4",
    "STRING_INCOMPLETE_CHAR",
    "NUMBER_AFTER_INITIAL_MINUS",
    "NUMBER_AFTER_INITIAL_ZERO",
    "NUMBER_AFTER_INITIAL_NON_ZERO",
    "NUMBER_AFTER_FULL_STOP",
    "NUMBER_AFTER_DECIMAL",
    "NUMBER_AFTER_E",
    "NUMBER_AFTER_E_AND_SIGN",
    "NUMBER_AFTER_E_AND_DIGIT",
    "SEPARATOR"
  ][tokenizerState]
}

/** Internal tokenizer controls shared by the streaming parser and its compatibility layer. */
export interface TokenizerOptions {
  handleUnescapedNewLines?: boolean
  numberBufferSize?: number
  /**
   * Controls partial string callback frequency without changing source chunks or snapshot policy.
   * Character mode preserves legacy progress cadence; chunk mode coalesces hot-path updates.
   */
  partialStringTokenMode?: "character" | "chunk"
  separator?: string
  stringBufferSize?: number
}

const defaultOpts: TokenizerOptions = {
  stringBufferSize: 0,
  numberBufferSize: 0,
  partialStringTokenMode: "character",
  separator: undefined,
  handleUnescapedNewLines: false
}

export class TokenizerError extends Error {
  constructor(message: string) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Tokenizes JSON across arbitrary byte boundaries, including split UTF-8 and escape sequences.
 * Chunk string mode batches contiguous ASCII bytes and flushes one partial value after each write.
 */
export default class Tokenizer {
  private state = TokenizerStates.START

  private readonly handleUnescapedNewLines?: boolean
  private readonly separator?: string
  private readonly separatorBytes?: Uint8Array
  private separatorIndex = 0
  private readonly bufferedString: StringBuilder
  private readonly bufferedNumber: StringBuilder
  private readonly batchStringsByChunk: boolean

  private unicode?: string // unicode escapes
  private highSurrogate?: number
  private bytesRemaining = 0
  private bytesInSequence = 0
  private readonly charSplitBuffer = new Uint8Array(4)
  private readonly encoder = new TextEncoder()
  private offset = -1

  private appendPendingHighSurrogate(): void {
    if (this.highSurrogate === undefined) {
      return
    }

    this.bufferedString.appendString(String.fromCharCode(this.highSurrogate))
    this.highSurrogate = undefined
  }

  constructor(opts?: TokenizerOptions) {
    const options = { ...defaultOpts, ...opts }

    const onIncrementalString = (str: string) => {
      this.onToken({
        token: TokenType.STRING,
        value: str,
        partial: true
      })
    }

    this.bufferedString =
      options.stringBufferSize && options.stringBufferSize > 0
        ? new BufferedString(options.stringBufferSize)
        : new NonBufferedString({
            deferIncrementalUpdates: options.partialStringTokenMode === "chunk",
            onIncrementalString
          })
    this.batchStringsByChunk =
      options.partialStringTokenMode === "chunk" && !(options.stringBufferSize ?? 0)

    this.bufferedNumber =
      options.numberBufferSize && options.numberBufferSize > 0
        ? new BufferedString(options.numberBufferSize, onIncrementalString)
        : new NonBufferedString({})

    this.handleUnescapedNewLines = options.handleUnescapedNewLines ?? false
    this.separator = options.separator
    this.separatorBytes = options.separator ? this.encoder.encode(options.separator) : undefined
  }

  public get isEnded(): boolean {
    return this.state === TokenizerStates.ENDED
  }

  public write(input: Iterable<number> | string): void {
    try {
      let buffer: Uint8Array
      if (input instanceof Uint8Array) {
        buffer = input
      } else if (typeof input === "string") {
        buffer = this.encoder.encode(input)
      } else if ((typeof input === "object" && "buffer" in input) || Array.isArray(input)) {
        buffer = Uint8Array.from(input)
      } else {
        throw new TypeError(
          "Unexpected type. The `write` function only accepts Arrays, TypedArrays and Strings."
        )
      }

      for (let i = 0; i < buffer.length; i += 1) {
        const n = buffer[i] // get current byte from buffer
        switch (this.state) {
          case TokenizerStates.START:
            this.offset += 1

            if (this.separatorBytes && n === this.separatorBytes[0]) {
              if (this.separatorBytes.length === 1) {
                this.state = TokenizerStates.START
                this.onToken({
                  token: TokenType.SEPARATOR,
                  value: this.separator as string,
                  offset: this.offset + this.separatorBytes.length - 1
                })
                continue
              }
              this.state = TokenizerStates.SEPARATOR
              continue
            }

            if (
              n === charset.SPACE ||
              n === charset.NEWLINE ||
              n === charset.CARRIAGE_RETURN ||
              n === charset.TAB
            ) {
              // whitespace
              continue
            }

            if (n === charset.LEFT_CURLY_BRACKET) {
              this.onToken({
                token: TokenType.LEFT_BRACE,
                value: "{",
                offset: this.offset
              })
              continue
            }
            if (n === charset.RIGHT_CURLY_BRACKET) {
              this.onToken({
                token: TokenType.RIGHT_BRACE,
                value: "}",
                offset: this.offset
              })
              continue
            }
            if (n === charset.LEFT_SQUARE_BRACKET) {
              this.onToken({
                token: TokenType.LEFT_BRACKET,
                value: "[",
                offset: this.offset
              })
              continue
            }
            if (n === charset.RIGHT_SQUARE_BRACKET) {
              this.onToken({
                token: TokenType.RIGHT_BRACKET,
                value: "]",
                offset: this.offset
              })
              continue
            }
            if (n === charset.COLON) {
              this.onToken({
                token: TokenType.COLON,
                value: ":",
                offset: this.offset
              })
              continue
            }
            if (n === charset.COMMA) {
              this.onToken({
                token: TokenType.COMMA,
                value: ",",
                offset: this.offset
              })
              continue
            }

            if (n === charset.LATIN_SMALL_LETTER_T) {
              this.state = TokenizerStates.TRUE1
              continue
            }

            if (n === charset.LATIN_SMALL_LETTER_F) {
              this.state = TokenizerStates.FALSE1
              continue
            }

            if (n === charset.LATIN_SMALL_LETTER_N) {
              this.state = TokenizerStates.NULL1
              continue
            }

            if (n === charset.QUOTATION_MARK) {
              this.bufferedString.reset()
              this.state = TokenizerStates.STRING_DEFAULT
              continue
            }

            if (n >= charset.DIGIT_ONE && n <= charset.DIGIT_NINE) {
              this.bufferedNumber.reset()
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_INITIAL_NON_ZERO
              continue
            }

            if (n === charset.DIGIT_ZERO) {
              this.bufferedNumber.reset()
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_INITIAL_ZERO
              continue
            }

            if (n === charset.HYPHEN_MINUS) {
              this.bufferedNumber.reset()
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_INITIAL_MINUS
              continue
            }

            break
          // STRING
          case TokenizerStates.STRING_DEFAULT:
            if (n === charset.REVERSE_SOLIDUS) {
              this.state = TokenizerStates.STRING_AFTER_BACKSLASH
              continue
            }

            this.appendPendingHighSurrogate()

            if (this.handleUnescapedNewLines && n === charset.NEWLINE) {
              this.bufferedString.appendChar(charset.REVERSE_SOLIDUS) // Appends '\'
              this.bufferedString.appendChar(charset.LATIN_SMALL_LETTER_N) // Appends 'n'
              continue
            }

            if (n === charset.QUOTATION_MARK) {
              const string = this.bufferedString.toString()
              this.state = TokenizerStates.START
              this.onToken({
                token: TokenType.STRING,
                value: string,
                offset: this.offset
              })
              this.offset += this.bufferedString.byteLength + 1
              continue
            }

            if (n >= 128) {
              // Parse multi byte (>=128) chars one at a time
              if (n >= 194 && n <= 223) {
                this.bytesInSequence = 2
              } else if (n <= 239) {
                this.bytesInSequence = 3
              } else {
                this.bytesInSequence = 4
              }

              if (this.bytesInSequence <= buffer.length - i) {
                // if bytes needed to complete char fall outside buffer length, we have a boundary split
                this.bufferedString.appendBuf(buffer, i, i + this.bytesInSequence)
                i += this.bytesInSequence - 1
                continue
              }

              this.bytesRemaining = i + this.bytesInSequence - buffer.length
              this.charSplitBuffer.set(buffer.subarray(i))
              i = buffer.length - 1
              this.state = TokenizerStates.STRING_INCOMPLETE_CHAR
              continue
            }

            if (n >= charset.SPACE) {
              if (this.batchStringsByChunk) {
                let end = i + 1
                while (end < buffer.length) {
                  const next = buffer[end]
                  if (
                    next < charset.SPACE ||
                    next >= 128 ||
                    next === charset.QUOTATION_MARK ||
                    next === charset.REVERSE_SOLIDUS
                  ) {
                    break
                  }
                  end += 1
                }
                this.bufferedString.appendBuf(buffer, i, end)
                i = end - 1
              } else {
                this.bufferedString.appendChar(n)
              }
              continue
            }

            break
          case TokenizerStates.STRING_INCOMPLETE_CHAR: {
            // Carry a multibyte character across as many input chunks as needed.
            const availableBytes = Math.min(this.bytesRemaining, buffer.length - i)
            const targetOffset = this.bytesInSequence - this.bytesRemaining
            this.charSplitBuffer.set(buffer.subarray(i, i + availableBytes), targetOffset)
            this.bytesRemaining -= availableBytes
            i += availableBytes - 1

            if (this.bytesRemaining === 0) {
              this.bufferedString.appendBuf(this.charSplitBuffer, 0, this.bytesInSequence)
              this.state = TokenizerStates.STRING_DEFAULT
            }

            continue
          }
          case TokenizerStates.STRING_AFTER_BACKSLASH:
            if (escapedSequences?.[n]) {
              this.appendPendingHighSurrogate()
              this.bufferedString.appendChar(escapedSequences[n])
              this.state = TokenizerStates.STRING_DEFAULT
              continue
            }

            if (n === charset.LATIN_SMALL_LETTER_U) {
              this.unicode = ""
              this.state = TokenizerStates.STRING_UNICODE_DIGIT_1
              continue
            }

            break
          case TokenizerStates.STRING_UNICODE_DIGIT_1:
          case TokenizerStates.STRING_UNICODE_DIGIT_2:
          case TokenizerStates.STRING_UNICODE_DIGIT_3:
            if (
              (n >= charset.DIGIT_ZERO && n <= charset.DIGIT_NINE) ||
              (n >= charset.LATIN_CAPITAL_LETTER_A && n <= charset.LATIN_CAPITAL_LETTER_F) ||
              (n >= charset.LATIN_SMALL_LETTER_A && n <= charset.LATIN_SMALL_LETTER_F)
            ) {
              this.unicode += String.fromCharCode(n)
              this.state += 1
              continue
            }
            break
          case TokenizerStates.STRING_UNICODE_DIGIT_4:
            if (
              (n >= charset.DIGIT_ZERO && n <= charset.DIGIT_NINE) ||
              (n >= charset.LATIN_CAPITAL_LETTER_A && n <= charset.LATIN_CAPITAL_LETTER_F) ||
              (n >= charset.LATIN_SMALL_LETTER_A && n <= charset.LATIN_SMALL_LETTER_F)
            ) {
              const intVal = Number.parseInt(this.unicode + String.fromCharCode(n), 16)
              if (this.highSurrogate === undefined) {
                if (intVal >= 0xd8_00 && intVal <= 0xdb_ff) {
                  //<55296,56319> - highSurrogate
                  this.highSurrogate = intVal
                } else {
                  this.bufferedString.appendString(String.fromCharCode(intVal))
                }
              } else if (intVal >= 0xdc_00 && intVal <= 0xdf_ff) {
                //<56320,57343> - lowSurrogate
                this.bufferedString.appendString(String.fromCharCode(this.highSurrogate, intVal))
                this.highSurrogate = undefined
              } else {
                this.appendPendingHighSurrogate()
                if (intVal >= 0xd8_00 && intVal <= 0xdb_ff) {
                  this.highSurrogate = intVal
                } else {
                  this.bufferedString.appendString(String.fromCharCode(intVal))
                }
              }
              this.state = TokenizerStates.STRING_DEFAULT
              continue
            }
            break
          // Number
          case TokenizerStates.NUMBER_AFTER_INITIAL_MINUS:
            if (n === charset.DIGIT_ZERO) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_INITIAL_ZERO
              continue
            }

            if (n >= charset.DIGIT_ONE && n <= charset.DIGIT_NINE) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_INITIAL_NON_ZERO
              continue
            }

            break
          case TokenizerStates.NUMBER_AFTER_INITIAL_ZERO:
            if (n === charset.FULL_STOP) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_FULL_STOP
              continue
            }

            if (n === charset.LATIN_SMALL_LETTER_E || n === charset.LATIN_CAPITAL_LETTER_E) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_E
              continue
            }

            i -= 1
            this.state = TokenizerStates.START
            this.emitNumber()
            continue
          case TokenizerStates.NUMBER_AFTER_INITIAL_NON_ZERO:
            if (n >= charset.DIGIT_ZERO && n <= charset.DIGIT_NINE) {
              this.bufferedNumber.appendChar(n)
              continue
            }

            if (n === charset.FULL_STOP) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_FULL_STOP
              continue
            }

            if (n === charset.LATIN_SMALL_LETTER_E || n === charset.LATIN_CAPITAL_LETTER_E) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_E
              continue
            }

            i -= 1
            this.state = TokenizerStates.START
            this.emitNumber()
            continue
          case TokenizerStates.NUMBER_AFTER_FULL_STOP:
            if (n >= charset.DIGIT_ZERO && n <= charset.DIGIT_NINE) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_DECIMAL
              continue
            }

            break
          case TokenizerStates.NUMBER_AFTER_DECIMAL:
            if (n >= charset.DIGIT_ZERO && n <= charset.DIGIT_NINE) {
              this.bufferedNumber.appendChar(n)
              continue
            }

            if (n === charset.LATIN_SMALL_LETTER_E || n === charset.LATIN_CAPITAL_LETTER_E) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_E
              continue
            }

            i -= 1
            this.state = TokenizerStates.START
            this.emitNumber()
            continue
          case TokenizerStates.NUMBER_AFTER_E:
            if (n === charset.PLUS_SIGN || n === charset.HYPHEN_MINUS) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_E_AND_SIGN
              continue
            }

            if (n >= charset.DIGIT_ZERO && n <= charset.DIGIT_NINE) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_E_AND_DIGIT
              continue
            }

            break
          case TokenizerStates.NUMBER_AFTER_E_AND_SIGN:
            if (n >= charset.DIGIT_ZERO && n <= charset.DIGIT_NINE) {
              this.bufferedNumber.appendChar(n)
              this.state = TokenizerStates.NUMBER_AFTER_E_AND_DIGIT
              continue
            }

            break
          case TokenizerStates.NUMBER_AFTER_E_AND_DIGIT:
            if (n >= charset.DIGIT_ZERO && n <= charset.DIGIT_NINE) {
              this.bufferedNumber.appendChar(n)
              continue
            }

            i -= 1
            this.state = TokenizerStates.START
            this.emitNumber()
            continue
          // TRUE
          case TokenizerStates.TRUE1:
            if (n === charset.LATIN_SMALL_LETTER_R) {
              this.state = TokenizerStates.TRUE2
              continue
            }
            break
          case TokenizerStates.TRUE2:
            if (n === charset.LATIN_SMALL_LETTER_U) {
              this.state = TokenizerStates.TRUE3
              continue
            }
            break
          case TokenizerStates.TRUE3:
            if (n === charset.LATIN_SMALL_LETTER_E) {
              this.state = TokenizerStates.START
              this.onToken({
                token: TokenType.TRUE,
                value: true,
                offset: this.offset
              })
              this.offset += 3
              continue
            }
            break
          // FALSE
          case TokenizerStates.FALSE1:
            if (n === charset.LATIN_SMALL_LETTER_A) {
              this.state = TokenizerStates.FALSE2
              continue
            }
            break
          case TokenizerStates.FALSE2:
            if (n === charset.LATIN_SMALL_LETTER_L) {
              this.state = TokenizerStates.FALSE3
              continue
            }
            break
          case TokenizerStates.FALSE3:
            if (n === charset.LATIN_SMALL_LETTER_S) {
              this.state = TokenizerStates.FALSE4
              continue
            }
            break
          case TokenizerStates.FALSE4:
            if (n === charset.LATIN_SMALL_LETTER_E) {
              this.state = TokenizerStates.START
              this.onToken({
                token: TokenType.FALSE,
                value: false,
                offset: this.offset
              })
              this.offset += 4
              continue
            }
            break
          // NULL
          case TokenizerStates.NULL1:
            if (n === charset.LATIN_SMALL_LETTER_U) {
              this.state = TokenizerStates.NULL2
              continue
            }
            break
          case TokenizerStates.NULL2:
            if (n === charset.LATIN_SMALL_LETTER_L) {
              this.state = TokenizerStates.NULL3
              continue
            }
            break
          case TokenizerStates.NULL3:
            if (n === charset.LATIN_SMALL_LETTER_L) {
              this.state = TokenizerStates.START
              this.onToken({
                token: TokenType.NULL,
                value: null,
                offset: this.offset
              })
              this.offset += 3
              continue
            }
            break
          case TokenizerStates.SEPARATOR:
            this.separatorIndex += 1
            if (!this.separatorBytes || n !== this.separatorBytes[this.separatorIndex]) {
              break
            }
            if (this.separatorIndex === this.separatorBytes.length - 1) {
              this.state = TokenizerStates.START
              this.onToken({
                token: TokenType.SEPARATOR,
                value: this.separator as string,
                offset: this.offset + this.separatorIndex
              })
              this.separatorIndex = 0
            }
            continue
          case TokenizerStates.ENDED:
            if (
              n === charset.SPACE ||
              n === charset.NEWLINE ||
              n === charset.CARRIAGE_RETURN ||
              n === charset.TAB
            ) {
              // whitespace
              continue
            }
            break
          default:
            break
        }

        throw new TokenizerError(
          `Unexpected "${String.fromCharCode(
            n
          )}" at position "${i}" in state ${tokenizerStateToString(this.state)}`
        )
      }
      this.bufferedString.flushPending()
    } catch (error: unknown) {
      this.error(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private emitNumber(): void {
    this.onToken({
      token: TokenType.NUMBER,
      value: this.parseNumber(this.bufferedNumber.toString()),
      offset: this.offset
    })
    this.offset += this.bufferedNumber.byteLength - 1
  }

  protected parseNumber(numberStr: string): number {
    return Number(numberStr)
  }

  public error(err: Error): void {
    if (this.state !== TokenizerStates.ENDED) {
      this.state = TokenizerStates.ERROR
    }

    this.onError(err)
  }

  public end(): void {
    switch (this.state) {
      case TokenizerStates.NUMBER_AFTER_INITIAL_ZERO:
      case TokenizerStates.NUMBER_AFTER_INITIAL_NON_ZERO:
      case TokenizerStates.NUMBER_AFTER_DECIMAL:
      case TokenizerStates.NUMBER_AFTER_E_AND_DIGIT:
        this.state = TokenizerStates.ENDED
        this.emitNumber()
        this.onEnd()
        break
      case TokenizerStates.START:
      case TokenizerStates.ERROR:
      case TokenizerStates.SEPARATOR:
        this.state = TokenizerStates.ENDED
        this.onEnd()
        break
      default:
        this.error(
          new TokenizerError(
            `Tokenizer ended in the middle of a token (state: ${tokenizerStateToString(
              this.state
            )}). Either not all the data was received or the data was invalid.`
          )
        )
    }
  }

  public onToken(_parsedToken: ParsedTokenInfo): void {
    // Override me
    throw new TokenizerError('Can\'t emit tokens before the "onToken" callback has been set up.')
  }

  public onError(err: Error): void {
    // Override me
    throw err
  }

  public onEnd(): void {
    // Override me
  }
}
