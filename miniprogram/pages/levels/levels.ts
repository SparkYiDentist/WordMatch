import { LEVEL_COUNT } from '../../engine/modes'
import { PlayType } from '../../engine/types'
import { getPreferredBook, loadProfile } from '../../services/storage'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

interface LevelItem {
  level: number
  stars: number
  unlocked: boolean
}

Page({
  data: {
    levels: [] as LevelItem[],
    bookLabel: '高中英语',
    playType: 'matching' as PlayType,
    dictionaryRefreshing: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ playType: query.playType === 'quiz' ? 'quiz' : 'matching' })
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
    const bookId = getPreferredBook()
    const profile = loadProfile()
    const progress = this.data.playType === 'quiz'
      ? (profile.quizLevelProgress || { '1': 0 })
      : profile.levelProgress
    const levels = Array.from({ length: LEVEL_COUNT }, (_, index) => {
      const level = index + 1
      return {
        level,
        stars: progress[String(level)] || 0,
        unlocked: progress[String(level)] !== undefined,
      }
    })
    const bookLabel = bookId === 'cet4' ? '大学英语四级' : bookId === 'cet6' ? '大学英语六级' : '高中英语'
    this.setData({ levels, bookLabel })
  },
  selectLevel(event: WechatMiniprogram.TouchEvent) {
    const level = Number(event.currentTarget.dataset.level)
    const item = this.data.levels.find(candidate => candidate.level === level)
    if (!item || !item.unlocked) {
      wx.showToast({ title: '请先完成上一关', icon: 'none' })
      return
    }
    const bookId = getPreferredBook()
    const url = this.data.playType === 'quiz'
      ? `/pages/word-quiz/word-quiz?mode=level&level=${level}&bookId=${bookId}`
      : `/pages/game/game?mode=level&level=${level}&bookId=${bookId}`
    wx.navigateTo({ url })
  },
  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() { openDictionaryOverlay(this, true) },
})
