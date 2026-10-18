import { VOCABULARY_DATA } from '../data/vocabulary/vocabulary-data'
import { VOCABULARY_SOURCE_COMMIT } from '../data/vocabulary/generated-meta'
import { BookId } from '../engine/types'
import { DictionaryEntry, DictionarySense } from './dictionary-types'

const BOOK_IDS: BookId[] = ['high_school', 'cet4', 'cet6']
const BOOK_MASKS: Record<BookId, number> = { high_school: 1, cet4: 2, cet6: 4 }

export const getDictionaryEntry = (wordId: string): DictionaryEntry | null => {
  const anchor = VOCABULARY_DATA.find(tuple => tuple[0] === wordId)
  if (!anchor) return null
  const normalized = anchor[1].toLocaleLowerCase()
  const tuples = VOCABULARY_DATA.filter(tuple => tuple[1].toLocaleLowerCase() === normalized)
  const seenSenses = new Set<string>()
  const senses = tuples.map<DictionarySense>(tuple => ({
    partOfSpeech: tuple[5] || undefined,
    matchMeaning: tuple[2],
    fullMeaning: tuple[3] || undefined,
  })).filter(sense => {
    const key = `${sense.partOfSpeech || ''}\u0000${sense.fullMeaning || sense.matchMeaning}`
    if (seenSenses.has(key)) return false
    seenSenses.add(key)
    return true
  })
  const mask = tuples.reduce((combined, tuple) => combined | tuple[6], 0)
  const fullMeaning = senses.map(sense => sense.fullMeaning || sense.matchMeaning).filter(Boolean).join('；')
  return {
    id: anchor[0],
    headword: anchor[1],
    phonetic: anchor[4] || undefined,
    senses,
    matchMeaning: anchor[2],
    fullMeaning: fullMeaning || undefined,
    bookIds: BOOK_IDS.filter(bookId => (mask & BOOK_MASKS[bookId]) !== 0),
    source: 'KyleBing/english-vocabulary（本地已导入词库）',
    version: VOCABULARY_SOURCE_COMMIT,
  }
}

