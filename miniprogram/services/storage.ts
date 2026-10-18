import { BookId, GameMode, SessionRecord, SessionStats, UserProfile, WordProgress } from '../engine/types'
import { applyWordAttempt, isActiveWrongProgress, toSessionRecord } from '../engine/review'
import { LEGACY_WORD_ID_MAP } from '../data/vocabulary/generated-meta'
import {
  ensureLegacyDailyStatsMigrated,
  getDailyLearningStat,
  localDateKey,
  recordDailyAttempt,
} from './daily-learning'
import type { AmbientSoundId } from './ambient-audio-service'

const PROFILE_KEY = 'wordmatch:v2:profile'
const LEGACY_PROFILE_KEY = 'wordmatch:v1:profile'
const LAST_RESULT_KEY = 'wordmatch:v1:lastResult'
const CHECK_IN_KEY = 'wordmatch:v1:checkIn'
const SETTINGS_KEY = 'wordmatch:v2:settings'
const AMBIENT_SETTINGS_KEY = 'wordmatch:v2:ambientSettings'

export interface AmbientSettings {
  soundId: AmbientSoundId
  focusEnabled: boolean
  feedbackSoundEnabled: boolean
}

export const DEFAULT_AMBIENT_SETTINGS: AmbientSettings = {
  soundId: 'off',
  focusEnabled: false,
  feedbackSoundEnabled: true,
}

const isAmbientSoundId = (value: unknown): value is AmbientSoundId => (
  value === 'off' || value === 'rain' || value === 'forest'
  || value === 'ocean' || value === 'stream' || value === 'white-noise'
)

export const normalizeAmbientSettings = (value: unknown): AmbientSettings => {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AMBIENT_SETTINGS }
  const candidate = value as Partial<AmbientSettings>
  return {
    soundId: isAmbientSoundId(candidate.soundId) ? candidate.soundId : DEFAULT_AMBIENT_SETTINGS.soundId,
    focusEnabled: typeof candidate.focusEnabled === 'boolean'
      ? candidate.focusEnabled
      : DEFAULT_AMBIENT_SETTINGS.focusEnabled,
    feedbackSoundEnabled: typeof candidate.feedbackSoundEnabled === 'boolean'
      ? candidate.feedbackSoundEnabled
      : DEFAULT_AMBIENT_SETTINGS.feedbackSoundEnabled,
  }
}

export const loadAmbientSettings = (): AmbientSettings => {
  try {
    return normalizeAmbientSettings(wx.getStorageSync(AMBIENT_SETTINGS_KEY))
  } catch (_error) {
    return { ...DEFAULT_AMBIENT_SETTINGS }
  }
}

export const saveAmbientSettings = (settings: AmbientSettings): AmbientSettings => {
  const normalized = normalizeAmbientSettings(settings)
  try {
    wx.setStorageSync(AMBIENT_SETTINGS_KEY, normalized)
  } catch (_error) {
    wx.showToast({ title: '沉浸设置保存失败', icon: 'none' })
  }
  return normalized
}

export interface CheckInStatus {
  checkedToday: boolean
  streak: number
  totalDays: number
}

interface StoredCheckIn {
  lastDate: string
  streak: number
  totalDays: number
}

export const createDefaultProfile = (): UserProfile => ({
  schemaVersion: 2,
  wordProgressById: {},
  learnedWordIds: [],
  dailyStats: {},
  dailyWrongWordIds: {},
  levelProgress: { '1': 0 },
  quizLevelProgress: { '1': 0 },
  sessionHistory: [],
})

const isProfile = (value: unknown): value is UserProfile => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<UserProfile>
  return candidate.schemaVersion === 2
    && Boolean(candidate.wordProgressById)
    && Array.isArray(candidate.learnedWordIds)
    && Boolean(candidate.dailyStats)
    && Boolean(candidate.levelProgress)
    && Array.isArray(candidate.sessionHistory)
}

interface LegacyProfile {
  schemaVersion: 1
  wordProgressById: Record<string, WordProgress>
  learnedWordIds: number[]
  dailyStats: Record<string, { completedCount: number; uniqueWordIds: number[] }>
  levelProgress: Record<string, number>
  sessionHistory: SessionRecord[]
}

const isLegacyProfile = (value: unknown): value is LegacyProfile => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LegacyProfile>
  return candidate.schemaVersion === 1
    && Boolean(candidate.wordProgressById)
    && Array.isArray(candidate.learnedWordIds)
    && Boolean(candidate.dailyStats)
    && Boolean(candidate.levelProgress)
    && Array.isArray(candidate.sessionHistory)
}

const migrateLegacyProfile = (legacy: LegacyProfile): UserProfile => {
  const wordProgressById: Record<string, WordProgress> = {}
  const legacyUnmappedProgress: Record<string, WordProgress> = {}
  Object.entries(legacy.wordProgressById).forEach(([oldId, progress]) => {
    const newId = LEGACY_WORD_ID_MAP[oldId]
    if (newId) wordProgressById[newId] = progress
    else legacyUnmappedProgress[oldId] = progress
  })
  const mapIds = (ids: readonly number[]): string[] => ids
    .map(id => LEGACY_WORD_ID_MAP[String(id)])
    .filter((id): id is string => Boolean(id))
  return {
    schemaVersion: 2,
    wordProgressById,
    learnedWordIds: [...new Set(mapIds(legacy.learnedWordIds))],
    dailyStats: Object.fromEntries(Object.entries(legacy.dailyStats).map(([date, stat]) => [date, {
      completedCount: stat.completedCount,
      uniqueWordIds: [...new Set(mapIds(stat.uniqueWordIds))],
    }])),
    dailyWrongWordIds: {},
    levelProgress: { ...legacy.levelProgress },
    sessionHistory: [...legacy.sessionHistory],
    ...(Object.keys(legacyUnmappedProgress).length ? { legacyUnmappedProgress } : {}),
  }
}

export const loadProfile = (): UserProfile => {
  try {
    const stored: unknown = wx.getStorageSync(PROFILE_KEY)
    if (isProfile(stored)) return stored
    const legacy: unknown = wx.getStorageSync(LEGACY_PROFILE_KEY)
    if (isLegacyProfile(legacy)) {
      const migrated = migrateLegacyProfile(legacy)
      wx.setStorageSync(PROFILE_KEY, migrated)
      return migrated
    }
    return createDefaultProfile()
  } catch (_error) {
    return createDefaultProfile()
  }
}

export const saveProfile = (profile: UserProfile): void => {
  try {
    wx.setStorageSync(PROFILE_KEY, profile)
  } catch (_error) {
    wx.showToast({ title: '学习记录保存失败', icon: 'none' })
  }
}

const dateKey = (timestamp: number): string => {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const previousDateKey = (timestamp: number): string => {
  const date = new Date(timestamp)
  date.setDate(date.getDate() - 1)
  return dateKey(date.getTime())
}

const loadCheckIn = (): StoredCheckIn => {
  try {
    const stored: unknown = wx.getStorageSync(CHECK_IN_KEY)
    if (stored && typeof stored === 'object') {
      const candidate = stored as Partial<StoredCheckIn>
      if (typeof candidate.lastDate === 'string'
        && typeof candidate.streak === 'number'
        && typeof candidate.totalDays === 'number') {
        return {
          lastDate: candidate.lastDate,
          streak: Math.max(0, Math.floor(candidate.streak)),
          totalDays: Math.max(0, Math.floor(candidate.totalDays)),
        }
      }
    }
  } catch (_error) {
    // Corrupted local data falls back to a clean check-in state.
  }
  return { lastDate: '', streak: 0, totalDays: 0 }
}

export const getCheckInStatus = (now: number = Date.now()): CheckInStatus => {
  const stored = loadCheckIn()
  return {
    checkedToday: stored.lastDate === dateKey(now),
    streak: stored.lastDate === dateKey(now) || stored.lastDate === previousDateKey(now) ? stored.streak : 0,
    totalDays: stored.totalDays,
  }
}

export const checkInToday = (now: number = Date.now()): CheckInStatus => {
  const stored = loadCheckIn()
  const today = dateKey(now)
  if (stored.lastDate === today) return getCheckInStatus(now)

  const next: StoredCheckIn = {
    lastDate: today,
    streak: stored.lastDate === previousDateKey(now) ? stored.streak + 1 : 1,
    totalDays: stored.totalDays + 1,
  }
  try {
    wx.setStorageSync(CHECK_IN_KEY, next)
  } catch (_error) {
    wx.showToast({ title: '签到保存失败', icon: 'none' })
    return getCheckInStatus(now)
  }
  return { checkedToday: true, streak: next.streak, totalDays: next.totalDays }
}

export interface AttemptContext {
  mode?: GameMode
  studySeconds?: number
  collectDailyWrong?: boolean
}

export const recordAttempt = (
  wordIds: string[],
  correct: boolean,
  now: number = Date.now(),
  context: AttemptContext = {},
): void => {
  const previousProfile = loadProfile()
  try {
    ensureLegacyDailyStatsMigrated(previousProfile)
  } catch (_error) {
    // Migration is best-effort and must never block the active learning flow.
  }
  let profile = applyWordAttempt(previousProfile, wordIds, correct, now)
  if (correct) {
    const key = dateKey(now)
    const previous = profile.dailyStats[key] || { completedCount: 0, uniqueWordIds: [] }
    const uniqueWordIds = [...previous.uniqueWordIds]
    const wordId = wordIds[0]
    if (!uniqueWordIds.includes(wordId)) uniqueWordIds.push(wordId)
    profile = {
      ...profile,
      dailyStats: {
        ...profile.dailyStats,
        [key]: { completedCount: previous.completedCount + 1, uniqueWordIds },
      },
    }
  } else if (context.collectDailyWrong === true) {
    const key = dateKey(now)
    const dailyWrongWordIds = { ...(profile.dailyWrongWordIds || {}) }
    dailyWrongWordIds[key] = [...new Set([...(dailyWrongWordIds[key] || []), ...wordIds])]
    profile = { ...profile, dailyWrongWordIds }
  }
  saveProfile(profile)
  try {
    recordDailyAttempt({
      wordIds,
      correct,
      mode: context.mode || 'endless',
      previouslyLearnedWordIds: previousProfile.learnedWordIds,
      studySeconds: context.studySeconds,
      now,
    })
  } catch (_error) {
    wx.showToast({ title: '每日统计保存失败', icon: 'none' })
  }
}

export const getActiveWrongWordIds = (profile: UserProfile = loadProfile()): string[] => (
  Object.keys(profile.wordProgressById).filter(id => isActiveWrongProgress(profile.wordProgressById[id]))
)

export const getDailyWrongWordIds = (date: string, profile: UserProfile = loadProfile()): string[] => (
  [...((profile.dailyWrongWordIds || {})[date] || [])]
)

export const getAllWrongWordIds = (profile: UserProfile = loadProfile()): string[] => {
  const archived = Object.values(profile.dailyWrongWordIds || {}).flat()
  const recorded = Object.keys(profile.wordProgressById).filter(id => profile.wordProgressById[id].errorCount > 0)
  return [...new Set([...recorded, ...archived])]
}

export const deleteWrongWord = (wordId: string): void => {
  const profile = loadProfile()
  const previous = profile.wordProgressById[wordId]
  const dailyWrongWordIds = Object.fromEntries(
    Object.entries(profile.dailyWrongWordIds || {})
      .map(([date, ids]) => [date, ids.filter(id => id !== wordId)])
      .filter(([, ids]) => ids.length > 0),
  )
  saveProfile({
    ...profile,
    dailyWrongWordIds,
    wordProgressById: previous ? {
      ...profile.wordProgressById,
      [wordId]: { ...previous, errorCount: 0, correctStreak: 0 },
    } : profile.wordProgressById,
  })
}

export const deleteWrongWordsForDate = (date: string, wordIds: readonly string[]): void => {
  const profile = loadProfile()
  const dailyWrongWordIds = { ...(profile.dailyWrongWordIds || {}) }
  delete dailyWrongWordIds[date]
  const remainingIds = new Set(Object.values(dailyWrongWordIds).flat())
  const wordProgressById = { ...profile.wordProgressById }
  wordIds.forEach(wordId => {
    const previous = wordProgressById[wordId]
    if (previous && !remainingIds.has(wordId)) {
      wordProgressById[wordId] = { ...previous, errorCount: 0, correctStreak: 0 }
    }
  })
  saveProfile({ ...profile, dailyWrongWordIds, wordProgressById })
}

export const saveSessionOnce = (stats: SessionStats, now: number = Date.now()): SessionRecord => {
  const profile = loadProfile()
  const existing = profile.sessionHistory.find(item => item.sessionId === stats.sessionId)
  if (existing) {
    wx.setStorageSync(LAST_RESULT_KEY, existing)
    return existing
  }

  const record = toSessionRecord(stats, now)
  const isQuiz = record.playType === 'quiz'
  const levelProgress = isQuiz
    ? { ...(profile.quizLevelProgress || { '1': 0 }) }
    : { ...profile.levelProgress }
  if (record.mode === 'level' && record.level) {
    const levelKey = String(record.level)
    levelProgress[levelKey] = Math.max(levelProgress[levelKey] || 0, record.stars)
    if (record.level < 10 && levelProgress[String(record.level + 1)] === undefined) {
      levelProgress[String(record.level + 1)] = 0
    }
  }
  saveProfile({
    ...profile,
    ...(isQuiz ? { quizLevelProgress: levelProgress } : { levelProgress }),
    sessionHistory: [record, ...profile.sessionHistory].slice(0, 50),
  })
  wx.setStorageSync(LAST_RESULT_KEY, record)
  return record
}

export const getLastResult = (): SessionRecord | null => {
  try {
    const stored: unknown = wx.getStorageSync(LAST_RESULT_KEY)
    return stored && typeof stored === 'object' ? stored as SessionRecord : null
  } catch (_error) {
    return null
  }
}

export const getTodayCompletedCount = (now: number = Date.now()): number => {
  const daily = getDailyLearningStat(localDateKey(now))
  if (daily.learnedWordIds.length) return daily.learnedWordIds.length
  const dailyStats = loadProfile().dailyStats[dateKey(now)]
  return dailyStats ? dailyStats.uniqueWordIds.length : 0
}

export const getTodayWordIds = (now: number = Date.now()): string[] => {
  const daily = getDailyLearningStat(localDateKey(now))
  if (daily.learnedWordIds.length) return [...daily.learnedWordIds]
  const dailyStats = loadProfile().dailyStats[dateKey(now)]
  return dailyStats ? [...dailyStats.uniqueWordIds] : []
}

export const getPreferredBook = (): BookId => {
  try {
    const stored: unknown = wx.getStorageSync(SETTINGS_KEY)
    if (stored && typeof stored === 'object') {
      const bookId = (stored as { bookId?: unknown }).bookId
      if (bookId === 'high_school' || bookId === 'cet4' || bookId === 'cet6') return bookId
    }
  } catch (_error) {
    // Settings are optional; fall back to the high-school book.
  }
  return 'high_school'
}

export const setPreferredBook = (bookId: BookId): void => {
  try {
    wx.setStorageSync(SETTINGS_KEY, { bookId })
  } catch (_error) {
    wx.showToast({ title: '词库设置保存失败', icon: 'none' })
  }
}
