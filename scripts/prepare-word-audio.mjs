import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const readArgument = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : ''
}

const projectRoot = process.cwd()
const sourceArgument = readArgument('--source')
const sourceRoot = path.resolve(projectRoot, sourceArgument || '')
const outputRoot = path.resolve(projectRoot, readArgument('--output') || 'source-assets/word-audio')
const audioSource = path.join(sourceRoot, 'Audio')
const licenseSource = path.join(sourceRoot, 'LICENSE')

if (!sourceArgument) throw new Error('缺少 --source，请指定克隆后的 WordAudio 仓库目录')

try {
  const existing = await readdir(outputRoot)
  if (existing.length) throw new Error(`输出目录已存在且非空，为保护现有文件已停止：${outputRoot}`)
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
}

const require = createRequire(import.meta.url)
const compiledVocabularyPath = path.join(projectRoot, '.test-build', 'data', 'vocabulary', 'vocabulary-data.js')
const { VOCABULARY_DATA } = require(compiledVocabularyPath)
const normalizeWord = value => String(value).trim().toLocaleLowerCase('en-US')
const vocabularyWords = [...new Set(VOCABULARY_DATA.map(tuple => normalizeWord(tuple[1])).filter(Boolean))].sort()

const sourceFiles = (await readdir(audioSource, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.toLocaleLowerCase('en-US').endsWith('.mp3'))
const sourceByWord = new Map()
for (const entry of sourceFiles) {
  const word = normalizeWord(entry.name.slice(0, -4))
  if (word && !sourceByWord.has(word)) sourceByWord.set(word, entry.name)
}

const matched = vocabularyWords.filter(word => sourceByWord.has(word))
const missing = vocabularyWords.filter(word => !sourceByWord.has(word))
const audioOutput = path.join(outputRoot, 'audio')
await mkdir(audioOutput, { recursive: true })

const files = {}
let totalBytes = 0
for (const word of matched) {
  const sourceName = sourceByWord.get(word)
  const targetName = `${word.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')}.mp3`
  if (!targetName || targetName === '.mp3') continue
  const sourcePath = path.join(audioSource, sourceName)
  const targetPath = path.join(audioOutput, targetName)
  await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL)
  totalBytes += (await stat(targetPath)).size
  files[word] = `audio/${targetName}`
}

const manifest = {
  schemaVersion: 1,
  source: {
    repository: 'https://github.com/mrcraked/WordAudio',
    license: 'MIT',
    generator: 'gTTS (as documented by the upstream repository)',
  },
  vocabularyWords: vocabularyWords.length,
  matchedWords: Object.keys(files).length,
  missingWords: missing.length,
  coveragePercent: Number((Object.keys(files).length / vocabularyWords.length * 100).toFixed(2)),
  totalAudioBytes: totalBytes,
  files,
}

const readme = `# WordMatch 单词语音包\n\n`
  + `本目录由 \`npm run audio:prepare\` 从 [mrcraked/WordAudio](https://github.com/mrcraked/WordAudio) 精确筛选生成。\n\n`
  + `- 当前词库英文词形：${vocabularyWords.length}\n`
  + `- 已匹配语音：${manifest.matchedWords}\n`
  + `- 覆盖率：${manifest.coveragePercent}%\n`
  + `- MP3 总大小：${(totalBytes / 1024 / 1024).toFixed(2)} MiB\n\n`
  + `该目录位于 \`miniprogram\` 之外，不进入微信小程序代码包。部署时应将目录原样上传到 HTTPS 静态存储；运行时使用 \`manifest.json\` 中的相对路径。未匹配词见 \`missing-words.txt\`，不得在界面中虚假显示为已有发音。\n`

await Promise.all([
  copyFile(licenseSource, path.join(outputRoot, 'LICENSE'), constants.COPYFILE_EXCL),
  writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
  writeFile(path.join(outputRoot, 'missing-words.txt'), `${missing.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' }),
  writeFile(path.join(outputRoot, 'README.md'), readme, { encoding: 'utf8', flag: 'wx' }),
])

console.log(JSON.stringify({
  vocabularyWords: vocabularyWords.length,
  sourceAudioFiles: sourceFiles.length,
  matchedWords: manifest.matchedWords,
  missingWords: manifest.missingWords,
  coveragePercent: manifest.coveragePercent,
  totalAudioBytes: manifest.totalAudioBytes,
  outputRoot,
}, null, 2))
