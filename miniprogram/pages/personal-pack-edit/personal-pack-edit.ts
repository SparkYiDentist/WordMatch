import { getWordById, lookupWord } from '../../services/vocabulary-service'
import { openDictionaryOverlay } from '../../utils/dictionary-overlay'
import { extractWordTextFromPdf } from '../../services/pdf-import'
import {
  getPersonalWordPack,
  hasMeaningConflicts,
  savePersonalWordPack,
} from '../../services/personal-word-pack'
import {
  ImportIssue,
  ImportedWordRecord,
  ImportStatus,
  parseMeanings,
  parseWordText,
  resolveImportedWords,
} from '../../services/word-import'

type ImportMethod = 'paste' | 'file' | 'manual'

interface RecordView extends ImportedWordRecord {
  recordIndex: number
  statusLabel: string
  statusClass: string
}

interface EditPageData {
  packId: string
  name: string
  method: ImportMethod
  pasteText: string
  pastePlaceholder: string
  manualEnglish: string
  manualMeaning: string
  manualFullMeaning: string
  manualCandidates: RecordView['candidates']
  manualSystemWordId: string
  manualLookupText: string
  processing: boolean
  saving: boolean
  processedText: string
  duplicateCount: number
  mergedMeaningCount: number
  invalidCount: number
  issueText: string
  addedCount: number
  existingCount: number
  totalCount: number
  matchedCount: number
  notFoundCount: number
  validCount: number
  reviewCount: number
  visibleRecords: RecordView[]
  visibleCount: number
  hasMore: boolean
}

const PAGE_SIZE = 80
const MAX_FILE_SIZE = 1024 * 1024
const MAX_PDF_FILE_SIZE = 5 * 1024 * 1024
let records: ImportedWordRecord[] = []
let issues: ImportIssue[] = []

const statusMeta: Record<ImportStatus, { label: string; className: string }> = {
  matched: { label: '已匹配', className: 'status--matched' },
  not_found: { label: '未找到', className: 'status--not-found' },
  manual: { label: '用户释义', className: 'status--manual' },
}

const mergeRecord = (target: ImportedWordRecord, incoming: ImportedWordRecord): number => {
  const incomingMeanings = incoming.meanings || parseMeanings(incoming.fullMeaning || incoming.matchMeaning)
  const previousMeanings = target.meanings || parseMeanings(target.fullMeaning || target.matchMeaning)
  const merged = incoming.source === 'user_import' && target.source === 'dictionary'
    ? [...incomingMeanings]
    : [...previousMeanings]
  const seen = new Set(merged)
  let added = 0
  incomingMeanings.forEach(meaning => {
    if (!seen.has(meaning)) { merged.push(meaning); seen.add(meaning); added += 1 }
  })
  target.meanings = merged
  target.fullMeaning = merged.join('；') || target.fullMeaning
  target.systemWordId = target.systemWordId || incoming.systemWordId
  if (incoming.source !== 'dictionary') {
    target.matchMeaning = incoming.matchMeaning
    target.source = incoming.source
    target.status = 'manual'
  }
  target.candidates = target.candidates.length ? target.candidates : incoming.candidates
  return added
}

const toView = (record: ImportedWordRecord, recordIndex: number): RecordView => ({
  ...record,
  recordIndex,
  statusLabel: statusMeta[record.status].label,
  statusClass: statusMeta[record.status].className,
})

Page<EditPageData, {
  refreshRecords(visibleCount: number): void
  selectMethod(event: WechatMiniprogram.TouchEvent): void
  inputName(event: WechatMiniprogram.Input): void
  inputPaste(event: WechatMiniprogram.Input): void
  inputIssueText(event: WechatMiniprogram.Input): void
  retryIssues(): void
  processText(text: string): void
  lookupPasted(): void
  chooseFile(): void
  inputManualEnglish(event: WechatMiniprogram.Input): void
  inputManualMeaning(event: WechatMiniprogram.Input): void
  inputManualFullMeaning(event: WechatMiniprogram.Input): void
  lookupManual(): void
  addManual(): void
  editEnglish(event: WechatMiniprogram.Input): void
  editMeaning(event: WechatMiniprogram.Input): void
  editFullMeaning(event: WechatMiniprogram.Input): void
  removeRecord(event: WechatMiniprogram.TouchEvent): void
  loadMore(): void
  savePack(): void
  openDictionary(): void
  onPullDownRefresh(): void
}>({
  data: {
    packId: '', name: '', method: 'paste', pasteText: '',
    pastePlaceholder: 'abandon\nachieve - 实现；达到\nwell-being - 幸福；福祉',
    manualEnglish: '', manualMeaning: '',
    manualFullMeaning: '', manualCandidates: [], manualSystemWordId: '', manualLookupText: '', processing: false, saving: false,
    processedText: '', duplicateCount: 0, mergedMeaningCount: 0, invalidCount: 0, issueText: '', addedCount: 0, existingCount: 0, totalCount: 0, matchedCount: 0,
    notFoundCount: 0, validCount: 0, reviewCount: 0,
    visibleRecords: [], visibleCount: PAGE_SIZE, hasMore: false,
  },
  onLoad(query) {
    records = []
    issues = []
    const packId = query.packId || ''
    if (packId) {
      const pack = getPersonalWordPack(packId)
      if (pack) {
        records = pack.words.map(entry => {
          const system = entry.systemWordId ? getWordById(entry.systemWordId) : undefined
          const english = entry.english || (system && system.english) || ''
          const matchMeaning = entry.matchMeaning || entry.matchMeaningOverride || (system && system.matchMeaning) || ''
          const fullMeaning = entry.fullMeaning || entry.fullMeaningOverride || (system && system.fullMeaning) || matchMeaning
          const meanings = entry.meanings?.length ? entry.meanings : parseMeanings(fullMeaning || matchMeaning)
          const lookup = lookupWord(english)
          return {
            english, meanings, matchMeaning, fullMeaning, systemWordId: entry.systemWordId || entry.originalDictionaryId,
            status: entry.source && entry.source !== 'dictionary' ? 'manual' as const : 'matched' as const,
            source: entry.source || (entry.matchMeaningOverride ? 'manual' as const : 'dictionary' as const),
            candidates: lookup.candidates.map(word => ({
              id: word.id, matchMeaning: word.matchMeaning, fullMeaning: word.fullMeaning,
              partOfSpeech: word.partOfSpeech || '',
            })),
          }
        })
        this.setData({ packId, name: pack.name })
        wx.setNavigationBarTitle({ title: '编辑词包' })
      }
    }
    this.refreshRecords(PAGE_SIZE)
  },
  onShareAppMessage() {
    return {
      title: 'Pan的英语｜单词配对闯关，边玩边背单词',
      path: '/pages/index/index',
    }
  },
  refreshRecords(visibleCount) {
    const matchedCount = records.filter(record => record.status === 'matched').length
    const notFoundCount = records.filter(record => record.status === 'not_found').length
    const validCount = records.filter(record => record.matchMeaning.trim()).length
    const reviewRecords = records
      .map(toView)
      .filter(record => record.status === 'not_found' || record.source !== 'dictionary')
    this.setData({
      totalCount: records.length, matchedCount, notFoundCount, validCount, reviewCount: reviewRecords.length,
      visibleCount,
      visibleRecords: reviewRecords,
      hasMore: false,
    })
  },
  selectMethod(event) { this.setData({ method: String(event.currentTarget.dataset.value) as ImportMethod }) },
  inputName(event) { this.setData({ name: event.detail.value }) },
  inputPaste(event) { this.setData({ pasteText: event.detail.value }) },
  inputIssueText(event) { this.setData({ issueText: event.detail.value }) },
  retryIssues() {
    const text = this.data.issueText.trim()
    if (!text) return
    issues = []
    this.setData({ issueText: '', invalidCount: 0 })
    this.processText(text)
  },
  processText(text) {
    if (!text.trim()) {
      wx.showToast({ title: '请先输入或选择文件', icon: 'none' })
      return
    }
    this.setData({ processing: true, processedText: '正在解析并检索本地词库…' })
    setTimeout(() => {
      const parsed = parseWordText(text)
      const imported = resolveImportedWords(parsed.rows)
      const existing = new Map(records.map(record => [record.english.toLocaleLowerCase(), record]))
      let crossDuplicateCount = 0
      let crossMergedMeaningCount = 0
      let addedCount = 0
      imported.forEach(record => {
        const key = record.english.toLocaleLowerCase()
        const current = existing.get(key)
        if (current) {
          crossDuplicateCount += 1
          crossMergedMeaningCount += mergeRecord(current, record)
        }
        else {
          existing.set(key, record)
          records.push(record)
          addedCount += 1
        }
      })
      issues = [...issues, ...parsed.issues]
      const issueText = issues.map(issue => issue.raw).join('\n')
      this.setData({
        processing: false,
        duplicateCount: this.data.duplicateCount + parsed.duplicateCount + crossDuplicateCount,
        mergedMeaningCount: this.data.mergedMeaningCount + parsed.mergedMeaningCount + crossMergedMeaningCount,
        invalidCount: issues.length,
        issueText,
        addedCount: this.data.addedCount + addedCount,
        existingCount: this.data.existingCount + crossDuplicateCount,
        processedText: parsed.truncated ? '已处理前 1000 条，请分批导入其余内容' : `已识别 ${imported.length} 个单词，可直接导入并保存`,
      })
      this.refreshRecords(Math.max(PAGE_SIZE, this.data.visibleCount))
    }, 20)
  },
  lookupPasted() { this.processText(this.data.pasteText) },
  chooseFile() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['txt', 'csv', 'pdf'],
      success: result => {
        const file = result.tempFiles[0]
        const extensionPart = file.name.split('.').pop()
        const extension = extensionPart ? extensionPart.toLocaleLowerCase() : ''
        if (extension !== 'txt' && extension !== 'csv' && extension !== 'pdf') {
          wx.showModal({ title: '不支持的文件', content: '请选择 TXT、CSV 或文本型 PDF 文件。', showCancel: false })
          return
        }
        const sizeLimit = extension === 'pdf' ? MAX_PDF_FILE_SIZE : MAX_FILE_SIZE
        if (file.size > sizeLimit) {
          wx.showModal({
            title: '文件过大',
            content: extension === 'pdf'
              ? '请选择不超过 5 MB 的文本型 PDF，单次最多导入 1000 条。'
              : '请选择不超过 1 MB 的文本文件，单次最多导入 1000 条。',
            showCancel: false,
          })
          return
        }
        const manager = wx.getFileSystemManager()
        if (extension === 'pdf') {
          this.setData({ processing: true, processedText: `正在读取 ${file.name}…` })
          manager.readFile({
            filePath: file.path,
            success: readResult => {
              setTimeout(() => {
                try {
                  if (typeof readResult.data === 'string') throw new Error('PDF 文件读取格式异常。')
                  const text = extractWordTextFromPdf(readResult.data)
                  this.setData({ processedText: `已提取 ${file.name} 中的文字` })
                  this.processText(text)
                } catch (error) {
                  this.setData({ processing: false, processedText: '' })
                  wx.showModal({
                    title: 'PDF 导入失败',
                    content: error instanceof Error ? error.message : '无法读取该 PDF，请改用 TXT 或 CSV。',
                    showCancel: false,
                  })
                }
              }, 20)
            },
            fail: () => {
              this.setData({ processing: false, processedText: '' })
              wx.showToast({ title: 'PDF 文件读取失败', icon: 'none' })
            },
          })
          return
        }
        manager.readFile({
          filePath: file.path, encoding: 'utf8',
          success: readResult => {
            const text = String(readResult.data)
            if (text.includes('\uFFFD') || text.includes('\u0000')) {
              wx.showModal({ title: '无法识别编码', content: '请将文件另存为 UTF-8 编码后重试。暂不支持 UTF-16、GBK 等编码。', showCancel: false })
              return
            }
            this.setData({ processedText: `已读取 ${file.name}` })
            this.processText(text)
          },
          fail: () => wx.showToast({ title: '文件读取失败', icon: 'none' }),
        })
      },
      fail: error => {
        if (!String(error.errMsg).includes('cancel')) wx.showToast({ title: '文件选择失败', icon: 'none' })
      },
    })
  },
  inputManualEnglish(event) {
    this.setData({ manualEnglish: event.detail.value, manualCandidates: [], manualSystemWordId: '', manualLookupText: '' })
  },
  inputManualMeaning(event) { this.setData({ manualMeaning: event.detail.value }) },
  inputManualFullMeaning(event) { this.setData({ manualFullMeaning: event.detail.value }) },
  lookupManual() {
    const english = this.data.manualEnglish.trim()
    if (!english) { wx.showToast({ title: '请输入英文', icon: 'none' }); return }
    const result = lookupWord(english)
    if (!result.found) {
      this.setData({
        manualCandidates: [], manualSystemWordId: '',
        manualLookupText: '本地词库未找到，请在下方手动填写中文释义。',
      })
      wx.showToast({ title: '本地词库未找到，请手动填写', icon: 'none' })
      return
    }
    const candidates = result.candidates.map(word => ({
      id: word.id, matchMeaning: word.matchMeaning, fullMeaning: word.fullMeaning,
      partOfSpeech: word.partOfSpeech || '',
    }))
    const candidate = candidates[0]
    this.setData({
      manualCandidates: candidates,
      manualMeaning: candidate.matchMeaning,
      manualFullMeaning: candidate.fullMeaning,
      manualSystemWordId: candidate.id,
      manualLookupText: '已自动识别并填入本地词库释义。',
    })
  },
  addManual() {
    const english = this.data.manualEnglish.trim()
    const meanings = parseMeanings(this.data.manualMeaning)
    const matchMeaning = meanings[0] || ''
    if (!english || !matchMeaning) { wx.showToast({ title: '请填写英文和中文释义', icon: 'none' }); return }
    if (records.some(record => record.english.toLocaleLowerCase() === english.toLocaleLowerCase())) {
      wx.showToast({ title: '该英文已在词包中', icon: 'none' }); return
    }
    records.push({
      english, meanings, matchMeaning, fullMeaning: this.data.manualFullMeaning.trim() || meanings.join('；'),
      systemWordId: this.data.manualSystemWordId || undefined, status: 'manual', source: 'manual',
      candidates: this.data.manualCandidates,
    })
    this.setData({
      manualEnglish: '', manualMeaning: '', manualFullMeaning: '', manualCandidates: [],
      manualSystemWordId: '', manualLookupText: '',
    })
    this.refreshRecords(this.data.visibleCount)
  },
  editEnglish(event) {
    const index = Number(event.currentTarget.dataset.index)
    const english = event.detail.value
    const lookup = lookupWord(english)
    const candidates = lookup.candidates.map(word => ({
      id: word.id, matchMeaning: word.matchMeaning, fullMeaning: word.fullMeaning,
      partOfSpeech: word.partOfSpeech || '',
    }))
    const first = lookup.candidates[0]
    const current = records[index]
    const hasUserMeaning = Boolean(current.matchMeaning.trim()) && current.source !== 'dictionary'
    records[index] = first ? {
      ...current,
      english,
      systemWordId: first.id,
      meanings: hasUserMeaning ? current.meanings : (first.matchMeanings?.length ? first.matchMeanings : [first.matchMeaning]),
      matchMeaning: hasUserMeaning ? current.matchMeaning : first.matchMeaning,
      fullMeaning: hasUserMeaning ? current.fullMeaning : first.fullMeaning,
      status: hasUserMeaning ? 'manual' : 'matched',
      source: hasUserMeaning ? current.source : 'dictionary',
      candidates,
    } : {
      ...current, english, systemWordId: undefined,
      meanings: hasUserMeaning ? current.meanings : [],
      matchMeaning: hasUserMeaning ? current.matchMeaning : '',
      fullMeaning: hasUserMeaning ? current.fullMeaning : '',
      status: hasUserMeaning ? 'manual' : 'not_found', source: hasUserMeaning ? current.source : 'dictionary', candidates,
    }
    this.refreshRecords(this.data.visibleCount)
  },
  editMeaning(event) {
    const index = Number(event.currentTarget.dataset.index)
    const meanings = parseMeanings(event.detail.value)
    const meaning = meanings[0] || ''
    records[index] = {
      ...records[index], meanings, matchMeaning: meaning, fullMeaning: meanings.join('；'),
      status: meaning ? 'manual' : 'not_found', source: meaning ? 'manual' : 'dictionary',
    }
    this.refreshRecords(this.data.visibleCount)
  },
  editFullMeaning(event) {
    const index = Number(event.currentTarget.dataset.index)
    const meanings = parseMeanings(event.detail.value)
    records[index] = {
      ...records[index], meanings: meanings.length ? meanings : records[index].meanings,
      fullMeaning: meanings.join('；') || event.detail.value.trim(), status: 'manual', source: 'manual',
    }
    this.refreshRecords(this.data.visibleCount)
  },
  removeRecord(event) {
    records.splice(Number(event.currentTarget.dataset.index), 1)
    this.refreshRecords(this.data.visibleCount)
  },
  loadMore() { this.refreshRecords(this.data.visibleCount + PAGE_SIZE) },
  savePack() {
    if (this.data.saving) return
    const validRecords = records.filter(record => record.matchMeaning.trim())
    if (!this.data.name.trim()) { wx.showToast({ title: '请输入词包名称', icon: 'none' }); return }
    if (!validRecords.length) { wx.showToast({ title: '没有可保存的有效单词', icon: 'none' }); return }
    const commit = (): void => {
      this.setData({ saving: true })
      try {
        const pack = savePersonalWordPack(this.data.name, validRecords, this.data.packId || undefined)
        const importedCount = this.data.addedCount || validRecords.length
        wx.showModal({
          title: '导入完成',
          content: `成功导入 ${importedCount} 个单词，已添加到当前词包。`,
          showCancel: false,
          success: () => wx.redirectTo({ url: `/pages/personal-pack-detail/personal-pack-detail?packId=${pack.id}` }),
        })
      } catch (error) {
        this.setData({ saving: false })
        wx.showModal({ title: '保存失败', content: error instanceof Error ? error.message : '本地空间不足或存储异常，请清理空间后重试。', showCancel: false })
      }
    }
    if (hasMeaningConflicts(validRecords)) {
      wx.showModal({
        title: '发现相近释义',
        content: '部分词条的中文释义相同或明显包含，游戏会尽量避免同屏出现。建议返回核对，或确认继续保存。',
        confirmText: '继续保存', success: result => { if (result.confirm) commit() },
      })
      return
    }
    commit()
  },

  openDictionary() { openDictionaryOverlay(this) },
  onPullDownRefresh() { openDictionaryOverlay(this, true) },
})
