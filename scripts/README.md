# 词库导入

词库生成文件已经提交到小程序代码中。需要重建时：

```powershell
git clone --depth 1 https://github.com/KyleBing/english-vocabulary.git <临时目录>
npm run vocab:import -- --source <临时目录>
```

脚本固定读取 `full_line_jsonl/sentence/正序/高中.jsonl`、`四级.jsonl`、`六级.jsonl`，清洗后生成：

- `miniprogram/data/vocabulary/generated-data.ts`
- `miniprogram/data/vocabulary/generated-compressed-data.ts`
- `miniprogram/data/vocabulary/generated-meta.ts`
- `reports/vocabulary-stats.json`
- `reports/vocabulary-stats.md`
- `reports/vocabulary-review.json`

生成数据只包含游戏需要的稳定 ID、英文、短释义、完整释义、音标、词性和词库位掩码。相同输入会生成相同 ID 和排序。

小程序运行时读取无损压缩后的 `generated-compressed-data.ts`；便于审查的完整原始数组 `generated-data.ts` 保留在仓库中，但通过 `project.config.json` 排除出上传代码包。导入脚本会自动刷新压缩文件。仅需重新压缩现有词库时，可运行：

```powershell
npm run vocab:compress
```

本地 `source-assets/ambient-packages` 中归档的是环境音原始素材（已被 Git 忽略）；运行版本位于 `remote-assets/ambient`，由小程序首次使用时从 GitHub 下载到 `wordmatch-cache/audio` 并持久缓存，不进入小程序代码包。
