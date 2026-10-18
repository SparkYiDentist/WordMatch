import { listPersonalWordPacks, PersonalWordPackSummary } from '../../services/personal-word-pack'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

interface PackCard extends PersonalWordPackSummary {
  progressPercent: number
  recentText: string
}

const recentText = (timestamp: number): string => {
  if (!timestamp) return '尚未练习'
  const date = new Date(timestamp)
  return `最近 ${date.getMonth() + 1}月${date.getDate()}日`
}

Page({
  data: { packs: [] as PackCard[], dictionaryRefreshing: false, playType: 'matching' as 'matching' | 'quiz' },
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
    const packs = listPersonalWordPacks().map(pack => ({
      ...pack,
      progressPercent: pack.wordCount ? Math.round((pack.practicedWordCount / pack.wordCount) * 100) : 0,
      recentText: recentText(pack.lastPracticedAt),
    }))
    this.setData({ packs })
  },
  createPack() {
    wx.navigateTo({ url: '/pages/personal-pack-edit/personal-pack-edit' })
  },
  openPack(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/personal-pack-detail/personal-pack-detail?packId=${event.currentTarget.dataset.id}&play=${this.data.playType}` })
  },
  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() { openDictionaryOverlay(this, true) },
})
