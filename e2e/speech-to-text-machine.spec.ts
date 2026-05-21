import { expect, test } from "@playwright/test";
import {
  reduceSpeechToText,
  speechToTextTransitionTable,
  type SpeechToTextState,
} from "../src/state/speechToTextMachine";
import { speechSetupRemediationMessage } from "../src/hooks/useSpeechToTextRecorder";
import { encodePcm16WavFromChannels } from "../src/services/audioWav";

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
});
