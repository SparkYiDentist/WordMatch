import { GameMode } from '../../engine/types'
import {
  DailyLearningStats,
  ensureLegacyDailyStatsMigrated,
  getDailyLearningStat,
  getDailyStatsRange,
  getLearningStreak,
  localDateKey,
} from '../../services/daily-learning'
import { loadProfile } from '../../services/storage'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'

interface CalendarCell {
  key: string
  day: string
  date: string
  count: number
  colorClass: string
  blank: boolean
  future: boolean
  selected: boolean
}

interface TrendPoint {
  date: string
  shortDate: string
  value: number
  heightPercent: number
  showLabel: boolean
  selected: boolean
}

type TrendSeries = 'total' | 'new' | 'review'

const pad = (value: number): string => String(value).padStart(2, '0')
const monthId = (year: number, month: number): string => `${year}-${pad(month)}`
const monthParts = (month: string): { year: number; month: number } => {
  const [year, value] = month.split('-').map(Number)
  return { year, month: value }
}
const formatMonthTitle = (month: string): string => {
  const parts = monthParts(month)
  return `${parts.year}年${parts.month}月`
}
const dateLabel = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number)
  return `${year}年${month}月${day}日`
}
const shortDate = (date: string): string => {
  const values = date.split('-')
  return `${Number(values[1])}/${Number(values[2])}`
}
const heatClass = (count: number): string => {
  if (count >= 100) return 'calendar-day--level-4'
  if (count >= 50) return 'calendar-day--level-3'
  if (count >= 20) return 'calendar-day--level-2'
  if (count >= 1) return 'calendar-day--level-1'
  return 'calendar-day--level-0'
}
const valueForSeries = (item: DailyLearningStats, series: TrendSeries): number => {
  if (series === 'new') return item.newWordIds.length
  if (series === 'review') return item.reviewedWordIds.length
  return item.learnedWordIds.length
}
const accuracyText = (stat: DailyLearningStats): string => (
  stat.firstAttempts ? `${Math.round(stat.correctFirstAttempts / stat.firstAttempts * 100)}%` : '0%'
)
const durationText = (seconds: number): string => {
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining ? `${minutes}分${remaining}秒` : `${minutes}分钟`
}

const modeLabel: Record<GameMode, string> = {
  endless: '无尽模式',
  level: '闯关模式',
  custom: '自选模式',
}

Page({
  data: {
    todayCount: 0,
    learnedCount: 0,
    streak: 0,
    currentMonth: '',
    monthTitle: '',
    canNextMonth: false,
    calendarCells: [] as CalendarCell[],
    selectedDate: '',
    selectedDateText: '',
    selectedStat: getDailyLearningStat(localDateKey()),
    selectedAccuracy: '0%',
    selectedDuration: '0秒',
    trendDays: 7,
    trendSeries: 'total' as TrendSeries,
    trendPoints: [] as TrendPoint[],
    trendMax: 1,
    selectedTrendDate: '',
    selectedTrendValue: 0,
    rangeNewCount: 0,
    rangeReviewCount: 0,
    newRatio: 0,
    reviewRatio: 0,
    modeItems: [] as Array<{ mode: GameMode; label: string; count: number; percent: number }>,
    migrationNote: '',
  },

  onLoad() {
    const today = localDateKey()
    this.setData({ currentMonth: today.slice(0, 7), selectedDate: today })
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
    this.refreshPage()
  },

  refreshPage() {
    const profile = loadProfile()
    try {
      ensureLegacyDailyStatsMigrated(profile)
    } catch (_error) {
      wx.showToast({ title: '历史统计迁移失败', icon: 'none' })
    }
    const today = localDateKey()
    const todayStat = getDailyLearningStat(today)
    this.setData({
      todayCount: todayStat.learnedWordIds.length,
      learnedCount: profile.learnedWordIds.length,
      streak: getLearningStreak(),
      migrationNote: Object.keys(profile.dailyStats).length
        ? '旧版记录仅迁移有可靠日期的每日去重词数；历史新词、复习、模式和时长不做推测。'
        : '',
    })
    this.buildCalendar()
    this.buildTrend()
  },

  buildCalendar() {
    const { year, month } = monthParts(this.data.currentMonth)
    const today = localDateKey()
    const firstWeekday = new Date(year, month - 1, 1, 12).getDay()
    const leading = (firstWeekday + 6) % 7
    const daysInMonth = new Date(year, month, 0, 12).getDate()
    const cells: CalendarCell[] = []
    for (let index = 0; index < leading; index += 1) {
      cells.push({ key: `blank-${index}`, day: '', date: '', count: 0, colorClass: '', blank: true, future: false, selected: false })
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${pad(month)}-${pad(day)}`
      const count = getDailyLearningStat(date).learnedWordIds.length
      const future = date > today
      cells.push({
        key: date,
        day: String(day),
        date,
        count,
        colorClass: future ? 'calendar-day--future' : heatClass(count),
        blank: false,
        future,
        selected: date === this.data.selectedDate,
      })
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `tail-${cells.length}`, day: '', date: '', count: 0, colorClass: '', blank: true, future: false, selected: false })
    }
    const current = monthParts(today.slice(0, 7))
    const canNextMonth = year < current.year || (year === current.year && month < current.month)
    this.setData({ calendarCells: cells, monthTitle: formatMonthTitle(this.data.currentMonth), canNextMonth })
    this.applySelectedDate(this.data.selectedDate.slice(0, 7) === this.data.currentMonth
      ? this.data.selectedDate
      : `${year}-${pad(month)}-01`)
  },

  applySelectedDate(date: string) {
    const stat = getDailyLearningStat(date)
    this.setData({
      selectedDate: date,
      selectedDateText: dateLabel(date),
      selectedStat: stat,
      selectedAccuracy: accuracyText(stat),
      selectedDuration: durationText(stat.studySeconds),
      calendarCells: this.data.calendarCells.map(cell => ({ ...cell, selected: cell.date === date })),
    })
  },

  selectDate(event: WechatMiniprogram.TouchEvent) {
    const date = String(event.currentTarget.dataset.date || '')
    if (!date || date > localDateKey()) return
    this.applySelectedDate(date)
  },

  previousMonth() {
    const { year, month } = monthParts(this.data.currentMonth)
    const date = new Date(year, month - 2, 1, 12)
    this.setData({ currentMonth: monthId(date.getFullYear(), date.getMonth() + 1) }, () => this.buildCalendar())
  },

  nextMonth() {
    if (!this.data.canNextMonth) return
    const { year, month } = monthParts(this.data.currentMonth)
    const date = new Date(year, month, 1, 12)
    this.setData({ currentMonth: monthId(date.getFullYear(), date.getMonth() + 1) }, () => this.buildCalendar())
  },

  changeTrendDays(event: WechatMiniprogram.TouchEvent) {
    const days = Number(event.currentTarget.dataset.days)
    if (days !== 7 && days !== 30 && days !== 90) return
    this.setData({ trendDays: days }, () => this.buildTrend())
  },

  changeTrendSeries(event: WechatMiniprogram.TouchEvent) {
    const series = String(event.currentTarget.dataset.series) as TrendSeries
    if (series !== 'total' && series !== 'new' && series !== 'review') return
    this.setData({ trendSeries: series }, () => this.buildTrend())
  },

  buildTrend() {
    const range = getDailyStatsRange(localDateKey(), this.data.trendDays)
    const values = range.map(item => valueForSeries(item, this.data.trendSeries))
    const maxValue = Math.max(1, ...values)
    const labelStep = this.data.trendDays === 7 ? 1 : this.data.trendDays === 30 ? 5 : 15
    const lastSelected = this.data.selectedTrendDate && range.some(item => item.date === this.data.selectedTrendDate)
      ? this.data.selectedTrendDate
      : range[range.length - 1].date
    const points = range.map((item, index): TrendPoint => ({
      date: item.date,
      shortDate: shortDate(item.date),
      value: values[index],
      heightPercent: values[index] ? Math.max(5, Math.round(values[index] / maxValue * 100)) : 0,
      showLabel: index === 0 || index === range.length - 1 || index % labelStep === 0,
      selected: item.date === lastSelected,
    }))
    const newCount = range.reduce((sum, item) => sum + item.newWordIds.length, 0)
    const reviewCount = range.reduce((sum, item) => sum + item.reviewedWordIds.length, 0)
    const classified = newCount + reviewCount
    const modes: Record<GameMode, number> = { endless: 0, level: 0, custom: 0 }
    range.forEach(item => {
      modes.endless += item.modeCounts.endless
      modes.level += item.modeCounts.level
      modes.custom += item.modeCounts.custom
    })
    const modeTotal = modes.endless + modes.level + modes.custom
    const selectedTrend = points.find(point => point.selected)
    this.setData({
      trendPoints: points,
      trendMax: maxValue,
      selectedTrendDate: lastSelected,
      selectedTrendValue: selectedTrend ? selectedTrend.value : 0,
      rangeNewCount: newCount,
      rangeReviewCount: reviewCount,
      newRatio: classified ? Math.round(newCount / classified * 100) : 0,
      reviewRatio: classified ? Math.round(reviewCount / classified * 100) : 0,
      modeItems: (Object.keys(modes) as GameMode[]).map(mode => ({
        mode,
        label: modeLabel[mode],
        count: modes[mode],
        percent: modeTotal ? Math.round(modes[mode] / modeTotal * 100) : 0,
      })),
    })
  },

  selectTrendPoint(event: WechatMiniprogram.TouchEvent) {
    const date = String(event.currentTarget.dataset.date || '')
    const point = this.data.trendPoints.find(item => item.date === date)
    if (!point) return
    this.setData({
      selectedTrendDate: date,
      selectedTrendValue: point.value,
      trendPoints: this.data.trendPoints.map(item => ({ ...item, selected: item.date === date })),
    })
  },

  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() { openDictionaryOverlay(this, true) },
})
