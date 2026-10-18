interface DictionaryComponent {
  open(): void
  goBack(): void
  data: { visible: boolean }
}

interface DictionaryPageHost {
  setData(data: Record<string, unknown>, callback?: () => void): void
  selectComponent(selector: string): unknown
}

const isDictionaryComponent = (value: unknown): value is DictionaryComponent => Boolean(
  value && typeof (value as { open?: unknown }).open === 'function',
)

// 下拉结束的瞬间页面还在回弹，此时 show page-container 有两个后果：容器被回弹动画盖掉，
// 或者刚弹出就捕捉到手势的余势被 close-on-slide-down 立刻关掉。等回弹跑完再打开。
const PULL_SETTLE_DELAY = 420

export const openDictionaryOverlay = (host: DictionaryPageHost, fromPull: boolean = false): void => {
  const open = (): void => {
    const component = host.selectComponent('#globalDictionary')
    if (isDictionaryComponent(component)) {
      component.open()
      return
    }
    console.warn('[dictionary] #globalDictionary not found')
    wx.showToast({ title: '查词入口未就绪', icon: 'none' })
  }
  if (fromPull) {
    host.setData({ dictionaryRefreshing: false })
    try {
      wx.stopPullDownRefresh()
    } catch (_error) {
      // scroll-view refreshers are stopped by their controlled triggered state.
    }
    setTimeout(open, PULL_SETTLE_DELAY)
    return
  }
  open()
}
