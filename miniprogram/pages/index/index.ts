import {
  checkInToday,
  getCheckInStatus,
  getTodayCompletedCount,
  getActiveWrongWordIds,
  setPreferredBook,
  loadProfile,
} from '../../services/storage'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

Page({
  data: {
    playType: 'matching' as 'matching' | 'quiz',
    todayCount: 0,
    learnedCount: 0,
    wrongCount: 0,
    checkedToday: false,
    checkInStreak: 0,
    dictionaryRefreshing: false,
  },
  selectPlayType(event: WechatMiniprogram.TouchEvent) {
    this.setData({ playType: String(event.currentTarget.dataset.value) as 'matching' | 'quiz' })
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
    const checkIn = getCheckInStatus()
    const wrongCount = getActiveWrongWordIds(profile).length
    this.setData({
      todayCount: getTodayCompletedCount(),
      learnedCount: profile.learnedWordIds.length,
      wrongCount,
      checkedToday: checkIn.checkedToday,
      checkInStreak: checkIn.streak,
    })
  },
  handleCheckIn() {
    if (this.data.checkedToday) {
      wx.showToast({ title: `已连续签到 ${this.data.checkInStreak} 天`, icon: 'none' })
      return
    }
    const checkIn = checkInToday()
    this.setData({
      checkedToday: checkIn.checkedToday,
      checkInStreak: checkIn.streak,
    })
    if (checkIn.checkedToday) {
      wx.showToast({ title: `签到成功，连续 ${checkIn.streak} 天`, icon: 'success' })
    }
  },
  startEndless() {
    const bookIds = ['high_school', 'cet4', 'cet6'] as const
    wx.showActionSheet({
      itemList: ['高中英语', '大学英语四级 CET-4', '大学英语六级 CET-6'],
      success: result => {
        const bookId = bookIds[result.tapIndex]
        if (!bookId) return
        setPreferredBook(bookId)
        const page = this.data.playType === 'quiz' ? 'word-quiz/word-quiz' : 'game/game'
        wx.navigateTo({ url: `/pages/${page}?mode=endless&bookId=${bookId}` })
      },
    })
  },
  openLevels() {
    wx.navigateTo({ url: `/pages/levels/levels?playType=${this.data.playType}` })
  },
  openCustom() {
    wx.navigateTo({ url: `/pages/custom/custom?play=${this.data.playType}` })
  },
  openTodayWords() {
    wx.navigateTo({ url: '/pages/vocabulary/vocabulary?view=today' })
  },
  openLearnedWords() {
    wx.navigateTo({ url: '/pages/vocabulary/vocabulary?view=learned' })
  },
  openVocabulary() {
    wx.navigateTo({ url: '/pages/vocabulary/vocabulary?view=wrong' })
  },
  openLearningStats() {
    wx.navigateTo({ url: '/pages/learning-stats/learning-stats' })
  },
  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },
  openDictionary() {
    openDictionaryOverlay(this)
  },
  onPullDownRefresh() {
    openDictionaryOverlay(this, true)
  },
})
