import { CardSide, CardSlot, Selection } from './types'

export interface SelectionResult {
  selection: Selection
  readyToJudge: boolean
  ignored: boolean
}

export const emptySelection = (): Selection => ({
  englishIndex: null,
  chineseIndex: null,
})

export const selectCard = (
  selection: Selection,
  side: CardSide,
  index: number,
  slots: CardSlot[],
  locked: boolean,
): SelectionResult => {
  if (locked || !slots[index] || !slots[index].word || slots[index].state === 'waiting') {
    return { selection, readyToJudge: false, ignored: true }
  }

  const key = side === 'english' ? 'englishIndex' : 'chineseIndex'
  const next: Selection = { ...selection }
  next[key] = selection[key] === index ? null : index

  return {
    selection: next,
    readyToJudge: next.englishIndex !== null && next.chineseIndex !== null,
    ignored: false,
  }
}

export const isMatchingPair = (
  left: CardSlot,
  right: CardSlot,
): boolean => Boolean(left.word && right.word && left.word.id === right.word.id)

export const withSelectedStates = (
  slots: CardSlot[],
  selectedIndex: number | null,
): CardSlot[] => slots.map((slot, index) => ({
  ...slot,
  state: slot.state === 'waiting'
    ? 'waiting'
    : slot.word && index === selectedIndex ? 'selected' : 'idle',
}))
