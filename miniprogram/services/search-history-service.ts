const HISTORY_KEY = 'cache:search:wordmatch:v1:dictionarySearchHistory'
const MAX_HISTORY = 20

const clean = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, MAX_HISTORY)
  : []

export const getSearchHistory = (): string[] => {
  try {
    return clean(wx.getStorageSync(HISTORY_KEY))
  } catch (_error) {
    return []
  }
}

export const addSearchHistory = (query: string): string[] => {
  const value = query.trim()
  if (!value) return getSearchHistory()
  const history = [value, ...getSearchHistory().filter(item => item.toLocaleLowerCase() !== value.toLocaleLowerCase())]
    .slice(0, MAX_HISTORY)
  try {
    wx.setStorageSync(HISTORY_KEY, history)
  } catch (_error) {
    // Search remains usable when storage is unavailable.
  }
  return history
}

export const removeSearchHistory = (query: string): string[] => {
  const history = getSearchHistory().filter(item => item !== query)
  try {
    wx.setStorageSync(HISTORY_KEY, history)
  } catch (_error) {
    // Keep the in-memory result even when persistence fails.
  }
  return history
}

export const clearSearchHistory = (): string[] => {
  try {
    wx.removeStorageSync(HISTORY_KEY)
  } catch (_error) {
    // Storage cleanup is best effort.
  }
  return []
}
