import { DictionaryEntry, DictionarySearchHit } from '../../services/dictionary-types'
import { getDictionaryEntry } from '../../services/dictionary-service'
import {
  addSystemWordToPersonalPack,
  createPersonalWordPackWithSystemWord,
  listPersonalWordPacks,
  PersonalWordPackSummary,
} from '../../services/personal-word-pack'
import {
  addSearchHistory,
  clearSearchHistory,
  getSearchHistory,
  removeSearchHistory,
} from '../../services/search-history-service'
import { releaseDictionaryIndex, searchDictionaryIndex } from '../../services/search-index-service'

const debounceTimers = new WeakMap<object, number>()

Component({
  properties: {
    avoidCapsule: { type: Boolean, value: false },
    // 默认只保留下拉进入搜索，不显示悬浮按钮；需要常驻入口的页面再显式开 true。
    showEntry: { type: Boolean, value: false },
  },
  data: {
    topInset: 30,
    visible: false,
    focusInput: false,
    query: '',
    results: [] as DictionarySearchHit[],
    history: [] as string[],
    selectedEntry: null as DictionaryEntry | null,
    searching: false,
    packSheetVisible: false,
    packs: [] as PersonalWordPackSummary[],
  },
  lifetimes: {
    attached() {
      try {
        const systemInfo = wx.getSystemInfoSync()
        this.setData({ topInset: (systemInfo.statusBarHeight || 20) + 10 })
      } catch (_error) {
        // 模拟器缺少系统信息时使用默认安全距离。
      }
    },
    detached() {
      const timer = debounceTimers.get(this)
      if (timer !== undefined) clearTimeout(timer)
      debounceTimers.delete(this)
    },
  },
  methods: {
    openFromEntry() {
      // 页面可能需要在打开前暂停计时或锁交互，先给它机会处理，组件再照常打开。
      this.triggerEvent('entryopen')
      this.open()
    },
    open() {
      this.setData({
        visible: true,
        focusInput: true,
        history: getSearchHistory(),
      })
    },
    openEntry(wordId: string) {
      const entry = getDictionaryEntry(wordId)
      if (!entry) {
        wx.showToast({ title: '词条暂时无法读取', icon: 'none' })
        return
      }
      this.open()
      this.setData({ selectedEntry: entry, query: entry.headword, focusInput: false })
    },
    goBack() {
      if (this.data.packSheetVisible) {
        this.setData({ packSheetVisible: false })
        return
      }
      if (this.data.selectedEntry) {
        this.setData({ selectedEntry: null, focusInput: true })
        return
      }
      this.setData({ visible: false, focusInput: false, query: '', results: [] })
      releaseDictionaryIndex()
      this.triggerEvent('close')
    },
    onContainerLeave() {
      // page-container 会优先承接系统返回和 iOS 侧滑返回。
      // 点击组件内返回键时 visible 已经是 false，这里不重复通知页面。
      if (!this.data.visible) return
      this.setData({
        visible: false,
        focusInput: false,
        query: '',
        results: [],
        selectedEntry: null,
        packSheetVisible: false,
      })
      releaseDictionaryIndex()
      this.triggerEvent('close')
    },
    close() {
      this.goBack()
    },
    stopEvent() {
      // Prevent taps inside the sheet from reaching the backdrop.
    },
    handleInput(event: WechatMiniprogram.Input) {
      const query = event.detail.value
      this.setData({ query, selectedEntry: null, searching: Boolean(query.trim()) })
      const currentTimer = debounceTimers.get(this)
      if (currentTimer !== undefined) {
        clearTimeout(currentTimer)
        debounceTimers.delete(this)
      }
      if (!query.trim()) {
        this.setData({ results: [], searching: false })
        return
      }
      const timer = setTimeout(() => {
        debounceTimers.delete(this)
        this.runSearch(query)
      }, 120)
      debounceTimers.set(this, timer)
    },
    submitSearch(event: WechatMiniprogram.Input) {
      const query = event.detail.value
      const currentTimer = debounceTimers.get(this)
      if (currentTimer !== undefined) {
        clearTimeout(currentTimer)
        debounceTimers.delete(this)
      }
      this.setData({ query, selectedEntry: null, searching: Boolean(query.trim()) }, () => {
        this.runSearch(query)
      })
      wx.hideKeyboard()
    },
    runSearch(query: string) {
      const normalizedQuery = query.trim()
      if (!normalizedQuery) {
        this.setData({ results: [], searching: false })
        return
      }
      if (query !== this.data.query) return
      try {
        this.setData({ results: searchDictionaryIndex(normalizedQuery), searching: false })
      } catch (_error) {
        this.setData({ results: [], searching: false })
        wx.showToast({ title: '本地词典加载失败，请重试', icon: 'none' })
      }
    },
    clearQuery() {
      const currentTimer = debounceTimers.get(this)
      if (currentTimer !== undefined) clearTimeout(currentTimer)
      this.setData({ query: '', results: [], selectedEntry: null, searching: false, focusInput: true })
    },
    onInputBlur() {
      this.setData({ focusInput: false })
    },
    useHistory(event: WechatMiniprogram.TouchEvent) {
      const query = String(event.currentTarget.dataset.query || '')
      if (!query) return
      this.setData({ query, results: searchDictionaryIndex(query), selectedEntry: null, focusInput: true })
    },
    removeHistory(event: WechatMiniprogram.TouchEvent) {
      const query = String(event.currentTarget.dataset.query || '')
      this.setData({ history: removeSearchHistory(query) })
    },
    clearHistory() {
      this.setData({ history: clearSearchHistory() })
    },
    selectResult(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      const entry = getDictionaryEntry(id)
      if (!entry) {
        wx.showToast({ title: '词条暂时无法读取', icon: 'none' })
        return
      }
      this.setData({
        selectedEntry: entry,
        focusInput: false,
        history: addSearchHistory(this.data.query || entry.headword),
      })
    },
    showPackSheet() {
      if (!this.data.selectedEntry) return
      const packs = listPersonalWordPacks()
      if (!packs.length) {
        this.createPack()
        return
      }
      this.setData({ packs, packSheetVisible: true })
    },
    hidePackSheet() {
      this.setData({ packSheetVisible: false })
    },
    addToPack(event: WechatMiniprogram.TouchEvent) {
      const entry = this.data.selectedEntry
      if (!entry) return
      try {
        const result = addSystemWordToPersonalPack(String(event.currentTarget.dataset.id || ''), entry.id)
        this.setData({ packSheetVisible: false })
        wx.showToast({ title: result === 'added' ? '已加入词包' : '词包中已有该词', icon: 'none' })
      } catch (error) {
        wx.showToast({ title: error instanceof Error ? error.message : '添加失败', icon: 'none' })
      }
    },
    createPack() {
      const entry = this.data.selectedEntry
      if (!entry) return
      wx.showModal({
        title: '新建个人词包',
        content: `新词包将包含 ${entry.headword}`,
        editable: true,
        placeholderText: '例如：本周生词',
        confirmText: '创建并加入',
        success: result => {
          if (!result.confirm) return
          try {
            createPersonalWordPackWithSystemWord(result.content || '', entry.id)
            this.setData({ packSheetVisible: false, packs: listPersonalWordPacks() })
            wx.showToast({ title: '已创建并加入', icon: 'success' })
          } catch (error) {
            wx.showToast({ title: error instanceof Error ? error.message : '创建失败', icon: 'none' })
          }
        },
      })
    },
  },
})
