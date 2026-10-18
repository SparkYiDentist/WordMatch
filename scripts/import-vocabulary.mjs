import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const BOOKS = [
  { id: 'high_school', label: '高中', file: '高中.jsonl', mask: 1 },
  { id: 'cet4', label: 'CET-4', file: '四级.jsonl', mask: 2 },
  { id: 'cet6', label: 'CET-6', file: '六级.jsonl', mask: 4 },
]

const args = process.argv.slice(2)
const sourceArg = args.indexOf('--source')
if (sourceArg < 0 || !args[sourceArg + 1]) {
  console.error('Usage: node scripts/import-vocabulary.mjs --source <english-vocabulary checkout>')
  process.exit(1)
}

const projectRoot = process.cwd()
const sourceRoot = path.resolve(args[sourceArg + 1])
const sourceDir = path.join(sourceRoot, 'full_line_jsonl', 'sentence', '正序')
const outputDir = path.join(projectRoot, 'miniprogram', 'data', 'vocabulary')
const reportDir = path.join(projectRoot, 'reports')

const cleanText = value => String(value ?? '')
  .normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const normalizeEnglish = value => cleanText(value).toLocaleLowerCase('en-US')
const normalizePos = value => cleanText(value)
  .toLocaleLowerCase('en-US')
  .replace(/\s+/g, '')
  .replace(/\.$/, '')
const normalizeMeaning = value => cleanText(value)
  .replace(/[，,。.!！?？；;、\s（）()\[\]【】]/g, '')

const hasChinese = value => /[\u3400-\u9fff]/u.test(value)
const isValidEnglish = value => /[a-z]/i.test(value) && value.length <= 80

const splitMeaning = value => cleanText(value)
  .replace(/[;；]+/g, '；')
  .split('；')
  .flatMap(part => part.split(/[，,]/))
  .map(part => part.replace(/^\s*[\[【（(][^\]】）)]*[\]】）)]\s*/u, '').trim())
  .filter(hasChinese)

const chooseMatchMeanings = fullMeaning => {
  const candidates = splitMeaning(fullMeaning)
    .map(value => value
      .replace(/^(使|使其|表示|指)\s*/u, match => match)
      .replace(/[（(][^）)]*[）)]/gu, '')
      .trim())
    .filter(Boolean)
  const frequency = new Map()
  candidates.forEach(value => {
    const key = normalizeMeaning(value)
    frequency.set(key, (frequency.get(key) || 0) + 1)
  })
  const unique = candidates.filter((value, index) => (
    candidates.findIndex(candidate => normalizeMeaning(candidate) === normalizeMeaning(value)) === index
  ))
  const concise = unique.filter(value => value.length <= 8)
  const longer = unique.filter(value => value.length > 8)
  const ordered = [...concise, ...longer]
  const primary = ordered[0]
  if (!primary) return []
  const primaryCharacters = new Set([...normalizeMeaning(primary)])
  const alternatives = ordered.slice(1).map((value, index) => ({
    value,
    index,
    sharedCharacters: [...new Set([...normalizeMeaning(value)])]
      .filter(character => primaryCharacters.has(character)).length,
    frequency: frequency.get(normalizeMeaning(value)) || 0,
  })).sort((left, right) => (
    right.sharedCharacters - left.sharedCharacters
    || right.frequency - left.frequency
    || left.index - right.index
  ))
  return [primary, ...alternatives.map(item => item.value)].slice(0, 3)
}

const shortHash = value => createHash('sha1').update(value).digest('hex').slice(0, 8)
const slugify = value => normalizeEnglish(value)
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || `word-${shortHash(value)}`

const sourceCommit = await (async () => {
  const head = cleanText(await readFile(path.join(sourceRoot, '.git', 'HEAD'), 'utf8'))
  if (head.startsWith('ref: ')) {
    return cleanText(await readFile(path.join(sourceRoot, '.git', head.slice(5)), 'utf8'))
  }
  return head
})().catch(() => 'unknown')

const groups = new Map()
const rawStats = Object.fromEntries(BOOKS.map(book => [book.id, {
  raw: 0,
  invalid: 0,
  missingMeaning: 0,
  duplicateSenses: 0,
}]))

for (const book of BOOKS) {
  const filePath = path.join(sourceDir, book.file)
  const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean)
  rawStats[book.id].raw = lines.length
  const seenInBook = new Set()

  for (const line of lines) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      rawStats[book.id].invalid += 1
      continue
    }
    const english = cleanText(row.word)
    const translations = Array.isArray(row.translations) ? row.translations : []
    if (!isValidEnglish(english) || translations.length === 0) {
      rawStats[book.id].invalid += 1
      if (translations.length === 0) rawStats[book.id].missingMeaning += 1
      continue
    }

    let accepted = 0
    for (const translation of translations) {
      const meaning = cleanText(translation?.translation)
      const partOfSpeech = normalizePos(translation?.type)
      if (!meaning || !hasChinese(meaning)) {
        rawStats[book.id].missingMeaning += 1
        continue
      }
      accepted += 1
      const groupKey = `${normalizeEnglish(english)}\u0000${partOfSpeech || 'unknown'}`
      const bookKey = `${groupKey}\u0000${book.id}`
      if (seenInBook.has(bookKey)) rawStats[book.id].duplicateSenses += 1
      seenInBook.add(bookKey)

      const existing = groups.get(groupKey) || {
        key: groupKey,
        english,
        normalizedEnglish: normalizeEnglish(english),
        partOfSpeech,
        meanings: [],
        phonetics: [],
        bookMask: 0,
        perBookMeanings: new Map(),
      }
      if (!existing.meanings.includes(meaning)) existing.meanings.push(meaning)
      const phonetic = cleanText(row.us || row.uk)
      if (phonetic && !existing.phonetics.includes(phonetic)) existing.phonetics.push(phonetic)
      existing.bookMask |= book.mask
      const meaningsForBook = existing.perBookMeanings.get(book.id) || []
      if (!meaningsForBook.includes(meaning)) meaningsForBook.push(meaning)
      existing.perBookMeanings.set(book.id, meaningsForBook)
      groups.set(groupKey, existing)
    }
    if (accepted === 0) rawStats[book.id].invalid += 1
  }
}

const idCounts = new Map()
const words = [...groups.values()].map(group => {
  const base = `${slugify(group.english)}-${group.partOfSpeech || 'word'}`
  const count = idCounts.get(base) || 0
  idCounts.set(base, count + 1)
  const id = count === 0 ? base : `${base}-${shortHash(group.key)}`
  const fullMeaning = group.meanings.join('；')
  const matchMeanings = chooseMatchMeanings(fullMeaning)
  return {
    id,
    english: group.english,
    normalizedEnglish: group.normalizedEnglish,
    matchMeaning: matchMeanings[0] || fullMeaning,
    matchMeanings: matchMeanings.length ? matchMeanings : [fullMeaning],
    fullMeaning,
    phonetic: group.phonetics[0] || '',
    partOfSpeech: group.partOfSpeech ? `${group.partOfSpeech}.` : '',
    bookMask: group.bookMask,
    perBookMeanings: group.perBookMeanings,
  }
}).sort((a, b) => a.normalizedEnglish.localeCompare(b.normalizedEnglish, 'en')
  || a.partOfSpeech.localeCompare(b.partOfSpeech, 'en'))

const idSet = new Set()
for (const word of words) {
  if (idSet.has(word.id)) throw new Error(`Duplicate stable ID: ${word.id}`)
  idSet.add(word.id)
}

const duplicateMeaningGroups = new Map()
for (const word of words) {
  const key = normalizeMeaning(word.matchMeaning)
  const list = duplicateMeaningGroups.get(key) || []
  list.push(word)
  duplicateMeaningGroups.set(key, list)
}

const reviewRows = []
for (const [meaning, entries] of duplicateMeaningGroups) {
  const englishSet = new Set(entries.map(entry => entry.normalizedEnglish))
  if (meaning && englishSet.size > 1) {
    reviewRows.push({
      reason: 'duplicate_match_meaning',
      meaning: entries[0].matchMeaning,
      ids: entries.map(entry => entry.id),
      english: [...englishSet],
    })
  }
}
for (const word of words) {
  if (word.matchMeaning.length > 10) {
    reviewRows.push({ reason: 'long_match_meaning', meaning: word.matchMeaning, ids: [word.id], english: [word.english] })
  }
  if (word.perBookMeanings.size > 1) {
    const normalizedSets = [...word.perBookMeanings.values()].map(values => new Set(values.flatMap(splitMeaning).map(normalizeMeaning)))
    const overlap = normalizedSets.slice(1).every(set => [...normalizedSets[0]].some(value => set.has(value)))
    if (!overlap) {
      reviewRows.push({ reason: 'cross_book_meaning_difference', meaning: word.matchMeaning, ids: [word.id], english: [word.english] })
    }
  }
}

const tuples = words.map(word => [
  word.id,
  word.english,
  word.matchMeaning,
  word.fullMeaning,
  word.phonetic,
  word.partOfSpeech,
  word.bookMask,
  word.matchMeanings.slice(1),
])

const legacyPath = path.join(projectRoot, 'miniprogram', 'data', 'words.ts')
const legacySource = await readFile(legacyPath, 'utf8')
const legacyMatches = [...legacySource.matchAll(/\['([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*\d+\]/g)]
const legacyMap = {}
const unmappedLegacyIds = []
legacyMatches.forEach((match, index) => {
  const english = normalizeEnglish(match[1])
  const pos = normalizePos(match[3])
  const candidates = words.filter(word => word.normalizedEnglish === english
    && normalizePos(word.partOfSpeech) === pos)
  if (candidates.length === 1) legacyMap[String(index + 1)] = candidates[0].id
  else unmappedLegacyIds.push(index + 1)
})

const header = `// Generated by scripts/import-vocabulary.mjs from KyleBing/english-vocabulary\n`
  + `// Source commit: ${sourceCommit}; do not edit manually.\n`
  + `export type EncodedWord = readonly [string,string,string,string,string,string,number,readonly string[]]\n`
const generatedData = `${header}export const VOCABULARY_DATA: readonly EncodedWord[]=${JSON.stringify(tuples)}\n`
const generatedMeta = `${header}export const VOCABULARY_SOURCE_COMMIT=${JSON.stringify(sourceCommit)}\n`
  + `export const BOOK_COUNTS=${JSON.stringify(Object.fromEntries(BOOKS.map(book => [book.id, words.filter(word => (word.bookMask & book.mask) !== 0).length])))} as const\n`
  + `export const LEGACY_WORD_ID_MAP: Readonly<Record<string,string>>=${JSON.stringify(legacyMap)}\n`

await mkdir(outputDir, { recursive: true })
await mkdir(reportDir, { recursive: true })
await writeFile(path.join(outputDir, 'generated-data.ts'), generatedData, 'utf8')
await writeFile(path.join(outputDir, 'generated-meta.ts'), generatedMeta, 'utf8')
await import('./compress-vocabulary.mjs')
await writeFile(path.join(reportDir, 'vocabulary-review.json'), `${JSON.stringify(reviewRows, null, 2)}\n`, 'utf8')

const dataBytes = Buffer.byteLength(generatedData)
const metaBytes = Buffer.byteLength(generatedMeta)
const bookStats = Object.fromEntries(BOOKS.map(book => {
  const bookWords = words.filter(word => (word.bookMask & book.mask) !== 0)
  return [book.id, {
    label: book.label,
    rawEntries: rawStats[book.id].raw,
    validSenseEntries: bookWords.length,
    duplicateSenseRows: rawStats[book.id].duplicateSenses,
    missingChineseMeaning: rawStats[book.id].missingMeaning,
    invalidRows: rawStats[book.id].invalid,
    manualReviewEntries: new Set(reviewRows.flatMap(row => row.ids)
      .filter(id => bookWords.some(word => word.id === id))).size,
    logicalEncodedBytes: Buffer.byteLength(JSON.stringify(bookWords.map(word => [
      word.id,
      word.english,
      word.matchMeaning,
      word.fullMeaning,
      word.phonetic,
      word.partOfSpeech,
      word.bookMask,
      word.matchMeanings.slice(1),
    ]))),
  }]
}))
const multiBookWords = words.filter(word => [1, 2, 4].filter(mask => (word.bookMask & mask) !== 0).length > 1).length

const report = {
  source: {
    repository: 'https://github.com/KyleBing/english-vocabulary',
    commit: sourceCommit,
    inputs: BOOKS.map(book => `full_line_jsonl/sentence/正序/${book.file}`),
    license: 'BSD-3-Clause (upstream provenance caveat documented in THIRD_PARTY_NOTICES.md)',
  },
  books: bookStats,
  totals: {
    uniqueSenseEntries: words.length,
    uniqueEnglishSpellings: new Set(words.map(word => word.normalizedEnglish)).size,
    multiBookSenseEntries: multiBookWords,
    generatedDataBytes: dataBytes,
    generatedMetadataBytes: metaBytes,
    generatedTotalBytes: dataBytes + metaBytes,
    manualReviewRows: reviewRows.length,
    legacyIdsMapped: Object.keys(legacyMap).length,
    legacyIdsUnmapped: unmappedLegacyIds,
  },
}
await writeFile(path.join(reportDir, 'vocabulary-stats.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

const markdown = `# WordMatch 词库统计报告\n\n`
  + `上游提交：\`${sourceCommit}\`（相同输入生成相同运行时数据与统计结果）\n\n`
  + `| 统计指标 | 高中 | CET-4 | CET-6 |\n|---|---:|---:|---:|\n`
  + `| 原始词条数量 | ${bookStats.high_school.rawEntries} | ${bookStats.cet4.rawEntries} | ${bookStats.cet6.rawEntries} |\n`
  + `| 清洗后有效义项数 | ${bookStats.high_school.validSenseEntries} | ${bookStats.cet4.validSenseEntries} | ${bookStats.cet6.validSenseEntries} |\n`
  + `| 重复义项行数 | ${bookStats.high_school.duplicateSenseRows} | ${bookStats.cet4.duplicateSenseRows} | ${bookStats.cet6.duplicateSenseRows} |\n`
  + `| 缺少中文释义数 | ${bookStats.high_school.missingChineseMeaning} | ${bookStats.cet4.missingChineseMeaning} | ${bookStats.cet6.missingChineseMeaning} |\n`
  + `| 需要人工检查的义项数 | ${bookStats.high_school.manualReviewEntries} | ${bookStats.cet4.manualReviewEntries} | ${bookStats.cet6.manualReviewEntries} |\n`
  + `| 逻辑编码大小（含跨库重复） | ${bookStats.high_school.logicalEncodedBytes} B | ${bookStats.cet4.logicalEncodedBytes} B | ${bookStats.cet6.logicalEncodedBytes} B |\n\n`
  + `- 三套词库合计：${words.length} 个不同义项，${report.totals.uniqueEnglishSpellings} 个不同英文拼写。\n`
  + `- 同时属于多个词库：${multiBookWords} 个义项。\n`
  + `- 生成文件：${dataBytes + metaBytes} bytes（${((dataBytes + metaBytes) / 1024 / 1024).toFixed(2)} MiB）。\n`
  + `- 人工审核清单：${reviewRows.length} 行，见 \`reports/vocabulary-review.json\`。\n`
  + `- 旧数字 ID：映射 ${Object.keys(legacyMap).length} 个；未映射 ${unmappedLegacyIds.length} 个。\n`
await writeFile(path.join(reportDir, 'vocabulary-stats.md'), markdown, 'utf8')

console.log(JSON.stringify(report, null, 2))
