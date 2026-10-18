interface DailyQuote {
  english: string
  chinese: string
}

const QUOTES: DailyQuote[] = [
  { english: 'Small steps, every day.', chinese: '每天向前一点，终会抵达想去的地方。' },
  { english: 'Learn a word. Open a world.', chinese: '记住一个词，也是在打开一个新世界。' },
  { english: 'Stay curious. Keep growing.', chinese: '保持好奇，也保持成长。' },
  { english: 'Progress begins with practice.', chinese: '每一次练习，都算数。' },
  { english: 'Today is a fresh page.', chinese: '今天，又是积累新知的一页。' },
  { english: 'Believe, begin, become.', chinese: '相信自己，然后勇敢开始。' },
  { english: 'Consistency creates confidence.', chinese: '持续学习，让自信自然发生。' },
]

let fadeTimer: number | null = null
let enterTimer: number | null = null

const formatDate = (date: Date): { dateText: string; weekdayText: string } => {
  const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
  return {
    dateText: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
    weekdayText: weekdays[date.getDay()],
  }
}

Page({
  data: {
    dateText: '',
    weekdayText: '',
    englishQuote: '',
    chineseQuote: '',
    leaving: false,
  },
  onLoad() {
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const quote = QUOTES[Math.floor(startOfToday / 86400000) % QUOTES.length]
    this.setData({
      ...formatDate(today),
      englishQuote: quote.english,
      chineseQuote: quote.chinese,
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
    if (fadeTimer !== null) clearTimeout(fadeTimer)
    if (enterTimer !== null) clearTimeout(enterTimer)
    fadeTimer = null
    enterTimer = null
  },
})
