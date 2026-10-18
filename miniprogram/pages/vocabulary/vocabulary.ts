import {
  deleteWrongWordsForDate,
  getActiveWrongWordIds,
  getAllWrongWordIds,
  getTodayCompletedCount,
  getTodayWordIds,
  loadProfile,
} from '../../services/storage'
import { getWordById } from '../../services/vocabulary-service'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

type VocabularyView = 'today' | 'learned' | 'wrong'

interface VocabularyItem {
  id: string
  english: string
  chinese: string
  partOfSpeech: string
  tag: string
  date: string
}

interface WrongDateGroup {
  date: string
  dateLabel: string
  count: number
  listHeight: number
  expanded: boolean
  words: VocabularyItem[]
}

const localDateKey = (timestamp: number): string => {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

Page({
  data: {
    view: 'wrong' as VocabularyView,
    words: [] as VocabularyItem[],
    wrongDateGroups: [] as WrongDateGroup[],
    kicker: 'REVIEW NOTEBOOK',
    title: '错过的，再碰一次',
    summary: '按错误次数排序，集中复习薄弱词汇',
    emptyTitle: '错词本还是空的',
    emptyDesc: '完成几轮配对后，需要复习的词会出现在这里。',
    accentClass: 'vocab-head__count--wrong',
    showReview: true,
    manageMode: false,
    dictionaryRefreshing: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    const view: VocabularyView = query.view === 'today' || query.view === 'learned' ? query.view : 'wrong'
    const manageMode = view === 'wrong' && query.manage === '1'
    this.setData({ view, manageMode })
    wx.setNavigationBarTitle({
      title: manageMode ? '错题条目管理' : view === 'today' ? '今日学习' : view === 'learned' ? '累计单词' : '错词本',
    })
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
    const profile = loadProfile()
    const view = this.data.view
    const todayIds = getTodayWordIds()
    const sourceIds = view === 'today'
      ? todayIds
      : view === 'learned'
        ? profile.learnedWordIds
        : this.data.manageMode ? getAllWrongWordIds(profile) : getActiveWrongWordIds(profile)
    const words = sourceIds
      .filter(id => Boolean(getWordById(id)) && Boolean(profile.wordProgressById[id]))
      .map(key => {
        const word = getWordById(key)!
        const progress = profile.wordProgressById[key]
        const date = new Date(progress.lastPracticedAt)
        return {
          id: word.id,
          english: word.english,
          chinese: word.fullMeaning,
          partOfSpeech: word.partOfSpeech || '',
          tag: view === 'wrong' ? `错 ${progress.errorCount} 次` : `练习 ${progress.practiceCount} 次`,
          date: `${date.getMonth() + 1}月${date.getDate()}日`,
        }
      })
      .sort((a, b) => {
        const aProgress = profile.wordProgressById[String(a.id)]
        const bProgress = profile.wordProgressById[String(b.id)]
        return view === 'wrong'
          ? bProgress.errorCount - aProgress.errorCount
          : bProgress.lastPracticedAt - aProgress.lastPracticedAt
      })

    const expandedDates = new Set(this.data.wrongDateGroups.filter(group => group.expanded).map(group => group.date))
    const archivedIds = new Set(Object.values(profile.dailyWrongWordIds || {}).flat())
    const groupedIds: Record<string, string[]> = Object.fromEntries(
      Object.entries(profile.dailyWrongWordIds || {}).map(([date, ids]) => [date, [...ids]]),
    )
    if (this.data.manageMode) {
      sourceIds.filter(id => !archivedIds.has(id)).forEach(id => {
        const progress = profile.wordProgressById[id]
        if (!progress) return
        const date = localDateKey(progress.lastPracticedAt)
        groupedIds[date] = [...new Set([...(groupedIds[date] || []), id])]
      })
    }
    const wrongDateGroups: WrongDateGroup[] = this.data.manageMode
      ? Object.entries(groupedIds)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, ids]) => {
          const groupWords = ids
            .map(id => words.find(word => word.id === id))
            .filter((word): word is VocabularyItem => Boolean(word))
          const parsed = new Date(`${date}T00:00:00`)
          return {
            date,
            dateLabel: `${parsed.getMonth() + 1}月${parsed.getDate()}日`,
            count: groupWords.length,
            listHeight: Math.min(groupWords.length, 4) * 148,
            expanded: expandedDates.has(date),
            words: groupWords,
          }
        })
        .filter(group => group.count > 0)
      : []

    const settings = view === 'today'
      ? {
        kicker: 'TODAY\'S LEARNING',
        title: '今天碰过的单词',
        summary: `完成 ${getTodayCompletedCount()} 次配对，共 ${words.length} 个不同单词`,
        emptyTitle: '今天还没有学习记录',
        emptyDesc: '选择任意模式开始配对，今天学过的单词会记录在这里。',
        accentClass: 'vocab-head__count--today',
        showReview: false,
      }
      : view === 'learned'
        ? {
          kicker: 'LEARNING ARCHIVE',
          title: '一路积累的单词',
          summary: `累计掌握 ${words.length} 个不同单词`,
          emptyTitle: '还没有累计单词',
          emptyDesc: '完成一次正确配对后，单词就会加入你的学习档案。',
          accentClass: 'vocab-head__count--learned',
          showReview: false,
        }
        : {
          kicker: 'REVIEW NOTEBOOK',
          title: '错过的，再碰一次',
          summary: this.data.manageMode ? '按日期查看并整组删除当天错题' : '连续答对 2 次后从活跃错词中移出',
          emptyTitle: '错词本还是空的',
          emptyDesc: '完成几轮配对后，需要复习的词会出现在这里。',
          accentClass: 'vocab-head__count--wrong',
          showReview: !this.data.manageMode,
        }
    this.setData({ words, wrongDateGroups, ...settings })
  },
  toggleWrongDate(event: WechatMiniprogram.TouchEvent) {
    const date = String(event.currentTarget.dataset.date)
    this.setData({
      wrongDateGroups: this.data.wrongDateGroups.map(group => (
        group.date === date ? { ...group, expanded: !group.expanded } : group
      )),
    })
  },
  startReview() {
    if (this.data.words.length === 0) return
    wx.navigateTo({ url: '/pages/game/game?mode=custom&bookId=all&scope=wrong&count=20' })
  },
  deleteWrongDate(event: WechatMiniprogram.TouchEvent) {
    const date = String(event.currentTarget.dataset.date)
    const group = this.data.wrongDateGroups.find(item => item.date === date)
    if (!group) return
    wx.showModal({
      title: '删除当天错题',
      content: `确认删除 ${group.dateLabel} 的 ${group.count} 条错题吗？其他日期记录不会受到影响。`,
      confirmText: '删除',
      confirmColor: '#c45f55',
      success: result => {
        if (!result.confirm) return
        deleteWrongWordsForDate(date, group.words.map(word => word.id))
        this.onShow()
      },
    })
  },
  goCustom() {
    wx.navigateTo({ url: '/pages/custom/custom' })
  },
  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() { openDictionaryOverlay(this, true) },
})
