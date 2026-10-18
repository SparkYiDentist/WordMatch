import { lookupWord } from './vocabulary-service'

export type ImportStatus = 'matched' | 'not_found' | 'manual'
export type ImportSource = 'dictionary' | 'user_import' | 'manual'

export interface ImportedWordRecord {
  english: string
  meanings: string[]
  matchMeaning: string
  fullMeaning: string
  systemWordId?: string
  status: ImportStatus
  source: ImportSource
  candidates: Array<{ id: string; matchMeaning: string; fullMeaning: string; partOfSpeech: string }>
}

export interface ImportRow {
  english: string
  meaning: string
  meanings?: string[]
}

export interface ImportIssue {
  lineNumber: number
  raw: string
  reason: string
}

export interface ImportParseResult {
  rows: ImportRow[]
  issues: ImportIssue[]
  duplicateCount: number
  mergedMeaningCount: number
  invalidCount: number
  truncated: boolean
}

const MAX_IMPORT_ROWS = 1000
const ENGLISH_PATTERN = /^[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*)*$/
const CHINESE_PATTERN = /[\u3400-\u9fff]/

const cleanCell = (value: string): string => value
  .replace(/^\uFEFF/, '')
  .trim()
  .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
  .trim()

export const normalizeImportedEnglish = (value: string): string => cleanCell(value)
  .replace(/[;；]+$/, '')
  .trim()
  .toLocaleLowerCase()

export const parseMeanings = (value: string): string[] => {
  const seen = new Set<string>()
  return cleanCell(value)
    .split(/[；;|]/)
    .map(item => item.trim())
    .filter(item => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else cell += character
  }
  cells.push(cell)
  return cells
}

const reliableSymbolSplit = (line: string): [string, string] | null => {
  const candidates: number[] = []
  for (let index = 0; index < line.length; index += 1) {
    const symbol = line[index]
    if (symbol !== '-' && symbol !== ':' && symbol !== '：' && symbol !== '—') continue
    const left = cleanCell(line.slice(0, index))
    const right = cleanCell(line.slice(index + 1))
    if (ENGLISH_PATTERN.test(left) && CHINESE_PATTERN.test(right)) candidates.push(index)
  }
  // Prefer the longest valid English side so well-being-幸福 does not split at its inner hyphen.
  const position = candidates.sort((first, second) => second - first)[0]
  return position === undefined ? null : [line.slice(0, position), line.slice(position + 1)]
}

const splitLine = (line: string): [string, string] => {
  if (line.includes('\t')) {
    const cells = line.split('\t')
    return [cells[0], cells.slice(1).join(' ')]
  }
  if (line.includes(',')) {
    const cells = parseCsvLine(line)
    if (cells.length >= 2 && ENGLISH_PATTERN.test(cleanCell(cells[0]))) return [cells[0], cells.slice(1).join(',')]
  }
  return reliableSymbolSplit(line) || [line, '']
}

export const parseWordText = (text: string): ImportParseResult => {
  const rows: ImportRow[] = []
  const rowByEnglish = new Map<string, ImportRow>()
  const issues: ImportIssue[] = []
  let duplicateCount = 0
  let mergedMeaningCount = 0
  let consideredRows = 0
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index]
    const line = original.trim()
    if (!line) continue
    consideredRows += 1
    if (rows.length >= MAX_IMPORT_ROWS) continue
    const [rawEnglish, rawMeaning] = splitLine(line)
    const english = cleanCell(rawEnglish).replace(/[;；]+$/, '').trim()
    const meanings = parseMeanings(rawMeaning)
    if (!ENGLISH_PATTERN.test(english)) {
      issues.push({ lineNumber: index + 1, raw: original, reason: '无法可靠识别英文词条与释义' })
      continue
    }
    const key = normalizeImportedEnglish(english)
    const existing = rowByEnglish.get(key)
    if (existing) {
      duplicateCount += 1
      const current = existing.meanings || parseMeanings(existing.meaning)
      const currentSet = new Set(current)
      meanings.forEach(meaning => {
        if (!currentSet.has(meaning)) {
          current.push(meaning)
          currentSet.add(meaning)
          mergedMeaningCount += 1
        }
      })
      existing.meanings = current
      existing.meaning = current.join('；')
      continue
    }
    const row = { english, meaning: meanings.join('；'), meanings }
    rowByEnglish.set(key, row)
    rows.push(row)
  }
  return {
    rows,
    issues,
    duplicateCount,
    mergedMeaningCount,
    invalidCount: issues.length,
    truncated: consideredRows > MAX_IMPORT_ROWS,
  }
}

export const resolveImportedWords = (rows: ImportRow[]): ImportedWordRecord[] => (
  rows.map(row => {
    const english = row.english.trim()
    const meanings = row.meanings?.length ? [...row.meanings] : parseMeanings(row.meaning)
    const lookup = lookupWord(english)
    const candidates = lookup.candidates.map(word => ({
      id: word.id,
      matchMeaning: word.matchMeaning,
      fullMeaning: word.fullMeaning,
      partOfSpeech: word.partOfSpeech || '',
    }))
    if (meanings.length) {
      return {
        english,
        meanings,
        matchMeaning: meanings[0],
        fullMeaning: meanings.join('；'),
        systemWordId: lookup.candidates[0]?.id,
        status: 'manual' as const,
        source: 'user_import' as const,
        candidates,
      }
    }
    if (!lookup.found) return {
      english, meanings: [], matchMeaning: '', fullMeaning: '', status: 'not_found' as const,
      source: 'dictionary' as const, candidates,
    }
    const first = lookup.candidates[0]
    const dictionaryMeanings = first.matchMeanings?.length ? [...first.matchMeanings] : [first.matchMeaning]
    return {
      english,
      meanings: dictionaryMeanings,
      matchMeaning: first.matchMeaning,
      fullMeaning: first.fullMeaning,
      systemWordId: first.id,
      status: 'matched' as const,
      source: 'dictionary' as const,
      candidates,
    }
  })
)
