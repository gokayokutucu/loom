import { describe, it, expect } from "vitest";
import {
  createOrchestrationVisibleProgress,
  activateVisibleAnswerStage,
  advanceVisibleProgress,
  finishVisibleAnswerProgress,
} from "./visibleAnswerProgress";

// ---------------------------------------------------------------------------
// createOrchestrationVisibleProgress
// ---------------------------------------------------------------------------

describe("createOrchestrationVisibleProgress", () => {
  it("starts with understandingQuestion running", () => {
    const progress = createOrchestrationVisibleProgress();
    const task = progress.tasks.find((t) => t.id === "understanding-question");
    expect(task).toBeDefined();
    expect(task?.status).toBe("running");
  });

  it("starts with preparingPlan pending", () => {
    const progress = createOrchestrationVisibleProgress();
    const task = progress.tasks.find((t) => t.id === "preparing-answer-plan");
    expect(task).toBeDefined();
    expect(task?.status).toBe("pending");
  });

  it("sets activeTaskId to understandingQuestion", () => {
    const progress = createOrchestrationVisibleProgress();
    expect(progress.activeTaskId).toBe("understanding-question");
  });

  it("sets statusText to Understanding the question...", () => {
    const progress = createOrchestrationVisibleProgress();
    expect(progress.statusText).toBe("Understanding the question...");
  });

  it("returns fresh state with no done tasks", () => {
    const progress = createOrchestrationVisibleProgress();
    const doneTasks = progress.tasks.filter((t) => t.status === "done");
    expect(doneTasks).toHaveLength(0);
  });

  it("returns a fresh independent object on each call", () => {
    const a = createOrchestrationVisibleProgress();
    const b = createOrchestrationVisibleProgress();
    expect(a).not.toBe(b);
    expect(a.tasks).not.toBe(b.tasks);
  });
});

// ---------------------------------------------------------------------------
// activateVisibleAnswerStage — generic stage insertion helper
// ---------------------------------------------------------------------------

describe("activateVisibleAnswerStage — context stage", () => {
  it("marks understandingQuestion done", () => {
    const initial = createOrchestrationVisibleProgress();
    const next = activateVisibleAnswerStage(initial, "context", "Building Loom context...");
    const task = next.tasks.find((t) => t.id === "understanding-question");
    expect(task?.status).toBe("done");
  });

  it("marks preparingPlan done", () => {
    const initial = createOrchestrationVisibleProgress();
    const next = activateVisibleAnswerStage(initial, "context", "Building Loom context...");
    const task = next.tasks.find((t) => t.id === "preparing-answer-plan");
    expect(task?.status).toBe("done");
  });

  it("inserts context task as running", () => {
    const initial = createOrchestrationVisibleProgress();
    const next = activateVisibleAnswerStage(initial, "context", "Building Loom context...");
    const contextTask = next.tasks.find((t) => t.stage === "context");
    expect(contextTask).toBeDefined();
    expect(contextTask?.status).toBe("running");
  });

  it("sets activeTaskId to the context task", () => {
    const initial = createOrchestrationVisibleProgress();
    const next = activateVisibleAnswerStage(initial, "context", "Building Loom context...");
    const contextTask = next.tasks.find((t) => t.stage === "context");
    expect(next.activeTaskId).toBe(contextTask?.id);
  });

  it("sets statusText to Building Loom context...", () => {
    const initial = createOrchestrationVisibleProgress();
    const next = activateVisibleAnswerStage(initial, "context", "Building Loom context...");
    expect(next.statusText).toBe("Building Loom context...");
  });

  it("does not mutate the input progress object", () => {
    const initial = createOrchestrationVisibleProgress();
    const tasksBefore = initial.tasks.map((t) => ({ ...t }));
    activateVisibleAnswerStage(initial, "context", "Building Loom context...");
    expect(initial.tasks).toEqual(tasksBefore);
  });
});

// ---------------------------------------------------------------------------
// finishVisibleAnswerProgress — generic completion helper
// ---------------------------------------------------------------------------

describe("finishVisibleAnswerProgress", () => {
  it("marks all tasks done", () => {
    const initial = createOrchestrationVisibleProgress();
    const advanced = activateVisibleAnswerStage(initial, "context", "Building Loom context...");
    const finished = finishVisibleAnswerProgress(advanced);
    expect(finished.tasks.every((t) => t.status === "done")).toBe(true);
  });

  it("clears statusText", () => {
    const initial = createOrchestrationVisibleProgress();
    const finished = finishVisibleAnswerProgress(initial);
    expect(finished.statusText).toBe("");
  });

  it("clears activeTaskId", () => {
    const initial = createOrchestrationVisibleProgress();
    const finished = finishVisibleAnswerProgress(initial);
    expect(finished.activeTaskId).toBeUndefined();
  });

  it("marks orchestration tasks done when called without context stage", () => {
    // Simulates context_ready arriving without a prior answer_plan_ready
    const initial = createOrchestrationVisibleProgress();
    const finished = finishVisibleAnswerProgress(initial);
    expect(finished.tasks.every((t) => t.status === "done")).toBe(true);
  });

  it("does not mutate the input", () => {
    const initial = createOrchestrationVisibleProgress();
    const statusBefore = initial.tasks.map((t) => t.status);
    finishVisibleAnswerProgress(initial);
    expect(initial.tasks.map((t) => t.status)).toEqual(statusBefore);
  });

  it("finishes a progress object with an inserted stage safely", () => {
    const initial = createOrchestrationVisibleProgress();
    const finalizing = activateVisibleAnswerStage(initial, "finalizing", "Writing final response...");
    const finished = finishVisibleAnswerProgress(finalizing);
    expect(finished.tasks.some((task) => task.stage === "finalizing")).toBe(true);
    expect(finished.tasks.every((task) => task.status === "done")).toBe(true);
    expect(finished.activeTaskId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Full event sequence simulation
// ---------------------------------------------------------------------------

describe("full orchestration event sequence", () => {
  it("submit → context_ready starts answer preparation", () => {
    // T0: submit
    let progress = createOrchestrationVisibleProgress();
    expect(progress.activeTaskId).toBe("understanding-question");
    expect(progress.tasks.find((t) => t.id === "understanding-question")?.status).toBe("running");
    expect(progress.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("pending");

    progress = advanceVisibleProgress(progress, "context_ready")!;
    expect(progress.tasks.find((t) => t.id === "understanding-question")?.status).toBe("done");
    expect(progress.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("running");
    expect(progress.activeTaskId).toBe("preparing-answer-plan");
    expect(progress.statusText).toBe("Preparing answer plan...");
  });

  it("answer_plan_ready keeps preparation visible and never leaves understanding running", () => {
    let progress = createOrchestrationVisibleProgress();
    progress = advanceVisibleProgress(progress, "answer_plan_ready")!;
    expect(progress.tasks.find((t) => t.id === "understanding-question")?.status).toBe("done");
    expect(progress.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("running");
    expect(progress.activeTaskId).toBe("preparing-answer-plan");
    expect(progress.statusText).toBe("Preparing answer plan...");
  });

  it("thinking_status keeps a lifecycle stage visible instead of clearing the checklist", () => {
    let progress = createOrchestrationVisibleProgress();
    progress = advanceVisibleProgress(progress, "thinking_status")!;
    expect(progress.tasks.find((t) => t.id === "understanding-question")?.status).toBe("done");
    expect(progress.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("done");
    expect(progress.tasks.find((t) => t.id === "generating-answer")?.status).toBe("running");
    expect(progress.activeTaskId).toBe("generating-answer");
    expect(progress.statusText).toBe("Generating answer...");
  });

  it("thinking_status before answer_plan_ready does not leave stale understanding", () => {
    let progress = createOrchestrationVisibleProgress();
    progress = advanceVisibleProgress(progress, "thinking_status")!;
    progress = advanceVisibleProgress(progress, "answer_plan_ready")!;
    expect(progress.tasks.find((t) => t.id === "understanding-question")?.status).toBe("done");
    expect(progress.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("done");
    expect(progress.tasks.find((t) => t.id === "generating-answer")?.status).toBe("running");
    expect(progress.activeTaskId).toBe("generating-answer");
  });

  it("context_ready before answer_plan_ready advances forward safely", () => {
    let progress = createOrchestrationVisibleProgress();
    progress = advanceVisibleProgress(progress, "context_ready")!;
    expect(progress.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("running");
    progress = advanceVisibleProgress(progress, "answer_plan_ready")!;
    expect(progress.tasks.find((t) => t.id === "understanding-question")?.status).toBe("done");
    expect(progress.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("running");
    expect(progress.activeTaskId).toBe("preparing-answer-plan");
  });

  it("answer_plan_ready before context_ready does not regress understanding", () => {
    let progress = createOrchestrationVisibleProgress();
    progress = advanceVisibleProgress(progress, "answer_plan_ready")!;
    progress = advanceVisibleProgress(progress, "context_ready")!;
    expect(progress.tasks.find((t) => t.id === "understanding-question")?.status).toBe("done");
    expect(progress.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("running");
    expect(progress.activeTaskId).toBe("preparing-answer-plan");
  });

  it("content_delta advances to generating answer without generic thinking copy", () => {
    const progress = createOrchestrationVisibleProgress();
    const next = advanceVisibleProgress(progress, "content_delta");
    expect(next?.tasks.find((t) => t.id === "understanding-question")?.status).toBe("done");
    expect(next?.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("done");
    expect(next?.tasks.find((t) => t.id === "generating-answer")?.status).toBe("running");
    expect(next?.activeTaskId).toBe("generating-answer");
  });

  it("undefined progress is safe", () => {
    expect(advanceVisibleProgress(undefined, "thinking_status")).toBeUndefined();
  });

  it("retry starts with fresh running and pending stages", () => {
    const progress = createOrchestrationVisibleProgress();
    const finished = advanceVisibleProgress(progress, "thinking_status");
    const retry = createOrchestrationVisibleProgress();
    expect(finished?.tasks.find((t) => t.id === "generating-answer")?.status).toBe("running");
    expect(retry.tasks.find((t) => t.id === "understanding-question")?.status).toBe("running");
    expect(retry.tasks.find((t) => t.id === "preparing-answer-plan")?.status).toBe("pending");
  });
});
