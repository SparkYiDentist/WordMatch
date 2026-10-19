import { emptySelection, isMatchingPair, selectCard, withSelectedStates } from '../../engine/matching'
import { createSlots, refillSlots, shuffle } from '../../engine/refill'
import { calculateAccuracy, createSessionStats, registerJudgement } from '../../engine/review'
import {
  BookId,
  CardSide,
  CardSlot,
  GameModeConfig,
  Selection,
  SessionStats,
  Word,
} from '../../engine/types'
import {
  AmbientSettings,
  getActiveWrongWordIds,
  getDailyWrongWordIds,
  loadAmbientSettings,
  loadProfile,
  recordAttempt,
  saveAmbientSettings,
  saveSessionOnce,
} from '../../services/storage'
import {
  AMBIENT_SOUND_OPTIONS,
  AmbientAudioState,
  AmbientSoundId,
  ambientAudioService,
} from '../../services/ambient-audio-service'
import { wordAudioService } from '../../services/word-audio-service'
import {
  getPersonalPackAvailableWords,
  getPersonalWordPack,
  recordPersonalPackAttempt,
} from '../../services/personal-word-pack'
import {
  getAvailableWordIds,
  getLevelWords,
  getNextWords,
  getWords,
  getWordsByIds,
  meaningsConflict,
  selectMatchMeaning,
} from '../../services/vocabulary-service'
import {
  configurePullGesture,
  endPullGesture,
  movePullGesture,
  startPullGesture,
} from '../../utils/pull-to-search'

interface CardTapDetail {
  side: CardSide
  index: number
}

interface PendingMatch {
  leftIndex: number
  rightIndex: number
}

interface AmbientSoundCard {
  id: Exclude<AmbientSoundId, 'off'>
  name: string
  englishName: string
  selected: boolean
}

interface AmbientSoundTapDetail {
  id?: AmbientSoundId
}

interface GamePageData {
  topInset: number
  leftCards: CardSlot[]
  rightCards: CardSlot[]
  modeTitle: string
  completedWords: number
  currentStreak: number
  accuracy: number
  progressPercent: number
  progressText: string
  durationText: string
  interactionLocked: boolean
  pauseVisible: boolean
  feedback: string
  dictionaryOpen: boolean
  pullHintVisible: boolean
  pullHintReady: boolean
  isEndless: boolean
  focusPanelVisible: boolean
  focusSheetOffset: number
  focusSheetGesture: boolean
  focusSheetDragging: boolean
  focusSheetSettling: boolean
  focusEnabled: boolean
  feedbackSoundEnabled: boolean
  ambientSoundId: AmbientSoundId
  ambientPlaying: boolean
  ambientLoading: boolean
  ambientError: string
  ambientSoundCards: AmbientSoundCard[]
}

let config: GameModeConfig
let session: SessionStats
let selection: Selection = emptySelection()
let sourcePool: Word[] = []
let sourceQueue: Word[] = []
let queueCursor = 0
let timerId: number | null = null
let pausedAt = 0
let pausedDuration = 0
let sessionSaved = false
let pendingMatch: PendingMatch | null = null
let activeBookId: BookId = 'high_school'
let endlessSeenIds = new Set<string>()
let activePackId = ''
let sheetTouchStartY = 0
let sheetTouchLastY = 0
let sheetTouchLastAt = 0
let sheetTouchOffset = 0
let sheetTouchVelocity = 0
let sheetTouchTracking = false
let sheetDismissTimer: number | null = null
let lastStudyActivityAt = 0
let hiddenAt = 0
let ambientSettings: AmbientSettings
let ambientWasPlayingBeforePause = false

const ambientCards = (selectedId: AmbientSoundId): AmbientSoundCard[] => (
  AMBIENT_SOUND_OPTIONS.map(({ id, name, englishName }) => ({
    id, name, englishName, selected: id === selectedId,
  }))
)

const parseBookId = (value: string | undefined): BookId => (
  value === 'cet4' || value === 'cet6' ? value : 'high_school'
)

const activeWords = (left: CardSlot[]): Word[] => left
  .map(slot => slot.word)
  .filter((word): word is Word => Boolean(word))

const formatDuration = (seconds: number): string => (
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
)

const sessionWithActiveDuration = (now: number = Date.now()): SessionStats => {
  const currentPause = pausedAt ? now - pausedAt : 0
  const currentHidden = hiddenAt ? now - hiddenAt : 0
  return {
    ...session,
    startedAt: session.startedAt + pausedDuration + currentPause + currentHidden,
  }
}

Page<GamePageData, {
  initializeGame(query: Record<string, string | undefined>): void
  takeNextWords(count: number, current: Word[]): Word[]
  handleCardTap(event: WechatMiniprogram.CustomEvent<CardTapDetail>): void
  playPronunciation(word: Word): void
  judgeSelection(): void
  updateStatsData(feedback?: string): void
  finishCorrectMatch(leftIndex: number, rightIndex: number): void
  handleAfterRemoval(): void
  performRefill(additions: Word[]): void
  startTimer(): void
  updateTimer(): void
  goBack(): void
  openPause(): void
  resumeGame(): void
  saveAndExit(): void
  finishSession(): void
  openDictionary(): void
  closeDictionary(): void
  handleDictionaryTouchStart(event: WechatMiniprogram.TouchEvent): void
  handleDictionaryTouchMove(event: WechatMiniprogram.TouchEvent): void
  handleDictionaryTouchEnd(): void
  openFocusPanel(): void
  closeFocusPanel(): void
  stopOverlayTap(): void
  handleSheetTouchStart(event: WechatMiniprogram.TouchEvent): void
  handleSheetTouchMove(event: WechatMiniprogram.TouchEvent): void
  handleSheetTouchEnd(): void
  selectAmbientSound(event: WechatMiniprogram.BaseEvent<AmbientSoundTapDetail>): void
  toggleAmbientPlayback(): void
  disableAmbientSound(): void
  handleFocusSwitch(event: WechatMiniprogram.SwitchChange): void
  handleFeedbackSoundSwitch(event: WechatMiniprogram.SwitchChange): void
  handleAmbientState(state: AmbientAudioState): void
  persistAmbientSettings(patch: Partial<AmbientSettings>): void
}>({
  data: {
    topInset: 72,
    leftCards: [],
    rightCards: [],
    modeTitle: '单词配对',
    completedWords: 0,
    currentStreak: 0,
    accuracy: 100,
    progressPercent: 0,
    progressText: '准备开始',
    durationText: '0:00',
    interactionLocked: false,
    pauseVisible: false,
    feedback: '任选一侧开始配对',
    dictionaryOpen: false,
    pullHintVisible: false,
    pullHintReady: false,
    isEndless: false,
    focusPanelVisible: false,
    focusSheetOffset: 0,
    focusSheetGesture: false,
    focusSheetDragging: false,
    focusSheetSettling: false,
    focusEnabled: false,
    feedbackSoundEnabled: true,
    ambientSoundId: 'off',
    ambientPlaying: false,
    ambientLoading: false,
    ambientError: '',
    ambientSoundCards: ambientCards('off'),
  },

  onLoad(query) {
    try {
      const menuButton = wx.getMenuButtonBoundingClientRect()
      if (menuButton.bottom > 0) {
        this.setData({ topInset: menuButton.bottom + 8 })
      }
    } catch (_error) {
      // Keep the conservative fallback inset on environments without the API.
    }
    configurePullGesture(this, () => this.openDictionary())
    this.initializeGame(query)
  },
  onShareAppMessage() {
    return {
      title: 'Pan的英语｜单词配对闯关，边玩边背单词',
      path: '/pages/index/index',
    }
  },

  onUnload() {
    if (timerId !== null) clearInterval(timerId)
    if (sheetDismissTimer !== null) clearTimeout(sheetDismissTimer)
    ambientAudioService.setListener(null)
    ambientAudioService.destroy()
    wordAudioService.stop()
    if (!sessionSaved && session && (session.pairAttempts > 0 || session.completedWords > 0)) {
      saveSessionOnce(sessionWithActiveDuration())
      sessionSaved = true
    }
  },

  onShow() {
    if (hiddenAt) pausedDuration += Date.now() - hiddenAt
    hiddenAt = 0
    if (session && !pausedAt) lastStudyActivityAt = Date.now()
  },

  onHide() {
    if (!pausedAt) hiddenAt = Date.now()
    lastStudyActivityAt = 0
    wordAudioService.stop()
    if (config && config.mode === 'endless') {
      ambientWasPlayingBeforePause = false
      ambientAudioService.pause()
    }
  },

  initializeGame(query) {
    const mode = query.mode === 'level' || query.mode === 'custom' ? query.mode : 'endless'
    const profile = loadProfile()
    if (mode === 'level') {
      const level = Math.max(1, Math.min(10, Number(query.level) || 1))
      activeBookId = parseBookId(query.bookId)
      sourcePool = getLevelWords(activeBookId, level)
      config = { mode, title: `闯关模式 · 第 ${level} 关`, targetCount: sourcePool.length, level }
    } else if (mode === 'custom') {
      const scope = query.scope === 'unlearned' || query.scope === 'wrong' ? query.scope : 'all'
      const requested = Math.max(1, Number(query.count) || 20)
      if (query.wrongDate) {
        activePackId = ''
        const archivedIds = getDailyWrongWordIds(query.wrongDate, profile)
        sourcePool = getWordsByIds(shuffle(archivedIds).slice(0, Math.min(requested, archivedIds.length)))
        config = { mode, title: `${query.wrongDate} · 错题包`, targetCount: sourcePool.length, source: 'system' }
      } else if (query.source === 'personal_pack' && query.packId) {
        activePackId = query.packId
        const pack = getPersonalWordPack(activePackId)
        const available = getPersonalPackAvailableWords(activePackId, scope)
        sourcePool = shuffle(available).slice(0, Math.min(requested, available.length))
        config = {
          mode, title: pack ? pack.name : '我的词包', targetCount: sourcePool.length,
          scope, source: 'personal_pack', packId: activePackId,
        }
      } else {
        activePackId = ''
        const bookId = query.bookId === 'all' ? 'all' : parseBookId(query.bookId)
        const wrongIds = getActiveWrongWordIds(profile)
        const availableIds = getAvailableWordIds(bookId, scope, profile.learnedWordIds, wrongIds)
        sourcePool = getWordsByIds(shuffle(availableIds).slice(0, Math.min(requested, availableIds.length)))
        config = { mode, title: '自选模式', targetCount: sourcePool.length, scope, source: 'system' }
      }
    } else {
      activeBookId = parseBookId(query.bookId)
      sourcePool = getWords(activeBookId, 200)
      config = { mode, title: '无尽模式', targetCount: null, bookId: activeBookId }
    }

    if (sourcePool.length < (config.source === 'personal_pack' ? 5 : 1)) {
      wx.showModal({
        title: '没有可用单词',
        content: config.source === 'personal_pack'
          ? '个人词包当前范围少于 5 个有效单词，请返回继续补充或更换范围。'
          : '请返回并更换词库或学习范围。',
        showCancel: false,
        success: () => wx.navigateBack(),
      })
      return
    }

    sourceQueue = shuffle(sourcePool)
    queueCursor = 0
    selection = emptySelection()
    pendingMatch = null
    endlessSeenIds = new Set<string>()
    pausedDuration = 0
    pausedAt = 0
    sessionSaved = false
    session = createSessionStats(config)
    lastStudyActivityAt = Date.now()
    hiddenAt = 0
    const initial = this.takeNextWords(Math.min(5, sourcePool.length), [])
    const board = createSlots(initial)
    ambientSettings = config.mode === 'endless' ? loadAmbientSettings() : {
      soundId: 'off', focusEnabled: false, feedbackSoundEnabled: true,
    }
    ambientWasPlayingBeforePause = false
    ambientAudioService.setListener(config.mode === 'endless' ? state => this.handleAmbientState(state) : null)
    this.setData({
      leftCards: board.left,
      rightCards: board.right,
      modeTitle: config.title,
      completedWords: 0,
      currentStreak: 0,
      accuracy: 100,
      progressPercent: 0,
      progressText: config.targetCount ? `0 / ${config.targetCount}` : '本轮 0 / 10',
      durationText: '0:00',
      interactionLocked: false,
      pauseVisible: false,
      feedback: '任选一侧开始配对',
      dictionaryOpen: false,
      pullHintVisible: false,
      pullHintReady: false,
      isEndless: config.mode === 'endless',
      focusPanelVisible: false,
      focusEnabled: config.mode === 'endless' && ambientSettings.focusEnabled,
      feedbackSoundEnabled: ambientSettings.feedbackSoundEnabled,
      ambientSoundId: ambientSettings.soundId,
      ambientPlaying: false,
      ambientLoading: false,
      ambientError: '',
      ambientSoundCards: ambientCards(ambientSettings.soundId),
    })
    this.startTimer()
  },

  takeNextWords(count, current) {
    const result: Word[] = []
    const blockedIds = new Set(current.map(word => word.id))
    const blockedEnglish = new Set(current.map(word => word.english.toLocaleLowerCase()))
    const blockedMeanings = current.flatMap(word => (
      word.displayMeanings || word.matchMeanings || [word.matchMeaning]
    ))
    let guard = 0
    const maxGuard = Math.max(sourcePool.length * 3, 20)

    while (result.length < count && guard < maxGuard) {
      if (queueCursor >= sourceQueue.length) {
        if (config.targetCount !== null) break
        let nextChunk = getNextWords(activeBookId, 200, [...endlessSeenIds])
        if (nextChunk.length === 0) {
          endlessSeenIds.clear()
          const profile = loadProfile()
          const wrongIds = getActiveWrongWordIds(profile)
          const reviewWords = shuffle(getWordsByIds(wrongIds)
            .filter(word => word.bookIds.includes(activeBookId)))
            .slice(0, 40)
          nextChunk = [
            ...reviewWords,
            ...getNextWords(activeBookId, 200 - reviewWords.length, reviewWords.map(word => word.id)),
          ]
        }
        sourcePool = nextChunk
        sourceQueue = shuffle(nextChunk)
        queueCursor = 0
        if (sourceQueue.length === 0) break
      }
      const word = sourceQueue[queueCursor]
      queueCursor += 1
      guard += 1
      const english = word.english.toLocaleLowerCase()
      const selectedWord = selectMatchMeaning(word, blockedMeanings)
      const meaning = selectedWord?.matchMeaning || ''
      if (!blockedIds.has(word.id)
        && !blockedEnglish.has(english)
        && Boolean(selectedWord)
        && !blockedMeanings.some(existing => meaningsConflict(existing, meaning))) {
        result.push(selectedWord!)
        blockedIds.add(word.id)
        blockedEnglish.add(english)
        blockedMeanings.push(...(selectedWord!.displayMeanings || [meaning]))
        if (config.targetCount === null) endlessSeenIds.add(word.id)
      } else if (config.targetCount !== null) {
        sourceQueue.push(word)
      }
    }
    return result
  },

  handleCardTap(event) {
    const { side, index } = event.detail
    const slots = side === 'english' ? this.data.leftCards : this.data.rightCards
    const result = selectCard(selection, side, index, slots, this.data.interactionLocked)
    if (result.ignored) return
    const tappedWord = slots[index]?.word
    if (side === 'english' && tappedWord) this.playPronunciation(tappedWord)
    selection = result.selection
    this.setData({
      leftCards: withSelectedStates(this.data.leftCards, selection.englishIndex),
      rightCards: withSelectedStates(this.data.rightCards, selection.chineseIndex),
      feedback: result.readyToJudge ? '正在判断…' : '再选一张对应卡片',
    })
    if (result.readyToJudge) this.judgeSelection()
  },

  playPronunciation(word) {
    wordAudioService.play(word.english).then(started => {
      if (!started) wx.showToast({ title: '该词发音暂不可用', icon: 'none' })
    })
  },

  judgeSelection() {
    if (selection.englishIndex === null || selection.chineseIndex === null) return
    const leftIndex = selection.englishIndex
    const rightIndex = selection.chineseIndex
    const leftSlot = this.data.leftCards[leftIndex]
    const rightSlot = this.data.rightCards[rightIndex]
    if (!leftSlot.word || !rightSlot.word) return

    const correct = isMatchingPair(leftSlot, rightSlot)
    const now = Date.now()
    const studySeconds = lastStudyActivityAt ? Math.max(0, Math.floor((now - lastStudyActivityAt) / 1000)) : 0
    lastStudyActivityAt = now
    session = registerJudgement(session, leftSlot.word.id, rightSlot.word.id, correct)
    const attemptedIds = correct ? [leftSlot.word.id] : [leftSlot.word.id, rightSlot.word.id]
    if (config.source === 'personal_pack' && activePackId) {
      recordPersonalPackAttempt(activePackId, attemptedIds, correct, now)
    }
    recordAttempt(attemptedIds, correct, now, {
      mode: config.mode,
      studySeconds,
      collectDailyWrong: config.source !== 'personal_pack',
    })

    const leftCards = this.data.leftCards.map((slot, index) => ({
      ...slot,
      state: index === leftIndex ? (correct ? 'correct' as const : 'wrong' as const) : slot.state,
    }))
    const rightCards = this.data.rightCards.map((slot, index) => ({
      ...slot,
      state: index === rightIndex ? (correct ? 'correct' as const : 'wrong' as const) : slot.state,
    }))
    this.setData({ leftCards, rightCards, interactionLocked: true })
    this.updateStatsData(correct ? '配对成功' : '再想一想')

    if (correct) {
      setTimeout(() => this.finishCorrectMatch(leftIndex, rightIndex), 620)
    } else {
      setTimeout(() => {
        selection = emptySelection()
        this.setData({
          leftCards: withSelectedStates(this.data.leftCards, null),
          rightCards: withSelectedStates(this.data.rightCards, null),
          interactionLocked: false,
          feedback: '已记入错词，再试一次',
        })
      }, 420)
    }
  },

  finishCorrectMatch(leftIndex, rightIndex) {
    const targetReached = config.targetCount !== null && session.completedWords >= config.targetCount
    const shouldWaitForSecond = session.completedWords % 2 === 1
      && !targetReached
      && activeWords(this.data.leftCards).length > 1

    if (shouldWaitForSecond) {
      pendingMatch = { leftIndex, rightIndex }
      selection = emptySelection()
      this.setData({
        leftCards: this.data.leftCards.map((slot, index) => (
          index === leftIndex ? { ...slot, state: 'waiting' as const } : slot
        )),
        rightCards: this.data.rightCards.map((slot, index) => (
          index === rightIndex ? { ...slot, state: 'waiting' as const } : slot
        )),
        interactionLocked: false,
        feedback: '第一组已配对，再完成一组一起消除',
      })
      return
    }

    const leftIndexes = new Set([leftIndex])
    const rightIndexes = new Set([rightIndex])
    if (pendingMatch) {
      leftIndexes.add(pendingMatch.leftIndex)
      rightIndexes.add(pendingMatch.rightIndex)
    }
    pendingMatch = null
    const leftCards = this.data.leftCards.map((slot, index) => (
      leftIndexes.has(index) ? { ...slot, state: 'removing' as const } : slot
    ))
    const rightCards = this.data.rightCards.map((slot, index) => (
      rightIndexes.has(index) ? { ...slot, state: 'removing' as const } : slot
    ))
    this.setData({ leftCards, rightCards })
    setTimeout(() => {
      const clearedLeft = this.data.leftCards.map((slot, index) => (
        leftIndexes.has(index) ? { ...slot, word: null, state: 'idle' as const } : { ...slot, state: 'idle' as const }
      ))
      const clearedRight = this.data.rightCards.map((slot, index) => (
        rightIndexes.has(index) ? { ...slot, word: null, state: 'idle' as const } : { ...slot, state: 'idle' as const }
      ))
      selection = emptySelection()
      this.setData({ leftCards: clearedLeft, rightCards: clearedRight })
      this.handleAfterRemoval()
    }, 440)
  },

  handleAfterRemoval() {
    if (config.targetCount !== null && session.completedWords >= config.targetCount) {
      this.finishSession()
      return
    }

    if (session.completedWords % 2 === 0 || activeWords(this.data.leftCards).length === 0) {
      const current = activeWords(this.data.leftCards)
      const emptyCount = 5 - current.length
      let refillCount = Math.min(2, emptyCount)
      if (config.targetCount !== null) {
        const notIntroduced = Math.max(0, config.targetCount - session.completedWords - current.length)
        refillCount = Math.min(refillCount, notIntroduced)
      }
      const additions = this.takeNextWords(refillCount, current)
      this.performRefill(additions)
      return
    }

    this.setData({ interactionLocked: false, feedback: '继续配对，下一组后补词' })
  },

  performRefill(additions) {
    const board = refillSlots(this.data.leftCards, this.data.rightCards, additions)
    this.setData({
      leftCards: board.left,
      rightCards: board.right,
      feedback: additions.length ? `补充 ${additions.length} 个新词` : '继续完成剩余单词',
    })
    setTimeout(() => {
      this.setData({
        leftCards: this.data.leftCards.map(slot => ({ ...slot, state: 'idle' as const })),
        rightCards: this.data.rightCards.map(slot => ({ ...slot, state: 'idle' as const })),
        interactionLocked: false,
      })
    }, 480)
  },

  updateStatsData(feedback) {
    const message = feedback || this.data.feedback
    const target = config.targetCount
    const cycleProgress = session.completedWords % 10
    this.setData({
      completedWords: session.completedWords,
      currentStreak: session.currentStreak,
      accuracy: calculateAccuracy(session),
      progressPercent: target
        ? Math.min(100, Math.round((session.completedWords / target) * 100))
        : cycleProgress * 10,
      progressText: target
        ? `${session.completedWords} / ${target}`
        : `本轮 ${cycleProgress} / 10`,
      feedback: message,
    })
  },

  startTimer() {
    if (timerId !== null) clearInterval(timerId)
    timerId = setInterval(() => this.updateTimer(), 1000)
  },

  updateTimer() {
    if (pausedAt || hiddenAt) return
    const elapsed = Math.max(0, Math.floor((Date.now() - session.startedAt - pausedDuration) / 1000))
    this.setData({ durationText: formatDuration(elapsed) })
  },

  goBack() {
    this.openPause()
  },

  openPause() {
    if (this.data.interactionLocked || this.data.pauseVisible) return
    pausedAt = Date.now()
    lastStudyActivityAt = 0
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
    ambientWasPlayingBeforePause = this.data.ambientPlaying
    ambientAudioService.pause()
    this.setData({ pauseVisible: true, interactionLocked: true })
  },

  resumeGame() {
    if (pausedAt) pausedDuration += Date.now() - pausedAt
    pausedAt = 0
    lastStudyActivityAt = Date.now()
    this.setData({ pauseVisible: false, interactionLocked: false })
    this.updateTimer()
    this.startTimer()
    if (ambientWasPlayingBeforePause && ambientSettings.soundId !== 'off') {
      ambientAudioService.play(ambientSettings.soundId)
    }
    ambientWasPlayingBeforePause = false
  },

  openDictionary() {
    if (this.data.interactionLocked || this.data.pauseVisible || this.data.dictionaryOpen) {
      if (!this.data.dictionaryOpen) wx.showToast({ title: '请等待当前动画结束', icon: 'none' })
      return
    }
    pausedAt = Date.now()
    lastStudyActivityAt = 0
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
    this.setData({
      dictionaryOpen: true,
      interactionLocked: true,
      pullHintVisible: false,
      pullHintReady: false,
    }, () => {
      const dictionary = this.selectComponent('#globalDictionary') as unknown as { open(): void } | undefined
      if (dictionary) dictionary.open()
    })
  },

  closeDictionary() {
    if (!this.data.dictionaryOpen) return
    if (pausedAt) pausedDuration += Date.now() - pausedAt
    pausedAt = 0
    lastStudyActivityAt = Date.now()
    this.setData({ dictionaryOpen: false, interactionLocked: false })
    this.updateTimer()
    this.startTimer()
  },

  handleDictionaryTouchStart(event) {
    startPullGesture(this, event, this.data.interactionLocked
      || this.data.pauseVisible
      || this.data.dictionaryOpen)
  },

  handleDictionaryTouchMove(event) {
    movePullGesture(this, event)
  },

  handleDictionaryTouchEnd() {
    endPullGesture(this)
  },
  openFocusPanel() {
    if (!this.data.isEndless || this.data.pauseVisible || this.data.dictionaryOpen) return
    if (sheetDismissTimer !== null) clearTimeout(sheetDismissTimer)
    sheetDismissTimer = null
    sheetTouchOffset = 0
    this.setData({
      focusPanelVisible: true,
      focusSheetOffset: 0,
      focusSheetGesture: false,
      focusSheetDragging: false,
      focusSheetSettling: false,
    })
  },

  closeFocusPanel() {
    if (sheetDismissTimer !== null) clearTimeout(sheetDismissTimer)
    sheetDismissTimer = null
    sheetTouchTracking = false
    sheetTouchOffset = 0
    sheetTouchVelocity = 0
    this.setData({
      focusPanelVisible: false,
      focusSheetOffset: 0,
      focusSheetGesture: false,
      focusSheetDragging: false,
      focusSheetSettling: false,
    })
  },

  stopOverlayTap() {
    // Stops taps inside the sheet from closing the overlay.
  },

  handleSheetTouchStart(event) {
    const touch = event.touches[0]
    sheetTouchTracking = Boolean(touch)
    sheetTouchStartY = touch ? touch.clientY : 0
    sheetTouchLastY = sheetTouchStartY
    sheetTouchLastAt = Date.now()
    sheetTouchOffset = 0
    sheetTouchVelocity = 0
    if (touch) {
      this.setData({
        focusSheetGesture: true,
        focusSheetDragging: true,
        focusSheetSettling: false,
      })
    }
  },

  handleSheetTouchMove(event) {
    if (!sheetTouchTracking) return
    const touch = event.touches[0]
    if (!touch) return
    const now = Date.now()
    const elapsed = Math.max(1, now - sheetTouchLastAt)
    const rawDistance = Math.max(0, touch.clientY - sheetTouchStartY)
    const resistedDistance = rawDistance <= 360 ? rawDistance : 360 + (rawDistance - 360) * 0.24
    const instantVelocity = (touch.clientY - sheetTouchLastY) / elapsed
    sheetTouchVelocity = sheetTouchVelocity * 0.55 + instantVelocity * 0.45
    sheetTouchLastY = touch.clientY
    sheetTouchLastAt = now
    sheetTouchOffset = resistedDistance
    this.setData({ focusSheetOffset: Math.round(resistedDistance) })
  },

  handleSheetTouchEnd() {
    if (!sheetTouchTracking) return
    sheetTouchTracking = false
    const shouldDismiss = sheetTouchOffset >= 110 || (sheetTouchOffset >= 32 && sheetTouchVelocity >= 0.55)
    if (!shouldDismiss) {
      sheetTouchOffset = 0
      sheetTouchVelocity = 0
      this.setData({
        focusSheetOffset: 0,
        focusSheetDragging: false,
        focusSheetSettling: true,
      })
      return
    }

    let dismissDistance = 900
    try {
      dismissDistance = Math.max(dismissDistance, wx.getSystemInfoSync().windowHeight + 80)
    } catch (_error) {
      // The conservative distance already moves the sheet fully off-screen.
    }
    sheetTouchOffset = dismissDistance
    this.setData({
      focusSheetOffset: dismissDistance,
      focusSheetDragging: false,
      focusSheetSettling: true,
    })
    sheetDismissTimer = setTimeout(() => this.closeFocusPanel(), 280)
  },

  selectAmbientSound(event) {
    const soundId = event.currentTarget.dataset.id as AmbientSoundId | undefined
    if (!soundId || soundId === 'off') return
    const wasPlaying = this.data.ambientPlaying
    this.persistAmbientSettings({ soundId })
    if (wasPlaying) ambientAudioService.play(soundId)
  },

  toggleAmbientPlayback() {
    if (this.data.ambientLoading) return
    if (this.data.ambientPlaying) {
      ambientAudioService.pause()
      return
    }
    const soundId = ambientSettings.soundId === 'off' ? 'rain' : ambientSettings.soundId
    if (ambientSettings.soundId === 'off') this.persistAmbientSettings({ soundId })
    ambientAudioService.play(soundId).then(started => {
      if (!started && ambientAudioService.getState().error) {
        wx.showToast({ title: ambientAudioService.getState().error, icon: 'none' })
      }
    })
  },

  disableAmbientSound() {
    ambientWasPlayingBeforePause = false
    ambientAudioService.stop()
    this.persistAmbientSettings({ soundId: 'off' })
  },

  handleFocusSwitch(event) {
    this.persistAmbientSettings({ focusEnabled: event.detail.value })
  },

  handleFeedbackSoundSwitch(event) {
    this.persistAmbientSettings({ feedbackSoundEnabled: event.detail.value })
  },

  handleAmbientState(state) {
    this.setData({
      ambientPlaying: state.playing,
      ambientLoading: state.loading,
      ambientError: state.error,
    })
  },

  persistAmbientSettings(patch) {
    ambientSettings = saveAmbientSettings({ ...ambientSettings, ...patch })
    this.setData({
      ambientSoundId: ambientSettings.soundId,
      focusEnabled: ambientSettings.focusEnabled,
      feedbackSoundEnabled: ambientSettings.feedbackSoundEnabled,
      ambientSoundCards: ambientCards(ambientSettings.soundId),
    })
  },

  saveAndExit() {
    ambientWasPlayingBeforePause = false
    ambientAudioService.stop()
    if (!sessionSaved) {
      saveSessionOnce(sessionWithActiveDuration())
      sessionSaved = true
    }
    wx.redirectTo({ url: '/pages/result/result' })
  },

  finishSession() {
    ambientWasPlayingBeforePause = false
    ambientAudioService.stop()
    this.setData({ interactionLocked: true, feedback: '完成训练，正在生成结果…' })
    if (!sessionSaved) {
      saveSessionOnce(sessionWithActiveDuration())
      sessionSaved = true
    }
    setTimeout(() => wx.redirectTo({ url: '/pages/result/result' }), 360)
  },
})
