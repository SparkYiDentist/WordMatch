const test = require('node:test')
const assert = require('node:assert/strict')

const matching = require('../.test-build/engine/matching.js')
const refill = require('../.test-build/engine/refill.js')
const review = require('../.test-build/engine/review.js')
const modes = require('../.test-build/engine/modes.js')
const vocabulary = require('../.test-build/services/vocabulary-service.js')
const wordImport = require('../.test-build/services/word-import.js')
const pdfImport = require('../.test-build/services/pdf-import.js')
const personalPacks = require('../.test-build/services/personal-word-pack.js')
const storageManager = require('../.test-build/services/storage-manager.js')
const dictionarySearch = require('../.test-build/services/search-index-service.js')
const dictionary = require('../.test-build/services/dictionary-service.js')
const searchHistory = require('../.test-build/services/search-history-service.js')
const dailyLearning = require('../.test-build/services/daily-learning.js')
const quiz = require('../.test-build/engine/quiz.js')

const makeWord = (id, english, matchMeaning) => ({
  id: String(id),
  english,
  matchMeaning,
  fullMeaning: matchMeaning,
  bookIds: ['high_school'],
})

test('四选一生成唯一且恰好一个正确答案，并尊重指定答案位置', () => {
  const words = [
    makeWord(1, 'achieve', '实现'), makeWord(2, 'abandon', '放弃'),
    makeWord(3, 'expand', '扩大'), makeWord(4, 'predict', '预测'),
    makeWord(5, 'maintain', '维持'),
  ]
  const question = quiz.generateQuizQuestion(words[0], words, 2, () => 0.4)
  assert.ok(question)
  assert.equal(question.options.length, 4)
  assert.equal(new Set(question.options.map(option => option.meaning)).size, 4)
  assert.equal(question.options.filter(option => option.correct).length, 1)
  assert.equal(question.options[2].wordId, words[0].id)
})

test('四选一过滤正确词的其他合法义项，候选不足时安全跳过', () => {
  const correct = { ...makeWord(1, 'present', '礼物'), matchMeanings: ['礼物', '现在'] }
  const ambiguous = makeWord(2, 'now', '现在')
  const question = quiz.generateQuizQuestion(correct, [correct, ambiguous, makeWord(3, 'x', '甲'), makeWord(4, 'y', '乙')], 0, () => 0.3)
  assert.equal(question, null)
})

test('四选一答案位置按四题一轮均衡且首次正确率不被重试改写', () => {
  const order = quiz.createBalancedAnswerOrder(() => 0.5)
  assert.deepEqual([...order].sort(), [0, 1, 2, 3])
  assert.equal(quiz.firstTryAccuracy([false, true, true, false]), 50)
})

test('支持任意一侧先选、取消和同列切换', () => {
  const words = [makeWord(1, 'one', '一'), makeWord(2, 'two', '二')]
  const board = refill.createSlots(words, () => 0.5)
  let selection = matching.emptySelection()
  selection = matching.selectCard(selection, 'chinese', 0, board.right, false).selection
  assert.equal(selection.chineseIndex, 0)
  selection = matching.selectCard(selection, 'chinese', 0, board.right, false).selection
  assert.equal(selection.chineseIndex, null)
  selection = matching.selectCard(selection, 'english', 0, board.left, false).selection
  selection = matching.selectCard(selection, 'english', 1, board.left, false).selection
  assert.equal(selection.englishIndex, 1)
})

test('锁定或空槽时忽略点击', () => {
  const board = refill.createSlots([makeWord(1, 'one', '一')])
  assert.equal(matching.selectCard(matching.emptySelection(), 'english', 0, board.left, true).ignored, true)
  assert.equal(matching.selectCard(matching.emptySelection(), 'english', 4, board.left, false).ignored, true)
})

test('第一组等待批量消除时保持朦胧锁定状态', () => {
  const board = refill.createSlots([makeWord(1, 'one', '一'), makeWord(2, 'two', '二')])
  board.left[0].state = 'waiting'
  assert.equal(matching.selectCard(matching.emptySelection(), 'english', 0, board.left, false).ignored, true)
  const updated = matching.withSelectedStates(board.left, 1)
  assert.equal(updated[0].state, 'waiting')
  assert.equal(updated[1].state, 'selected')
})

test('匹配使用唯一 ID 而不是中文字符串', () => {
  const first = makeWord(1, 'big', '大的')
  const second = makeWord(2, 'large', '大的')
  const left = { slotId: 0, word: first, state: 'idle' }
  const wrongRight = { slotId: 0, word: second, state: 'idle' }
  assert.equal(matching.isMatchingPair(left, wrongRight), false)
})

test('补词保留原卡片位置，仅让新词进入空位', () => {
  const initial = [1, 2, 3, 4, 5].map(id => makeWord(id, `w${id}`, `释义${id}`))
  const board = refill.createSlots(initial, () => 0.4)
  board.left[1].word = null
  board.left[3].word = null
  board.right = board.right.map(slot => (
    slot.word && (slot.word.id === 2 || slot.word.id === 4) ? { ...slot, word: null } : slot
  ))
  const retainedRightIds = board.right.map(slot => slot.word && slot.word.id)
  const additions = [makeWord(6, 'w6', '释义6'), makeWord(7, 'w7', '释义7')]
  const next = refill.refillSlots(board.left, board.right, additions, () => 0.3)
  assert.equal(next.left[0].word.id, '1')
  assert.equal(next.left[1].word.id, '6')
  assert.equal(next.left[2].word.id, '3')
  assert.equal(next.left[3].word.id, '7')
  assert.equal(next.left[0].state, 'idle')
  assert.equal(next.left[1].state, 'entering')
  assert.equal(next.right.filter(slot => slot.word).length, 5)
  retainedRightIds.forEach((id, index) => {
    if (id) {
      assert.equal(next.right[index].word.id, id)
      assert.equal(next.right[index].state, 'idle')
    } else {
      assert.equal(next.right[index].state, 'entering')
    }
  })
})

test('抽词排除当前 ID 和重复中文释义，并允许剩余 1 词', () => {
  const pool = [
    makeWord(1, 'big', '大的'),
    makeWord(2, 'large', '大的'),
    makeWord(3, 'small', '小的'),
  ]
  const picked = refill.pickUniqueWords(pool, 2, [1], ['大的'])
  assert.deepEqual(picked.map(word => word.id), ['3'])
})

test('首次错误涉及的两个单词都进入错词进度', () => {
  const profile = {
    schemaVersion: 2,
    wordProgressById: {},
    learnedWordIds: [],
    dailyStats: {},
    levelProgress: { 1: 0 },
    sessionHistory: [],
  }
  const next = review.applyWordAttempt(profile, ['1', '2'], false, 1000)
  assert.equal(next.wordProgressById['1'].errorCount, 1)
  assert.equal(next.wordProgressById['2'].errorCount, 1)
  assert.equal(next.wordProgressById['1'].correctStreak, 0)
})

test('错词连续答对两次后不再属于活跃错词，之后答错会重新进入', () => {
  const profile = {
    schemaVersion: 2,
    wordProgressById: {},
    learnedWordIds: [],
    dailyStats: {},
    dailyWrongWordIds: {},
    levelProgress: { 1: 0 },
    sessionHistory: [],
  }
  const wrong = review.applyWordAttempt(profile, ['1'], false, 1000)
  const once = review.applyWordAttempt(wrong, ['1'], true, 2000)
  const twice = review.applyWordAttempt(once, ['1'], true, 3000)
  const wrongAgain = review.applyWordAttempt(twice, ['1'], false, 4000)
  assert.equal(review.isActiveWrongProgress(wrong.wordProgressById['1']), true)
  assert.equal(review.isActiveWrongProgress(once.wordProgressById['1']), true)
  assert.equal(review.isActiveWrongProgress(twice.wordProgressById['1']), false)
  assert.equal(review.isActiveWrongProgress(wrongAgain.wordProgressById['1']), true)
})

test('首次正确率不会被后续重试刷高', () => {
  const config = { mode: 'level', title: '第一关', targetCount: 20, level: 1 }
  let stats = review.createSessionStats(config, 0)
  stats = review.registerJudgement(stats, '1', '2', false)
  stats = review.registerJudgement(stats, '1', '1', true)
  assert.equal(review.calculateFirstTryAccuracy(stats), 0)
  assert.equal(stats.completedWords, 1)
})

test('星级阈值正确', () => {
  assert.equal(review.starsForAccuracy(95), 3)
  assert.equal(review.starsForAccuracy(80), 2)
  assert.equal(review.starsForAccuracy(60), 1)
  assert.equal(review.starsForAccuracy(59), 0)
})

test('十个关卡各取 20 个且关内不重复、同关结果稳定', () => {
  for (let level = 1; level <= 10; level += 1) {
    const words = vocabulary.getLevelWords('high_school', level)
    const repeated = vocabulary.getLevelWords('high_school', level)
    assert.equal(words.length, 20)
    assert.equal(new Set(words.map(word => word.id)).size, 20)
    assert.deepEqual(words.map(word => word.id), repeated.map(word => word.id))
  }
})

test('三套正式词库可查询，自选空范围安全返回空数组', () => {
  assert.ok(vocabulary.getBookCount('high_school') > 6000)
  assert.ok(vocabulary.getBookCount('cet4') > 5000)
  assert.ok(vocabulary.getBookCount('cet6') > 5000)
  const sample = vocabulary.getWords('high_school', 20)
  const wrong = vocabulary.getAvailableWordIds('high_school', 'wrong', [], sample.slice(0, 2).map(word => word.id))
  const empty = vocabulary.getAvailableWordIds('cet6', 'wrong', [], ['not-a-real-id'])
  assert.deepEqual(wrong.sort(), sample.slice(0, 2).map(word => word.id).sort())
  assert.equal(empty.length, 0)
})

test('统一词库接口返回稳定 ID、完整释义且排除当前词条', () => {
  const initial = vocabulary.getWords('cet4', 5)
  assert.equal(initial.length, 5)
  assert.ok(initial.every(word => word.id && word.matchMeaning && word.fullMeaning))
  assert.ok(initial.every(word => word.displayMeanings.length >= 1 && word.displayMeanings.length <= 3))
  initial.forEach((word, index) => {
    initial.slice(index + 1).forEach(other => {
      word.displayMeanings.forEach(meaning => {
        other.displayMeanings.forEach(otherMeaning => {
          assert.equal(vocabulary.meaningsConflict(meaning, otherMeaning), false)
        })
      })
    })
  })
  const next = vocabulary.getNextWords('cet4', 5, initial.map(word => word.id))
  assert.equal(next.length, 5)
  assert.equal(next.some(word => initial.some(existing => existing.id === word.id)), false)
  assert.equal(vocabulary.getWordById(initial[0].id).english, initial[0].english)
})

test('词义冲突检测覆盖完全相同和包含关系', () => {
  assert.equal(vocabulary.meaningsConflict('获得', '获得'), true)
  assert.equal(vocabulary.meaningsConflict('获得', '获得知识'), true)
  assert.equal(vocabulary.meaningsConflict('获得', '放弃'), false)
})

test('主释义冲突时按顺序使用备用释义', () => {
  const word = {
    id: 'obtain-v', english: 'obtain', matchMeaning: '获得', matchMeanings: ['获得', '得到', '取得'],
    fullMeaning: '获得；得到；取得', bookIds: ['cet4'],
  }
  const selected = vocabulary.selectMatchMeaning(word, ['获得'])
  assert.equal(selected.matchMeaning, '得到')
  assert.equal(selected.displayMeaning, '得到；取得')
  assert.equal(vocabulary.selectMatchMeaning(word, ['获得', '得到', '取得']), undefined)
  const obtain = vocabulary.lookupWord('obtain').candidates.find(candidate => candidate.id === 'obtain-v')
  assert.equal(vocabulary.selectMatchMeaning(obtain, ['获得']).matchMeaning, '得到')
  assert.match(vocabulary.selectMatchMeaning(obtain, ['获得']).displayMeaning, /^得到/)
})

test('本地单词检索忽略首尾空格和大小写并返回多义候选', () => {
  const result = vocabulary.lookupWord('  Abandon  ')
  assert.equal(result.found, true)
  assert.equal(result.normalized, 'abandon')
  assert.ok(result.candidates.length > 1)
  assert.ok(result.candidates.every(word => word.english.toLowerCase() === 'abandon'))
  assert.equal(vocabulary.lookupWord('not-a-real-wordmatch-entry').found, false)
})

test('全局词典检索支持精确、前缀、中文、词形和相近拼写', () => {
  const exact = dictionarySearch.searchDictionaryIndex('  Abandon  ')
  assert.equal(exact[0].headword.toLowerCase(), 'abandon')
  assert.equal(exact[0].matchKind, 'exact')
  assert.equal(dictionarySearch.searchDictionaryIndex('aban').some(item => item.headword.toLowerCase() === 'abandon'), true)
  assert.equal(dictionarySearch.searchDictionaryIndex('遗弃').some(item => item.headword.toLowerCase() === 'abandon'), true)
  assert.equal(dictionarySearch.searchDictionaryIndex('abilities').some(item => item.headword.toLowerCase() === 'ability'), true)
  assert.equal(dictionarySearch.searchDictionaryIndex('abandno').some(item => item.headword.toLowerCase() === 'abandon'), true)
  assert.equal(dictionarySearch.searchDictionaryIndex('不存在的中文词义xyz').length, 0)
})

test('词典详情保留多词性义项且不填造缺失字段', () => {
  const hit = dictionarySearch.searchDictionaryIndex('abandon')[0]
  const entry = dictionary.getDictionaryEntry(hit.id)
  assert.equal(entry.headword.toLowerCase(), 'abandon')
  assert.ok(entry.senses.length > 1)
  assert.equal(entry.englishDefinition, undefined)
  assert.equal(entry.examples, undefined)
  assert.ok(entry.source.includes('本地已导入词库'))
})

test('搜索历史保存、去重、删除和清空', () => {
  const values = new Map()
  global.wx = {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    removeStorageSync: key => values.delete(key),
  }
  searchHistory.addSearchHistory('abandon')
  searchHistory.addSearchHistory('ability')
  searchHistory.addSearchHistory('ABANDON')
  assert.deepEqual(searchHistory.getSearchHistory(), ['ABANDON', 'ability'])
  searchHistory.removeSearchHistory('ability')
  assert.deepEqual(searchHistory.getSearchHistory(), ['ABANDON'])
  assert.deepEqual(searchHistory.clearSearchHistory(), [])
})

test('导入解析支持逐行、Tab、CSV 和连接符且去重', () => {
  const parsed = wordImport.parseWordText([
    'abandon',
    'achieve\t实现',
    '"maintain","维持，保持"',
    'take care - 当心',
    '',
    ' ABANDON ',
  ].join('\n'))
  assert.deepEqual(parsed.rows, [
    { english: 'abandon', meaning: '', meanings: [] },
    { english: 'achieve', meaning: '实现', meanings: ['实现'] },
    { english: 'maintain', meaning: '维持，保持', meanings: ['维持，保持'] },
    { english: 'take care', meaning: '当心', meanings: ['当心'] },
  ])
  assert.equal(parsed.duplicateCount, 1)
})

test('批量检索不编造未找到释义并保留用户释义', () => {
  const resolved = wordImport.resolveImportedWords([
    { english: 'achieve', meaning: '' },
    { english: 'maintain', meaning: '用户选择的释义' },
    { english: 'not-a-real-wordmatch-entry', meaning: '' },
  ])
  assert.equal(resolved[0].status, 'matched')
  assert.ok(resolved[0].candidates.length > 0)
  assert.equal(resolved[1].matchMeaning, '用户选择的释义')
  assert.equal(resolved[1].source, 'user_import')
  assert.equal(resolved[2].status, 'not_found')
  assert.equal(resolved[2].matchMeaning, '')
  assert.equal(resolved[2].candidates.length, 0)
})

const bufferToArrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

test('PDF 导入提取未压缩文本流中的逐行单词', () => {
  const content = 'BT (abandon) Tj T* (achieve) Tj ET'
  const pdf = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n%%EOF`, 'latin1')
  const text = pdfImport.extractWordTextFromPdf(bufferToArrayBuffer(pdf))
  assert.deepEqual(text.split('\n'), ['abandon', 'achieve'])
})

test('PDF 导入支持常见 FlateDecode 压缩文本流', () => {
  const zlib = require('node:zlib')
  const compressed = zlib.deflateSync(Buffer.from('BT (maintain) Tj ET', 'latin1'))
  const prefix = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1')
  const suffix = Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
  const pdf = Buffer.concat([prefix, compressed, suffix])
  assert.equal(pdfImport.extractWordTextFromPdf(bufferToArrayBuffer(pdf)), 'maintain')
})

test('PDF 导入明确拒绝加密文件和无文本扫描件', () => {
  const encrypted = Buffer.from('%PDF-1.4\n<< /Encrypt 2 0 R >>\n%%EOF', 'latin1')
  assert.throws(
    () => pdfImport.extractWordTextFromPdf(bufferToArrayBuffer(encrypted)),
    error => error.code === 'encrypted',
  )
  const imageOnly = Buffer.from('%PDF-1.4\n1 0 obj << /Subtype /Image >> endobj\n%%EOF', 'latin1')
  assert.throws(
    () => pdfImport.extractWordTextFromPdf(bufferToArrayBuffer(imageOnly)),
    error => error.code === 'no_text',
  )
})

test('智能导入支持无空格连接符、连字号英文和多释义合并', () => {
  const parsed = wordImport.parseWordText([
    'apple-苹果',
    'abandon-放弃；抛弃；遗弃',
    'achieve - 实现；达到',
    'maintain:维持；保持',
    'generate：产生|生成',
    'well-being-幸福；福祉',
    'APPLE-苹果；苹果树',
    '无法识别的混合行',
  ].join('\n'))
  assert.equal(parsed.rows.length, 6)
  assert.deepEqual(parsed.rows.find(row => row.english === 'well-being').meanings, ['幸福', '福祉'])
  assert.deepEqual(parsed.rows.find(row => row.english === 'apple').meanings, ['苹果', '苹果树'])
  assert.equal(parsed.duplicateCount, 1)
  assert.equal(parsed.mergedMeaningCount, 1)
  assert.equal(parsed.invalidCount, 1)
  assert.equal(parsed.issues[0].raw, '无法识别的混合行')
})

test('本地词库未收录但已提供释义时直接生成用户词条', () => {
  const [record] = wordImport.resolveImportedWords(wordImport.parseWordText('resiliencetestword-韧性；恢复力').rows)
  assert.equal(record.status, 'manual')
  assert.equal(record.source, 'user_import')
  assert.deepEqual(record.meanings, ['韧性', '恢复力'])
  assert.equal(record.matchMeaning, '韧性')
  assert.equal(record.fullMeaning, '韧性；恢复力')
  assert.equal(record.systemWordId, undefined)
})

test('个人词包按独立键保存并独立累计学习记录', () => {
  const storage = new Map()
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    getStorageInfoSync: () => ({ currentSize: 0, limitSize: 10240, keys: [...storage.keys()] }),
  }
  const imported = wordImport.resolveImportedWords([
    { english: 'achieve', meaning: '' },
    { english: 'maintain', meaning: '维持' },
    { english: 'abandon', meaning: '放弃' },
    { english: 'ability', meaning: '能力' },
    { english: 'accept', meaning: '接受' },
  ])
  const pack = personalPacks.savePersonalWordPack('测试词包', imported)
  assert.equal(personalPacks.listPersonalWordPacks().length, 1)
  assert.ok(storage.has(`wordmatch:v1:personalPack:${pack.id}`))
  const wordId = personalPacks.resolvePersonalPackWords(pack)[0].id
  personalPacks.recordPersonalPackAttempt(pack.id, [wordId], false, 1000)
  const summary = personalPacks.listPersonalWordPacks()[0]
  assert.equal(summary.pairAttempts, 1)
  assert.equal(summary.errorCount, 1)
  assert.equal(summary.practicedWordCount, 1)
  personalPacks.deletePersonalWordPack(pack.id)
  assert.equal(personalPacks.listPersonalWordPacks().length, 0)
})

test('用户导入词在不同词包使用独立稳定 ID，并可直接用于配对和四选一', () => {
  const storage = new Map()
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    getStorageInfoSync: () => ({ currentSize: 0, limitSize: 10240, keys: [...storage.keys()] }),
  }
  const imported = wordImport.resolveImportedWords(wordImport.parseWordText([
    'resiliencetestword-韧性；恢复力',
    'apple-苹果',
    'abandon-放弃',
    'achieve-实现',
    'maintain-保持',
  ].join('\n')).rows)
  const first = personalPacks.savePersonalWordPack('词包一', imported)
  const second = personalPacks.savePersonalWordPack('词包二', imported)
  const firstWords = personalPacks.resolvePersonalPackWords(first)
  const secondWords = personalPacks.resolvePersonalPackWords(second)
  assert.notEqual(firstWords[0].id, secondWords[0].id)
  assert.deepEqual(firstWords[0].displayMeanings, ['韧性', '恢复力'])
  assert.equal(matching.isMatchingPair(
    { slotId: 0, word: firstWords[0], state: 'idle' },
    { slotId: 1, word: firstWords[0], state: 'idle' },
  ), true)
  const question = quiz.generateQuizQuestion(firstWords[0], firstWords, 0, () => 0.4)
  assert.ok(question)
  assert.equal(question.options.filter(option => option.correct).length, 1)

  const updatedRecords = wordImport.resolveImportedWords(wordImport.parseWordText([
    'resiliencetestword-韧性；复原力',
    'apple-苹果',
    'abandon-放弃',
    'achieve-实现',
    'maintain-保持',
  ].join('\n')).rows)
  const updated = personalPacks.savePersonalWordPack('词包一', updatedRecords, first.id)
  assert.equal(personalPacks.resolvePersonalPackWords(updated)[0].id, firstWords[0].id)
})

test('旧版个人词包的系统 ID 和自定义释义仍可直接读取', () => {
  const systemWord = vocabulary.lookupWord('achieve').candidates[0]
  const legacyPack = {
    schemaVersion: 1,
    id: 'legacy-pack',
    name: '旧词包',
    createdAt: 1,
    updatedAt: 1,
    words: [
      { id: systemWord.id, systemWordId: systemWord.id },
      { id: 'personal:legacy', english: 'legacycustomword', matchMeaningOverride: '旧自定义', fullMeaningOverride: '旧自定义；保留释义' },
    ],
    progressByWordId: {},
    pairAttempts: 0,
    correctPairs: 0,
    errorCount: 0,
    lastPracticedAt: 0,
  }
  const storage = new Map([
    ['wordmatch:v1:personalPacks:index', { schemaVersion: 1, packs: [] }],
    ['wordmatch:v1:personalPack:legacy-pack', legacyPack],
  ])
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    getStorageInfoSync: () => ({ currentSize: 0, limitSize: 10240, keys: [...storage.keys()] }),
  }
  const words = personalPacks.resolvePersonalPackWords(personalPacks.getPersonalWordPack('legacy-pack'))
  assert.equal(words[0].id, systemWord.id)
  assert.deepEqual(words[1].displayMeanings, ['旧自定义', '保留释义'])
})

test('查词结果可加入既有词包且不会重复添加', () => {
  const storage = new Map()
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    getStorageInfoSync: () => ({ currentSize: 0, limitSize: 10240, keys: [...storage.keys()] }),
  }
  const wordId = dictionarySearch.searchDictionaryIndex('abandon')[0].id
  const pack = personalPacks.createPersonalWordPackWithSystemWord('查词收藏', wordId)
  assert.equal(personalPacks.addSystemWordToPersonalPack(pack.id, wordId), 'duplicate')
  const secondId = dictionarySearch.searchDictionaryIndex('ability')[0].id
  assert.equal(personalPacks.addSystemWordToPersonalPack(pack.id, secondId), 'added')
  assert.equal(personalPacks.getPersonalWordPack(pack.id).words.length, 2)
})

test('旧 v1 学习记录迁移到稳定 ID，并原样保留旧存储', () => {
  const memory = {
    'wordmatch:v1:profile': {
      schemaVersion: 1,
      wordProgressById: {
        1: { learned: true, practiceCount: 3, errorCount: 1, lastPracticedAt: 1000, correctStreak: 1 },
      },
      learnedWordIds: [1],
      dailyStats: { '2026-10-11': { completedCount: 1, uniqueWordIds: [1] } },
      levelProgress: { 1: 2 },
      sessionHistory: [],
    },
  }
  global.wx = {
    getStorageSync: key => memory[key],
    setStorageSync: (key, value) => { memory[key] = value },
    showToast: () => {},
  }
  const storage = require('../.test-build/services/storage.js')
  const migrated = storage.loadProfile()
  assert.equal(migrated.schemaVersion, 2)
  assert.deepEqual(migrated.learnedWordIds, ['abandon-v'])
  assert.equal(migrated.wordProgressById['abandon-v'].practiceCount, 3)
  assert.equal(memory['wordmatch:v1:profile'].schemaVersion, 1)
  assert.equal(memory['wordmatch:v2:profile'].schemaVersion, 2)
})

test('全局错题按日期归档，连续答对两次退出活跃列表且可单独删除', () => {
  const values = new Map()
  global.wx = {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    showToast: () => {},
  }
  const storage = require('../.test-build/services/storage.js')
  const now = new Date(2026, 9, 11, 12, 0, 0).getTime()
  storage.recordAttempt(['word-a'], false, now, { mode: 'level', collectDailyWrong: true })
  let profile = storage.loadProfile()
  assert.deepEqual(profile.dailyWrongWordIds['2026-10-11'], ['word-a'])
  assert.deepEqual(storage.getActiveWrongWordIds(profile), ['word-a'])

  storage.recordAttempt(['word-a'], true, now + 1000, { mode: 'custom' })
  storage.recordAttempt(['word-a'], true, now + 2000, { mode: 'custom' })
  profile = storage.loadProfile()
  assert.deepEqual(storage.getActiveWrongWordIds(profile), [])
  assert.deepEqual(storage.getDailyWrongWordIds('2026-10-11', profile), ['word-a'])

  storage.deleteWrongWord('word-a')
  profile = storage.loadProfile()
  assert.deepEqual(storage.getDailyWrongWordIds('2026-10-11', profile), [])
  assert.equal(profile.wordProgressById['word-a'].errorCount, 0)
})

test('按日期删除整组错题，并保留同一单词在其他日期的记录', () => {
  const values = new Map()
  global.wx = {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    showToast: () => {},
  }
  const storage = require('../.test-build/services/storage.js')
  const firstDay = new Date(2026, 9, 10, 12, 0, 0).getTime()
  const secondDay = new Date(2026, 9, 11, 12, 0, 0).getTime()
  storage.recordAttempt(['word-a', 'word-b'], false, firstDay, { mode: 'level', collectDailyWrong: true })
  storage.recordAttempt(['word-a'], false, secondDay, { mode: 'endless', collectDailyWrong: true })

  storage.deleteWrongWordsForDate('2026-10-10', ['word-a', 'word-b'])
  const profile = storage.loadProfile()
  assert.deepEqual(storage.getDailyWrongWordIds('2026-10-10', profile), [])
  assert.deepEqual(storage.getDailyWrongWordIds('2026-10-11', profile), ['word-a'])
  assert.equal(profile.wordProgressById['word-a'].errorCount > 0, true)
  assert.equal(profile.wordProgressById['word-b'].errorCount, 0)
})

const createStorageManagerMock = ({ failUnlink = '' } = {}) => {
  const values = new Map([
    ['wordmatch:v2:profile', { schemaVersion: 2, learnedWordIds: ['a'], wordProgressById: { a: { errorCount: 1 } }, dailyStats: {}, levelProgress: { 1: 2 }, sessionHistory: [] }],
    ['wordmatch:v1:dailyStats:2026-10', { schemaVersion: 1, days: { '2026-10-11': { learnedWordIds: ['a'] } } }],
    ['wordmatch:v1:personalPacks:index', { schemaVersion: 1, packs: [{ id: 'mine' }] }],
    ['wordmatch:v1:personalPack:mine', { schemaVersion: 1, id: 'mine', words: [{ english: 'safe', matchMeaningOverride: '安全' }] }],
    ['cache:search:recent', ['hello']],
    ['cache:image:cover', 'wxfile://usr/wordmatch-cache/image/cover.png'],
    ['unknown:must-stay', { user: true }],
  ])
  const directories = new Map([
    ['wxfile://usr', ['wordmatch-cache', 'user-import.txt']],
    ['wxfile://usr/wordmatch-cache', ['image', 'temporary']],
    ['wxfile://usr/wordmatch-cache/image', ['cover.png']],
    ['wxfile://usr/wordmatch-cache/temporary', []],
  ])
  const files = new Map([
    ['wxfile://usr/user-import.txt', 700],
    ['wxfile://usr/wordmatch-cache/image/cover.png', 300],
  ])
  const manager = {
    readdir: ({ dirPath, success, fail }) => {
      if (directories.has(dirPath)) success({ files: directories.get(dirPath), errMsg: 'readdir:ok' })
      else fail({ errMsg: 'readdir:fail no such file' })
    },
    stat: ({ path, success, fail }) => {
      if (directories.has(path)) success({ stats: { size: 0, isDirectory: () => true, isFile: () => false }, errMsg: 'stat:ok' })
      else if (files.has(path)) success({ stats: { size: files.get(path), isDirectory: () => false, isFile: () => true }, errMsg: 'stat:ok' })
      else fail({ errMsg: 'stat:fail no such file' })
    },
    unlink: ({ filePath, success, fail }) => {
      if (filePath === failUnlink) {
        fail({ errMsg: 'unlink:fail permission denied' })
        return
      }
      if (files.delete(filePath)) success({ errMsg: 'unlink:ok' })
      else fail({ errMsg: 'unlink:fail no such file' })
    },
  }
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getStorageSync: key => values.get(key),
    removeStorageSync: key => values.delete(key),
    getStorageInfoSync: () => ({
      currentSize: values.has('cache:search:recent') || values.has('cache:image:cover') ? 8 : 6,
      limitSize: 10240,
      keys: [...values.keys()],
    }),
    getFileSystemManager: () => manager,
  }
  return { values, files }
}

test('存储管理按白名单分类并读取真实 Storage 配额及文件 stat 大小', async () => {
  createStorageManagerMock()
  const overview = await storageManager.getStorageOverview()
  assert.equal(overview.storageCurrentBytes, 8 * 1024)
  assert.equal(overview.storageLimitBytes, 10240 * 1024)
  assert.equal(overview.localFileBytes, 1000)
  assert.equal(overview.categories.find(item => item.id === 'media-cache').sizeBytes >= 300, true)
  assert.equal(overview.categories.find(item => item.id === 'dictionary').note.includes('代码包'), true)
  assert.equal(overview.categories.find(item => item.id === 'protected-other').sizeBytes > 0, true)
})

test('一键清理只删除缓存白名单并保护学习记录、错词进度、个人词包和未知 Key', async () => {
  const { values, files } = createStorageManagerMock()
  const result = await storageManager.clearCache('all')
  assert.equal(result.success, true)
  assert.equal(values.has('cache:search:recent'), false)
  assert.equal(values.has('cache:image:cover'), false)
  assert.equal(files.has('wxfile://usr/wordmatch-cache/image/cover.png'), false)
  assert.equal(values.has('wordmatch:v2:profile'), true)
  assert.equal(values.has('wordmatch:v1:dailyStats:2026-10'), true)
  assert.equal(values.get('wordmatch:v2:profile').wordProgressById.a.errorCount, 1)
  assert.equal(values.has('wordmatch:v1:personalPack:mine'), true)
  assert.equal(values.has('wordmatch:v1:personalPacks:index'), true)
  assert.equal(values.has('unknown:must-stay'), true)
  assert.equal(files.has('wxfile://usr/user-import.txt'), true)
})

test('异常路径被拒绝，文件删除失败时不会误报全部成功', async () => {
  createStorageManagerMock({ failUnlink: 'wxfile://usr/wordmatch-cache/image/cover.png' })
  assert.equal(storageManager.isSafeCachePath('wxfile://usr/wordmatch-cache/image/cover.png'), true)
  assert.equal(storageManager.isSafeCachePath('wxfile://usr/wordmatch-cache/../user-import.txt'), false)
  assert.equal(storageManager.isSafeCachePath('wxfile://usr'), false)
  assert.equal(storageManager.isSafeCachePath('wxfile://usr/wordmatch-cache'), false)
  const result = await storageManager.clearCache('media')
  assert.equal(result.success, false)
  assert.equal(result.failures.some(message => message.includes('删除文件失败')), true)
})

const createDailyStatsMock = () => {
  const values = new Map()
  global.wx = {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    removeStorageSync: key => values.delete(key),
    showToast: () => {},
  }
  return values
}

const localTimestamp = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).getTime()

test('每日统计按稳定词条 ID 去重，重复正确与跨词库命中只算一个词', () => {
  createDailyStatsMock()
  const now = localTimestamp(2026, 10, 11)
  dailyLearning.recordDailyAttempt({ wordIds: ['apple-n'], correct: true, mode: 'endless', previouslyLearnedWordIds: [], now })
  dailyLearning.recordDailyAttempt({ wordIds: ['apple-n'], correct: true, mode: 'level', previouslyLearnedWordIds: ['apple-n'], now })
  const stat = dailyLearning.getDailyLearningStat('2026-10-11')
  assert.deepEqual(stat.learnedWordIds, ['apple-n'])
  assert.deepEqual(stat.newWordIds, ['apple-n'])
  assert.deepEqual(stat.reviewedWordIds, [])
  assert.equal(stat.totalMatches, 2)
  assert.deepEqual(stat.modeCounts, { endless: 1, level: 0, custom: 0 })
})

test('错误后正确计入学习词但首次正确率保持为零', () => {
  createDailyStatsMock()
  const now = localTimestamp(2026, 10, 11)
  dailyLearning.recordDailyAttempt({ wordIds: ['apple-n', 'pear-n'], correct: false, mode: 'custom', previouslyLearnedWordIds: [], now, studySeconds: 8 })
  dailyLearning.recordDailyAttempt({ wordIds: ['apple-n'], correct: true, mode: 'custom', previouslyLearnedWordIds: [], now, studySeconds: 5 })
  const stat = dailyLearning.getDailyLearningStat('2026-10-11')
  assert.deepEqual(stat.learnedWordIds, ['apple-n'])
  assert.equal(stat.firstAttempts, 2)
  assert.equal(stat.correctFirstAttempts, 0)
  assert.equal(stat.studySeconds, 13)
})

test('只有错误没有正确时不计入当天学习词但保留配对与错误首次尝试', () => {
  createDailyStatsMock()
  const now = localTimestamp(2026, 10, 11)
  dailyLearning.recordDailyAttempt({ wordIds: ['a', 'b'], correct: false, mode: 'level', previouslyLearnedWordIds: [], now })
  const stat = dailyLearning.getDailyLearningStat('2026-10-11')
  assert.equal(stat.learnedWordIds.length, 0)
  assert.equal(stat.totalMatches, 1)
  assert.equal(stat.firstAttempts, 2)
})

test('次日再次成功归类为复习词且同日归类不改变', () => {
  createDailyStatsMock()
  dailyLearning.recordDailyAttempt({ wordIds: ['known'], correct: true, mode: 'endless', previouslyLearnedWordIds: [], now: localTimestamp(2026, 10, 10) })
  dailyLearning.recordDailyAttempt({ wordIds: ['known'], correct: true, mode: 'level', previouslyLearnedWordIds: ['known'], now: localTimestamp(2026, 10, 11) })
  dailyLearning.recordDailyAttempt({ wordIds: ['known'], correct: true, mode: 'custom', previouslyLearnedWordIds: ['known'], now: localTimestamp(2026, 10, 11, 13) })
  const stat = dailyLearning.getDailyLearningStat('2026-10-11')
  assert.deepEqual(stat.newWordIds, [])
  assert.deepEqual(stat.reviewedWordIds, ['known'])
  assert.equal(stat.modeCounts.level, 1)
  assert.equal(stat.modeCounts.custom, 0)
})

test('无尽、闯关、自选与个人词条 ID 都能独立统计', () => {
  createDailyStatsMock()
  const now = localTimestamp(2026, 10, 11)
  dailyLearning.recordDailyAttempt({ wordIds: ['endless-word'], correct: true, mode: 'endless', previouslyLearnedWordIds: [], now })
  dailyLearning.recordDailyAttempt({ wordIds: ['level-word'], correct: true, mode: 'level', previouslyLearnedWordIds: [], now })
  dailyLearning.recordDailyAttempt({ wordIds: ['personal:123'], correct: true, mode: 'custom', previouslyLearnedWordIds: [], now })
  const stat = dailyLearning.getDailyLearningStat('2026-10-11')
  assert.equal(stat.learnedWordIds.length, 3)
  assert.deepEqual(stat.modeCounts, { endless: 1, level: 1, custom: 1 })
})

test('7天、30天、90天趋势连续补零且结束于所选日期', () => {
  createDailyStatsMock()
  const end = '2026-10-11'
  ;[7, 30, 90].forEach(days => {
    const range = dailyLearning.getDailyStatsRange(end, days)
    assert.equal(range.length, days)
    assert.equal(range.at(-1).date, end)
    assert.equal(range.every(item => item.learnedWordIds.length === 0), true)
  })
})

test('连续学习天数覆盖今天未学、断档、跨月、跨年与闰年', () => {
  createDailyStatsMock()
  const record = (year, month, day) => dailyLearning.recordDailyAttempt({
    wordIds: [`${year}-${month}-${day}`], correct: true, mode: 'endless', previouslyLearnedWordIds: [], now: localTimestamp(year, month, day),
  })
  record(2023, 12, 31)
  record(2024, 1, 1)
  record(2024, 2, 28)
  record(2024, 2, 29)
  record(2024, 3, 1)
  assert.equal(dailyLearning.getLearningStreak(localTimestamp(2024, 3, 1)), 3)
  assert.equal(dailyLearning.getLearningStreak(localTimestamp(2024, 3, 2)), 3)
  assert.equal(dailyLearning.getLearningStreak(localTimestamp(2024, 3, 3)), 0)
  assert.equal(dailyLearning.addLocalDays('2023-12-31', 1), '2024-01-01')
  assert.equal(dailyLearning.addLocalDays('2024-02-28', 1), '2024-02-29')
})

test('每日数据按月份分 Key 持久化，重读后仍存在且有效时长单次最多计120秒', () => {
  const values = createDailyStatsMock()
  dailyLearning.recordDailyAttempt({ wordIds: ['jan'], correct: true, mode: 'endless', previouslyLearnedWordIds: [], now: localTimestamp(2026, 1, 31), studySeconds: 999 })
  dailyLearning.recordDailyAttempt({ wordIds: ['feb'], correct: true, mode: 'endless', previouslyLearnedWordIds: [], now: localTimestamp(2026, 2, 1), studySeconds: 10 })
  assert.equal(values.has('wordmatch:v1:dailyStats:2026-01'), true)
  assert.equal(values.has('wordmatch:v1:dailyStats:2026-02'), true)
  assert.equal(dailyLearning.getDailyLearningStat('2026-01-31').studySeconds, 120)
  assert.equal(dailyLearning.getDailyLearningStat('2026-02-01').learnedWordIds[0], 'feb')
})

test('本地日期变化后自动归入新日期而不是UTC截取日期', () => {
  createDailyStatsMock()
  const first = localTimestamp(2026, 10, 11, 23)
  const second = localTimestamp(2026, 10, 12, 1)
  dailyLearning.recordDailyAttempt({ wordIds: ['late'], correct: true, mode: 'endless', previouslyLearnedWordIds: [], now: first })
  dailyLearning.recordDailyAttempt({ wordIds: ['early'], correct: true, mode: 'endless', previouslyLearnedWordIds: [], now: second })
  assert.deepEqual(dailyLearning.getDailyLearningStat('2026-10-11').learnedWordIds, ['late'])
  assert.deepEqual(dailyLearning.getDailyLearningStat('2026-10-12').learnedWordIds, ['early'])
})

test('旧每日摘要只迁移可靠日期与去重ID，不伪造新词复习模式时长', () => {
  createDailyStatsMock()
  const profile = {
    schemaVersion: 2,
    wordProgressById: {}, learnedWordIds: ['legacy'], levelProgress: {}, sessionHistory: [],
    dailyStats: { '2025-12-31': { completedCount: 9, uniqueWordIds: ['legacy', 'legacy'] } },
  }
  dailyLearning.ensureLegacyDailyStatsMigrated(profile)
  dailyLearning.ensureLegacyDailyStatsMigrated(profile)
  const stat = dailyLearning.getDailyLearningStat('2025-12-31')
  assert.deepEqual(stat.learnedWordIds, ['legacy'])
  assert.equal(stat.newWordIds.length, 0)
  assert.equal(stat.reviewedWordIds.length, 0)
  assert.equal(stat.studySeconds, 0)
  assert.deepEqual(stat.modeCounts, { endless: 0, level: 0, custom: 0 })
})

test('每日统计 Key 被存储管理识别为学习记录且不会进入缓存清理范围', () => {
  assert.equal(storageManager.classifyStorageKey('wordmatch:v1:dailyStats:index'), 'learning')
  assert.equal(storageManager.classifyStorageKey('wordmatch:v1:dailyStats:2026-10'), 'learning')
})

test('沉浸设置校验音效与独立开关并保护设置 Key', () => {
  const storage = require('../.test-build/services/storage.js')
  assert.deepEqual(storage.normalizeAmbientSettings({
    soundId: 'ocean', focusEnabled: true, feedbackSoundEnabled: false,
  }), {
    soundId: 'ocean', focusEnabled: true, feedbackSoundEnabled: false,
  })
  assert.deepEqual(storage.normalizeAmbientSettings({ soundId: 'unknown' }), {
    soundId: 'off', focusEnabled: false, feedbackSoundEnabled: true,
  })
  assert.equal(storageManager.classifyStorageKey('wordmatch:v2:ambientSettings'), 'settings')
})

test('环境音服务复用单一播放器并在切换、暂停和销毁时清理状态', async () => {
  let created = 0
  let stopped = 0
  const downloaded = []
  const cachedFiles = new Set()
  let interruptionHandler = null
  let removedInterruptionHandler = null
  const context = {
    autoplay: false, loop: false, volume: 1, src: '', paused: true,
    onPlay(callback) { this.playCallback = callback },
    onPause(callback) { this.pauseCallback = callback },
    onStop(callback) { this.stopCallback = callback },
    onError(callback) { this.errorCallback = callback },
    offPlay() {}, offPause() {}, offStop() {}, offError() {},
    play() { this.paused = false; this.playCallback() },
    pause() { this.paused = true; this.pauseCallback() },
    stop() { this.paused = true; stopped += 1; this.stopCallback() },
    destroy() { this.destroyed = true },
  }
  global.wx = {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      accessSync(path) {
        if (!cachedFiles.has(path)) throw new Error('not found')
      },
      mkdirSync() {},
      unlinkSync(path) { cachedFiles.delete(path) },
    }),
    downloadFile: options => {
      downloaded.push(options.url)
      cachedFiles.add(options.filePath)
      options.success({ statusCode: 200, filePath: options.filePath, tempFilePath: '', errMsg: 'downloadFile:ok' })
      return {}
    },
    createInnerAudioContext: () => { created += 1; return context },
    onAudioInterruptionBegin: callback => { interruptionHandler = callback },
    offAudioInterruptionBegin: callback => { removedInterruptionHandler = callback },
  }
  const { ambientAudioService } = require('../.test-build/services/ambient-audio-service.js')
  assert.equal(await ambientAudioService.play('rain'), true)
  assert.equal(await ambientAudioService.play('ocean'), true)
  assert.equal(created, 1)
  assert.equal(downloaded.length, 2)
  assert.equal(context.loop, true)
  assert.equal(context.src, '/user-data/wordmatch-cache/audio/ambient-v1/ocean.mp3')
  assert.equal(context.volume, 1)
  assert.equal(stopped >= 1, true)
  interruptionHandler()
  assert.equal(ambientAudioService.getState().playing, false)
  ambientAudioService.destroy()
  assert.equal(context.destroyed, true)
  assert.equal(removedInterruptionHandler, interruptionHandler)
})
