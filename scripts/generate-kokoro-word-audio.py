"""Generate a resumable, CDN-ready MP3 pronunciation package with Kokoro ONNX."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


MODEL_SHA256 = "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96"
VOICES_SHA256 = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--voices", required=True, type=Path)
    parser.add_argument("--dependencies", required=True, type=Path)
    parser.add_argument("--seed-manifest", type=Path, default=Path("source-assets/word-audio/manifest.json"))
    parser.add_argument("--missing-words", type=Path, default=Path("source-assets/word-audio/missing-words.txt"))
    parser.add_argument("--output", type=Path, default=Path("source-assets/word-audio-kokoro"))
    parser.add_argument(
        "--runtime-temp",
        type=Path,
        help="Executable temporary directory used by the Windows eSpeak phonemizer",
    )
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=0.92)
    parser.add_argument("--bitrate", type=int, default=24)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--only", help="Comma-separated words for a sample run")
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_word(value: str) -> str:
    return value.strip().lower()


def load_words(seed_manifest_path: Path, missing_words_path: Path) -> list[str]:
    seed = json.loads(seed_manifest_path.read_text(encoding="utf-8"))
    words = {normalize_word(word) for word in seed.get("files", {})}
    words.update(normalize_word(word) for word in missing_words_path.read_text(encoding="utf-8").splitlines())
    return sorted(word for word in words if word)


def relative_audio_path(word: str) -> str:
    digest = hashlib.sha256(word.encode("utf-8")).hexdigest()[:24]
    return f"audio/{digest[:2]}/{digest}.mp3"


def atomic_json_write(path: Path, value: object) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(f"{json.dumps(value, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
    temporary.replace(path)


def write_readme(output_root: Path, manifest: dict[str, object]) -> None:
    generation = manifest["generation"]
    content = f"""# WordMatch Kokoro pronunciation package

This directory is a generated deployment artifact. It is intentionally outside
`miniprogram/`, so it is not included in the WeChat mini-program package.

- Entries: {manifest['generatedWords']} / {manifest['requestedWords']}
- Audio bytes: {manifest['totalAudioBytes']}
- Format: {generation['format']}, mono, {generation['bitrateKbps']} kbps
- Engine: {generation['engine']} {generation['engineVersion']}
- Model: {generation['model']}
- Voice: {generation['voice']} ({generation['language']})

Upload this directory to HTTPS static storage/CDN and keep `manifest.json` next
to the `audio/` directory. Runtime clients should resolve a normalized English
word through `manifest.json` and download/cache only the requested MP3.

Kokoro-82M is licensed under Apache-2.0. See the repository root
`THIRD_PARTY_NOTICES.md` for provenance and license links.
"""
    (output_root / "README.md").write_text(content, encoding="utf-8")


def encode_mp3(samples, sample_rate: int, bitrate: int, np, lameenc) -> tuple[bytes, int]:
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    active = np.flatnonzero(np.abs(audio) >= 0.002)
    if not active.size:
        raise ValueError("generated audio is silent")
    leading = int(sample_rate * 0.04)
    trailing = int(sample_rate * 0.08)
    start = max(0, int(active[0]) - leading)
    end = min(audio.size, int(active[-1]) + trailing + 1)
    audio = audio[start:end]
    peak = float(np.max(np.abs(audio)))
    if peak > 0:
        audio = audio * min(1.0, 0.92 / peak)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bitrate)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    encoded = encoder.encode(pcm) + encoder.flush()
    return encoded, round(audio.size / sample_rate * 1000)


def main() -> int:
    args = parse_args()
    runtime_temp = (args.runtime_temp or args.dependencies.parent / "runtime-temp").resolve()
    runtime_temp.mkdir(parents=True, exist_ok=True)
    os.environ["TEMP"] = str(runtime_temp)
    os.environ["TMP"] = str(runtime_temp)
    tempfile.tempdir = str(runtime_temp)
    sys.path.insert(0, str(args.dependencies.resolve()))
    os.environ.setdefault("ORT_LOG_SEVERITY_LEVEL", "3")

    import lameenc  # type: ignore
    import numpy as np  # type: ignore
    import onnxruntime as ort  # type: ignore
    from kokoro_onnx import Kokoro  # type: ignore

    model_path = args.model.resolve()
    voices_path = args.voices.resolve()
    if file_sha256(model_path) != MODEL_SHA256:
        raise ValueError("Kokoro model SHA-256 does not match the approved release")
    if file_sha256(voices_path) != VOICES_SHA256:
        raise ValueError("Kokoro voices SHA-256 does not match the approved release")

    words = load_words(args.seed_manifest.resolve(), args.missing_words.resolve())
    if args.only:
        requested = {normalize_word(word) for word in args.only.split(",") if normalize_word(word)}
        words = [word for word in words if word in requested]
        absent = sorted(requested.difference(words))
        if absent:
            raise ValueError(f"Sample words not found in vocabulary: {', '.join(absent)}")
    if args.limit > 0:
        words = words[: args.limit]

    output_root = args.output.resolve()
    manifest_path = output_root / "manifest.json"
    failures_path = output_root / "failures.json"
    output_root.mkdir(parents=True, exist_ok=True)
    existing_items = [item for item in output_root.iterdir() if item.name not in {"manifest.json", "failures.json"}]
    if not manifest_path.exists() and existing_items:
        raise ValueError(f"Output directory is non-empty and has no resumable manifest: {output_root}")

    generation = {
        "engine": "kokoro-onnx",
        "engineVersion": "0.6.0",
        "model": "Kokoro-82M v1.0 fp16",
        "modelSha256": MODEL_SHA256,
        "voicesSha256": VOICES_SHA256,
        "voice": args.voice,
        "language": "en-us",
        "speed": args.speed,
        "format": "mp3",
        "bitrateKbps": args.bitrate,
    }
    manifest = {
        "schemaVersion": 1,
        "generation": generation,
        "requestedWords": len(words),
        "generatedWords": 0,
        "failedWords": 0,
        "totalAudioBytes": 0,
        "files": {},
    }
    failures: dict[str, str] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("generation") != generation or manifest.get("requestedWords") != len(words):
            raise ValueError("Existing manifest uses different generation settings")
        if failures_path.exists():
            failures = json.loads(failures_path.read_text(encoding="utf-8"))
    else:
        atomic_json_write(manifest_path, manifest)

    print(f"Loading Kokoro model; words={len(words)}, voice={args.voice}, bitrate={args.bitrate}kbps", flush=True)
    session_options = ort.SessionOptions()
    session_options.log_severity_level = 3
    session = ort.InferenceSession(
        str(model_path),
        sess_options=session_options,
        providers=["CPUExecutionProvider"],
    )
    kokoro = Kokoro.from_session(session, str(voices_path))
    if args.voice not in kokoro.get_voices():
        raise ValueError(f"Voice is not available: {args.voice}")

    files: dict[str, dict[str, object]] = manifest["files"]
    pending_words = []
    for word in words:
        relative_path = relative_audio_path(word)
        target_path = output_root / Path(relative_path)
        existing = files.get(word)
        if existing and target_path.is_file() and target_path.stat().st_size == existing.get("bytes"):
            continue
        pending_words.append(word)

    def synthesize(word: str):
        try:
            samples, sample_rate = kokoro.create(word, voice=args.voice, speed=args.speed, lang="en-us")
            mp3, duration_ms = encode_mp3(samples, int(sample_rate), args.bitrate, np, lameenc)
            return word, mp3, duration_ms, None
        except Exception as error:  # Continue so one unusual spelling cannot block the package.
            return word, None, None, f"{type(error).__name__}: {error}"

    started = time.monotonic()
    completed_before_run = len(words) - len(pending_words)
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        results = executor.map(synthesize, pending_words)
        for run_index, (word, mp3, duration_ms, error_message) in enumerate(results, start=1):
            index = completed_before_run + run_index
            relative_path = relative_audio_path(word)
            target_path = output_root / Path(relative_path)
            if error_message:
                failures[word] = error_message
            else:
                assert mp3 is not None and duration_ms is not None
                target_path.parent.mkdir(parents=True, exist_ok=True)
                if target_path.exists():
                    if target_path.stat().st_size == len(mp3):
                        encoded_hash = file_sha256(target_path)
                    else:
                        failures[word] = f"FileExistsError: Different existing audio file: {target_path}"
                        continue
                else:
                    with target_path.open("xb") as target:
                        target.write(mp3)
                    encoded_hash = hashlib.sha256(mp3).hexdigest()
                files[word] = {
                    "path": relative_path,
                    "bytes": len(mp3),
                    "sha256": encoded_hash,
                    "durationMs": duration_ms,
                }
                failures.pop(word, None)

            if index % 25 == 0 or run_index == len(pending_words):
                manifest["generatedWords"] = len(files)
                manifest["failedWords"] = len(failures)
                manifest["totalAudioBytes"] = sum(int(item["bytes"]) for item in files.values())
                atomic_json_write(manifest_path, manifest)
                atomic_json_write(failures_path, failures)
                elapsed = max(0.001, time.monotonic() - started)
                run_rate = run_index / elapsed
                remaining = (len(pending_words) - run_index) / run_rate if run_rate else 0
                print(
                    f"progress={index}/{len(words)} generated={len(files)} failed={len(failures)} "
                    f"rate={run_rate:.2f}/s eta={remaining / 60:.1f}m",
                    flush=True,
                )

    write_readme(output_root, manifest)

    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
