import { BookId } from '../engine/types'

export interface DictionaryExample {
  english: string
  chinese?: string
}

export interface DictionarySense {
  partOfSpeech?: string
  matchMeaning: string
  fullMeaning?: string
  englishDefinition?: string
  examples?: DictionaryExample[]
}

export interface DictionaryWordForms {
  lemma?: string
  plural?: string
  past?: string
  pastParticiple?: string
  presentParticiple?: string
  thirdPerson?: string
  comparative?: string
  superlative?: string
}

export interface DictionaryEntry {
  id: string
  headword: string
  phonetic?: string
  phoneticUK?: string
  phoneticUS?: string
  audioUK?: string
  audioUS?: string
  senses: DictionarySense[]
  matchMeaning: string
  fullMeaning?: string
  englishDefinition?: string
  examples?: DictionaryExample[]
  collocations?: string[]
  synonyms?: string[]
  antonyms?: string[]
  wordForms?: DictionaryWordForms
  morphology?: string
  etymology?: string
  frequency?: number
  difficulty?: string
  bookIds: BookId[]
  source: string
  version: string
}

export type DictionaryMatchKind = 'exact' | 'prefix' | 'meaning' | 'form' | 'similar'

export interface DictionarySearchHit {
  id: string
  headword: string
  matchMeaning: string
  partOfSpeech: string
  bookIds: BookId[]
  matchKind: DictionaryMatchKind
  matchLabel: string
}
