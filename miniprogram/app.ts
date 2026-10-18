const SPLASH_ROUTE = 'pages/splash/splash'
const HOME_ROUTE = 'pages/index/index'

let shouldReplaySplash = false

App<IAppOption>({
  globalData: {},
  onShow() {
    if (!shouldReplaySplash) return
    shouldReplaySplash = false

    setTimeout(() => {
      const pages = getCurrentPages()
      const currentPage = pages[pages.length - 1]
      if (currentPage && currentPage.route === HOME_ROUTE) {
        wx.reLaunch({ url: `/${SPLASH_ROUTE}` })
      }
    }, 0)
  },
  onHide() {
    shouldReplaySplash = true
  },
})
