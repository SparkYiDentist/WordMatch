interface DailyCover {
  fileName: string
  english: string
  chinese: string
}

interface DailyCoverCache {
  dateKey: string
  remoteUrl: string
}

const COVER_ASSET_BASE_URL = 'https://raw.githubusercontent.com/SparkYiDentist/WordMatch/main/remote-assets/splash'
const COVER_CACHE_KEY = 'cache:image:daily-cover'
const COVER_CACHE_VERSION = 'v1'
const FALLBACK_COVER = '/assets/splash-morning-compact.jpg'

const DAILY_COVERS: readonly DailyCover[] = [
  { fileName: 'daily-cover-01-forest.jpg', english: 'Small steps, every day.', chinese: '每天向前一点，终会抵达想去的地方。' },
  { fileName: 'daily-cover-02-study.jpg', english: 'Today is a fresh page.', chinese: '今天，又是积累新知的一页。' },
  { fileName: 'daily-cover-03-coast.jpg', english: 'Learn a word. Open a world.', chinese: '记住一个词，也是在打开一个新世界。' },
  { fileName: 'daily-cover-04-tea.jpg', english: 'Consistency creates confidence.', chinese: '持续学习，让自信自然发生。' },
  { fileName: 'daily-cover-05-campus.jpg', english: 'Stay curious. Keep growing.', chinese: '保持好奇，也保持成长。' },
]

let fadeTimer: number | null = null
let enterTimer: number | null = null
let coverRequestId = 0

const coverCacheDirectory = (): string => `${wx.env.USER_DATA_PATH}/wordmatch-cache/image/daily-cover-${COVER_CACHE_VERSION}`
const coverCachePath = (): string => `${coverCacheDirectory()}/cover.jpg`

const fileExists = (filePath: string): boolean => {
  try {
    wx.getFileSystemManager().accessSync(filePath)
    return true
  } catch (_error) {
    return false
  }
}

const removeCachedCover = (): void => {
  try {
    wx.getFileSystemManager().unlinkSync(coverCachePath())
  } catch (_error) {
    // The previous cover is already absent; continue with today's download.
  }
  try {
    wx.removeStorageSync(COVER_CACHE_KEY)
  } catch (_error) {
    // Cache metadata is optional and can be recreated after a successful download.
  }
}

const readCachedCover = (): DailyCoverCache | null => {
  try {
    const value = wx.getStorageSync<DailyCoverCache | null>(COVER_CACHE_KEY)
    if (!value || typeof value.dateKey !== 'string' || typeof value.remoteUrl !== 'string') return null
    return value
  } catch (_error) {
    return null
  }
}

const resolveDailyCover = (dateKey: string, cover: DailyCover): Promise<string> => {
  const remoteUrl = `${COVER_ASSET_BASE_URL}/${cover.fileName}`
  const cached = readCachedCover()
  const destination = coverCachePath()
  if (cached && cached.dateKey === dateKey && cached.remoteUrl === remoteUrl && fileExists(destination)) {
    return Promise.resolve(destination)
  }

  removeCachedCover()
  return new Promise((resolve, reject) => {
    try {
      wx.getFileSystemManager().mkdirSync(coverCacheDirectory(), true)
      wx.downloadFile({
        url: remoteUrl,
        filePath: destination,
        timeout: 20000,
        success: result => {
          if (result.statusCode < 200 || result.statusCode >= 300) {
            removeCachedCover()
            reject(new Error(`封面下载失败：HTTP ${result.statusCode}`))
            return
          }
          try {
            wx.setStorageSync(COVER_CACHE_KEY, { dateKey, remoteUrl } as DailyCoverCache)
          } catch (_error) {
            // The downloaded file remains usable even if metadata cannot be persisted.
          }
          resolve(destination)
        },
        fail: error => {
          removeCachedCover()
          reject(new Error(error.errMsg || '封面下载失败'))
        },
      })
    } catch (error) {
      removeCachedCover()
      reject(error)
    }
  })
}

const formatDate = (date: Date): { dateText: string; weekdayText: string } => {
  const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
  return {
    dateText: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
    weekdayText: weekdays[date.getDay()],
  }
}

const formatDateKey = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

Page({
  data: {
    coverSrc: FALLBACK_COVER,
    dateText: '',
    weekdayText: '',
    englishQuote: '',
    chineseQuote: '',
    leaving: false,
  },
  onLoad() {
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const cover = DAILY_COVERS[Math.floor(startOfToday / 86400000) % DAILY_COVERS.length]
    const requestId = ++coverRequestId
    this.setData({
      ...formatDate(today),
      coverSrc: FALLBACK_COVER,
      englishQuote: cover.english,
      chineseQuote: cover.chinese,
    })

    void resolveDailyCover(formatDateKey(today), cover)
      .then(coverSrc => {
        if (requestId === coverRequestId) this.setData({ coverSrc })
      })
      .catch(() => {
        // Keep the bundled fallback cover when GitHub is unavailable.
      })

    fadeTimer = setTimeout(() => this.setData({ leaving: true }), 1760)
    enterTimer = setTimeout(() => {
      wx.reLaunch({ url: '/pages/index/index' })
    }, 2000)
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
  onUnload() {
    coverRequestId += 1
    if (fadeTimer !== null) clearTimeout(fadeTimer)
    if (enterTimer !== null) clearTimeout(enterTimer)
    fadeTimer = null
    enterTimer = null
  },
})
