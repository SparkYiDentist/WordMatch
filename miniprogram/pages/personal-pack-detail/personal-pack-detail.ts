import {
  copyPersonalWordPack,
  deletePersonalWordPack,
  getPersonalPackAvailableWords,
  getPersonalWordPack,
  PersonalWordPackSummary,
  listPersonalWordPacks,
  renamePersonalWordPack,
} from '../../services/personal-word-pack'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

type Scope = 'all' | 'unlearned' | 'wrong'

interface DetailData {
  [key: string]: unknown
  playType: 'matching' | 'quiz'
  packId: string
  pack: PersonalWordPackSummary | null
  scope: Scope
  count: number
  useAll: boolean
  availableCount: number
  canStart: boolean
  progressPercent: number
  lastPracticeText: string
  dictionaryRefreshing: boolean
}

Page<DetailData, {
  refresh(): void
  selectScope(event: WechatMiniprogram.TouchEvent): void
  selectCount(event: WechatMiniprogram.TouchEvent): void
  editPack(): void
  renamePack(): void
  copyPack(): void
  deletePack(): void
  startTest(): void
  openDictionary(): void
  onPullDownRefresh(): void
}>({
  data: {
    packId: '', pack: null, scope: 'all', count: 20, useAll: false,
    playType: 'matching',
    availableCount: 0, canStart: false, progressPercent: 0, lastPracticeText: '尚未练习',
    dictionaryRefreshing: false,
  },
  onLoad(query) { this.setData({ packId: query.packId || '', playType: query.play === 'quiz' ? 'quiz' : 'matching' }) },
  onShareAppMessage() {
    return {
      title: 'Pan的英语｜单词配对闯关，边玩边背单词',
      path: '/pages/index/index',
    }
  },
  onShow() { this.refresh() },
  refresh() {
    const packDocument = getPersonalWordPack(this.data.packId)
    const pack = listPersonalWordPacks().find(item => item.id === this.data.packId) || null
    if (!packDocument || !pack) {
      wx.showToast({ title: '词包不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    const availableCount = getPersonalPackAvailableWords(pack.id, this.data.scope).length
    const date = pack.lastPracticedAt ? new Date(pack.lastPracticedAt) : null
    this.setData({
      pack,
      availableCount,
      canStart: availableCount >= (this.data.playType === 'quiz' ? 1 : 5),
      progressPercent: pack.wordCount ? Math.round((pack.practicedWordCount / pack.wordCount) * 100) : 0,
      lastPracticeText: date ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日` : '尚未练习',
    })
  },
  selectScope(event) {
    this.setData({ scope: String(event.currentTarget.dataset.value) as Scope }, () => this.refresh())
  },
  selectCount(event) {
    const value = String(event.currentTarget.dataset.value)
    this.setData({ count: value === 'all' ? 0 : Number(value), useAll: value === 'all' })
  },
  editPack() {
    wx.navigateTo({ url: `/pages/personal-pack-edit/personal-pack-edit?packId=${this.data.packId}` })
  },
  renamePack() {
    const pack = this.data.pack
    if (!pack) return
    wx.showModal({
      title: '重命名词包', editable: true, placeholderText: pack.name,
      success: result => {
        if (!result.confirm) return
        try {
          renamePersonalWordPack(pack.id, result.content || '')
          this.refresh()
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : '重命名失败', icon: 'none' })
        }
      },
    })
  },
  copyPack() {
    try {
      copyPersonalWordPack(this.data.packId)
      wx.showToast({ title: '已复制词包', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '复制失败', icon: 'none' })
    }
  },
  deletePack() {
    const pack = this.data.pack
    if (!pack) return
    wx.showModal({
      title: '删除词包？',
      content: `将删除“${pack.name}”。系统词库、其他词包和既有学习记录不会受影响。`,
      confirmText: '删除', confirmColor: '#b5524b',
      success: result => {
        if (!result.confirm) return
        try {
          deletePersonalWordPack(pack.id)
          wx.navigateBack()
        } catch (_error) {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        }
      },
    })
  },
  startTest() {
    const minimum = this.data.playType === 'quiz' ? 1 : 5
    if (this.data.availableCount < minimum) {
      wx.showModal({ title: '暂时不能开始', content: `当前范围少于 ${minimum} 个有效单词，请继续补充或更换学习范围。`, showCancel: false })
      return
    }
    const requested = this.data.useAll ? this.data.availableCount : this.data.count
    if (requested > this.data.availableCount) {
      wx.showModal({
        title: '请调整训练数量',
        content: `当前范围可用 ${this.data.availableCount} 词，少于所选的 ${requested} 词。`,
        showCancel: false,
      })
      return
    }
    const page = this.data.playType === 'quiz' ? 'word-quiz/word-quiz' : 'game/game'
    wx.navigateTo({ url: `/pages/${page}?mode=custom&source=personal_pack&packId=${this.data.packId}&scope=${this.data.scope}&count=${requested}` })
  },
  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() { openDictionaryOverlay(this, true) },
})
