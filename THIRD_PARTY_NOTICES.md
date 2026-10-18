# Third-party notices

## English vocabulary data

- Project: `KyleBing/english-vocabulary`
- Repository: https://github.com/KyleBing/english-vocabulary
- Imported commit: `c4c6c80879ff17d7025c28fb853a4991c8e6be6a`
- Imported files: `full_line_jsonl/sentence/正序/高中.jsonl`, `四级.jsonl`, `六级.jsonl`
- Repository license: BSD 3-Clause License, Copyright (c) 2022-2026, KyleBing

The upstream repository states that its data lineage is `kajweb/dict` → `KyleBing/dict` → `KyleBing/english-vocabulary`. The repository does not separately document the licensing provenance of every dictionary definition, translation, phonetic transcription, phrase, or example sentence. WordMatch imports only word heads, Chinese translations, parts of speech, and phonetic transcriptions, but downstream users should still complete their own rights review before commercial distribution.

### BSD 3-Clause License

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE, ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## WordAudio pronunciation files

- Project: `mrcraked/WordAudio`
- Repository: https://github.com/mrcraked/WordAudio
- Use in WordMatch: source files for the independently deployable word-pronunciation package under `source-assets/word-audio`
- License: MIT, Copyright (c) 2025 mrcraked
- Upstream generator: gTTS, as documented in the upstream `Scripts/Audio.py`

Only filenames exactly matching WordMatch vocabulary headwords are copied. The generated package, manifest, missing-word report, and upstream license stay outside `miniprogram/`, so they are not included in the WeChat Mini Program code package.

## Kokoro generated pronunciation files

- Model: `hexgrad/Kokoro-82M` v1.0, Apache 2.0
- Model repository: https://huggingface.co/hexgrad/Kokoro-82M
- ONNX runtime wrapper: `thewh1teagle/kokoro-onnx` 0.6.0, MIT
- ONNX repository: https://github.com/thewh1teagle/kokoro-onnx
- MP3 encoder binding: `lameenc` 1.8.1
- Use in WordMatch: locally generate a consistent American-English pronunciation file for every bundled vocabulary headword

The model, voices, Python dependencies, and intermediate PCM data are build-time tools stored outside the repository. Generated MP3 files remain under `source-assets/word-audio-kokoro`, outside `miniprogram/`, and are intended for independent HTTPS static hosting.

## pako

- Project: `pako`
- Version: `1.0.11`
- Repository: https://github.com/nodeca/pako
- Use in WordMatch: local decompression of common Flate-compressed PDF text streams
- License: MIT and zlib

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
