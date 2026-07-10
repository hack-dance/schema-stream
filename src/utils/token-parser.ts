/**
 * This file has been modified -  but the majority pulled directly from
 *  https://www.npmjs.com/package/@streamparser/json
 *  https://github.com/juanjoDiaz/streamparser-json
 *
 *  Copyright (c) 2020 Juanjo Diaz
 *  https://github.com/juanjoDiaz
 *
 */

import TokenType from "./token-type"

export type JsonPrimitive = string | number | boolean | null
export type JsonKey = string | number | undefined
export type JsonObject = { [key: string]: JsonPrimitive | JsonStruct }
export type JsonArray = (JsonPrimitive | JsonStruct)[]
export type JsonStruct = JsonObject | JsonArray

export const enum TokenParserMode {
  OBJECT = 0,
  ARRAY = 1
}

export interface StackElement {
  emit: boolean
  key: JsonKey
  mode?: TokenParserMode
  value: JsonStruct
}

export interface ParsedTokenInfo {
  offset?: number
  partial?: boolean
  token: TokenType
  value: JsonPrimitive
}

export interface ParsedElementInfo {
  key?: JsonKey
  parent?: JsonStruct
  stack: StackElement[]
  value: JsonPrimitive | JsonStruct
}

export const enum TokenParserState {
  VALUE = 0,
  KEY = 1,
  COLON = 2,
  COMMA = 3,
  ENDED = 4,
  ERROR = 5,
  SEPARATOR = 6
}

function tokenParserStateToString(state: TokenParserState): string {
  return ["VALUE", "KEY", "COLON", "COMMA", "ENDED", "ERROR", "SEPARATOR"][state]
}

export interface TokenParserOptions {
  keepStack?: boolean
  paths?: string[]
  separator?: string
}

const defaultOpts: TokenParserOptions = {
  paths: undefined,
  keepStack: true,
  separator: undefined
}

export class TokenParserError extends Error {
  constructor(message: string) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export default class TokenParser {
  private readonly paths?: (string[] | undefined)[]
  private readonly keepStack: boolean
  private readonly separator?: string
  state: TokenParserState = TokenParserState.VALUE
  mode: TokenParserMode | undefined = undefined
  key: JsonKey = undefined
  value: JsonStruct | undefined = undefined
  stack: StackElement[] = []

  constructor(opts?: TokenParserOptions) {
    const options = { ...defaultOpts, ...opts }

    if (options.paths) {
      const paths: (string[] | undefined)[] = []
      for (const path of options.paths) {
        if (path === undefined || path === "$*") {
          paths.push(undefined)
          continue
        }

        if (!path.startsWith("$")) {
          throw new TokenParserError(`Invalid selector "${path}". Should start with "$".`)
        }
        const pathParts = path.split(".").slice(1)
        if (pathParts.includes("")) {
          throw new TokenParserError(`Invalid selector "${path}". ".." syntax not supported.`)
        }
        paths.push(pathParts)
      }
      this.paths = paths
    }

    this.keepStack = options.keepStack ?? true
    this.separator = options.separator
  }

  private shouldEmit(): boolean {
    if (!this.paths) {
      return true
    }

    return this.paths.some(path => {
      if (path === undefined) {
        return true
      }
      if (path.length !== this.stack.length) {
        return false
      }

      for (let i = 0; i < path.length - 1; i += 1) {
        const selector = path[i]
        const { key } = this.stack[i + 1]
        if (selector === "*") {
          continue
        }
        if (selector !== key) {
          return false
        }
      }

      const selector = path.at(-1)
      if (selector === "*") {
        return true
      }
      return selector === this.key?.toString()
    })
  }

  private push(): void {
    this.stack.push({
      key: this.key,
      value: this.value as JsonStruct,
      mode: this.mode,
      emit: this.shouldEmit()
    })
  }

  private pop(): void {
    const { value } = this
    const stackElement = this.stack.pop()
    if (!stackElement) {
      throw new TokenParserError("Unexpected container end without a parent stack entry")
    }

    const { emit, key, mode, value: parentValue } = stackElement
    this.key = key
    this.mode = mode
    this.value = parentValue

    this.state = this.mode === undefined ? TokenParserState.VALUE : TokenParserState.COMMA

    this.emit(value as JsonPrimitive | JsonStruct, emit)
  }

  private emit(value: JsonPrimitive | JsonStruct, emit: boolean): void {
    if (!this.keepStack && this.value && this.stack.every(item => !item.emit)) {
      if (Array.isArray(this.value) && typeof this.key === "number") {
        delete this.value[this.key]
      } else if (!Array.isArray(this.value) && typeof this.key === "string") {
        delete this.value[this.key]
      }
    }

    if (emit) {
      this.onValue({
        value,
        key: this.key,
        parent: this.value,
        stack: this.stack
      })
    }

    if (this.stack.length === 0) {
      if (this.separator) {
        this.state = TokenParserState.SEPARATOR
      } else if (this.separator === undefined) {
        this.end()
      }
      // else if separator === '', expect next JSON object.
    }
  }

  public get isEnded(): boolean {
    return this.state === TokenParserState.ENDED
  }

  public write({ token, value, partial }: Omit<ParsedTokenInfo, "offset">): void {
    if (partial) {
      return
    }

    try {
      if (this.state === TokenParserState.VALUE) {
        if (
          token === TokenType.STRING ||
          token === TokenType.NUMBER ||
          token === TokenType.TRUE ||
          token === TokenType.FALSE ||
          token === TokenType.NULL
        ) {
          if (this.mode === TokenParserMode.OBJECT) {
            ;(this.value as JsonObject)[this.key as string] = value
            this.state = TokenParserState.COMMA
          } else if (this.mode === TokenParserMode.ARRAY) {
            ;(this.value as JsonArray).push(value)
            this.state = TokenParserState.COMMA
          }

          this.emit(value, this.shouldEmit())
          return
        }

        if (token === TokenType.LEFT_BRACE) {
          this.push()
          if (this.mode === TokenParserMode.OBJECT) {
            const object: JsonObject = {}
            ;(this.value as JsonObject)[this.key as string] = object
            this.value = object
          } else if (this.mode === TokenParserMode.ARRAY) {
            const val = {}
            ;(this.value as JsonArray).push(val)
            this.value = val
          } else {
            this.value = {}
          }
          this.mode = TokenParserMode.OBJECT
          this.state = TokenParserState.KEY
          this.key = undefined
          return
        }

        if (token === TokenType.LEFT_BRACKET) {
          this.push()
          if (this.mode === TokenParserMode.OBJECT) {
            const array: JsonArray = []
            ;(this.value as JsonObject)[this.key as string] = array
            this.value = array
          } else if (this.mode === TokenParserMode.ARRAY) {
            const val: JsonArray = []
            ;(this.value as JsonArray).push(val)
            this.value = val
          } else {
            this.value = []
          }
          this.mode = TokenParserMode.ARRAY
          this.state = TokenParserState.VALUE
          this.key = 0
          return
        }

        if (
          this.mode === TokenParserMode.ARRAY &&
          token === TokenType.RIGHT_BRACKET &&
          (this.value as JsonArray).length === 0
        ) {
          this.pop()
          return
        }
      }

      if (this.state === TokenParserState.KEY) {
        if (token === TokenType.STRING) {
          this.key = value as string
          this.state = TokenParserState.COLON
          return
        }

        if (token === TokenType.RIGHT_BRACE && Object.keys(this.value as JsonObject).length === 0) {
          this.pop()
          return
        }
      }

      if (this.state === TokenParserState.COLON && token === TokenType.COLON) {
        this.state = TokenParserState.VALUE
        return
      }

      if (this.state === TokenParserState.COMMA) {
        if (token === TokenType.COMMA) {
          if (this.mode === TokenParserMode.ARRAY) {
            this.state = TokenParserState.VALUE
            ;(this.key as number) += 1
            return
          }

          if (this.mode === TokenParserMode.OBJECT) {
            this.state = TokenParserState.KEY
            return
          }
        }

        if (
          (token === TokenType.RIGHT_BRACE && this.mode === TokenParserMode.OBJECT) ||
          (token === TokenType.RIGHT_BRACKET && this.mode === TokenParserMode.ARRAY)
        ) {
          this.pop()
          return
        }
      }

      if (
        this.state === TokenParserState.SEPARATOR &&
        token === TokenType.SEPARATOR &&
        value === this.separator
      ) {
        this.state = TokenParserState.VALUE
        return
      }

      throw new TokenParserError(
        `Unexpected ${TokenType[token]} (${JSON.stringify(
          value
        )}) in state ${tokenParserStateToString(this.state)}`
      )
    } catch (error: unknown) {
      this.error(error instanceof Error ? error : new Error(String(error)))
    }
  }

  public error(err: Error): void {
    if (this.state !== TokenParserState.ENDED) {
      this.state = TokenParserState.ERROR
    }

    this.onError(err)
  }

  public end(): void {
    if (
      (this.state !== TokenParserState.VALUE && this.state !== TokenParserState.SEPARATOR) ||
      this.stack.length > 0
    ) {
      this.error(
        new Error(
          `Parser ended in mid-parsing (state: ${tokenParserStateToString(
            this.state
          )}). Either not all the data was received or the data was invalid.`
        )
      )
    } else {
      this.state = TokenParserState.ENDED
      this.onEnd()
    }
  }

  public onValue(_parsedElementInfo: ParsedElementInfo): void {
    throw new TokenParserError('Can\'t emit data before the "onValue" callback has been set up.')
  }

  public onError(err: Error): void {
    // Override me
    throw err
  }

  public onEnd(): void {
    // Override me
  }
}
