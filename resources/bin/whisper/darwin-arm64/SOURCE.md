# Whisper Runtime Asset

This directory contains the macOS arm64 local Speech-to-Text runtime bundled by Loom.

- Upstream: `ggml-org/whisper.cpp`
- Source checkout: `https://github.com/ggerganov/whisper.cpp.git`
- Commit: `afa2ea544fb4b0448916b4a31ecd33c8685bd482`
- Build type: `Release`
- Binary target: `whisper-cli`
- Output path: `resources/bin/whisper/darwin-arm64/whisper-cli`
- SHA-256: `9983912c754283d87119f8a93bdc4b7937dad2a29cede0c71df8cc7e4ff3b0bf`

Build command used for this artifact:

```sh
cmake -S /private/tmp/loom-whisper.cpp \
  -B /private/tmp/loom-whisper.cpp/build-static-cpu \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DGGML_METAL=OFF \
  -DGGML_BLAS=OFF

cmake --build /private/tmp/loom-whisper.cpp/build-static-cpu \
  --config Release \
  -j 8 \
  --target whisper-cli
```

The asset is CPU-only to avoid requiring Metal/GPU availability for baseline local STT.
