import { SessionRecord } from '../../engine/types'
import { getLastResult } from '../../services/storage'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

Page({
  data: {
    result: null as SessionRecord | null,
    durationText: '0:00',
  },
  onLoad() {
    const result = getLastResult()
    const seconds = result ? result.durationSeconds : 0
    this.setData({
      result,
      durationText: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    })
  },
  onShareAppMessage() {
    return {
      title: 'Pan的英语｜单词配对闯关，边玩边背单词',
      path: '/pages/index/index',
    }
  },
  onPullDownRefresh() {
    openDictionaryOverlay(this, true)
  },
  replay() {
    const result = this.data.result
    if (!result) return
    if (result.playType === 'quiz') {
      if (result.mode === 'endless') {
        wx.redirectTo({ url: '/pages/word-quiz/word-quiz?mode=endless' })
        return
      }
      if (result.source === 'personal_pack' && result.packId) {
        wx.redirectTo({ url: `/pages/personal-pack-detail/personal-pack-detail?packId=${result.packId}&play=quiz` })
        return
      }
      wx.redirectTo({ url: '/pages/custom/custom?play=quiz' })
      return
    }
    if (result.mode === 'level' && result.level) {
      wx.redirectTo({ url: `/pages/game/game?mode=level&level=${result.level}` })
      return
    }
    if (result.mode === 'endless') {
      wx.redirectTo({ url: '/pages/game/game?mode=endless' })
      return
    }
    if (result.source === 'personal_pack' && result.packId) {
      wx.redirectTo({ url: `/pages/personal-pack-detail/personal-pack-detail?packId=${result.packId}` })
      return
    }
    wx.redirectTo({ url: '/pages/custom/custom' })
  },
  goHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  },
  openDictionary() { openDictionaryOverlay(this) },
})
