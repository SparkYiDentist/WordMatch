import { Word } from '../../engine/types'

const lengthClass = (baseClass: string, text: string, longAt: number, extraLongAt: number): string => {
  if (text.length >= extraLongAt) return `${baseClass} ${baseClass}--xlong`
  if (text.length >= longAt) return `${baseClass} ${baseClass}--long`
  return baseClass
}

Component({
  data: {
    displayText: '',
    englishClass: 'card__english',
    chineseClass: 'card__chinese',
    accessibilityLabel: '空位',
  },
  properties: {
    word: {
      type: Object,
      value: {},
    },
    empty: {
      type: Boolean,
      value: true,
    },
    side: {
      type: String,
      value: 'english',
    },
    state: {
      type: String,
      value: 'idle',
    },
    index: {
      type: Number,
      value: 0,
    },
    disabled: {
      type: Boolean,
      value: false,
    },
  },
  observers: {
    'word, side, empty'(word: Word | undefined, side: string, empty: boolean) {
      const english = word?.english || ''
      const displayText = word?.displayMeaning || word?.matchMeaning || ''
      this.setData({
        displayText,
        englishClass: lengthClass('card__english', english, 11, 13),
        chineseClass: lengthClass('card__chinese', displayText, 9, 13),
        accessibilityLabel: empty ? '空位' : (side === 'english' ? english : displayText),
      })
    },
  },
  methods: {
    handleTap() {
      if (this.data.empty || this.data.disabled || this.data.state === 'waiting') return
      this.triggerEvent('cardtap', {
        side: this.data.side,
        index: this.data.index,
      })
    },
  },
})
