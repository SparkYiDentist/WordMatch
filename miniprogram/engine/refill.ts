import { CardSlot, Word } from './types'

export type RandomSource = () => number

export const shuffle = <T>(items: T[], random: RandomSource = Math.random): T[] => {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[target]
    result[target] = current
  }
  return result
}

export const normalizeMeaning = (meaning: string): string => meaning
  .toLowerCase()
  .replace(/[，。；、,.\s]/g, '')

export const createSlots = (words: Word[], random: RandomSource = Math.random): {
  left: CardSlot[]
  right: CardSlot[]
} => {
  const padded: Array<Word | null> = [...words]
  while (padded.length < 5) padded.push(null)
  const left = padded.slice(0, 5).map((word, slotId) => ({ slotId, word, state: 'idle' as const }))
  const shuffled = shuffle(words, random)
  const rightWords: Array<Word | null> = [...shuffled]
  while (rightWords.length < 5) rightWords.push(null)
  const right = rightWords.slice(0, 5).map((word, slotId) => ({ slotId, word, state: 'idle' as const }))
  return { left, right }
}

export const pickUniqueWords = (
  candidates: Word[],
  count: number,
  excludedIds: string[] = [],
  excludedMeanings: string[] = [],
): Word[] => {
  const idSet = new Set(excludedIds)
  const meaningSet = new Set(excludedMeanings.map(normalizeMeaning))
  const picked: Word[] = []
  for (const word of candidates) {
    const normalized = normalizeMeaning(word.matchMeaning)
    if (!idSet.has(word.id) && !meaningSet.has(normalized)) {
      picked.push(word)
      idSet.add(word.id)
      meaningSet.add(normalized)
      if (picked.length === count) break
    }
  }
  return picked
}

export const refillSlots = (
  left: CardSlot[],
  right: CardSlot[],
  additions: Word[],
  random: RandomSource = Math.random,
): { left: CardSlot[]; right: CardSlot[] } => {
  const nextLeft: CardSlot[] = left.map(slot => ({ ...slot, state: 'idle' }))
  let additionIndex = 0
  for (let index = 0; index < nextLeft.length && additionIndex < additions.length; index += 1) {
    if (!nextLeft[index].word) {
      nextLeft[index] = { ...nextLeft[index], word: additions[additionIndex], state: 'entering' }
      additionIndex += 1
    }
  }

  const nextRight: CardSlot[] = right.map(slot => ({ ...slot, state: 'idle' }))
  const emptyRightIndexes = shuffle(
    nextRight
      .map((slot, index) => slot.word ? -1 : index)
      .filter(index => index >= 0),
    random,
  )
  const shuffledAdditions = shuffle(additions, random)
  shuffledAdditions.forEach((word, index) => {
    const targetIndex = emptyRightIndexes[index]
    if (targetIndex !== undefined) {
      nextRight[targetIndex] = {
        ...nextRight[targetIndex],
        word,
        state: 'entering',
      }
    }
  })
  return { left: nextLeft, right: nextRight }
}
