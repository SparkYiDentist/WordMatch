# WordMatch 环境音资源与授权

本文件只记录音频素材授权。项目代码许可证与音频素材许可证彼此独立，不能互相替代。

## 已打包资源

| WordMatch 文件 | 界面名称 | 原始作品与作者 | 原始来源 | 许可证 | 本项目中的处理 |
|---|---|---|---|---|---|
| `remote-assets/ambient/rain.mp3` | 轻柔雨声 Rain | Rain on Window Reverberant — Silencyo | [Freesound 81818](https://freesound.org/s/81818/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 使用本地归档的原始高质量 MP3，首次使用时下载并缓存 |
| `remote-assets/ambient/forest.mp3` | 森林晨光 Forest | Birds singing, Dawn chorus — SamsterBirdies | [Freesound 578523](https://freesound.org/s/578523/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 使用本地归档的原始高质量 MP3，首次使用时下载并缓存 |
| `remote-assets/ambient/ocean.mp3` | 海浪轻拍 Ocean | oceanwaves-10 (Point Reyes loop) — Rmutt | [Freesound 156598](https://freesound.org/s/156598/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 使用本地归档的原始高质量 MP3，首次使用时下载并缓存 |
| `remote-assets/ambient/stream.mp3` | 山间溪流 Stream | G53-19a Brook or Creek — USC / Internet Archive | [GOLD_TAPE_53_54_Water](https://archive.org/details/GOLD_TAPE_53_54_Water) | CC0 / Public Domain | 使用本地归档的原始高质量 MP3，首次使用时下载并缓存 |
| `remote-assets/ambient/white-noise.wav` | 柔和白噪音 White Noise | WordMatch 确定性伪随机生成 | `scripts/generate-white-noise.mjs` | 项目自生成，无第三方音频权利负担 | 使用项目生成的原始 WAV，首次使用时下载并缓存 |

前四个文件取自 [twtrubiks/moonseal 的逐文件音频清单](https://github.com/twtrubiks/moonseal/blob/main/public/audio/README.md)。该仓库已将来源、许可证和循环处理步骤逐项对应；本项目保留这些对应关系，不依据代码仓库许可证推断音频许可证。

## 候选仓库审查记录

- `Muges/ambientsounds`：仓库 README 对每个 OGG 文件逐项标注 CC0 或 CC BY，授权链清晰；可作为后续替换来源，但本次未打包其文件。
- `remvze/moodist`：代码为 MIT；README 只说明声音混合使用 Pixabay Content License 与 CC0，未对每个文件逐项对应，因此本次不复制其中音频。
- `bradtraversy/ambient-sound-mixer`：代码为 MIT，但说明仅称音频来自 royalty-free libraries，缺少逐文件作者、原始链接与许可证，本次不使用。
- `yulcat/noisebox`：声音通过浏览器 Web Audio API 实时合成；微信小程序原生 `InnerAudioContext` 不能直接复用其 Web Audio 实现，本次不复制。
- `gretzke/open-alarm`：包含逐文件来源清单，可作为海浪等声音的备选；本次未打包其文件。

## 再分发说明

四段第三方录音均为 CC0 / Public Domain，允许复制、修改和再分发且不强制署名；本项目仍保留作者、来源与处理记录，方便审计。白噪音由仓库内脚本生成，可随项目重新生成。

