import { VOCABULARY_DATA, EncodedWord } from '../data/vocabulary/vocabulary-data'
import { BOOK_COUNTS } from '../data/vocabulary/generated-meta'
import { BookId, Word } from '../engine/types'

const BOOK_MASKS: Record<BookId, number> = { high_school: 1, cet4: 2, cet6: 4 }
const BOOK_IDS: BookId[] = ['high_school', 'cet4', 'cet6']
const tupleIndexesByBook: Partial<Record<BookId, number[]>> = {}
let tupleById: Map<string, EncodedWord> | null = null
let tuplesByEnglish: Map<string, EncodedWord[]> | null = null

export interface WordLookupResult {
  query: string
  normalized: string
  found: boolean
  candidates: Word[]
}

export interface VocabularyLookupProvider {
  lookup(english: string): WordLookupResult | Promise<WordLookupResult>
}

const decode = (tuple: EncodedWord): Word => {
  const matchMeanings = [tuple[2], ...tuple[7]].slice(0, 3)
  return {
    id: tuple[0],
    english: tuple[1],
    matchMeaning: tuple[2],
    matchMeanings,
    displayMeanings: matchMeanings,
    displayMeaning: matchMeanings.join('；'),
    fullMeaning: tuple[3],
    phonetic: tuple[4],
    partOfSpeech: tuple[5],
    bookIds: BOOK_IDS.filter(bookId => (tuple[6] & BOOK_MASKS[bookId]) !== 0),
  }
}

const indexesForBook = (bookId: BookId): number[] => {
  const cached = tupleIndexesByBook[bookId]
  if (cached) return cached
  const mask = BOOK_MASKS[bookId]
  const indexes: number[] = []
  VOCABULARY_DATA.forEach((tuple, index) => {
    if ((tuple[6] & mask) !== 0) indexes.push(index)
  })
  tupleIndexesByBook[bookId] = indexes
  return indexes
}

const normalizeText = (value: string): string => value
  .toLocaleLowerCase()
  .replace(/[，。；、,.!！?？\s（）()\[\]【】]/g, '')

export const meaningsConflict = (first: string, second: string): boolean => {
  const left = normalizeText(first)
  const right = normalizeText(second)
  if (!left || !right) return true
  return left === right
    || (left.length >= 2 && right.includes(left))
    || (right.length >= 2 && left.includes(right))
}

export const selectMatchMeaning = (word: Word, blockedMeanings: readonly string[]): Word | undefined => {
  const candidates = word.matchMeanings?.length ? word.matchMeanings : [word.matchMeaning]
  const selected = candidates.filter(candidate => (
    !blockedMeanings.some(blocked => meaningsConflict(blocked, candidate))
  )).slice(0, 3)
  if (!selected.length) return undefined
  return {
    ...word,
    matchMeaning: selected[0],
    displayMeanings: selected,
    displayMeaning: selected.join('；'),
  }
}

const shuffled = <T>(items: readonly T[], random: () => number = Math.random): T[] => {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[target]
    result[target] = current
  }
  return result
}

const pickWords = (tuples: EncodedWord[], count: number, excludedIds: readonly string[]): Word[] => {
  const blockedIds = new Set(excludedIds)
  const blockedEnglish = new Set<string>()
  const blockedMeanings: string[] = []
  excludedIds.forEach(id => {
    const word = getWordById(id)
    if (word) {
      blockedEnglish.add(normalizeText(word.english))
      blockedMeanings.push(...(word.displayMeanings || word.matchMeanings || [word.matchMeaning]))
    }
  })
  const result: Word[] = []
  for (const tuple of tuples) {
    const word = decode(tuple)
    const normalizedEnglish = normalizeText(word.english)
    if (blockedIds.has(word.id) || blockedEnglish.has(normalizedEnglish)) continue
    const selectedWord = selectMatchMeaning(word, blockedMeanings)
    if (!selectedWord) continue
    result.push(selectedWord)
    blockedIds.add(word.id)
    blockedEnglish.add(normalizedEnglish)
    blockedMeanings.push(...(selectedWord.displayMeanings || [selectedWord.matchMeaning]))
    if (result.length >= count) break
  }
  return result
}

const seededRandom = (seed: number): (() => number) => {
  let value = seed % 2147483647
  if (value <= 0) value += 2147483646
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

export const getBookCount = (bookId: BookId): number => BOOK_COUNTS[bookId]

export const getWords = (bookId: BookId, count: number): Word[] => getNextWords(bookId, count, [])

export const getNextWords = (
  bookId: BookId,
  count: number,
  excludeIds: readonly string[],
): Word[] => {
  if (count <= 0) return []
  const tuples = shuffled(indexesForBook(bookId)).map(index => VOCABULARY_DATA[index])
  return pickWords(tuples, count, excludeIds)
}

export const getLevelWords = (bookId: BookId, level: number, count: number = 20): Word[] => {
  const bookSeed = BOOK_IDS.indexOf(bookId) + 1
  const random = seededRandom((level * 7919) + (bookSeed * 104729))
  const tuples = shuffled(indexesForBook(bookId), random).map(index => VOCABULARY_DATA[index])
  return pickWords(tuples, count, [])
}

export const getWordById = (wordId: string): Word | undefined => {
  if (!tupleById) tupleById = new Map(VOCABULARY_DATA.map(tuple => [tuple[0], tuple]))
  const tuple = tupleById.get(wordId)
  return tuple ? decode(tuple) : undefined
}

export const getWordsByIds = (wordIds: readonly string[]): Word[] => wordIds
  .map(getWordById)
  .filter((word): word is Word => Boolean(word))

const normalizeEnglish = (value: string): string => value.trim().toLocaleLowerCase()

/** Exact, case-insensitive local lookup. Online providers can implement this contract later. */
export const lookupWord = (english: string): WordLookupResult => {
  const normalized = normalizeEnglish(english)
  if (!normalized) return { query: english, normalized, found: false, candidates: [] }
  if (!tuplesByEnglish) {
    tuplesByEnglish = new Map<string, EncodedWord[]>()
    VOCABULARY_DATA.forEach(tuple => {
      const key = normalizeEnglish(tuple[1])
      const existing = tuplesByEnglish!.get(key)
      if (existing) existing.push(tuple)
      else tuplesByEnglish!.set(key, [tuple])
    })
  }
  const candidates = (tuplesByEnglish.get(normalized) || []).map(decode)
  return { query: english, normalized, found: candidates.length > 0, candidates }
}

export const localVocabularyProvider: VocabularyLookupProvider = { lookup: lookupWord }

export const getAvailableWordIds = (
  bookId: BookId | 'all',
  scope: 'all' | 'unlearned' | 'wrong',
  learnedIds: readonly string[],
  wrongIds: readonly string[],
): string[] => {
  const learned = new Set(learnedIds)
  const wrong = new Set(wrongIds)
  return VOCABULARY_DATA
    .filter(tuple => bookId === 'all' || (tuple[6] & BOOK_MASKS[bookId]) !== 0)
    .map(tuple => tuple[0])
    .filter(id => scope === 'unlearned' ? !learned.has(id) : scope === 'wrong' ? wrong.has(id) : true)
}
