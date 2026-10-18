import { Word } from '../engine/types'
import { getWordById, meaningsConflict } from './vocabulary-service'
import { ImportedWordRecord, normalizeImportedEnglish, parseMeanings } from './word-import'

const INDEX_KEY = 'wordmatch:v1:personalPacks:index'
const INDEX_BACKUP_KEY = 'wordmatch:v1:personalPacks:index:backup'
const PACK_KEY_PREFIX = 'wordmatch:v1:personalPack:'
export const PERSONAL_PACK_SCHEMA_VERSION = 1

export interface PersonalPackWord {
  id: string
  systemWordId?: string
  originalDictionaryId?: string
  english?: string
  meanings?: string[]
  matchMeaning?: string
  fullMeaning?: string
  source?: 'dictionary' | 'user_import' | 'manual'
  matchMeaningOverride?: string
  fullMeaningOverride?: string
}

export interface PersonalPackWordProgress {
  practiced: boolean
  pairAttempts: number
  correctPairs: number
  errorCount: number
  firstAttemptCorrect?: boolean
  lastPracticedAt: number
}

export interface PersonalWordPack {
  schemaVersion: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  words: PersonalPackWord[]
  progressByWordId: Record<string, PersonalPackWordProgress>
  pairAttempts: number
  correctPairs: number
  errorCount: number
  lastPracticedAt: number
}

export interface PersonalWordPackSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  wordCount: number
  practicedWordCount: number
  pairAttempts: number
  correctPairs: number
  errorCount: number
  firstTryAccuracy: number
  lastPracticedAt: number
}

interface PersonalPackIndex {
  schemaVersion: 1
  packs: PersonalWordPackSummary[]
}

const emptyIndex = (): PersonalPackIndex => ({ schemaVersion: PERSONAL_PACK_SCHEMA_VERSION, packs: [] })
const packKey = (id: string): string => `${PACK_KEY_PREFIX}${id}`

const createId = (prefix: string): string => (
  `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xFFFFFF).toString(36)}`
)

const hashText = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const isIndex = (value: unknown): value is PersonalPackIndex => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersonalPackIndex>
  return candidate.schemaVersion === PERSONAL_PACK_SCHEMA_VERSION && Array.isArray(candidate.packs)
}

const isPack = (value: unknown): value is PersonalWordPack => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersonalWordPack>
  return candidate.schemaVersion === PERSONAL_PACK_SCHEMA_VERSION
    && typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && Array.isArray(candidate.words)
    && Boolean(candidate.progressByWordId)
}

const loadIndex = (): PersonalPackIndex => {
  try {
    const value: unknown = wx.getStorageSync(INDEX_KEY)
    if (isIndex(value)) return value
    const backup: unknown = wx.getStorageSync(INDEX_BACKUP_KEY)
    return isIndex(backup) ? backup : emptyIndex()
  } catch (_error) {
    return emptyIndex()
  }
}

const firstTryAccuracy = (pack: PersonalWordPack): number => {
  const firstAttempts = Object.values(pack.progressByWordId)
    .map(item => item.firstAttemptCorrect)
    .filter((value): value is boolean => value !== undefined)
  return firstAttempts.length
    ? Math.round((firstAttempts.filter(Boolean).length / firstAttempts.length) * 100)
    : 100
}

const toSummary = (pack: PersonalWordPack): PersonalWordPackSummary => ({
  id: pack.id,
  name: pack.name,
  createdAt: pack.createdAt,
  updatedAt: pack.updatedAt,
  wordCount: pack.words.length,
  practicedWordCount: Object.values(pack.progressByWordId).filter(item => item.practiced).length,
  pairAttempts: pack.pairAttempts,
  correctPairs: pack.correctPairs,
  errorCount: pack.errorCount,
  firstTryAccuracy: firstTryAccuracy(pack),
  lastPracticedAt: pack.lastPracticedAt,
})

const writePackAndIndex = (pack: PersonalWordPack): void => {
  const current = loadIndex()
  const next: PersonalPackIndex = {
    schemaVersion: PERSONAL_PACK_SCHEMA_VERSION,
    packs: [toSummary(pack), ...current.packs.filter(item => item.id !== pack.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt),
  }
  try {
    const storage = wx.getStorageInfoSync()
    const estimatedKilobytes = Math.ceil((JSON.stringify(pack).length + JSON.stringify(next).length) * 2 / 1024)
    if (storage.limitSize - storage.currentSize < estimatedKilobytes + 32) {
      throw new Error('本地存储空间不足，请清理不用的词包后重试')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('存储空间不足')) throw error
    // Some developer-tool versions do not expose storage quota; the actual write remains guarded below.
  }
  // The pack is committed first. If the index write fails, the previous index remains recoverable.
  wx.setStorageSync(packKey(pack.id), pack)
  wx.setStorageSync(INDEX_BACKUP_KEY, current)
  wx.setStorageSync(INDEX_KEY, next)
}

export const listPersonalWordPacks = (): PersonalWordPackSummary[] => [...loadIndex().packs]

export const getPersonalWordPack = (id: string): PersonalWordPack | null => {
  try {
    const value: unknown = wx.getStorageSync(packKey(id))
    return isPack(value) ? value : null
  } catch (_error) {
    return null
  }
}

const wordIdentity = (english: string, systemWordId?: string): string => (
  systemWordId ? `system:${systemWordId}` : `english:${normalizeImportedEnglish(english)}`
)

const uniqueMeanings = (values: readonly string[]): string[] => {
  const seen = new Set<string>()
  return values.map(value => value.trim()).filter(value => {
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

const entryFromRecord = (
  record: ImportedWordRecord,
  packId: string,
  previousEntries: readonly PersonalPackWord[],
): PersonalPackWord | null => {
  const english = record.english.trim()
  const matchMeaning = record.matchMeaning.trim()
  if (!english || !matchMeaning) return null
  const system = record.systemWordId ? getWordById(record.systemWordId) : undefined
  const meanings = uniqueMeanings(record.meanings?.length ? record.meanings : parseMeanings(record.fullMeaning || matchMeaning))
  const fullMeaning = record.fullMeaning.trim() || meanings.join('；') || matchMeaning
  const usesSystemMeaning = Boolean(record.source === 'dictionary' && system
    && system!.english.toLocaleLowerCase() === english.toLocaleLowerCase()
    && system!.matchMeaning === matchMeaning
    && (!fullMeaning || system!.fullMeaning === fullMeaning))
  if (system && usesSystemMeaning) return { id: system.id, systemWordId: system.id }
  const identity = wordIdentity(english, system?.id)
  const previous = previousEntries.find(entry => wordIdentity(
    entry.english || getWordById(entry.systemWordId || entry.originalDictionaryId || '')?.english || '',
    entry.systemWordId || entry.originalDictionaryId,
  ) === identity)
  return {
    id: previous?.id.startsWith('personal:') ? previous.id : `personal:${hashText(`${packId}\u0000${identity}`)}`,
    systemWordId: system ? system.id : undefined,
    originalDictionaryId: system ? system.id : undefined,
    english,
    meanings: meanings.length ? meanings : [matchMeaning],
    matchMeaning,
    fullMeaning,
    source: record.source,
    matchMeaningOverride: matchMeaning,
    fullMeaningOverride: fullMeaning,
  }
}

export const savePersonalWordPack = (
  name: string,
  records: ImportedWordRecord[],
  existingId?: string,
): PersonalWordPack => {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('请输入词包名称')
  const now = Date.now()
  const previous = existingId ? getPersonalWordPack(existingId) : null
  const id = previous ? previous.id : createId('pack')
  const mergedRecords: ImportedWordRecord[] = []
  const recordByIdentity = new Map<string, ImportedWordRecord>()
  records.forEach(record => {
    const identity = wordIdentity(record.english, record.systemWordId)
    const existing = recordByIdentity.get(identity)
    if (!existing) {
      const copy = { ...record, meanings: uniqueMeanings(record.meanings || []) }
      recordByIdentity.set(identity, copy)
      mergedRecords.push(copy)
      return
    }
    const meanings = uniqueMeanings([
      ...(existing.meanings || parseMeanings(existing.fullMeaning || existing.matchMeaning)),
      ...(record.meanings || parseMeanings(record.fullMeaning || record.matchMeaning)),
    ])
    const preferIncoming = record.source !== 'dictionary'
    existing.meanings = meanings
    existing.matchMeaning = preferIncoming ? record.matchMeaning : existing.matchMeaning
    existing.fullMeaning = meanings.join('；') || existing.fullMeaning
    if (preferIncoming) existing.source = record.source
  })
  const words = mergedRecords
    .map(record => entryFromRecord(record, id, previous?.words || []))
    .filter((entry): entry is PersonalPackWord => Boolean(entry))
  if (!words.length) throw new Error('至少需要 1 个有效的中英配对')
  const progressByWordId: Record<string, PersonalPackWordProgress> = {}
  words.forEach(word => {
    let existing = previous ? previous.progressByWordId[word.id] : undefined
    if (!existing && previous) {
      const identity = wordIdentity(word.english || '', word.systemWordId || word.originalDictionaryId)
      const previousWord = previous.words.find(item => wordIdentity(
        item.english || getWordById(item.systemWordId || item.originalDictionaryId || '')?.english || '',
        item.systemWordId || item.originalDictionaryId,
      ) === identity)
      if (previousWord) existing = previous.progressByWordId[previousWord.id]
    }
    if (existing) progressByWordId[word.id] = existing
  })
  const pack: PersonalWordPack = {
    schemaVersion: PERSONAL_PACK_SCHEMA_VERSION,
    id,
    name: trimmedName,
    createdAt: previous ? previous.createdAt : now,
    updatedAt: now,
    words,
    progressByWordId,
    pairAttempts: previous ? previous.pairAttempts : 0,
    correctPairs: previous ? previous.correctPairs : 0,
    errorCount: previous ? previous.errorCount : 0,
    lastPracticedAt: previous ? previous.lastPracticedAt : 0,
  }
  writePackAndIndex(pack)
  return pack
}

export type AddWordToPackResult = 'added' | 'duplicate'

export const addSystemWordToPersonalPack = (packId: string, wordId: string): AddWordToPackResult => {
  const pack = getPersonalWordPack(packId)
  if (!pack) throw new Error('词包不存在或已被删除')
  const word = getWordById(wordId)
  if (!word) throw new Error('本地词条不存在')
  if (pack.words.some(item => item.id === wordId || item.systemWordId === wordId)) return 'duplicate'
  writePackAndIndex({
    ...pack,
    updatedAt: Date.now(),
    words: [...pack.words, { id: wordId, systemWordId: wordId }],
  })
  return 'added'
}

export const createPersonalWordPackWithSystemWord = (name: string, wordId: string): PersonalWordPack => {
  const word = getWordById(wordId)
  if (!word) throw new Error('本地词条不存在')
  return savePersonalWordPack(name, [{
    english: word.english,
    meanings: word.matchMeanings?.length ? word.matchMeanings : [word.matchMeaning],
    matchMeaning: word.matchMeaning,
    fullMeaning: word.fullMeaning,
    systemWordId: word.id,
    status: 'matched',
    source: 'dictionary',
    candidates: [{
      id: word.id,
      matchMeaning: word.matchMeaning,
      fullMeaning: word.fullMeaning,
      partOfSpeech: word.partOfSpeech || '',
    }],
  }])
}

export const renamePersonalWordPack = (id: string, name: string): void => {
  const pack = getPersonalWordPack(id)
  if (!pack) throw new Error('词包不存在或已被删除')
  const trimmed = name.trim()
  if (!trimmed) throw new Error('词包名称不能为空')
  writePackAndIndex({ ...pack, name: trimmed, updatedAt: Date.now() })
}

export const copyPersonalWordPack = (id: string): PersonalWordPack => {
  const source = getPersonalWordPack(id)
  if (!source) throw new Error('词包不存在或已被删除')
  const now = Date.now()
  const copy: PersonalWordPack = {
    ...source,
    id: createId('pack'),
    name: `${source.name} 副本`,
    createdAt: now,
    updatedAt: now,
    progressByWordId: {},
    pairAttempts: 0,
    correctPairs: 0,
    errorCount: 0,
    lastPracticedAt: 0,
  }
  writePackAndIndex(copy)
  return copy
}

export const deletePersonalWordPack = (id: string): void => {
  const current = loadIndex()
  const next: PersonalPackIndex = {
    schemaVersion: PERSONAL_PACK_SCHEMA_VERSION,
    packs: current.packs.filter(item => item.id !== id),
  }
  wx.setStorageSync(INDEX_BACKUP_KEY, current)
  wx.setStorageSync(INDEX_KEY, next)
  wx.removeStorageSync(packKey(id))
}

export const resolvePersonalPackWords = (pack: PersonalWordPack): Word[] => pack.words
  .map((entry): Word | null => {
    const dictionaryId = entry.systemWordId || entry.originalDictionaryId
    const system = dictionaryId ? getWordById(dictionaryId) : undefined
    const english = entry.english || (system && system.english) || ''
    const matchMeaning = entry.matchMeaning || entry.matchMeaningOverride || (system && system.matchMeaning) || ''
    const fullMeaning = entry.fullMeaning || entry.fullMeaningOverride || (system && system.fullMeaning) || matchMeaning
    const meanings = uniqueMeanings(entry.meanings?.length
      ? entry.meanings
      : parseMeanings(fullMeaning || matchMeaning))
    if (!english || !matchMeaning) return null
    return {
      id: entry.id,
      dictionaryId: system ? system.id : undefined,
      english,
      matchMeaning,
      matchMeanings: meanings.length ? meanings : [matchMeaning],
      displayMeanings: meanings.length ? meanings : [matchMeaning],
      displayMeaning: (meanings.length ? meanings : [matchMeaning]).join('；'),
      fullMeaning,
      phonetic: system ? system.phonetic : undefined,
      partOfSpeech: system ? system.partOfSpeech : undefined,
      bookIds: system ? system.bookIds : [],
    }
  })
  .filter((word): word is Word => Boolean(word))

export const getPersonalPackAvailableWords = (
  id: string,
  scope: 'all' | 'unlearned' | 'wrong',
): Word[] => {
  const pack = getPersonalWordPack(id)
  if (!pack) return []
  return resolvePersonalPackWords(pack).filter(word => {
    const progress = pack.progressByWordId[word.id]
    if (scope === 'unlearned') return !progress || !progress.practiced
    if (scope === 'wrong') return Boolean(progress && progress.errorCount > 0)
    return true
  })
}

export const recordPersonalPackAttempt = (
  packId: string,
  wordIds: string[],
  correct: boolean,
  now: number = Date.now(),
): void => {
  const pack = getPersonalWordPack(packId)
  if (!pack) return
  const progressByWordId = { ...pack.progressByWordId }
  wordIds.forEach(wordId => {
    const previous = progressByWordId[wordId] || {
      practiced: false, pairAttempts: 0, correctPairs: 0, errorCount: 0, lastPracticedAt: 0,
    }
    progressByWordId[wordId] = {
      practiced: true,
      pairAttempts: previous.pairAttempts + 1,
      correctPairs: previous.correctPairs + (correct ? 1 : 0),
      errorCount: previous.errorCount + (correct ? 0 : 1),
      firstAttemptCorrect: previous.firstAttemptCorrect === undefined ? correct : previous.firstAttemptCorrect,
      lastPracticedAt: now,
    }
  })
  writePackAndIndex({
    ...pack,
    progressByWordId,
    pairAttempts: pack.pairAttempts + 1,
    correctPairs: pack.correctPairs + (correct ? 1 : 0),
    errorCount: pack.errorCount + (correct ? 0 : 1),
    lastPracticedAt: now,
    updatedAt: now,
  })
}

export const hasMeaningConflicts = (records: ImportedWordRecord[]): boolean => {
  const valid = records.filter(record => record.matchMeaning.trim())
  return valid.some((record, index) => valid.slice(index + 1)
    .some(other => meaningsConflict(record.matchMeaning, other.matchMeaning)))
}
