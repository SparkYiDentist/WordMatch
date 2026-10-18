import { openDictionaryOverlay } from './dictionary-overlay'

/**
 * Pull-to-search gesture shared by every page.
 *
 * scroll-view 的 refresher 只有在内容超出容器高度时才会响应，内容不满屏的页面
 * 下拉完全没反馈。这里改用页面级触摸手势：只要容器处于顶部（scrollTop 为 0），
 * 向下拖动到阈值就直接打开全局查词。
 */

const PULL_THRESHOLD = 88
const ARM_DISTANCE = 12

interface PullGestureState {
  tracking: boolean
  startY: number
  scrollTop: number
  opened: boolean
  hintVisible: boolean
  hintReady: boolean
  open: (() => void) | null
}

type PullHost = {
  setData(data: Record<string, unknown>, callback?: () => void): void
  selectComponent(selector: string): unknown
}

const states = new WeakMap<PullHost, PullGestureState>()

const stateOf = (host: PullHost): PullGestureState => {
  const existing = states.get(host)
  if (existing) return existing
  const created: PullGestureState = {
    tracking: false,
    startY: 0,
    scrollTop: 0,
    opened: false,
    hintVisible: false,
    hintReady: false,
    open: null,
  }
  states.set(host, created)
  return created
}

const clearHint = (host: PullHost, state: PullGestureState): void => {
  if (!state.hintVisible && !state.hintReady) return
  state.hintVisible = false
  state.hintReady = false
  host.setData({ pullHintVisible: false, pullHintReady: false })
}

/** 页面可以在打开查词前插入自己的副作用，例如游戏页需要先暂停计时器并锁交互。 */
export const configurePullGesture = (host: PullHost, open: () => void): void => {
  stateOf(host).open = open
}

/** 绑定在 scroll-view 的 bindscroll 上，用于判断容器是否已经离开顶部。 */
export const trackPullScrollTop = (
  host: PullHost,
  event: WechatMiniprogram.CustomEvent<{ scrollTop?: number }>,
): void => {
  const scrollTop = event.detail ? event.detail.scrollTop : undefined
  stateOf(host).scrollTop = typeof scrollTop === 'number' ? scrollTop : 0
}

export const startPullGesture = (
  host: PullHost,
  event: WechatMiniprogram.TouchEvent,
  blocked: boolean = false,
): void => {
  const state = stateOf(host)
  state.opened = false
  if (blocked) {
    state.tracking = false
    return
  }
  const touch = event.touches[0]
  state.tracking = Boolean(touch)
  state.startY = touch ? touch.clientY : 0
}

export const movePullGesture = (host: PullHost, event: WechatMiniprogram.TouchEvent): void => {
  const state = stateOf(host)
  if (!state.tracking || state.opened) return
  // 容器已经滚离顶部时，向下拖动是普通滚动，不能抢。
  if (state.scrollTop > 0) {
    state.tracking = false
    clearHint(host, state)
    return
  }
  const touch = event.touches[0]
  if (!touch) return
  const distance = touch.clientY - state.startY
  if (distance < ARM_DISTANCE) return
  const ready = distance >= PULL_THRESHOLD * 0.7
  if (!state.hintVisible || state.hintReady !== ready) {
    state.hintVisible = true
    state.hintReady = ready
    host.setData({ pullHintVisible: true, pullHintReady: ready })
  }
  if (distance >= PULL_THRESHOLD) {
    state.opened = true
    state.tracking = false
    clearHint(host, state)
    if (state.open) state.open()
    else openDictionaryOverlay(host)
  }
}

export const endPullGesture = (host: PullHost): void => {
  const state = stateOf(host)
  state.tracking = false
  clearHint(host, state)
}
