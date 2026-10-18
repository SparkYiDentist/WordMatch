import {
  CacheType,
  clearCache,
  formatBytes,
  getStorageOverview,
  StorageOverview,
} from '../../services/storage-manager'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const emptyOverview = (): StorageOverview => ({
  storageCurrentBytes: 0,
  storageLimitBytes: 0,
  storagePercent: 0,
  localFileBytes: 0,
  clearableBytes: 0,
  importantBytes: 0,
  categories: [],
  cacheItems: [],
  calculatedAt: 0,
  errors: [],
})

Page({
  data: {
    loading: true,
    cleaning: false,
    errorText: '',
    overview: emptyOverview(),
    storageCurrentText: '—',
    storageLimitText: '—',
    localFileText: '—',
    clearableText: '—',
    importantText: '—',
    calculatedAtText: '—',
    categories: [] as Array<{ id: string; label: string; sizeText: string; note: string; kind: string }>,
    cacheItems: [] as Array<{ id: string; label: string; description: string; sizeText: string; disabled: boolean }>,
    dictionaryRefreshing: false,
  },
  active: true,
  onLoad() {
    this.active = true
    this.refreshStorage()
  },
  onShareAppMessage() {
    return {
      title: 'Pan的英语｜单词配对闯关，边玩边背单词',
      path: '/pages/index/index',
    }
  },
  onUnload() {
    this.active = false
  },
  async refreshStorage() {
    if (this.data.cleaning) return
    this.setData({ loading: true, errorText: '' })
    try {
      const overview = await getStorageOverview()
      if (!this.active) return
      this.applyOverview(overview)
    } catch (_error) {
      if (!this.active) return
      this.setData({ loading: false, errorText: '统计失败，请稍后重试' })
    }
  },
  applyOverview(overview: StorageOverview) {
    this.setData({
      loading: false,
      overview,
      storageCurrentText: formatBytes(overview.storageCurrentBytes),
      storageLimitText: formatBytes(overview.storageLimitBytes),
      localFileText: formatBytes(overview.localFileBytes),
      clearableText: formatBytes(overview.clearableBytes),
      importantText: formatBytes(overview.importantBytes),
      calculatedAtText: formatTime(overview.calculatedAt),
      errorText: overview.errors.length ? `部分文件无法统计（${overview.errors.length} 项）` : '',
      categories: overview.categories.map(item => ({ ...item, sizeText: formatBytes(item.sizeBytes) })),
      cacheItems: overview.cacheItems.map(item => ({ ...item, sizeText: formatBytes(item.sizeBytes), disabled: item.itemCount === 0 })),
    })
  },
  requestClear(event: WechatMiniprogram.TouchEvent) {
    if (this.data.cleaning) return
    const type = event.currentTarget.dataset.type as CacheType
    const item = this.data.cacheItems.find(cache => cache.id === type)
    if (!item || item.disabled) return
    wx.showModal({
      title: item.label,
      content: `${item.description}。学习记录、错词本、关卡进度和个人词包不会受到影响。`,
      confirmText: '确认清理',
      confirmColor: '#176b57',
      success: result => { if (result.confirm) this.runCleanup(type) },
    })
  },
  clearAll() {
    if (this.data.cleaning || this.data.overview.clearableBytes === 0) return
    wx.showModal({
      title: '清理可删除缓存',
      content: '即将清理搜索历史、临时文件及可重新生成的缓存。学习记录、错词本、关卡进度和个人词包不会受到影响。',
      confirmText: '确认清理',
      confirmColor: '#176b57',
      success: result => { if (result.confirm) this.runCleanup('all') },
    })
  },
  async runCleanup(type: CacheType) {
    if (this.data.cleaning) return
    this.setData({ cleaning: true, errorText: '' })
    wx.showLoading({ title: '正在清理', mask: true })
    try {
      const result = await clearCache(type)
      if (!this.active) return
      this.applyOverview(result.overview)
      if (result.success) {
        wx.showToast({ title: `已释放 ${formatBytes(result.releasedBytes)}`, icon: 'none' })
      } else {
        wx.showModal({
          title: '部分清理失败',
          content: `已释放 ${formatBytes(result.releasedBytes)}。${result.failures.slice(0, 2).join('；')}`,
          showCancel: false,
        })
      }
    } catch (_error) {
      if (this.active) wx.showToast({ title: '清理失败，请稍后重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      if (this.active) this.setData({ cleaning: false })
    }
  },
  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() {
    if (this.data.cleaning) {
      this.setData({ dictionaryRefreshing: false })
      return
    }
    openDictionaryOverlay(this, true)
  },
})
