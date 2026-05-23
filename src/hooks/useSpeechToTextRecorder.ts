import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { LoomEngineClient, SpeechSetupStatus } from "../engine";
import {
  initialSpeechToTextState,
  reduceSpeechToText,
  type SpeechToTextStatus,
} from "../state/speechToTextMachine";
import { logElectronEvent } from "../electronRuntime";
import { transcodeRecordedAudioToPcmWav } from "../services/audioWav";

const AUDIO_MIME_CANDIDATES = [
  "audio/webm",
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
];

const PLACEHOLDER_BARS = 24;
const MAX_RECORDING_MS = 60_000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export type SpeechRecorderStatus = SpeechToTextStatus;

export interface SpeechRecorderResult {
  transcript: string;
  warnings: string[];
  retention: {
    audioPersisted: boolean;
    transcriptPersisted: boolean;
  };
}

export interface SpeechRecorderState {
  status: SpeechRecorderStatus;
  error: string | null;
  waveform: number[];
  startRecording: () => Promise<void>;
  stopAndTranscribe: () => Promise<SpeechRecorderResult | null>;
  cancelRecording: () => void;
  resetError: () => void;
}

function bestSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return AUDIO_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null;
}

function errorMessageForMediaError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied. Allow microphone access and retry.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone was found. Connect a microphone and retry.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The microphone is unavailable. Close other recording apps and retry.";
    }
  }
  return error instanceof Error ? error.message : "Microphone recording failed.";
}

export function speechSetupRemediationMessage(setup: SpeechSetupStatus | null | undefined) {
  switch (setup?.state) {
    case "whisper_not_found":
      return "Local Speech Engine is not installed. Open Settings → Capability → Speech-to-Text and install the local speech engine.";
    case "model_missing":
      return "Local Speech Engine is installed, but no speech model is available. Open Settings → Capability → Speech-to-Text and download/select a model.";
    case "model_ready":
      return "Speech-to-Text is not configured yet. Open Settings → Capability → Speech-to-Text and run Auto-configure.";
    case "ready":
      return "Speech-to-Text is configured, but the local command failed. Open Settings → Capability → Speech-to-Text and run Check Provider.";
    default:
      return "Speech-to-Text is not configured yet. Open Settings → Capability → Speech-to-Text and run Auto-configure.";
  }
}

function isMissingSpeechProviderError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("local speech-to-text provider is not configured") ||
    message.includes("speech-to-text is not configured") ||
    message.includes("missing_command")
  );
}

function engineErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & { kind?: unknown; details?: unknown };
  const kind = typeof candidate.kind === "string" ? candidate.kind : undefined;
  const details =
    typeof candidate.details === "object" && candidate.details !== null
      ? (candidate.details as Record<string, unknown>)
      : {};
  const serviceKind = typeof details.serviceKind === "string" ? details.serviceKind : undefined;
  const serviceErrorCode =
    typeof details.serviceErrorCode === "string" ? details.serviceErrorCode : undefined;
  const path = typeof details.path === "string" ? details.path : undefined;
  const status = typeof details.status === "number" ? details.status : undefined;
  return {
    kind,
    serviceKind,
    serviceErrorCode,
    path,
    status,
    message: error.message.toLowerCase(),
  };
}

export function speechTranscriptionFailureMessage(error: unknown) {
  const details = engineErrorDetails(error);
  const code = details?.serviceErrorCode ?? details?.serviceKind ?? details?.kind;
  const message = details?.message ?? "";
  if (code === "no_speech_detected" || message.includes("no speech was detected")) {
    return "No speech was detected. Try speaking a little louder or longer.";
  }
  if (code === "provider_timeout" || code === "timeout" || message.includes("timed out")) {
    return "Speech transcription timed out. Try a shorter recording.";
  }
  if (code === "payload_too_large" || code === "audio_too_large") {
    return "Recording is too long. Try a shorter recording.";
  }
  if (details?.status === 413) {
    return "Recording is too long. Try a shorter recording.";
  }
  if (code === "unsupported_audio" || code === "unsupported_audio_type") {
    return "The recording format is not supported. Try recording again.";
  }
  if (code === "service_unavailable" || message.includes("service is not reachable")) {
    return "Loom service is not reachable. Restart the app or check service status.";
  }
  if (
    code === "provider_failed" ||
    code === "transcription_failed" ||
    code === "provider_error" ||
    message.includes("local speech engine failed")
  ) {
    return "Local speech engine failed to process the recording. Check Speech-to-Text settings.";
  }
  if (
    details?.path === "/speech/transcribe" &&
    (code === "request_failed" || message.includes("request failed for /speech/transcribe"))
  ) {
    return "Local speech engine could not process the recording. Check Speech-to-Text settings.";
  }
  return null;
}

export async function speechTranscriptionErrorMessage(
  error: unknown,
  engineClient: LoomEngineClient
) {
  if (isMissingSpeechProviderError(error)) {
    try {
      return speechSetupRemediationMessage(await engineClient.getSpeechSetupStatus());
    } catch {
      return speechSetupRemediationMessage(null);
    }
  }
  const mappedMessage = speechTranscriptionFailureMessage(error);
  if (mappedMessage) return mappedMessage;
  if (error instanceof Error) return error.message;
  return "Speech transcription failed. Please retry.";
}

function placeholderWaveform(frame: number) {
  return Array.from({ length: PLACEHOLDER_BARS }, (_, index) => {
    const wave = Math.sin((frame + index * 1.7) / 3);
    const pulse = Math.cos((frame + index * 0.9) / 5);
    return Math.max(0.14, Math.min(1, 0.42 + wave * 0.24 + pulse * 0.12));
  });
}

export function useSpeechToTextRecorder(engineClient: LoomEngineClient): SpeechRecorderState {
  const [recorderState, dispatchRecorder] = useReducer(
    reduceSpeechToText,
    initialSpeechToTextState
  );
  const [waveform, setWaveform] = useState<number[]>(() => placeholderWaveform(0));
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const placeholderFrameRef = useRef(0);

  const clearRecordingTimeout = useCallback(() => {
    if (recordingTimeoutRef.current === null) return;
    window.clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
  }, []);

  const stopWaveform = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const cleanupAudio = useCallback(() => {
    clearRecordingTimeout();
    stopWaveform();
    recorderRef.current = null;
    chunksRef.current = [];
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [clearRecordingTimeout, stopWaveform]);

  const startWaveform = useCallback((stream: MediaStream) => {
    stopWaveform();
    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) throw new Error("AudioContext unavailable");
      const audioContext = new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.78;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setWaveform(
          Array.from(data.slice(0, PLACEHOLDER_BARS), (value) =>
            Math.max(0.12, Math.min(1, value / 255))
          )
        );
        animationFrameRef.current = window.requestAnimationFrame(tick);
      };
      tick();
    } catch {
      const tick = () => {
        placeholderFrameRef.current += 1;
        setWaveform(placeholderWaveform(placeholderFrameRef.current));
        animationFrameRef.current = window.requestAnimationFrame(tick);
      };
      tick();
    }
  }, [stopWaveform]);

  const startRecording = useCallback(async () => {
    dispatchRecorder({ type: "START_REQUESTED" });
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatchRecorder({
        type: "PERMISSION_DENIED",
        error: "This browser does not support microphone capture.",
      });
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      dispatchRecorder({
        type: "PERMISSION_DENIED",
        error: "This browser does not support audio recording.",
      });
      return;
    }
    const mimeType = bestSupportedMimeType();
    if (!mimeType) {
      dispatchRecorder({
        type: "PERMISSION_DENIED",
        error: "This browser does not support a compatible audio format.",
      });
      return;
    }

    try {
      cleanupAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      dispatchRecorder({ type: "PERMISSION_GRANTED" });
      streamRef.current = stream;
      chunksRef.current = [];
      mimeTypeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      dispatchRecorder({ type: "RECORDER_READY" });
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.start(100);
      recordingTimeoutRef.current = window.setTimeout(() => {
        const activeRecorder = recorderRef.current;
        if (activeRecorder && activeRecorder.state !== "inactive") {
          try {
            activeRecorder.stop();
          } catch {
            // Cleanup below handles stale recorder state.
          }
        }
        cleanupAudio();
        dispatchRecorder({
          type: "TRANSCRIBE_FAILED",
          error: "Maximum recording duration reached. Please retry with a shorter recording.",
        });
      }, MAX_RECORDING_MS);
      startWaveform(stream);
      dispatchRecorder({ type: "RECORDING_STARTED" });
    } catch (recordingError) {
      cleanupAudio();
      dispatchRecorder({
        type: "PERMISSION_DENIED",
        error: errorMessageForMediaError(recordingError),
      });
    }
  }, [cleanupAudio, startWaveform]);

  const cancelRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Recorder may already be stopping; cleanup below owns final state.
      }
    }
    cleanupAudio();
    dispatchRecorder({ type: "CANCEL_REQUESTED" });
    dispatchRecorder({ type: "CLEANUP_DONE" });
    setWaveform(placeholderWaveform(0));
  }, [cleanupAudio]);

  const stopAndTranscribe = useCallback(async () => {
    dispatchRecorder({ type: "STOP_REQUESTED" });
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanupAudio();
      dispatchRecorder({
        type: "TRANSCRIBE_FAILED",
        error: "No active microphone recording was found.",
      });
      return null;
    }

    try {
      const stopped = new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
      });
      recorder.stop();
      await stopped;
      clearRecordingTimeout();
      const chunks = chunksRef.current.slice();
      const mimeType = mimeTypeRef.current;
      stopWaveform();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      dispatchRecorder({ type: "AUDIO_READY" });
      if (chunks.length === 0) {
        cleanupAudio();
        logElectronEvent("warn", "speech.recorder.empty_capture", {
          source: "main_composer_microphone",
          chunkCount: 0,
        });
        dispatchRecorder({
          type: "TRANSCRIBE_FAILED",
          error: "No speech was captured. Please retry.",
        });
        return null;
      }
      const wavAudio = await transcodeRecordedAudioToPcmWav(chunks, mimeType);
      if (wavAudio.wavByteSize > MAX_AUDIO_BYTES) {
        cleanupAudio();
        logElectronEvent("warn", "speech.recorder.audio_too_large", {
          source: "main_composer_microphone",
          sourceMimeType: wavAudio.sourceMimeType,
          mimeType: wavAudio.mimeType,
          sourceByteSize: wavAudio.sourceByteSize,
          byteSize: wavAudio.wavByteSize,
          chunkCount: chunks.length,
          sampleRate: wavAudio.sampleRate,
          channelCount: wavAudio.channelCount,
          sourceSampleRate: wavAudio.sourceSampleRate,
          sourceChannelCount: wavAudio.sourceChannelCount,
          durationSeconds: Number(wavAudio.durationSeconds.toFixed(3)),
        });
        dispatchRecorder({
          type: "TRANSCRIBE_FAILED",
          error: "Recording is too long. Try a shorter recording.",
        });
        return null;
      }
      cleanupAudio();
      dispatchRecorder({ type: "TRANSCRIBE_STARTED" });
      const requestStartedAt = Date.now();
      logElectronEvent("info", "speech.recorder.transcribe_requested", {
        source: "main_composer_microphone",
        sourceMimeType: wavAudio.sourceMimeType,
        mimeType: wavAudio.mimeType,
        extension: "wav",
        sourceByteSize: wavAudio.sourceByteSize,
        byteSize: wavAudio.wavByteSize,
        chunkCount: chunks.length,
        sampleRate: wavAudio.sampleRate,
        channelCount: wavAudio.channelCount,
        sourceSampleRate: wavAudio.sourceSampleRate,
        sourceChannelCount: wavAudio.sourceChannelCount,
        durationSeconds: Number(wavAudio.durationSeconds.toFixed(3)),
      });
      const response = await engineClient.transcribeSpeech({
        audioBytes: wavAudio.audioBytes,
        mimeType: wavAudio.mimeType,
        mode: "preview",
        metadata: {
          source: "main_composer_microphone",
          sourceMimeType: wavAudio.sourceMimeType,
          audioFormat: "pcm_s16le_wav",
          sampleRate: wavAudio.sampleRate,
          channelCount: wavAudio.channelCount,
          sourceSampleRate: wavAudio.sourceSampleRate,
          sourceChannelCount: wavAudio.sourceChannelCount,
          durationSeconds: wavAudio.durationSeconds,
          sourceByteSize: wavAudio.sourceByteSize,
          wavByteSize: wavAudio.wavByteSize,
        },
      });
      const transcript = response.transcript.trim();
      if (!transcript) {
        logElectronEvent("warn", "speech.recorder.transcribe_empty", {
          source: "main_composer_microphone",
          elapsedMs: Date.now() - requestStartedAt,
          transcriptLength: response.transcript.length,
          audioPersisted: response.retention.audioPersisted,
          transcriptPersisted: response.retention.transcriptPersisted,
        });
        dispatchRecorder({
          type: "TRANSCRIBE_FAILED",
          error: "No speech was detected. Try speaking a little louder or longer.",
        });
        return null;
      }
      logElectronEvent("info", "speech.recorder.transcribe_succeeded", {
        source: "main_composer_microphone",
        elapsedMs: Date.now() - requestStartedAt,
        transcriptLength: response.transcript.length,
        audioPersisted: response.retention.audioPersisted,
        transcriptPersisted: response.retention.transcriptPersisted,
      });
      dispatchRecorder({ type: "TRANSCRIBE_SUCCEEDED" });
      dispatchRecorder({ type: "CLEANUP_DONE" });
      return {
        transcript,
        warnings: response.warnings,
        retention: response.retention,
      };
    } catch (transcriptionError) {
      cleanupAudio();
      const error = await speechTranscriptionErrorMessage(transcriptionError, engineClient);
      const details =
        transcriptionError instanceof Error
          ? ((transcriptionError as Error & { kind?: unknown; details?: unknown }).details ?? {})
          : {};
      const safeDetails =
        typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
      logElectronEvent("warn", "speech.recorder.transcribe_failed", {
        source: "main_composer_microphone",
        message: error,
        kind:
          transcriptionError instanceof Error
            ? (transcriptionError as Error & { kind?: unknown }).kind
            : undefined,
        serviceErrorCode:
          typeof safeDetails.serviceErrorCode === "string" ? safeDetails.serviceErrorCode : undefined,
        serviceKind: typeof safeDetails.serviceKind === "string" ? safeDetails.serviceKind : undefined,
        status: typeof safeDetails.status === "number" ? safeDetails.status : undefined,
        path: typeof safeDetails.path === "string" ? safeDetails.path : undefined,
        diagnostics: safeDetails.diagnostics,
      });
      dispatchRecorder({
        type: "TRANSCRIBE_FAILED",
        error,
      });
      return null;
    }
  }, [cleanupAudio, engineClient, stopWaveform]);

  const resetError = useCallback(() => {
    dispatchRecorder({ type: "RESET" });
  }, []);

  useEffect(() => cleanupAudio, [cleanupAudio]);

  return {
    status: recorderState.status,
    error: recorderState.error,
    waveform,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
    resetError,
  };
}
