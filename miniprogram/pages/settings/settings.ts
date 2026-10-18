import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

Page({
  data: { dictionaryRefreshing: false },
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
  openStorageManager() {
    wx.navigateTo({ url: '/pages/storage-manager/storage-manager' })
  },
  openWrongManager() {
    wx.navigateTo({ url: '/pages/vocabulary/vocabulary?view=wrong&manage=1' })
  },
  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() { openDictionaryOverlay(this, true) },
})
