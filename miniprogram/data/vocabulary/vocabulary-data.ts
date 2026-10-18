import { VOCABULARY_DATA_Z85, VOCABULARY_PACKED_BYTES } from './generated-compressed-data'

export type EncodedWord = readonly [string, string, string, string, string, string, number, readonly string[]]

const Z85_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#'

const decodeZ85 = (source: string, byteLength: number): Uint8Array => {
  const alphabetIndex = new Int16Array(128)
  alphabetIndex.fill(-1)
  for (let index = 0; index < Z85_ALPHABET.length; index += 1) {
    alphabetIndex[Z85_ALPHABET.charCodeAt(index)] = index
  }

  const output = new Uint8Array(byteLength)
  let outputIndex = 0
  for (let index = 0; index < source.length; index += 5) {
    let value = 0
    for (let digit = 0; digit < 5; digit += 1) {
      const code = source.charCodeAt(index + digit)
      const decoded = code < alphabetIndex.length ? alphabetIndex[code] : -1
      if (decoded < 0) throw new Error('Invalid vocabulary encoding')
      value = value * 85 + decoded
    }
    if (outputIndex < byteLength) output[outputIndex] = Math.floor(value / 0x1000000) & 255
    if (outputIndex + 1 < byteLength) output[outputIndex + 1] = (value >>> 16) & 255
    if (outputIndex + 2 < byteLength) output[outputIndex + 2] = (value >>> 8) & 255
    if (outputIndex + 3 < byteLength) output[outputIndex + 3] = value & 255
    outputIndex += 4
  }
  return output
}

const unpack = (packed: Uint8Array): Uint8Array => {
  if (packed.length < 4) throw new Error('Vocabulary package is incomplete')
  const outputLength = (
    packed[0]
    | (packed[1] << 8)
    | (packed[2] << 16)
    | (packed[3] << 24)
  ) >>> 0
  const output = new Uint8Array(outputLength)
  let inputIndex = 4
  let outputIndex = 0

  while (inputIndex < packed.length && outputIndex < output.length) {
    const flags = packed[inputIndex]
    inputIndex += 1
    for (let bit = 0; bit < 8 && inputIndex < packed.length && outputIndex < output.length; bit += 1) {
      if ((flags & (1 << bit)) === 0) {
        output[outputIndex] = packed[inputIndex]
        outputIndex += 1
        inputIndex += 1
        continue
      }
      if (inputIndex + 2 >= packed.length) throw new Error('Vocabulary package ended inside a match')
      const offset = packed[inputIndex] | (packed[inputIndex + 1] << 8)
      const length = packed[inputIndex + 2] + 3
      inputIndex += 3
      if (offset <= 0 || offset > outputIndex) throw new Error('Vocabulary package contains an invalid match')
      for (let index = 0; index < length && outputIndex < output.length; index += 1) {
        output[outputIndex] = output[outputIndex - offset]
        outputIndex += 1
      }
    }
  }
  if (outputIndex !== output.length) throw new Error('Vocabulary package did not fully decode')
  return output
}

const decodeUtf8 = (bytes: Uint8Array): string => {
  let result = ''
  const codeUnits: number[] = []
  const flush = (): void => {
    if (!codeUnits.length) return
    result += String.fromCharCode(...codeUnits)
    codeUnits.length = 0
  }

  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]
    index += 1
    let codePoint = first
    if ((first & 0xe0) === 0xc0) {
      codePoint = ((first & 0x1f) << 6) | (bytes[index] & 0x3f)
      index += 1
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = ((first & 0x0f) << 12) | ((bytes[index] & 0x3f) << 6) | (bytes[index + 1] & 0x3f)
      index += 2
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = ((first & 0x07) << 18)
        | ((bytes[index] & 0x3f) << 12)
        | ((bytes[index + 1] & 0x3f) << 6)
        | (bytes[index + 2] & 0x3f)
      index += 3
    }

    if (codePoint <= 0xffff) codeUnits.push(codePoint)
    else {
      const adjusted = codePoint - 0x10000
      codeUnits.push(0xd800 + (adjusted >>> 10), 0xdc00 + (adjusted & 0x3ff))
    }
    if (codeUnits.length >= 4096) flush()
  }
  flush()
  return result
}

const decodedJson = decodeUtf8(unpack(decodeZ85(VOCABULARY_DATA_Z85, VOCABULARY_PACKED_BYTES)))

export const VOCABULARY_DATA = JSON.parse(decodedJson) as readonly EncodedWord[]
