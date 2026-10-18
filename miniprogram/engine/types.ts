export type GameMode = 'endless' | 'level' | 'custom'
export type PlayType = 'matching' | 'quiz'
export type BookId = 'high_school' | 'cet4' | 'cet6'
export type CardSide = 'english' | 'chinese'
export type CardVisualState = 'idle' | 'selected' | 'correct' | 'wrong' | 'waiting' | 'removing' | 'entering'

export interface Word {
  id: string
  dictionaryId?: string
  english: string
  matchMeaning: string
  matchMeanings?: string[]
  displayMeanings?: string[]
  displayMeaning?: string
  fullMeaning: string
  phonetic?: string
  partOfSpeech?: string
  bookIds: BookId[]
}

export interface CardSlot {
  slotId: number
  word: Word | null
  state: CardVisualState
}

export interface Selection {
  englishIndex: number | null
  chineseIndex: number | null
}

export interface GameModeConfig {
  mode: GameMode
  title: string
  targetCount: number | null
  level?: number
  bookId?: BookId
  scope?: 'all' | 'unlearned' | 'wrong'
  source?: 'system' | 'personal_pack'
  packId?: string
}

export interface SessionStats {
  sessionId: string
  mode: GameMode
  modeTitle: string
  targetCount: number | null
  startedAt: number
  finishedAt: number | null
  pairAttempts: number
  correctPairs: number
  completedWords: number
  currentStreak: number
  bestStreak: number
  uniqueCompletedIds: Record<string, true>
  firstAttemptByWord: Record<string, boolean>
  level?: number
  source?: 'system' | 'personal_pack'
  packId?: string
  playType?: PlayType
}

export interface WordProgress {
  learned: boolean
  practiceCount: number
  errorCount: number
  lastPracticedAt: number
  correctStreak: number
  nextReviewAt?: number
  intervalDays?: number
}

export interface DailyStat {
  completedCount: number
  uniqueWordIds: string[]
}

export interface SessionRecord {
  sessionId: string
  mode: GameMode
  modeTitle: string
  completedWords: number
  pairAttempts: number
  correctPairs: number
  firstTryAccuracy: number
  accuracy: number
  durationSeconds: number
  bestStreak: number
  stars: number
  level?: number
  source?: 'system' | 'personal_pack'
  packId?: string
  playType?: PlayType
  finishedAt: number
}

export interface UserProfile {
  schemaVersion: 2
  wordProgressById: Record<string, WordProgress>
  learnedWordIds: string[]
  dailyStats: Record<string, DailyStat>
  dailyWrongWordIds?: Record<string, string[]>
  levelProgress: Record<string, number>
  quizLevelProgress?: Record<string, number>
  sessionHistory: SessionRecord[]
  legacyUnmappedProgress?: Record<string, WordProgress>
}
