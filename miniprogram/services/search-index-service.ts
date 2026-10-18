import { VOCABULARY_DATA } from '../data/vocabulary/vocabulary-data'
import { BookId } from '../engine/types'
import { DictionaryMatchKind, DictionarySearchHit } from './dictionary-types'

const BOOK_IDS: BookId[] = ['high_school', 'cet4', 'cet6']
const BOOK_MASKS: Record<BookId, number> = { high_school: 1, cet4: 2, cet6: 4 }

interface SearchRecord {
  id: string
  headword: string
  normalized: string
  matchMeaning: string
  meanings: string
  partOfSpeech: string
  bookMask: number
  representativeMask: number
}

interface SearchIndex {
  records: SearchRecord[]
  exact: Map<string, number>
  sortedEnglish: number[]
  byInitial: Map<string, number[]>
  byChineseCharacter: Map<string, number[]>
}

let cachedIndex: SearchIndex | null = null

const normalizeEnglish = (value: string): string => value.trim().toLocaleLowerCase()
const containsChinese = (value: string): boolean => /[\u3400-\u9fff]/.test(value)

const buildIndex = (): SearchIndex => {
  if (cachedIndex) return cachedIndex
  const records: SearchRecord[] = []
  const exact = new Map<string, number>()
  VOCABULARY_DATA.forEach(tuple => {
    const normalized = normalizeEnglish(tuple[1])
    const existingIndex = exact.get(normalized)
    if (existingIndex !== undefined) {
      const existing = records[existingIndex]
      existing.meanings += `；${tuple[2]}；${tuple[3]}`
      existing.bookMask |= tuple[6]
      const existingCoverage = ((existing.representativeMask & 1) ? 1 : 0)
        + ((existing.representativeMask & 2) ? 1 : 0)
        + ((existing.representativeMask & 4) ? 1 : 0)
      const tupleCoverage = ((tuple[6] & 1) ? 1 : 0) + ((tuple[6] & 2) ? 1 : 0) + ((tuple[6] & 4) ? 1 : 0)
      if (tupleCoverage > existingCoverage) {
        existing.id = tuple[0]
        existing.matchMeaning = tuple[2]
        existing.representativeMask = tuple[6]
      }
      if (tuple[5] && !existing.partOfSpeech.includes(tuple[5])) {
        existing.partOfSpeech += `${existing.partOfSpeech ? ' / ' : ''}${tuple[5]}`
      }
      return
    }
    exact.set(normalized, records.length)
    records.push({
      id: tuple[0],
      headword: tuple[1],
      normalized,
      matchMeaning: tuple[2],
      meanings: `${tuple[2]}；${tuple[3]}`,
      partOfSpeech: tuple[5],
      bookMask: tuple[6],
      representativeMask: tuple[6],
    })
  })

  const sortedEnglish = records.map((_record, index) => index)
    .sort((left, right) => records[left].normalized.localeCompare(records[right].normalized))
  const byInitial = new Map<string, number[]>()
  const byChineseCharacter = new Map<string, number[]>()
  records.forEach((record, index) => {
    const initial = record.normalized[0] || ''
    const bucket = byInitial.get(initial)
    if (bucket) bucket.push(index)
    else byInitial.set(initial, [index])
    const characters = new Set(Array.from(record.meanings).filter(character => /[\u3400-\u9fff]/.test(character)))
    characters.forEach(character => {
      const characterBucket = byChineseCharacter.get(character)
      if (characterBucket) characterBucket.push(index)
      else byChineseCharacter.set(character, [index])
    })
  })
  cachedIndex = { records, exact, sortedEnglish, byInitial, byChineseCharacter }
  return cachedIndex
}

const lowerBound = (indexes: number[], records: SearchRecord[], query: string): number => {
  let low = 0
  let high = indexes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (records[indexes[middle]].normalized < query) low = middle + 1
    else high = middle
  }
  return low
}

const editDistanceAtMostTwo = (left: string, right: string): number => {
  if (Math.abs(left.length - right.length) > 2) return 3
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    let rowMinimum = row
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      const value = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost)
      current.push(value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > 2) return 3
    previous = current
  }
  return previous[right.length]
}

const bookIdsForMask = (mask: number): BookId[] => BOOK_IDS.filter(bookId => (mask & BOOK_MASKS[bookId]) !== 0)

const toHit = (record: SearchRecord, matchKind: DictionaryMatchKind): DictionarySearchHit => ({
  id: record.id,
  headword: record.headword,
  matchMeaning: record.matchMeaning,
  partOfSpeech: record.partOfSpeech,
  bookIds: bookIdsForMask(record.bookMask),
  matchKind,
  matchLabel: matchKind === 'exact'
    ? '精确匹配'
    : matchKind === 'prefix'
      ? '前缀匹配'
      : matchKind === 'meaning'
        ? '释义匹配'
        : matchKind === 'form'
          ? '可能的原形'
          : '拼写相近',
})

const formCandidates = (query: string): string[] => {
  const candidates: string[] = []
  if (query.endsWith('ies') && query.length > 3) candidates.push(`${query.slice(0, -3)}y`)
  if (query.endsWith('ing') && query.length > 4) {
    candidates.push(query.slice(0, -3), `${query.slice(0, -3)}e`)
    if (query.length > 5 && query[query.length - 4] === query[query.length - 5]) candidates.push(query.slice(0, -4))
  }
  if (query.endsWith('ed') && query.length > 3) candidates.push(query.slice(0, -2), `${query.slice(0, -1)}`)
  if (query.endsWith('es') && query.length > 3) candidates.push(query.slice(0, -2), query.slice(0, -1))
  if (query.endsWith('s') && query.length > 2) candidates.push(query.slice(0, -1))
  return [...new Set(candidates)].filter(candidate => candidate !== query)
}

export const searchDictionaryIndex = (query: string, limit: number = 24): DictionarySearchHit[] => {
  const value = query.trim()
  if (!value) return []
  const index = buildIndex()
  const hits: Array<{ recordIndex: number; kind: DictionaryMatchKind; score: number }> = []
  const seen = new Set<number>()
  const add = (recordIndex: number, kind: DictionaryMatchKind, score: number): void => {
    if (seen.has(recordIndex)) return
    seen.add(recordIndex)
    hits.push({ recordIndex, kind, score })
  }

  if (containsChinese(value)) {
    const characters = [...new Set(Array.from(value).filter(character => /[\u3400-\u9fff]/.test(character)))]
    const buckets = characters.map(character => index.byChineseCharacter.get(character) || [])
    const smallest = [...buckets].sort((left, right) => left.length - right.length)[0] || []
    smallest.forEach(recordIndex => {
      const record = index.records[recordIndex]
      if (record.meanings.includes(value)) add(recordIndex, 'meaning', 80)
    })
  } else {
    const normalized = normalizeEnglish(value)
    const exactIndex = index.exact.get(normalized)
    if (exactIndex !== undefined) add(exactIndex, 'exact', 120)

    const start = lowerBound(index.sortedEnglish, index.records, normalized)
    for (let position = start; position < index.sortedEnglish.length && hits.length < limit; position += 1) {
      const recordIndex = index.sortedEnglish[position]
      const record = index.records[recordIndex]
      if (!record.normalized.startsWith(normalized)) break
      add(recordIndex, 'prefix', 100 - Math.min(20, record.normalized.length - normalized.length))
    }

    formCandidates(normalized).forEach(candidate => {
      const recordIndex = index.exact.get(candidate)
      if (recordIndex !== undefined) add(recordIndex, 'form', 70)
    })

    if (normalized.length >= 3 && hits.length < Math.min(8, limit)) {
      const fuzzy = (index.byInitial.get(normalized[0]) || [])
        .filter(recordIndex => Math.abs(index.records[recordIndex].normalized.length - normalized.length) <= 2)
        .map(recordIndex => ({ recordIndex, distance: editDistanceAtMostTwo(normalized, index.records[recordIndex].normalized) }))
        .filter(item => item.distance <= 2)
        .sort((left, right) => left.distance - right.distance
          || index.records[left.recordIndex].normalized.localeCompare(index.records[right.recordIndex].normalized))
        .slice(0, 6)
      fuzzy.forEach(item => add(item.recordIndex, 'similar', 50 - item.distance))
    }
  }

  return hits.sort((left, right) => right.score - left.score
    || index.records[left.recordIndex].normalized.localeCompare(index.records[right.recordIndex].normalized))
    .slice(0, limit)
    .map(hit => toHit(index.records[hit.recordIndex], hit.kind))
}

export const getDictionaryIndexStats = (): { entries: number; sourceSenses: number } => {
  const index = buildIndex()
  return { entries: index.records.length, sourceSenses: VOCABULARY_DATA.length }
}

export const releaseDictionaryIndex = (): void => {
  cachedIndex = null
}
