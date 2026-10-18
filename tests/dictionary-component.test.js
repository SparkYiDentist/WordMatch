const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 小程序运行时桩：组件依赖的全局 wx API
const storage = new Map()
global.wx = {
  getMenuButtonBoundingClientRect: () => ({ bottom: 0 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showToast() {},
  showModal() {},
  hideKeyboard() {},
  getStorageSync: key => (storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : ''),
  setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
  removeStorageSync: key => storage.delete(key),
}

// 捕获组件注册时的定义
let componentDefinition = null
global.Component = definition => { componentDefinition = definition }

require('../.test-build/components/global-dictionary/global-dictionary.js')

const createInstance = () => {
  const events = {}
  const instance = {
    data: JSON.parse(JSON.stringify(componentDefinition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (typeof callback === 'function') callback()
    },
    triggerEvent(name, detail) {
      if (!events[name]) events[name] = []
      events[name].push(detail)
    },
  }
  Object.entries(componentDefinition.methods).forEach(([name, fn]) => {
    instance[name] = fn.bind(instance)
  })
  instance._events = events
  return instance
}

test('词典使用从右侧进入的原生全屏容器，侧滑返回不会穿透到底层页面', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'components', 'global-dictionary', 'global-dictionary.wxml'),
    'utf8',
  )
  assert.match(wxml, /<page-container/)
  assert.match(wxml, /show="\{\{visible\}\}"/)
  assert.match(wxml, /position="right"/)
  assert.match(wxml, /custom-style="[^"]*width: 100vw;[^"]*height: 100vh;/)
  assert.match(wxml, /bind:leave="onContainerLeave"/)
  assert.doesNotMatch(wxml, /position="full"/)
  assert.match(wxml, /class="dictionary-overlay"/)
  assert.match(wxml, /class="header-back" bindtap="goBack"/)
  assert.match(wxml, /<view class="dictionary-searchbar">\s*<button class="header-back"/)
  assert.doesNotMatch(wxml, /header-back__label/)
})

test('组件同时处理按钮返回和原生容器侧滑返回', () => {
  assert.equal(typeof componentDefinition.methods.goBack, 'function')
  assert.equal(typeof componentDefinition.methods.onContainerLeave, 'function')
})

test('顶部控件使用设备状态栏高度并额外下移', () => {
  const inst = createInstance()
  componentDefinition.lifetimes.attached.call(inst)
  assert.equal(inst.data.topInset, 30)
})

test('在搜索结果层按返回：只关闭词典弹层、清空输入并通知页面，页面不退出', () => {
  const inst = createInstance()
  inst.setData({ visible: true, query: 'abandon', results: [{}], focusInput: true })
  inst.goBack()
  assert.equal(inst.data.visible, false)
  assert.equal(inst.data.query, '')
  assert.deepEqual(inst.data.results, [])
  assert.equal(inst.data.packSheetVisible, false)
  assert.equal(inst.data.selectedEntry, null)
  assert.equal(inst._events.close.length, 1)
})

test('在词条详情层按返回：只退回搜索结果，弹层保持打开且不通知页面关闭', () => {
  const inst = createInstance()
  const entry = { id: 'abandon-v', headword: 'abandon' }
  inst.setData({ visible: true, query: 'abandon', results: [{}], selectedEntry: entry })
  inst.goBack()
  assert.equal(inst.data.selectedEntry, null)
  assert.equal(inst.data.visible, true)
  assert.equal(inst._events.close, undefined)
})

test('在加入词包弹层按返回：只关闭弹层，仍停留在词条详情', () => {
  const inst = createInstance()
  const entry = { id: 'abandon-v', headword: 'abandon' }
  inst.setData({ visible: true, selectedEntry: entry, packSheetVisible: true, packs: [{}] })
  inst.goBack()
  assert.equal(inst.data.packSheetVisible, false)
  assert.equal(inst.data.selectedEntry, entry)
  assert.equal(inst.data.visible, true)
  assert.equal(inst._events.close, undefined)
})

test('连续两次返回：详情先退到结果，再退才关闭弹层', () => {
  const inst = createInstance()
  inst.setData({ visible: true, query: 'abandon', results: [{}], selectedEntry: { headword: 'abandon' } })
  inst.goBack()
  assert.equal(inst.data.selectedEntry, null)
  assert.equal(inst.data.visible, true)
  inst.goBack()
  assert.equal(inst.data.visible, false)
  assert.equal(inst._events.close.length, 1)
})

test('系统侧滑返回：直接关闭词典并通知原页面恢复，不退出底层页面', () => {
  const inst = createInstance()
  inst.setData({
    visible: true,
    query: 'abandon',
    results: [{}],
    selectedEntry: { headword: 'abandon' },
    packSheetVisible: true,
  })
  inst.onContainerLeave()
  assert.equal(inst.data.visible, false)
  assert.equal(inst.data.query, '')
  assert.deepEqual(inst.data.results, [])
  assert.equal(inst.data.selectedEntry, null)
  assert.equal(inst.data.packSheetVisible, false)
  assert.equal(inst._events.close.length, 1)
})

test('按钮关闭后产生的容器 leave 事件不会重复通知原页面', () => {
  const inst = createInstance()
  inst.setData({ visible: true })
  inst.goBack()
  inst.onContainerLeave()
  assert.equal(inst._events.close.length, 1)
})

test('关闭后再次打开：visible 从 false 正常变为 true，弹层可重新弹出', () => {
  const inst = createInstance()
  inst.open()
  assert.equal(inst.data.visible, true)
  inst.goBack()
  assert.equal(inst.data.visible, false)
  inst.open()
  assert.equal(inst.data.visible, true)
})
