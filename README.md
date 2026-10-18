# WordMatch

WordMatch 是使用 TypeScript 开发的微信单词配对小程序，包含无尽、闯关、自选、个人词包、全局词典、学习统计和沉浸学习模式。

## 本地开发

```powershell
npm install
npm run typecheck
npm test
```

使用微信开发者工具导入仓库根目录即可运行。

## 环境音资源

环境音文件存放在 `remote-assets/ambient`，不打入小程序包。用户首次播放某个环境音时，小程序会从本仓库的 GitHub Raw 地址下载到用户文件目录；之后优先离线读取缓存。

发布前需要在微信公众平台将以下地址加入 **downloadFile 合法域名**：

```text
https://raw.githubusercontent.com
```

缓存文件位于小程序的 `wordmatch-cache/audio` 目录，可在应用的存储管理页面清理。音频来源和许可证见 [SOUND_LICENSES.md](./SOUND_LICENSES.md)。

## 词库

运行时使用无损压缩词库 `miniprogram/data/vocabulary/generated-compressed-data.ts`。重建方式见 [scripts/README.md](./scripts/README.md)。
