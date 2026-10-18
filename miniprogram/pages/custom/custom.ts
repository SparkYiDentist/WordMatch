import { BookId } from '../../engine/types'
import {
  deleteWrongWord,
  getActiveWrongWordIds,
  getPreferredBook,
  loadProfile,
  setPreferredBook,
} from '../../services/storage'
import { getAvailableWordIds, getWordById } from '../../services/vocabulary-service'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

type Scope = 'all' | 'unlearned' | 'wrong'

interface DailyWrongPackView {
  date: string
  dateLabel: string
  count: number
  listHeight: number
  expanded: boolean
  words: Array<{ id: string; english: string; chinese: string }>
}

Page({
  data: {
    playType: 'matching' as 'matching' | 'quiz',
    bookId: 'high_school' as BookId,
    scope: 'all' as Scope,
    count: 20,
    useAll: false,
    availableCount: 0,
    canStart: false,
    wrongPackExpanded: false,
    wrongPacks: [] as DailyWrongPackView[],
    dictionaryRefreshing: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ playType: query.play === 'quiz' ? 'quiz' : 'matching' })
  },
  onShareAppMessage() {
    return {
      title: 'Pan的英语｜单词配对闯关，边玩边背单词',
      path: '/pages/index/index',
    }
  },
  onShareTimeline() {
    return {
      title: 'Pan的英语｜单词配对闯关，边玩边背单词',
    }
  },
  onShow() {
    this.setData({ bookId: getPreferredBook() }, () => {
      this.refreshAvailability()
      this.refreshWrongPacks()
    })
  },
  selectBook(event: WechatMiniprogram.TouchEvent) {
    const bookId = String(event.currentTarget.dataset.value) as BookId
    setPreferredBook(bookId)
    this.setData({ bookId }, () => this.refreshAvailability())
  },
  selectScope(event: WechatMiniprogram.TouchEvent) {
    this.setData({ scope: String(event.currentTarget.dataset.value) as Scope }, () => this.refreshAvailability())
  },
  selectCount(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value)
    this.setData({ count: value === 'all' ? 0 : Number(value), useAll: value === 'all' })
  },
  refreshAvailability() {
    const profile = loadProfile()
    const wrongIds = getActiveWrongWordIds(profile)
    const availableCount = getAvailableWordIds(
      this.data.bookId,
      this.data.scope,
      profile.learnedWordIds,
      wrongIds,
    ).length
    this.setData({ availableCount, canStart: availableCount > 0 })
  },
  refreshWrongPacks() {
    const profile = loadProfile()
    const expandedDates = new Set(this.data.wrongPacks.filter(item => item.expanded).map(item => item.date))
    const wrongPacks = Object.entries(profile.dailyWrongWordIds || {})
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, ids]) => {
        const words = ids.map(id => getWordById(id)).filter(Boolean).map(word => ({
          id: word!.id,
          english: word!.english,
          chinese: word!.fullMeaning,
        }))
        const parsed = new Date(`${date}T00:00:00`)
        return {
          date,
          dateLabel: `${parsed.getMonth() + 1}月${parsed.getDate()}日`,
          count: words.length,
          listHeight: Math.min(words.length, 3) * 92,
          expanded: expandedDates.has(date),
          words,
        }
      })
      .filter(pack => pack.count > 0)
    this.setData({ wrongPacks })
  },
  toggleWrongPack() {
    this.setData({ wrongPackExpanded: !this.data.wrongPackExpanded })
  },
  toggleWrongDate(event: WechatMiniprogram.TouchEvent) {
    const date = String(event.currentTarget.dataset.date)
    this.setData({
      wrongPacks: this.data.wrongPacks.map(pack => (
        pack.date === date ? { ...pack, expanded: !pack.expanded } : pack
      )),
    })
  },
  practiceWrongPack(event: WechatMiniprogram.TouchEvent) {
    const date = String(event.currentTarget.dataset.date)
    const pack = this.data.wrongPacks.find(item => item.date === date)
    if (!pack || pack.count === 0) return
    const page = this.data.playType === 'quiz' ? 'word-quiz/word-quiz' : 'game/game'
    wx.navigateTo({ url: `/pages/${page}?mode=custom&wrongDate=${date}&count=${pack.count}` })
  },
  deleteWrongEntry(event: WechatMiniprogram.TouchEvent) {
    const wordId = String(event.currentTarget.dataset.wordId)
    const word = getWordById(wordId)
    if (!word) return
    wx.showModal({
      title: '删除错题条目',
      content: `确认从错题记录中删除 “${word.english}” 吗？`,
      confirmText: '删除',
      confirmColor: '#c45f55',
      success: result => {
        if (!result.confirm) return
        deleteWrongWord(wordId)
        this.refreshAvailability()
        this.refreshWrongPacks()
      },
    })
  },
  startLearning() {
    if (!this.data.canStart) {
      wx.showToast({ title: '当前范围暂无可用单词', icon: 'none' })
      return
    }
    const requested = this.data.useAll ? this.data.availableCount : this.data.count
    const actual = Math.min(requested, this.data.availableCount)
    const navigate = (): void => {
      const page = this.data.playType === 'quiz' ? 'word-quiz/word-quiz' : 'game/game'
      wx.navigateTo({
        url: `/pages/${page}?mode=custom&bookId=${this.data.bookId}&scope=${this.data.scope}&count=${actual}`,
      })
    }
    if (actual < requested) {
      wx.showModal({
        title: '按实际词数开始',
        content: `计划训练 ${requested} 词，当前可用 ${actual} 词。是否继续？`,
        confirmText: '继续',
        success: result => { if (result.confirm) navigate() },
      })
      return
    }
    navigate()
  },
  openPersonalPacks() {
    wx.navigateTo({ url: `/pages/personal-packs/personal-packs?play=${this.data.playType}` })
  },
  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() { openDictionaryOverlay(this, true) },
})
