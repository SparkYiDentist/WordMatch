import { GameModeConfig, SessionRecord, SessionStats, UserProfile, WordProgress } from './types'

export const isActiveWrongProgress = (progress: WordProgress | undefined): boolean => (
  Boolean(progress && progress.errorCount > 0 && (progress.correctStreak || 0) < 2)
)

export const createSessionStats = (config: GameModeConfig, now: number = Date.now()): SessionStats => ({
  sessionId: `${now}-${Math.floor(Math.random() * 1000000)}`,
  mode: config.mode,
  modeTitle: config.title,
  targetCount: config.targetCount,
  startedAt: now,
  finishedAt: null,
  pairAttempts: 0,
  correctPairs: 0,
  completedWords: 0,
  currentStreak: 0,
  bestStreak: 0,
  uniqueCompletedIds: {},
  firstAttemptByWord: {},
  level: config.level,
  source: config.source,
  packId: config.packId,
  playType: 'matching',
})

export const registerJudgement = (
  stats: SessionStats,
  englishWordId: string,
  chineseWordId: string,
  correct: boolean,
): SessionStats => {
  const next: SessionStats = {
    ...stats,
    uniqueCompletedIds: { ...stats.uniqueCompletedIds },
    firstAttemptByWord: { ...stats.firstAttemptByWord },
    pairAttempts: stats.pairAttempts + 1,
  }

  if (correct) {
    next.correctPairs += 1
    next.completedWords += 1
    next.currentStreak += 1
    next.bestStreak = Math.max(next.bestStreak, next.currentStreak)
    next.uniqueCompletedIds[String(englishWordId)] = true
    if (next.firstAttemptByWord[String(englishWordId)] === undefined) {
      next.firstAttemptByWord[String(englishWordId)] = true
    }
  } else {
    next.currentStreak = 0
    if (next.firstAttemptByWord[String(englishWordId)] === undefined) {
      next.firstAttemptByWord[String(englishWordId)] = false
    }
    if (next.firstAttemptByWord[String(chineseWordId)] === undefined) {
      next.firstAttemptByWord[String(chineseWordId)] = false
    }
  }
  return next
}

export const calculateAccuracy = (stats: SessionStats): number => (
  stats.pairAttempts === 0 ? 100 : Math.round((stats.correctPairs / stats.pairAttempts) * 100)
)

export const calculateFirstTryAccuracy = (stats: SessionStats): number => {
  const values = Object.values(stats.firstAttemptByWord)
  if (values.length === 0) return 100
  return Math.round((values.filter(Boolean).length / values.length) * 100)
}

export const starsForAccuracy = (accuracy: number): number => {
  if (accuracy >= 95) return 3
  if (accuracy >= 80) return 2
  if (accuracy >= 60) return 1
  return 0
}

export const toSessionRecord = (stats: SessionStats, now: number = Date.now()): SessionRecord => {
  const firstTryAccuracy = calculateFirstTryAccuracy(stats)
  return {
    sessionId: stats.sessionId,
    mode: stats.mode,
    modeTitle: stats.modeTitle,
    completedWords: stats.completedWords,
    pairAttempts: stats.pairAttempts,
    correctPairs: stats.correctPairs,
    firstTryAccuracy,
    accuracy: calculateAccuracy(stats),
    durationSeconds: Math.max(0, Math.round((now - stats.startedAt) / 1000)),
    bestStreak: stats.bestStreak,
    stars: stats.mode === 'level' ? starsForAccuracy(firstTryAccuracy) : 0,
    level: stats.level,
    source: stats.source,
    packId: stats.packId,
    playType: stats.playType,
    finishedAt: now,
  }
}

export const applyWordAttempt = (
  profile: UserProfile,
  wordIds: string[],
  correct: boolean,
  now: number = Date.now(),
): UserProfile => {
  const next: UserProfile = {
    ...profile,
    wordProgressById: { ...profile.wordProgressById },
    learnedWordIds: [...profile.learnedWordIds],
    dailyStats: { ...profile.dailyStats },
  }

  wordIds.forEach(wordId => {
    const key = String(wordId)
    const previous = next.wordProgressById[key] || {
      learned: false,
      practiceCount: 0,
      errorCount: 0,
      lastPracticedAt: 0,
      correctStreak: 0,
    }
    next.wordProgressById[key] = {
      ...previous,
      learned: previous.learned || correct,
      practiceCount: previous.practiceCount + 1,
      errorCount: previous.errorCount + (correct ? 0 : 1),
      lastPracticedAt: now,
      correctStreak: correct ? previous.correctStreak + 1 : 0,
    }
    if (correct && !next.learnedWordIds.includes(wordId)) next.learnedWordIds.push(wordId)
  })
  return next
}
