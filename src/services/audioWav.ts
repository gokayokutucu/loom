export const PCM_WAV_MIME_TYPE = "audio/wav";
export const DEFAULT_STT_WAV_SAMPLE_RATE = 16_000;

export interface RecordedAudioWav {
  audioBytes: number[];
  mimeType: typeof PCM_WAV_MIME_TYPE;
  sourceMimeType: string;
  sourceByteSize: number;
  wavByteSize: number;
  sampleRate: number;
  channelCount: number;
  sourceSampleRate: number;
  sourceChannelCount: number;
  durationSeconds: number;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodePcm16WavFromChannels(channels: Float32Array[], sampleRate: number) {
  if (channels.length === 0) throw new Error("No decoded audio channels were found.");
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("Decoded audio sample rate is invalid.");
  }

  const frameCount = channels[0]?.length ?? 0;
  if (frameCount === 0) throw new Error("Decoded audio is empty.");
  if (channels.some((channel) => channel.length !== frameCount)) {
    throw new Error("Decoded audio channels have mismatched lengths.");
  }

  const channelCount = channels.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataByteLength = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Uint8Array(buffer);
}

function downmixAndResampleToMono(decoded: AudioBuffer, targetSampleRate: number) {
  const targetFrameCount = Math.max(1, Math.round(decoded.duration * targetSampleRate));
  const sourceChannels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
    decoded.getChannelData(index)
  );
  const mono = new Float32Array(targetFrameCount);
  const ratio = decoded.sampleRate / targetSampleRate;

  for (let frame = 0; frame < targetFrameCount; frame += 1) {
    const sourcePosition = frame * ratio;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, decoded.length - 1);
    const fraction = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of sourceChannels) {
      const left = channel[leftIndex] ?? 0;
      const right = channel[rightIndex] ?? left;
      sample += left + (right - left) * fraction;
    }
    mono[frame] = sample / Math.max(1, sourceChannels.length);
  }

  return mono;
}

function createDecodeAudioContext() {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("This browser cannot convert recorded audio to WAV.");
  }
  return new AudioContextConstructor();
}

export async function transcodeRecordedAudioToPcmWav(
  chunks: Blob[],
  sourceMimeType: string
): Promise<RecordedAudioWav> {
  const sourceBlob = new Blob(chunks, { type: sourceMimeType });
  if (sourceBlob.size === 0) throw new Error("No speech was captured. Please retry.");

  const sourceArrayBuffer = await sourceBlob.arrayBuffer();
  const audioContext = createDecodeAudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(sourceArrayBuffer.slice(0));
    const mono = downmixAndResampleToMono(decoded, DEFAULT_STT_WAV_SAMPLE_RATE);
    const wavBytes = encodePcm16WavFromChannels([mono], DEFAULT_STT_WAV_SAMPLE_RATE);
    return {
      audioBytes: Array.from(wavBytes),
      mimeType: PCM_WAV_MIME_TYPE,
      sourceMimeType,
      sourceByteSize: sourceBlob.size,
      wavByteSize: wavBytes.byteLength,
      sampleRate: DEFAULT_STT_WAV_SAMPLE_RATE,
      channelCount: 1,
      sourceSampleRate: decoded.sampleRate,
      sourceChannelCount: decoded.numberOfChannels,
      durationSeconds: decoded.duration,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recorded audio could not be decoded.";
    throw new Error(`Could not convert recorded audio to WAV: ${message}`);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}
