declare const require: (moduleName: string) => unknown

const PDF_HEADER = '%PDF-'
const MAX_TEXT_LENGTH = 200000
const ENGLISH_LINE = /^[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*)*$/
const CHINESE_TEXT = /[\u3400-\u9fff]/

export type PdfImportErrorCode = 'invalid_pdf' | 'encrypted' | 'unsupported_filter' | 'no_text' | 'dependency_missing'

export class PdfImportError extends Error {
  constructor(public readonly code: PdfImportErrorCode, message: string) {
    super(message)
    this.name = 'PdfImportError'
  }
}

interface PdfStream {
  dictionary: string
  content: string
}

interface InflateModule {
  inflate(data: Uint8Array): Uint8Array
}

let inflateModule: InflateModule | null = null

const inflatePdfBytes = (bytes: Uint8Array): Uint8Array => {
  if (!inflateModule) {
    try {
      // Load only when a compressed PDF is actually selected. This keeps the page usable before WeChat npm is built.
      const loaded = require('pako') as InflateModule | { default?: InflateModule }
      inflateModule = 'inflate' in loaded ? loaded : loaded.default || null
    } catch (_error) {
      throw new PdfImportError('dependency_missing', 'PDF 组件尚未构建。请在微信开发者工具中选择“工具 → 构建 npm”后重试。')
    }
  }
  if (!inflateModule) {
    throw new PdfImportError('dependency_missing', 'PDF 组件尚未构建。请在微信开发者工具中选择“工具 → 构建 npm”后重试。')
  }
  return inflateModule.inflate(bytes)
}

const bytesToLatin1 = (bytes: Uint8Array): string => {
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length))
    let value = ''
    for (let offset = 0; offset < chunk.length; offset += 1) value += String.fromCharCode(chunk[offset])
    chunks.push(value)
  }
  return chunks.join('')
}

const trimStreamEnd = (bytes: Uint8Array): Uint8Array => {
  let end = bytes.length
  while (end > 0 && (bytes[end - 1] === 10 || bytes[end - 1] === 13)) end -= 1
  return bytes.subarray(0, end)
}

const streamDictionary = (source: string, streamIndex: number): string => {
  const windowStart = Math.max(0, streamIndex - 4096)
  const window = source.slice(windowStart, streamIndex)
  const start = window.lastIndexOf('<<')
  return start >= 0 ? window.slice(start) : ''
}

const decodeStream = (dictionary: string, bytes: Uint8Array): string | null => {
  const filters = [...dictionary.matchAll(/\/(?:Filter\s*)?(FlateDecode|Fl|ASCIIHexDecode|ASCII85Decode|LZWDecode|DCTDecode|JPXDecode)\b/g)]
    .map(match => match[1])
  if (!filters.length) return bytesToLatin1(bytes)
  if (filters.some(filter => filter !== 'FlateDecode' && filter !== 'Fl')) return null
  try {
    return bytesToLatin1(inflatePdfBytes(bytes))
  } catch (error) {
    if (error instanceof PdfImportError) throw error
    return null
  }
}

const collectStreams = (bytes: Uint8Array, source: string): { streams: PdfStream[]; skippedFilters: boolean } => {
  const streams: PdfStream[] = []
  let skippedFilters = false
  const pattern = /stream(?:\r\n|\n|\r)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const dataStart = match.index + match[0].length
    const dataEnd = source.indexOf('endstream', dataStart)
    if (dataEnd < 0) break
    const dictionary = streamDictionary(source, match.index)
    const raw = trimStreamEnd(bytes.subarray(dataStart, dataEnd))
    const content = decodeStream(dictionary, raw)
    if (content === null) skippedFilters = true
    else streams.push({ dictionary, content })
    pattern.lastIndex = dataEnd + 9
  }
  return { streams, skippedFilters }
}

const unicodeFromHex = (hex: string): string => {
  const normalized = hex.replace(/\s/g, '')
  let result = ''
  for (let index = 0; index + 3 < normalized.length; index += 4) {
    const code = Number.parseInt(normalized.slice(index, index + 4), 16)
    if (!Number.isNaN(code) && code !== 0xFEFF) result += String.fromCharCode(code)
  }
  return result
}

const incrementHex = (hex: string, amount: number): string => {
  const value = Number.parseInt(hex, 16) + amount
  return value.toString(16).toUpperCase().padStart(hex.length, '0')
}

const parseToUnicodeMaps = (streams: PdfStream[]): Map<string, string> => {
  const map = new Map<string, string>()
  streams.forEach(stream => {
    const content = stream.content
    const pairPattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
    const bfcharBlocks = content.match(/beginbfchar[\s\S]*?endbfchar/g) || []
    bfcharBlocks.forEach(block => {
      let match: RegExpExecArray | null
      while ((match = pairPattern.exec(block))) map.set(match[1].toUpperCase(), unicodeFromHex(match[2]))
      pairPattern.lastIndex = 0
    })
    const rangeBlocks = content.match(/beginbfrange[\s\S]*?endbfrange/g) || []
    rangeBlocks.forEach(block => {
      const rangePattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]+)\])/g
      let range: RegExpExecArray | null
      while ((range = rangePattern.exec(block))) {
        const start = Number.parseInt(range[1], 16)
        const end = Number.parseInt(range[2], 16)
        const arrayTargets = range[4] ? [...range[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map(item => item[1]) : []
        for (let code = start; code <= end && code - start < 4096; code += 1) {
          const sourceHex = code.toString(16).toUpperCase().padStart(range[1].length, '0')
          const targetHex = range[3] ? incrementHex(range[3], code - start) : arrayTargets[code - start]
          if (targetHex) map.set(sourceHex, unicodeFromHex(targetHex))
        }
      }
    })
  })
  return map
}

const decodeLiteral = (token: string): string => {
  const content = token.slice(1, -1)
  let result = ''
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (character !== '\\') {
      result += character
      continue
    }
    const next = content[index + 1]
    if (next === '\r' || next === '\n') {
      index += next === '\r' && content[index + 2] === '\n' ? 2 : 1
      continue
    }
    const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }
    if (escapes[next] !== undefined) {
      result += escapes[next]
      index += 1
      continue
    }
    if (/[0-7]/.test(next || '')) {
      const octal = content.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] || ''
      result += String.fromCharCode(Number.parseInt(octal, 8))
      index += octal.length
      continue
    }
    if (next) { result += next; index += 1 }
  }
  return result
}

const decodeHex = (token: string, unicodeMap: Map<string, string>): string => {
  const hex = token.slice(1, -1).replace(/\s/g, '').toUpperCase()
  if (!hex) return ''
  const keyLengths = [...new Set([...unicodeMap.keys()].map(key => key.length))].sort((a, b) => b - a)
  if (keyLengths.length) {
    let mapped = ''
    let cursor = 0
    while (cursor < hex.length) {
      const length = keyLengths.find(size => unicodeMap.has(hex.slice(cursor, cursor + size)))
      if (!length) { mapped = ''; break }
      mapped += unicodeMap.get(hex.slice(cursor, cursor + length)) || ''
      cursor += length
    }
    if (mapped) return mapped
  }
  if (hex.startsWith('FEFF')) return unicodeFromHex(hex)
  let result = ''
  for (let index = 0; index + 1 < hex.length; index += 2) {
    result += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16))
  }
  return result
}

const decodeTextToken = (token: string, unicodeMap: Map<string, string>): string => {
  if (token.startsWith('(')) return decodeLiteral(token)
  if (token.startsWith('<')) return decodeHex(token, unicodeMap)
  const pieces = token.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g) || []
  return pieces.map(piece => decodeTextToken(piece, unicodeMap)).join('')
}

const extractTextLines = (streams: PdfStream[], unicodeMap: Map<string, string>): string[] => {
  const lines: string[] = []
  const flush = (parts: string[]): void => {
    const line = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
    parts.length = 0
  }
  streams.forEach(stream => {
    const blocks = stream.content.match(/BT[\s\S]*?ET/g) || []
    blocks.forEach(block => {
      const parts: string[] = []
      const tokenPattern = /(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>|\[(?:\\.|[^\]])*\])\s*(Tj|TJ|'|")|(?:^|\s)(T\*|[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+(?:Td|TD)|(?:[-+]?\d*\.?\d+\s+){6}Tm)(?=\s|$)/g
      let token: RegExpExecArray | null
      while ((token = tokenPattern.exec(block))) {
        if (token[3]) {
          flush(parts)
          continue
        }
        if (token[2] === "'") flush(parts)
        const decoded = decodeTextToken(token[1], unicodeMap).replace(/[\u0000-\u001F]+/g, ' ').trim()
        if (decoded) parts.push(decoded)
      }
      flush(parts)
    })
  })
  return lines
}

const normalizePdfLines = (lines: string[]): string => lines
  .map(line => line.replace(/^\s*(?:\d+[.)、]|[-•·▪])\s*/, '').trim())
  .map(line => {
    if (ENGLISH_LINE.test(line)) return line
    if (CHINESE_TEXT.test(line)) {
      const match = line.match(/^([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*)*)\s+(.+)$/)
      if (match && CHINESE_TEXT.test(match[2])) return `${match[1]}\t${match[2]}`
    }
    return line
  })
  .filter(Boolean)
  .join('\n')
  .slice(0, MAX_TEXT_LENGTH)

/** Extracts text rows from ordinary text PDFs. Scanned/image-only PDFs intentionally require OCR and are rejected. */
export const extractWordTextFromPdf = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  const source = bytesToLatin1(bytes)
  if (!source.startsWith(PDF_HEADER)) throw new PdfImportError('invalid_pdf', '文件不是有效的 PDF。')
  if (/\/Encrypt\b/.test(source)) throw new PdfImportError('encrypted', '暂不支持加密或带密码的 PDF。')
  const collected = collectStreams(bytes, source)
  const unicodeMap = parseToUnicodeMaps(collected.streams)
  const text = normalizePdfLines(extractTextLines(collected.streams, unicodeMap))
  if (!text.trim()) {
    const message = collected.skippedFilters
      ? '该 PDF 使用了暂不支持的文本压缩方式，请先导出为 TXT 或 CSV。'
      : '未能提取文字。扫描件或图片型 PDF 暂不支持，请先转换为可复制文字的 PDF。'
    throw new PdfImportError(collected.skippedFilters ? 'unsupported_filter' : 'no_text', message)
  }
  return text
}
