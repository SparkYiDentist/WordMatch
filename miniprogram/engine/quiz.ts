import { meaningsConflict } from '../services/vocabulary-service'
import { Word } from './types'

export type QuizPhase = 'answering' | 'wrong-feedback' | 'correct-feedback' | 'explanation' | 'completed'

export interface QuizOption {
  id: string
  wordId: string
  label: 'A' | 'B' | 'C' | 'D'
  meaning: string
  correct: boolean
}

export interface QuizQuestion {
  word: Word
  options: QuizOption[]
  correctOptionId: string
}

const LABELS: Array<QuizOption['label']> = ['A', 'B', 'C', 'D']

const legalMeanings = (word: Word): string[] => [
  word.matchMeaning,
  ...(word.matchMeanings || []),
  ...(word.displayMeanings || []),
].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)

const isSafeDistractor = (candidate: Word, correct: Word, selected: Word[]): boolean => {
  if (candidate.id === correct.id || candidate.english.toLocaleLowerCase() === correct.english.toLocaleLowerCase()) return false
  const meaning = candidate.matchMeaning.trim()
  if (!meaning) return false
  const blocked = [...legalMeanings(correct), ...selected.map(word => word.matchMeaning)]
  return !blocked.some(value => meaningsConflict(value, meaning))
}

export const generateQuizQuestion = (
  correct: Word,
  pool: readonly Word[],
  correctIndex: number,
  random: () => number = Math.random,
): QuizQuestion | null => {
  const shuffled = [...pool].sort(() => random() - 0.5)
  const samePart = shuffled.filter(word => Boolean(correct.partOfSpeech) && word.partOfSpeech === correct.partOfSpeech)
  const candidates = [...samePart, ...shuffled.filter(word => !samePart.includes(word))]
  const distractors: Word[] = []
  for (const candidate of candidates) {
    if (isSafeDistractor(candidate, correct, distractors)) distractors.push(candidate)
    if (distractors.length === 3) break
  }
  if (distractors.length < 3) return null

  const boundedIndex = Math.max(0, Math.min(3, Math.floor(correctIndex)))
  const optionWords = [...distractors]
  optionWords.splice(boundedIndex, 0, correct)
  const options = optionWords.map((word, index): QuizOption => ({
    id: `${word.id}:${index}`,
    wordId: word.id,
    label: LABELS[index],
    meaning: word.matchMeaning,
    correct: word.id === correct.id,
  }))
  return { word: correct, options, correctOptionId: options[boundedIndex].id }
}

export const createBalancedAnswerOrder = (random: () => number = Math.random): number[] => {
  const values = [0, 1, 2, 3]
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    const current = values[index]
    values[index] = values[target]
    values[target] = current
  }
  return values
}

export const firstTryAccuracy = (firstResults: readonly boolean[]): number => (
  firstResults.length ? Math.round((firstResults.filter(Boolean).length / firstResults.length) * 100) : 100
)
