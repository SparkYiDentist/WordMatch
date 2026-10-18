import { createBalancedAnswerOrder, firstTryAccuracy, generateQuizQuestion, QuizOption, QuizPhase, QuizQuestion } from '../../engine/quiz'
import { LEVEL_WORD_COUNT } from '../../engine/modes'
import { BookId, GameMode, SessionStats, Word } from '../../engine/types'
import { ambientAudioService } from '../../services/ambient-audio-service'
import { DictionaryEntry, DictionaryWordForms } from '../../services/dictionary-types'
import { getDictionaryEntry } from '../../services/dictionary-service'
import {
  addSystemWordToPersonalPack,
  createPersonalWordPackWithSystemWord,
  getPersonalPackAvailableWords,
  listPersonalWordPacks,
  recordPersonalPackAttempt,
} from '../../services/personal-word-pack'
import { getActiveWrongWordIds, getDailyWrongWordIds, loadAmbientSettings, loadProfile, recordAttempt, saveSessionOnce } from '../../services/storage'
import { getAvailableWordIds, getLevelWords, getNextWords, getWords, getWordsByIds } from '../../services/vocabulary-service'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

type QuizMode = Extract<GameMode, 'endless' | 'level' | 'custom'>
type Scope = 'all' | 'unlearned' | 'wrong'

interface OptionView extends QuizOption { state: 'idle' | 'wrong' | 'correct' }
interface FormView { label: string; value: string }
interface QuizDraft {
  version: 1
  signature: string
  question: QuizQuestion
  queueIds: string[]
  queueSnapshots?: Word[]
  cursor: number
  answerOrder: number[]
  orderCursor: number
  selectedWrongOptionIds: string[]
  answeredCorrect: boolean
  phase: QuizPhase
  questionNumber: number
  completedWords: number
  totalAttempts: number
  firstResults: boolean[]
  wrongWordIds: string[]
  startedAt: number
  activeSeconds: number
  completedWordIds: string[]
  firstAttemptByWord: Record<string, boolean>
  sessionId: string
}

const DRAFT_KEY = 'wordmatch:v1:quizDraft'
const REVIEW_KEY = 'wordmatch:v1:quizReviewWords'
let mode: QuizMode = 'endless'
let bookId: BookId = 'high_school'
let scope: Scope = 'all'
let source: 'system' | 'personal_pack' = 'system'
let packId = ''
let currentLevel: number | null = null
let targetCount: number | null = null
let queue: Word[] = []
let distractorPool: Word[] = []
let cursor = 0
let answerOrder: number[] = []
let orderCursor = 0
let question: QuizQuestion | null = null
let selectedWrongIds = new Set<string>()
let firstSelectionMade = false
let answeredCorrect = false
let firstResults: boolean[] = []
let wrongWordIds = new Set<string>()
let startedAt = 0
let activeStartedAt = 0
let activeSeconds = 0
let totalAttempts = 0
let completedWordIds = new Set<string>()
let firstAttemptByWord: Record<string, boolean> = {}
let sessionId = ''
let timerId: number | null = null
let signature = ''
let queueNeedsSnapshot = false

const parseBookId = (value: string | undefined): BookId => (
  value === 'cet4' || value === 'cet6' ? value : 'high_school'
)

const formatDuration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
const entryForWord = (word: Word): DictionaryEntry => {
  const dictionaryEntry = getDictionaryEntry(word.dictionaryId || word.id)
  const meanings = word.displayMeanings?.length ? word.displayMeanings : [word.matchMeaning]
  const personalSenses = meanings.map(meaning => ({
    partOfSpeech: word.partOfSpeech,
    matchMeaning: meaning,
    fullMeaning: meaning,
  }))
  if (dictionaryEntry && word.dictionaryId && word.id !== word.dictionaryId) {
    const personalMeaningSet = new Set(meanings)
    return {
      ...dictionaryEntry,
      matchMeaning: word.matchMeaning,
      fullMeaning: word.fullMeaning,
      senses: [...personalSenses, ...dictionaryEntry.senses.filter(sense => !personalMeaningSet.has(sense.matchMeaning))],
      source: '个人词包释义；系统词典详情已保留',
    }
  }
  return dictionaryEntry || {
    id: word.id,
    headword: word.english,
    phonetic: word.phonetic,
    senses: personalSenses,
    matchMeaning: word.matchMeaning,
    fullMeaning: word.fullMeaning,
    bookIds: word.bookIds,
    source: '用户导入的个人词条',
    version: 'local',
  }
}

const formsForEntry = (forms: DictionaryWordForms | undefined): FormView[] => {
  if (!forms) return []
  const labels: Array<[keyof DictionaryWordForms, string]> = [
    ['plural', '复数'], ['past', '过去式'], ['pastParticiple', '过去分词'],
    ['presentParticiple', '现在分词'], ['thirdPerson', '第三人称'],
    ['comparative', '比较级'], ['superlative', '最高级'],
  ]
  return labels.filter(([key]) => Boolean(forms[key])).map(([key, label]) => ({ label, value: forms[key] || '' }))
}

Page({
  data: {
    topInset: 72,
    modeTitle: '单词四选一',
    questionNumber: 1,
    completedWords: 0,
    targetCount: null as number | null,
    progressText: '第 1 题',
    accuracy: 100,
    durationText: '0:00',
    word: null as Word | null,
    options: [] as OptionView[],
    entry: null as DictionaryEntry | null,
    forms: [] as FormView[],
    bookLabels: [] as string[],
    synonymsText: '',
    antonymsText: '',
    phase: 'answering' as QuizPhase,
    pauseVisible: false,
    wrongCount: 0,
    resultWrongCount: 0,
    resultFirstCorrect: 0,
    savedToPack: false,
    dictionaryRefreshing: false,
  },

  onLoad(queryParams: Record<string, string | undefined>) {
    try {
      const menu = wx.getMenuButtonBoundingClientRect()
      if (menu.bottom > 0) this.setData({ topInset: menu.bottom + 8 })
    } catch (_error) {
      // Keep the fallback inset in simulators without the capsule API.
    }
    this.initialize(queryParams)
  },
  onShareAppMessage() {
    return {
      title: 'Pan的英语｜单词配对闯关，边玩边背单词',
      path: '/pages/index/index',
    }
  },

  onShow() {
    if (this.data.pauseVisible || this.data.phase === 'completed') return
    activeStartedAt = Date.now()
    if (mode === 'endless') {
      const settings = loadAmbientSettings()
      if (settings.focusEnabled && settings.soundId !== 'off') ambientAudioService.play(settings.soundId)
    }
  },

  onHide() {
    this.commitActiveTime()
    ambientAudioService.pause()
    this.saveDraft()
  },

  onUnload() {
    this.commitActiveTime()
    this.stopTimer()
    ambientAudioService.destroy()
    this.saveDraft()
  },

  initialize(queryParams: Record<string, string | undefined>) {
    mode = queryParams.mode === 'custom' ? 'custom' : queryParams.mode === 'level' ? 'level' : 'endless'
    bookId = parseBookId(queryParams.bookId)
    scope = queryParams.scope === 'unlearned' || queryParams.scope === 'wrong' ? queryParams.scope : 'all'
    source = queryParams.source === 'personal_pack' ? 'personal_pack' : 'system'
    packId = queryParams.packId || ''
    currentLevel = mode === 'level' ? Math.max(1, Number(queryParams.level) || 1) : null
    const requested = Math.max(1, Number(queryParams.count) || 20)
    targetCount = mode === 'custom' ? requested : mode === 'level' ? LEVEL_WORD_COUNT : null
    signature = [mode, bookId, scope, source, packId, currentLevel || '', queryParams.wrongDate || '', queryParams.reviewSession || '', targetCount || 'all'].join('|')
    queueNeedsSnapshot = source === 'personal_pack' || queryParams.reviewSession === '1' || mode === 'level'

    const profile = loadProfile()
    if (mode === 'level') {
      queue = getLevelWords(bookId, currentLevel!, LEVEL_WORD_COUNT)
    } else if (mode === 'endless') {
      queue = getWords(bookId, 400)
    } else if (queryParams.reviewSession === '1') {
      const storedWords = wx.getStorageSync(REVIEW_KEY) as Word[] | undefined
      queue = (Array.isArray(storedWords) ? storedWords : []).slice(0, requested)
    } else if (queryParams.wrongDate) {
      queue = getWordsByIds(getDailyWrongWordIds(queryParams.wrongDate, profile)).slice(0, requested)
    } else if (source === 'personal_pack' && packId) {
      queue = getPersonalPackAvailableWords(packId, scope).slice(0, requested)
    } else {
      const ids = getAvailableWordIds(bookId, scope, profile.learnedWordIds, getActiveWrongWordIds(profile))
      queue = getWordsByIds(ids).slice(0, requested)
    }
    if (mode === 'custom') targetCount = Math.min(requested, queue.length)
    if (mode === 'level') targetCount = Math.min(LEVEL_WORD_COUNT, queue.length)
    if (queue.length < 1) {
      wx.showModal({ title: '没有可练单词', content: '当前学习范围没有可用词条，请更换范围。', showCancel: false, success: () => wx.navigateBack() })
      return
    }
    queue = [...queue].sort(() => Math.random() - 0.5)
    distractorPool = [...queue, ...getWords(bookId, 400)].filter((word, index, values) => (
      values.findIndex(candidate => candidate.id === word.id) === index
    ))
    if (!this.restoreDraft()) this.startFreshSession()
    this.startTimer()
  },

  startFreshSession() {
    cursor = 0
    answerOrder = createBalancedAnswerOrder()
    orderCursor = 0
    selectedWrongIds = new Set<string>()
    firstSelectionMade = false
    answeredCorrect = false
    firstResults = []
    wrongWordIds = new Set<string>()
    completedWordIds = new Set<string>()
    firstAttemptByWord = {}
    totalAttempts = 0
    sessionId = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`
    startedAt = Date.now()
    activeStartedAt = startedAt
    activeSeconds = 0
    this.setData({ completedWords: 0, questionNumber: 1, targetCount, accuracy: 100, phase: 'answering' })
    this.loadNextQuestion()
  },

  loadNextQuestion() {
    let attempts = 0
    while (attempts < Math.max(queue.length, 20)) {
      if (cursor >= queue.length) {
        if (mode === 'custom') {
          this.completeSession()
          return
        }
        queue = getNextWords(bookId, 400, [])
        queue.sort(() => Math.random() - 0.5)
        distractorPool = queue
        cursor = 0
      }
      const word = queue[cursor]
      cursor += 1
      attempts += 1
      if (orderCursor >= answerOrder.length) {
        answerOrder = createBalancedAnswerOrder()
        orderCursor = 0
      }
      const candidate = generateQuizQuestion(word, distractorPool, answerOrder[orderCursor])
      if (!candidate) continue
      orderCursor += 1
      question = candidate
      selectedWrongIds = new Set<string>()
      firstSelectionMade = false
      answeredCorrect = false
      const questionNumber = this.data.completedWords + 1
      this.setData({
        questionNumber,
        progressText: targetCount ? `${questionNumber} / ${targetCount}` : `第 ${questionNumber} 题`,
        word,
        options: candidate.options.map(option => ({ ...option, state: 'idle' as const })),
        entry: null,
        forms: [],
        bookLabels: [],
        phase: 'answering',
        wrongCount: 0,
        savedToPack: false,
      })
      this.saveDraft()
      return
    }
    wx.showModal({ title: '暂时无法出题', content: '当前词库找不到 3 个无歧义干扰项，请更换学习范围。', showCancel: false, success: () => wx.navigateBack() })
  },

  chooseOption(event: WechatMiniprogram.TouchEvent) {
    if (!question || answeredCorrect || this.data.pauseVisible) return
    const optionId = String(event.currentTarget.dataset.id || '')
    const option = question.options.find(item => item.id === optionId)
    if (!option || selectedWrongIds.has(optionId)) return
    const now = Date.now()
    totalAttempts += 1
    const studySeconds = this.consumeStudySeconds(now)
    if (!firstSelectionMade) {
      firstSelectionMade = true
      firstResults.push(option.correct)
      firstAttemptByWord[question.word.id] = option.correct
    }
    if (!option.correct) {
      selectedWrongIds.add(optionId)
      wrongWordIds.add(question.word.id)
      recordAttempt([question.word.id], false, now, { mode, studySeconds, collectDailyWrong: source !== 'personal_pack' })
      if (source === 'personal_pack' && packId) recordPersonalPackAttempt(packId, [question.word.id], false, now)
      this.setData({
        options: this.data.options.map(item => item.id === optionId ? { ...item, state: 'wrong' as const } : item),
        phase: 'wrong-feedback',
        wrongCount: selectedWrongIds.size,
        accuracy: firstTryAccuracy(firstResults),
      })
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      this.saveDraft()
      return
    }

    answeredCorrect = true
    completedWordIds.add(question.word.id)
    recordAttempt([question.word.id], true, now, { mode, studySeconds, collectDailyWrong: false })
    if (source === 'personal_pack' && packId) recordPersonalPackAttempt(packId, [question.word.id], true, now)
    const entry = entryForWord(question.word)
    const completedWords = this.data.completedWords + 1
    this.setData({
      options: this.data.options.map(item => item.id === optionId ? { ...item, state: 'correct' as const } : item),
      phase: 'correct-feedback',
      completedWords,
      accuracy: firstTryAccuracy(firstResults),
      entry,
      forms: formsForEntry(entry?.wordForms),
      bookLabels: (entry?.bookIds || question.word.bookIds).map(id => id === 'high_school' ? '高中' : id === 'cet4' ? 'CET-4' : 'CET-6'),
      synonymsText: (entry?.synonyms || []).join(' · '),
      antonymsText: (entry?.antonyms || []).join(' · '),
    }, () => {
      setTimeout(() => this.setData({ phase: 'explanation' }, () => this.saveDraft()), 180)
    })
  },

  nextQuestion() {
    if (!answeredCorrect) return
    if (targetCount !== null && this.data.completedWords >= targetCount) {
      this.completeSession()
      return
    }
    this.loadNextQuestion()
  },

  completeSession() {
    this.commitActiveTime()
    this.stopTimer()
    try { wx.removeStorageSync(DRAFT_KEY) } catch (_error) { /* best effort */ }
    const modeTitle = mode === 'level'
      ? `单词四选一 · 第 ${currentLevel} 关`
      : mode === 'endless' ? '单词四选一 · 无尽模式' : '单词四选一 · 自选模式'
    const stats: SessionStats = {
      sessionId,
      mode,
      modeTitle,
      targetCount,
      startedAt: Date.now() - activeSeconds * 1000,
      finishedAt: Date.now(),
      pairAttempts: totalAttempts,
      correctPairs: this.data.completedWords,
      completedWords: this.data.completedWords,
      currentStreak: 0,
      bestStreak: 0,
      uniqueCompletedIds: Object.fromEntries([...completedWordIds].map(id => [id, true])) as Record<string, true>,
      firstAttemptByWord: { ...firstAttemptByWord },
      level: currentLevel || undefined,
      source,
      packId: packId || undefined,
      playType: 'quiz',
    }
    saveSessionOnce(stats)
    this.setData({
      phase: 'completed',
      resultWrongCount: wrongWordIds.size,
      resultFirstCorrect: firstResults.filter(Boolean).length,
      durationText: formatDuration(activeSeconds),
    })
  },

  reviewWrongWords() {
    const ids = [...wrongWordIds]
    if (!ids.length) {
      wx.showToast({ title: '本次没有错词', icon: 'none' })
      return
    }
    const wordMap = new Map(queue.map(word => [word.id, word]))
    wx.setStorageSync(REVIEW_KEY, ids.map(id => wordMap.get(id)).filter((word): word is Word => Boolean(word)))
    wx.redirectTo({ url: `/pages/word-quiz/word-quiz?mode=custom&reviewSession=1&bookId=${bookId}&count=${ids.length}` })
  },

  openPause() {
    if (this.data.phase === 'completed') return
    this.commitActiveTime()
    ambientAudioService.pause()
    this.setData({ pauseVisible: true })
    this.saveDraft()
  },

  resumeQuiz() {
    activeStartedAt = Date.now()
    this.setData({ pauseVisible: false })
    if (mode === 'endless') {
      const settings = loadAmbientSettings()
      if (settings.focusEnabled && settings.soundId !== 'off') ambientAudioService.play(settings.soundId)
    }
  },

  exitQuiz() {
    this.saveDraft()
    wx.navigateBack()
  },

  goHome() { wx.reLaunch({ url: '/pages/index/index' }) },

  onPullDownRefresh() { openDictionaryOverlay(this, true) },


  openFullDictionary() {
    if (!question) return
    const dictionary = this.selectComponent('#globalDictionary') as unknown as { openEntry(wordId: string): void } | undefined
    if (dictionary) dictionary.openEntry(question.word.dictionaryId || question.word.id)
  },

  addToPack() {
    if (!question || source === 'personal_pack') {
      wx.showToast({ title: source === 'personal_pack' ? '已在当前词包中' : '无法读取词条', icon: 'none' })
      return
    }
    const currentWordId = question.word.id
    const packs = listPersonalWordPacks()
    if (!packs.length) {
      wx.showModal({
        title: '新建个人词包', editable: true, placeholderText: '例如：本周生词', confirmText: '创建并加入',
        success: result => {
          if (!result.confirm) return
          try {
            createPersonalWordPackWithSystemWord(result.content || '', currentWordId)
            this.setData({ savedToPack: true })
            wx.showToast({ title: '已创建并加入', icon: 'success' })
          } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '添加失败', icon: 'none' }) }
        },
      })
      return
    }
    wx.showActionSheet({
      itemList: packs.map(pack => pack.name),
      success: result => {
        const selected = packs[result.tapIndex]
        if (!selected) return
        const addResult = addSystemWordToPersonalPack(selected.id, currentWordId)
        this.setData({ savedToPack: true })
        wx.showToast({ title: addResult === 'added' ? '已加入词包' : '词包中已有该词', icon: 'none' })
      },
    })
  },

  startTimer() {
    this.stopTimer()
    timerId = setInterval(() => {
      const live = activeSeconds + (activeStartedAt ? Math.floor((Date.now() - activeStartedAt) / 1000) : 0)
      this.setData({ durationText: formatDuration(live) })
    }, 1000)
  },

  stopTimer() { if (timerId !== null) { clearInterval(timerId); timerId = null } },

  commitActiveTime() {
    if (!activeStartedAt) return
    activeSeconds += Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1000))
    activeStartedAt = 0
  },

  consumeStudySeconds(now: number): number {
    if (!activeStartedAt) return 0
    const seconds = Math.max(0, Math.floor((now - activeStartedAt) / 1000))
    activeSeconds += seconds
    activeStartedAt = now
    return seconds
  },

  saveDraft() {
    if (!question || this.data.phase === 'completed') return
    const draft: QuizDraft = {
      version: 1, signature, question, queueIds: queue.map(word => word.id),
      ...(queueNeedsSnapshot ? { queueSnapshots: queue } : {}), cursor,
      answerOrder, orderCursor, selectedWrongOptionIds: [...selectedWrongIds], answeredCorrect,
      phase: this.data.phase, questionNumber: this.data.questionNumber, completedWords: this.data.completedWords,
      totalAttempts, firstResults: [...firstResults],
      wrongWordIds: [...wrongWordIds], startedAt, activeSeconds,
      completedWordIds: [...completedWordIds], firstAttemptByWord: { ...firstAttemptByWord }, sessionId,
    }
    try { wx.setStorageSync(DRAFT_KEY, draft) } catch (_error) { wx.showToast({ title: '进度保存失败', icon: 'none' }) }
  },

  restoreDraft(): boolean {
    try {
      const stored = wx.getStorageSync(DRAFT_KEY) as QuizDraft | undefined
      if (!stored || stored.version !== 1 || stored.signature !== signature || !stored.question) return false
      const pool = stored.queueSnapshots || (source === 'personal_pack' && packId ? getPersonalPackAvailableWords(packId, 'all') : getWordsByIds(stored.queueIds))
      const byId = new Map(pool.map(word => [word.id, word]))
      queue = stored.queueIds.map(id => byId.get(id)).filter((word): word is Word => Boolean(word))
      if (!queue.length) return false
      distractorPool = [...queue, ...getWords(bookId, 400)].filter((word, index, values) => (
        values.findIndex(candidate => candidate.id === word.id) === index
      ))
      cursor = Math.min(stored.cursor, queue.length)
      answerOrder = stored.answerOrder.length ? stored.answerOrder : createBalancedAnswerOrder()
      orderCursor = stored.orderCursor
      question = stored.question
      selectedWrongIds = new Set(stored.selectedWrongOptionIds)
      firstSelectionMade = stored.answeredCorrect || selectedWrongIds.size > 0
      answeredCorrect = stored.answeredCorrect
      firstResults = [...stored.firstResults]
      wrongWordIds = new Set(stored.wrongWordIds)
      startedAt = stored.startedAt
      activeSeconds = stored.activeSeconds
      activeStartedAt = Date.now()
      totalAttempts = stored.totalAttempts || 0
      completedWordIds = new Set(stored.completedWordIds || [])
      firstAttemptByWord = { ...(stored.firstAttemptByWord || {}) }
      sessionId = stored.sessionId || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`
      const entry = answeredCorrect ? entryForWord(question.word) : null
      this.setData({
        word: question.word,
        options: question.options.map(option => ({ ...option, state: option.correct && answeredCorrect ? 'correct' as const : selectedWrongIds.has(option.id) ? 'wrong' as const : 'idle' as const })),
        entry, forms: formsForEntry(entry?.wordForms),
        bookLabels: (entry?.bookIds || question.word.bookIds).map(id => id === 'high_school' ? '高中' : id === 'cet4' ? 'CET-4' : 'CET-6'),
        synonymsText: (entry?.synonyms || []).join(' · '), antonymsText: (entry?.antonyms || []).join(' · '),
        phase: stored.answeredCorrect ? 'explanation' : stored.phase,
        questionNumber: stored.questionNumber, completedWords: stored.completedWords,
        targetCount, progressText: targetCount ? `${stored.questionNumber} / ${targetCount}` : `第 ${stored.questionNumber} 题`,
        accuracy: firstTryAccuracy(firstResults), wrongCount: selectedWrongIds.size,
      })
      return true
    } catch (_error) { return false }
  },
})
