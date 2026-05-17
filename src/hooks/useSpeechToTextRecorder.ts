import { useCallback, useEffect, useRef, useState } from "react";
import type { LoomEngineClient } from "../engine";

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

export type SpeechRecorderStatus = "idle" | "recording" | "transcribing" | "error";

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

function errorMessageForTranscription(error: unknown) {
  if (
    error instanceof Error &&
    error.message.includes("Local speech-to-text provider is not configured")
  ) {
    return "Local speech-to-text provider is not configured. Configure a local Whisper-compatible command in Settings → Capability.";
  }
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
  const [status, setStatus] = useState<SpeechRecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("This browser does not support microphone capture.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setStatus("error");
      setError("This browser does not support audio recording.");
      return;
    }
    const mimeType = bestSupportedMimeType();
    if (!mimeType) {
      setStatus("error");
      setError("This browser does not support a compatible audio format.");
      return;
    }

    try {
      cleanupAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      chunksRef.current = [];
      mimeTypeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
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
        setStatus("error");
        setError("Maximum recording duration reached. Please retry with a shorter recording.");
      }, MAX_RECORDING_MS);
      startWaveform(stream);
      setStatus("recording");
    } catch (recordingError) {
      cleanupAudio();
      setStatus("error");
      setError(errorMessageForMediaError(recordingError));
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
    setStatus("idle");
    setError(null);
    setWaveform(placeholderWaveform(0));
  }, [cleanupAudio]);

  const stopAndTranscribe = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setStatus("error");
      setError("No active microphone recording was found.");
      cleanupAudio();
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
      setStatus("transcribing");
      if (chunks.length === 0) {
        cleanupAudio();
        setStatus("error");
        setError("No speech was captured. Please retry.");
        return null;
      }
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size === 0) {
        cleanupAudio();
        setStatus("error");
        setError("No speech was captured. Please retry.");
        return null;
      }
      if (blob.size > MAX_AUDIO_BYTES) {
        cleanupAudio();
        setStatus("error");
        setError("Recording is too large to transcribe. Please retry with a shorter recording.");
        return null;
      }
      const audioBytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      cleanupAudio();
      const response = await engineClient.transcribeSpeech({
        audioBytes,
        mimeType,
        mode: "preview",
        metadata: { source: "main_composer_microphone" },
      });
      const transcript = response.transcript.trim();
      if (!transcript) {
        setStatus("error");
        setError("Speech transcription was empty. Please retry.");
        return null;
      }
      setStatus("idle");
      setError(null);
      return {
        transcript,
        warnings: response.warnings,
        retention: response.retention,
      };
    } catch (transcriptionError) {
      cleanupAudio();
      setStatus("error");
      setError(errorMessageForTranscription(transcriptionError));
      return null;
    }
  }, [cleanupAudio, engineClient, stopWaveform]);

  const resetError = useCallback(() => {
    setError(null);
    setStatus("idle");
  }, []);

  useEffect(() => cleanupAudio, [cleanupAudio]);

  return {
    status,
    error,
    waveform,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
    resetError,
  };
}
