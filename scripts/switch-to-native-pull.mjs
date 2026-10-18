/**
 * 一次性迁移脚本：把页面根 scroll-view 换成普通 view，改用小程序原生下拉刷新。
 *
 * 背景：scroll-view 会拦截页面级下拉手势，而 refresher 只在内容溢出时才响应，
 * 两条路在内容不满屏的页面上都失效。改成 enablePullDownRefresh + onPullDownRefresh
 * 后由系统接管手势，与内容高度无关。
 *
 * 用法：node scripts/switch-to-native-pull.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGES = 'C:/Users/D/Desktop/Memory/单词配对/miniprogram/pages'

const targets = [
  { dir: 'index', cls: 'home', open: '<view class="home">' },
  { dir: 'custom', cls: 'custom-page', open: '<view class="custom-page">' },
  { dir: 'levels', cls: 'levels-page', open: '<view class="levels-page">' },
  { dir: 'vocabulary', cls: 'vocabulary-page', open: '<view class="vocabulary-page">' },
  { dir: 'settings', cls: 'settings-page', open: '<view class="settings-page">' },
  { dir: 'personal-packs', cls: 'packs-page', open: '<view class="packs-page">' },
  {
    dir: 'personal-pack-detail',
    cls: 'detail-page',
    open: '<view wx:if="{{pack}}" class="detail-page">',
  },
  { dir: 'storage-manager', cls: 'storage-page', open: '<view class="storage-page">' },
  { dir: 'learning-stats', cls: 'stats-page', open: '<view class="stats-page">' },
  { dir: 'personal-pack-edit', cls: 'edit-page', open: '<view class="edit-page">' },
  {
    dir: 'word-quiz',
    cls: 'quiz-scroll',
    open: '<view wx:if="{{phase !== \'completed\'}}" class="quiz-scroll">',
    minHeight: 'min-height: calc(100vh - 240rpx)',
  },
]

const PULL_METHODS = ['handlePullScroll', 'handlePullStart', 'handlePullMove', 'handlePullEnd']

const report = []

for (const target of targets) {
  const base = join(PAGES, target.dir, target.dir)

  // ---- wxml ----
  const wxmlPath = `${base}.wxml`
  let wxml = readFileSync(wxmlPath, 'utf8')
  const openTag = /<scroll-view\b[^>]*>/
  if (!openTag.test(wxml)) throw new Error(`${target.dir}: 找不到 scroll-view 开标签`)
  wxml = wxml.replace(openTag, target.open)
  const closeIdx = wxml.lastIndexOf('</scroll-view>')
  if (closeIdx < 0) throw new Error(`${target.dir}: 找不到 scroll-view 闭标签`)
  wxml = `${wxml.slice(0, closeIdx)}</view>${wxml.slice(closeIdx + '</scroll-view>'.length)}`
  writeFileSync(wxmlPath, wxml)

  // ---- wxss ----
  const wxssPath = `${base}.wxss`
  let wxss = readFileSync(wxssPath, 'utf8')
  const rule = new RegExp(`\\.${target.cls}\\s*\\{([^}]*)\\}`)
  if (!rule.test(wxss)) throw new Error(`${target.dir}: 找不到 .${target.cls} 规则`)
  wxss = wxss.replace(rule, (_match, body) => {
    const next = target.minHeight
      ? body.replace(/height:\s*[^;]+;?/, target.minHeight)
      : body.replace(/height:\s*100vh/, 'min-height: calc(100vh + 4rpx)')
    return `.${target.cls} {${next}}`
  })
  writeFileSync(wxssPath, wxss)

  // ---- json ----
  const jsonPath = `${base}.json`
  const config = JSON.parse(readFileSync(jsonPath, 'utf8'))
  config.enablePullDownRefresh = true
  config.backgroundTextStyle = 'dark'
  writeFileSync(jsonPath, `${JSON.stringify(config, null, 2)}\n`)

  // ---- ts ----
  const tsPath = `${base}.ts`
  let ts = readFileSync(tsPath, 'utf8')
  ts = ts.split('openDictionaryFromPull').join('onPullDownRefresh')
  // 先删方法签名 interface 里的声明（整行，以 `: void` 结尾）
  for (const name of PULL_METHODS) {
    ts = ts.replace(new RegExp(`^  ${name}\\(.*\\): void\\n`, 'gm'), '')
  }
  // 再删实现块（到本块的 `  },` 为止）
  for (const name of PULL_METHODS) {
    ts = ts.replace(new RegExp(`\\n  ${name}\\([\\s\\S]*?\\n  \\},`, 'g'), '')
  }
  // 注意用 [^}]*：否则会从文件第一个 `import {` 一路吞到本条 import，把上面的导入全删掉
  ts = ts.replace(
    /import\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/utils\/pull-to-search'\n/g,
    '',
  )
  writeFileSync(tsPath, ts)

  report.push(`${target.dir}: ok`)
}

console.log(report.join('\n'))
