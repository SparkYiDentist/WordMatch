import type { GameMode, UserProfile } from '../engine/types'

export interface DailyLearningStats {
  date: string
  learnedWordIds: string[]
  newWordIds: string[]
  reviewedWordIds: string[]
  totalMatches: number
  correctFirstAttempts: number
  firstAttempts: number
  studySeconds: number
  modeCounts: Record<GameMode, number>
  firstAttemptWordIds: string[]
  correctFirstAttemptWordIds: string[]
}

interface StoredMonth {
  schemaVersion: 1
  days: Record<string, DailyLearningStats>
}

interface DailyStatsIndex {
  schemaVersion: 1
  months: string[]
  legacyProfileMigrated: boolean
}

export interface DailyAttemptInput {
  wordIds: string[]
  correct: boolean
  mode: GameMode
  previouslyLearnedWordIds: readonly string[]
  studySeconds?: number
  now?: number
}

const KEY_PREFIX = 'wordmatch:v1:dailyStats:'
const INDEX_KEY = 'wordmatch:v1:dailyStats:index'

const unique = (values: readonly string[]): string[] => [...new Set(values.map(String).filter(Boolean))]

export const localDateKey = (timestamp: number = Date.now()): string => {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export const addLocalDays = (dateKey: string, amount: number): string => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  date.setDate(date.getDate() + amount)
  return localDateKey(date.getTime())
}

export const emptyDailyLearningStats = (date: string): DailyLearningStats => ({
  date,
  learnedWordIds: [],
  newWordIds: [],
  reviewedWordIds: [],
  totalMatches: 0,
  correctFirstAttempts: 0,
  firstAttempts: 0,
  studySeconds: 0,
  modeCounts: { endless: 0, level: 0, custom: 0 },
  firstAttemptWordIds: [],
  correctFirstAttemptWordIds: [],
})

const normalizeDay = (value: unknown, date: string): DailyLearningStats => {
  if (!value || typeof value !== 'object') return emptyDailyLearningStats(date)
  const day = value as Partial<DailyLearningStats>
  const modeCounts = day.modeCounts || { endless: 0, level: 0, custom: 0 }
  return {
    date,
    learnedWordIds: unique(Array.isArray(day.learnedWordIds) ? day.learnedWordIds : []),
    newWordIds: unique(Array.isArray(day.newWordIds) ? day.newWordIds : []),
    reviewedWordIds: unique(Array.isArray(day.reviewedWordIds) ? day.reviewedWordIds : []),
    totalMatches: Math.max(0, Math.floor(day.totalMatches || 0)),
    correctFirstAttempts: Math.max(0, Math.floor(day.correctFirstAttempts || 0)),
    firstAttempts: Math.max(0, Math.floor(day.firstAttempts || 0)),
    studySeconds: Math.max(0, Math.floor(day.studySeconds || 0)),
    modeCounts: {
      endless: Math.max(0, Math.floor(modeCounts.endless || 0)),
      level: Math.max(0, Math.floor(modeCounts.level || 0)),
      custom: Math.max(0, Math.floor(modeCounts.custom || 0)),
    },
    firstAttemptWordIds: unique(Array.isArray(day.firstAttemptWordIds) ? day.firstAttemptWordIds : []),
    correctFirstAttemptWordIds: unique(Array.isArray(day.correctFirstAttemptWordIds) ? day.correctFirstAttemptWordIds : []),
  }
}

const monthKey = (date: string): string => date.slice(0, 7)
const storageKey = (month: string): string => `${KEY_PREFIX}${month}`

const loadIndex = (): DailyStatsIndex => {
  try {
    const value: unknown = wx.getStorageSync(INDEX_KEY)
    if (value && typeof value === 'object') {
      const index = value as Partial<DailyStatsIndex>
      if (index.schemaVersion === 1 && Array.isArray(index.months)) {
        return {
          schemaVersion: 1,
          months: unique(index.months).sort(),
          legacyProfileMigrated: Boolean(index.legacyProfileMigrated),
        }
      }
    }
  } catch (_error) {
    // Invalid optional index is rebuilt on the next successful write.
  }
  return { schemaVersion: 1, months: [], legacyProfileMigrated: false }
}

const saveIndex = (index: DailyStatsIndex): void => wx.setStorageSync(INDEX_KEY, index)

const loadMonth = (month: string): StoredMonth => {
  try {
    const value: unknown = wx.getStorageSync(storageKey(month))
    if (value && typeof value === 'object') {
      const stored = value as Partial<StoredMonth>
      if (stored.schemaVersion === 1 && stored.days && typeof stored.days === 'object') {
        const days: Record<string, DailyLearningStats> = {}
        Object.keys(stored.days).forEach(date => { days[date] = normalizeDay(stored.days![date], date) })
        return { schemaVersion: 1, days }
      }
    }
  } catch (_error) {
    // Corrupted month data is isolated to this month.
  }
  return { schemaVersion: 1, days: {} }
}

const saveMonth = (month: string, value: StoredMonth): void => {
  wx.setStorageSync(storageKey(month), value)
  const index = loadIndex()
  if (!index.months.includes(month)) saveIndex({ ...index, months: [...index.months, month].sort() })
}

export const ensureLegacyDailyStatsMigrated = (profile: UserProfile): void => {
  const index = loadIndex()
  if (index.legacyProfileMigrated) return
  const byMonth: Record<string, StoredMonth> = {}
  Object.entries(profile.dailyStats).forEach(([date, legacy]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(legacy.uniqueWordIds)) return
    const month = monthKey(date)
    const stored = byMonth[month] || loadMonth(month)
    const current = normalizeDay(stored.days[date], date)
    stored.days[date] = {
      ...current,
      learnedWordIds: unique([...current.learnedWordIds, ...legacy.uniqueWordIds]),
    }
    byMonth[month] = stored
  })
  Object.entries(byMonth).forEach(([month, value]) => saveMonth(month, value))
  const updated = loadIndex()
  saveIndex({ ...updated, legacyProfileMigrated: true })
}

export const recordDailyAttempt = (input: DailyAttemptInput): DailyLearningStats => {
  const now = input.now === undefined ? Date.now() : input.now
  const date = localDateKey(now)
  const month = monthKey(date)
  const stored = loadMonth(month)
  const previous = normalizeDay(stored.days[date], date)
  const attemptedIds = unique(input.wordIds)
  const firstAttemptWordIds = [...previous.firstAttemptWordIds]
  const correctFirstAttemptWordIds = [...previous.correctFirstAttemptWordIds]
  attemptedIds.forEach(wordId => {
    if (firstAttemptWordIds.includes(wordId)) return
    firstAttemptWordIds.push(wordId)
    if (input.correct) correctFirstAttemptWordIds.push(wordId)
  })

  const learnedWordIds = [...previous.learnedWordIds]
  const newWordIds = [...previous.newWordIds]
  const reviewedWordIds = [...previous.reviewedWordIds]
  const modeCounts = { ...previous.modeCounts }
  if (input.correct) {
    attemptedIds.forEach(wordId => {
      if (learnedWordIds.includes(wordId)) return
      learnedWordIds.push(wordId)
      if (input.previouslyLearnedWordIds.includes(wordId)) reviewedWordIds.push(wordId)
      else newWordIds.push(wordId)
      modeCounts[input.mode] += 1
    })
  }
  const next: DailyLearningStats = {
    ...previous,
    learnedWordIds,
    newWordIds,
    reviewedWordIds,
    totalMatches: previous.totalMatches + 1,
    correctFirstAttempts: correctFirstAttemptWordIds.length,
    firstAttempts: firstAttemptWordIds.length,
    studySeconds: previous.studySeconds + Math.max(0, Math.min(120, Math.floor(input.studySeconds || 0))),
    modeCounts,
    firstAttemptWordIds,
    correctFirstAttemptWordIds,
  }
  saveMonth(month, { ...stored, days: { ...stored.days, [date]: next } })
  return next
}

export const getDailyLearningStat = (date: string): DailyLearningStats => {
  const stored = loadMonth(monthKey(date))
  return normalizeDay(stored.days[date], date)
}

export const getDailyStatsRange = (endDate: string, days: number): DailyLearningStats[] => {
  const count = Math.max(1, Math.floor(days))
  return Array.from({ length: count }, (_unused, index) => {
    const date = addLocalDays(endDate, index - count + 1)
    return getDailyLearningStat(date)
  })
}

export const getLearningStreak = (now: number = Date.now()): number => {
  const today = localDateKey(now)
  let cursor = getDailyLearningStat(today).learnedWordIds.length ? today : addLocalDays(today, -1)
  if (!getDailyLearningStat(cursor).learnedWordIds.length) return 0
  let streak = 0
  while (getDailyLearningStat(cursor).learnedWordIds.length) {
    streak += 1
    cursor = addLocalDays(cursor, -1)
  }
  return streak
}

export const getRecordedMonths = (): string[] => [...loadIndex().months]

