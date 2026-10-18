import { Word } from './types'
import { shuffle } from './refill'

export const LEVEL_COUNT = 10
export const LEVEL_WORD_COUNT = 20

const seededRandom = (seed: number): (() => number) => {
  let value = seed % 2147483647
  if (value <= 0) value += 2147483646
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

export const getLevelWords = (words: Word[], level: number): Word[] => (
  shuffle(words, seededRandom(level * 7919)).slice(0, Math.min(LEVEL_WORD_COUNT, words.length))
)

export const getCustomWords = (
  words: Word[],
  bookId: string,
  scope: 'all' | 'unlearned' | 'wrong',
  learnedIds: string[],
  wrongIds: string[],
): Word[] => words.filter(word => {
  if (bookId !== 'all' && !word.bookIds.some(candidate => candidate === bookId)) return false
  if (scope === 'unlearned') return !learnedIds.includes(word.id)
  if (scope === 'wrong') return wrongIds.includes(word.id)
  return true
})
