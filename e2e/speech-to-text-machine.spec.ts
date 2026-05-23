import { expect, test } from "@playwright/test";
import {
  reduceSpeechToText,
  speechToTextTransitionTable,
  type SpeechToTextState,
} from "../src/state/speechToTextMachine";
import {
  speechSetupRemediationMessage,
  speechTranscriptionFailureMessage,
} from "../src/hooks/useSpeechToTextRecorder";
import {
  DEFAULT_STT_WAV_SAMPLE_RATE,
  PCM_WAV_MIME_TYPE,
  encodePcm16WavFromChannels,
} from "../src/services/audioWav";

test.describe("[pure-state] Speech-to-Text recorder lifecycle machine", () => {
  test("idle requests permission and reaches recording", () => {
    const requesting = reduceSpeechToText(
      { status: "idle", error: null },
      { type: "START_REQUESTED" }
    );
    const granted = reduceSpeechToText(requesting, { type: "PERMISSION_GRANTED" });
    const ready = reduceSpeechToText(granted, { type: "RECORDER_READY" });

    expect(requesting).toEqual({ status: "requesting-permission", error: null });
    expect(ready).toBe(granted);
    expect(reduceSpeechToText(ready, { type: "RECORDING_STARTED" })).toEqual({
      status: "recording",
      error: null,
    });
  });

  test("permission denied enters error", () => {
    expect(
      reduceSpeechToText(
        { status: "requesting-permission", error: null },
        { type: "PERMISSION_DENIED", error: "Microphone permission was denied." }
      )
    ).toEqual({
      status: "error",
      error: "Microphone permission was denied.",
    });
  });

  test("recording stops and moves to transcribing when audio is ready", () => {
    const stopping = reduceSpeechToText(
      { status: "recording", error: null },
      { type: "STOP_REQUESTED" }
    );

    expect(stopping).toEqual({ status: "stopping", error: null });
    expect(reduceSpeechToText(stopping, { type: "AUDIO_READY" })).toEqual({
      status: "transcribing",
      error: null,
    });
  });

  test("transcribing completes on success", () => {
    expect(
      reduceSpeechToText(
        { status: "transcribing", error: null },
        { type: "TRANSCRIBE_SUCCEEDED" }
      )
    ).toEqual({ status: "completed", error: null });
  });

  test("transcribing enters error on failure", () => {
    expect(
      reduceSpeechToText(
        { status: "transcribing", error: null },
        { type: "TRANSCRIBE_FAILED", error: "Speech-to-Text setup required." }
      )
    ).toEqual({
      status: "error",
      error: "Speech-to-Text setup required.",
    });
  });

  test("setup-aware recorder remediation replaces generic provider errors", () => {
    expect(speechSetupRemediationMessage({ state: "whisper_not_found" } as never)).toBe(
      "Local Speech Engine is not installed. Open Settings → Capability → Speech-to-Text and install the local speech engine."
    );
    expect(speechSetupRemediationMessage({ state: "model_missing" } as never)).toBe(
      "Local Speech Engine is installed, but no speech model is available. Open Settings → Capability → Speech-to-Text and download/select a model."
    );
    expect(speechSetupRemediationMessage({ state: "model_ready" } as never)).toBe(
      "Speech-to-Text is not configured yet. Open Settings → Capability → Speech-to-Text and run Auto-configure."
    );
    expect(speechSetupRemediationMessage({ state: "ready" } as never)).toBe(
      "Speech-to-Text is configured, but the local command failed. Open Settings → Capability → Speech-to-Text and run Check Provider."
    );
  });

  test("structured transcription errors map to user-friendly messages", () => {
    const noSpeech = Object.assign(new Error("loom-service rejected the request"), {
      kind: "no_speech_detected",
      details: {
        serviceErrorCode: "no_speech_detected",
        diagnostics: {
          byteLength: 32044,
          durationMs: 1000,
        },
      },
    });
    const providerFailed = Object.assign(new Error("loom-service request failed for /speech/transcribe."), {
      kind: "provider_error",
      details: {
        serviceErrorCode: "provider_failed",
      },
    });
    const payloadTooLarge = Object.assign(new Error("payload too large"), {
      kind: "payload_too_large",
      details: {
        serviceErrorCode: "payload_too_large",
      },
    });
    const genericSpeechRequestFailed = Object.assign(
      new Error("loom-service request failed for /speech/transcribe."),
      {
        kind: "request_failed",
        details: {
          path: "/speech/transcribe",
          status: 422,
        },
      }
    );
    const statusPayloadTooLarge = Object.assign(
      new Error("loom-service request failed for /speech/transcribe."),
      {
        kind: "request_failed",
        details: {
          path: "/speech/transcribe",
          status: 413,
        },
      }
    );
    const plainHttpPayloadTooLarge = Object.assign(
      new Error("Recording is too long. Try a shorter recording."),
      {
        kind: "payload_too_large",
        details: {
          path: "/speech/transcribe",
          status: 413,
          responseBodyPresent: true,
        },
      }
    );

    expect(speechTranscriptionFailureMessage(noSpeech)).toBe(
      "No speech was detected. Try speaking a little louder or longer."
    );
    expect(speechTranscriptionFailureMessage(providerFailed)).toBe(
      "Local speech engine failed to process the recording. Check Speech-to-Text settings."
    );
    expect(speechTranscriptionFailureMessage(payloadTooLarge)).toBe(
      "Recording is too long. Try a shorter recording."
    );
    expect(speechTranscriptionFailureMessage(genericSpeechRequestFailed)).toBe(
      "Local speech engine could not process the recording. Check Speech-to-Text settings."
    );
    expect(speechTranscriptionFailureMessage(statusPayloadTooLarge)).toBe(
      "Recording is too long. Try a shorter recording."
    );
    expect(speechTranscriptionFailureMessage(plainHttpPayloadTooLarge)).toBe(
      "Recording is too long. Try a shorter recording."
    );
  });

  test("recording can be cancelled", () => {
    expect(
      reduceSpeechToText(
        { status: "recording", error: null },
        { type: "CANCEL_REQUESTED" }
      )
    ).toEqual({ status: "cancelled", error: null });
  });

  test("error resets to idle", () => {
    expect(
      reduceSpeechToText(
        { status: "error", error: "No speech was captured." },
        { type: "RESET" }
      )
    ).toEqual({ status: "idle", error: null });
  });

  test("invalid transitions are safe", () => {
    const state: SpeechToTextState = { status: "idle", error: null };

    expect(reduceSpeechToText(state, { type: "TRANSCRIBE_SUCCEEDED" })).toBe(state);
  });

  test("transition table contains every recorder state", () => {
    expect(Object.keys(speechToTextTransitionTable).sort()).toEqual([
      "cancelled",
      "completed",
      "error",
      "idle",
      "recording",
      "requesting-permission",
      "stopping",
      "transcribing",
    ]);
  });

  test("PCM WAV encoder emits a valid RIFF/WAVE payload", () => {
    const wav = encodePcm16WavFromChannels([new Float32Array([0, 0.5, -0.5, 1, -1])], 16_000);
    const header = String.fromCharCode(...wav.slice(0, 4));
    const wave = String.fromCharCode(...wav.slice(8, 12));
    const data = String.fromCharCode(...wav.slice(36, 40));
    const view = new DataView(wav.buffer);

    expect(header).toBe("RIFF");
    expect(wave).toBe("WAVE");
    expect(data).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(10);
  });

  test("recorder upload normalization targets mono 16 kHz WAV", () => {
    expect(PCM_WAV_MIME_TYPE).toBe("audio/wav");
    expect(DEFAULT_STT_WAV_SAMPLE_RATE).toBe(16_000);
  });
});
