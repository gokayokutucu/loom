import { expect, test } from "@playwright/test";
import {
  applyComposerGenerationEvent,
  applyEngineResponseEvent,
  composerGenerationLifecycleMap,
  createComposerGenerationSnapshot,
  normalizeComposerGenerationEvent,
} from "../src/state/composerGenerationLifecycle";
import type { EngineResponseEvent } from "../src/engine/LoomEngineTypes";

test.describe("[pure-state] Composer generation lifecycle baseline", () => {
  test("documents current lifecycle states and events", () => {
    expect(composerGenerationLifecycleMap.states).toEqual([
      "idle",
      "draft-ready",
      "submitting",
      "placeholder-created",
      "service-accepted",
      "streaming-thinking",
      "streaming-answer",
      "completed",
      "truncated",
      "cancelled",
      "error",
    ]);
    expect(composerGenerationLifecycleMap.events).toEqual([
      "SUBMIT",
      "PLACEHOLDER_CREATED",
      "SERVICE_ACCEPTED",
      "THINKING_STARTED",
      "THINKING_PROGRESS",
      "ANSWER_DELTA",
      "RESPONSE_COMPLETED",
      "RESPONSE_TRUNCATED",
      "CANCEL_REQUESTED",
      "CANCELLED",
      "ERROR",
      "RETRY",
    ]);
    expect(composerGenerationLifecycleMap.notes.temporaryWeft).toContain("promotes");
  });

  test("submit creates a local placeholder state once the placeholder exists", () => {
    const submitting = applyComposerGenerationEvent(createComposerGenerationSnapshot(true), {
      type: "SUBMIT",
    });
    const placeholder = applyComposerGenerationEvent(submitting, {
      type: "PLACEHOLDER_CREATED",
      responseId: "local-assistant-1",
    });

    expect(submitting).toMatchObject({ state: "submitting" });
    expect(placeholder).toMatchObject({
      state: "placeholder-created",
      responseId: "local-assistant-1",
    });
  });

  test("service accepted maps workflow run id from service events", () => {
    const placeholder = applyEngineResponseEvent(createComposerGenerationSnapshot(true), {
      type: "assistant_placeholder_created",
      payload: {
        loomId: "loom-1",
        responseId: "assistant-1",
        workflowRunId: "run-1",
      },
    });
    const accepted = applyEngineResponseEvent(placeholder, {
      type: "user_message_created",
      payload: {
        loomId: "loom-1",
        responseId: "user-1",
        workflowRunId: "run-1",
      },
    });

    expect(placeholder).toMatchObject({
      state: "placeholder-created",
      serviceAccepted: true,
      responseId: "assistant-1",
      workflowRunId: "run-1",
    });
    expect(accepted).toMatchObject({
      state: "service-accepted",
      userResponseId: "user-1",
      workflowRunId: "run-1",
    });
  });

  test("answer deltas append in stream order", () => {
    const first = applyEngineResponseEvent(createComposerGenerationSnapshot(true), {
      type: "content_delta",
      payload: { responseId: "assistant-1", delta: "Hello" },
    });
    const second = applyEngineResponseEvent(first, {
      type: "content_delta",
      payload: { responseId: "assistant-1", delta: " Loom" },
    });

    expect(second).toMatchObject({
      state: "streaming-answer",
      answerText: "Hello Loom",
      responseId: "assistant-1",
    });
  });

  test("thinking status preserves metadata only and ignores raw thinking fields", () => {
    const event = {
      type: "thinking_status",
      payload: {
        status: "running",
        durationMs: 2400,
        raw_thinking: "hidden reasoning",
        chain_of_thought: "hidden",
      },
    } as unknown as EngineResponseEvent;
    const normalized = normalizeComposerGenerationEvent(event);
    const snapshot = applyEngineResponseEvent(createComposerGenerationSnapshot(true), event);

    expect(normalized).toEqual({ type: "THINKING_PROGRESS", durationMs: 2400 });
    expect(snapshot).toMatchObject({
      state: "streaming-thinking",
      thinkingStarted: true,
      elapsedThinkingSeconds: 2,
    });
    expect(JSON.stringify(normalized)).not.toContain("hidden");
    expect(JSON.stringify(snapshot)).not.toContain("raw_thinking");
    expect(JSON.stringify(snapshot)).not.toContain("chain_of_thought");
  });

  test("completion finalizes the response", () => {
    const snapshot = applyEngineResponseEvent(
      {
        ...createComposerGenerationSnapshot(true),
        answerText: "Done",
      },
      {
        type: "response_completed",
        payload: { responseId: "assistant-1", doneReason: "stop" },
      }
    );

    expect(snapshot).toMatchObject({
      state: "completed",
      responseId: "assistant-1",
      doneReason: "stop",
      truncated: false,
    });
  });

  test("cancellation request waits for stream cancellation event before marking cancelled", () => {
    const cancelling = applyComposerGenerationEvent(
      {
        ...createComposerGenerationSnapshot(true),
        state: "streaming-answer",
        workflowRunId: "run-1",
        responseId: "assistant-1",
      },
      { type: "CANCEL_REQUESTED" }
    );
    const snapshot = applyEngineResponseEvent(
      cancelling,
      {
        type: "response_cancelled",
        payload: {
          responseId: "assistant-1",
          workflowRunId: "run-1",
          message: "Response cancelled.",
        },
      }
    );

    expect(cancelling).toMatchObject({ state: "streaming-answer" });
    expect(snapshot).toMatchObject({
      state: "cancelled",
      responseId: "assistant-1",
      workflowRunId: "run-1",
      cancelledMessage: "Response cancelled.",
    });
  });

  test("error records current accepted-stream behavior without draft restoration", () => {
    const snapshot = applyEngineResponseEvent(
      {
        ...createComposerGenerationSnapshot(true),
        state: "placeholder-created",
        responseId: "assistant-1",
        workflowRunId: "run-1",
      },
      {
        type: "response_error",
        payload: {
          responseId: "assistant-1",
          workflowRunId: "run-1",
          message: "provider unavailable",
        },
      }
    );

    expect(snapshot).toMatchObject({
      state: "error",
      serviceAccepted: true,
      responseId: "assistant-1",
      workflowRunId: "run-1",
      errorMessage: "provider unavailable",
    });
    expect(composerGenerationLifecycleMap.notes.draft).toContain("instead of restoring");
  });

  test("truncated response is distinct from completed", () => {
    const snapshot = applyEngineResponseEvent(createComposerGenerationSnapshot(true), {
      type: "response_truncated",
      payload: { responseId: "assistant-1", doneReason: "length" },
    });

    expect(snapshot).toMatchObject({
      state: "truncated",
      responseId: "assistant-1",
      doneReason: "length",
      truncated: true,
    });
  });

  test("temporary Weft first prompt promotion remains covered by product E2E contract note", () => {
    expect(composerGenerationLifecycleMap.notes.temporaryWeft).toBe(
      "Temporary Weft first prompt promotes the Weft before generation continues against the persisted target Loom."
    );
  });
});
