import { expect, test } from "@playwright/test";
import {
  reduceSpeechToText,
  speechToTextTransitionTable,
  type SpeechToTextState,
} from "../src/state/speechToTextMachine";

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
        { type: "TRANSCRIBE_FAILED", error: "Local speech-to-text provider is not configured." }
      )
    ).toEqual({
      status: "error",
      error: "Local speech-to-text provider is not configured.",
    });
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
});
