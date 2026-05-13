// E2E data authority classification: LEGACY_TYPESCRIPT_LOCAL.
// This spec protects deprecated TypeScript runtime planner/context behavior until TS test cleanup.
import { expect, test } from "@playwright/test";
import {
  buildQuestionOrchestratorPayload,
  orchestrateQuestionPlanWithExecutor,
  planAnswerDeterministically,
} from "../src/services/answerPlanner";
import { resolveAnswerExecutionConfig } from "../src/services/answerExecution";
import { buildLoomContext } from "../src/services/loomContextBuilder";
import {
  isLengthDoneReason,
  resolveOllamaNumPredict,
  resolveOllamaThinkValue,
} from "../src/services/modelProviders";
import { TimeoutSignalError, runWithTimeoutSignal } from "../src/services/abortSignals";
import {
  activateVisibleAnswerStage,
  buildVisibleAnswerPlanPrompt,
  createDeterministicVisibleAnswerPlan,
  createVisibleTaskProgress,
  generateVisibleAnswerPlanWithExecutor,
  resolveVisibleContentOutline,
  resolveVisibleAnswerTasks,
} from "../src/services/visibleAnswerProgress";
import type { Conversation, LoomLink, ResponseItem } from "../src/types";

function reference(id: string, title: string, selectedText?: string): LoomLink {
  return {
    id,
    type: selectedText ? "fragment" : "response",
    title,
    path: `loom://test/root/${id}`,
    referenceCode: id.toUpperCase(),
    selectedText,
    sourceResponseId: selectedText ? id : undefined,
    sourceLoomId: selectedText ? "root" : undefined,
    sourceResponseCode: id.toUpperCase(),
    sourceResponseTitle: "Event Sourcing nedir?",
  };
}

function conversation(): Conversation {
  return {
    id: "root",
    title: "Test Loom",
    path: "loom://test/root",
    folder: "Test",
    summary: "Test summary",
  };
}

function priorResponse(id: string): ResponseItem {
  return {
    id,
    title: `Prior ${id}`,
    address: `loom://test/root/${id}`,
    question: `Prior question ${id}`,
    answer: [`Prior answer ${id}`],
    suggestedLinks: [],
    bookmarkedLinks: [],
  };
}

test.describe("[legacy-typescript-local] Question Orchestrator planning", () => {
  test("simple factual prompts use instant mode and minimal context", () => {
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "ahtapot kaç kolludur",
      attachedReferences: [],
      selectedResponseMode: "auto",
    });

    expect(plan.intent).toBe("simple_factual");
    expect(plan.responseMode).toBe("instant");
    expect(plan.useThinking).toBe(false);
    expect(plan.contextStrategy).toBe("minimal");
    expect(plan.answerStyle).toBe("direct");

    const context = buildLoomContext({
      loomId: "root",
      currentHeadResponseId: "r-2",
      newUserPrompt: "ahtapot kaç kolludur",
      answerPlan: plan,
      attachedReferences: [],
      responseMode: plan.useThinking ? "thinking" : "instant",
      resolvedNumCtx: 2048,
      conversation: conversation(),
      responses: [priorResponse("r-1"), priorResponse("r-2")],
      forkRecords: [],
    });

    expect(context.context).toEqual([]);
    expect(context.includedRecentTurnCount).toBe(0);
    expect(context.prompt).toBe("ahtapot kaç kolludur");
  });

  test("references on separate lines produce labeled section items without group labels", () => {
    const first = reference("r-one", "Electron", "Electron");
    const second = reference("r-two", "Graph", "Graph");
    const plan = planAnswerDeterministically({
      cleanUserPrompt:
        "[[Electron]] ne teknolojisi?\n\n[[Graph]] yöntemi de nedir?",
      attachedReferences: [first, second],
      selectedResponseMode: "auto",
    });

    expect(plan.intent).toBe("reference_scoped_question");
    expect(plan.answerStyle).toBe("separate_sections");
    expect(plan.contextStrategy).toBe("reference_scoped");
    expect(plan.questionUnits).toHaveLength(2);
    expect(plan.questionUnits[0].references).toEqual([first]);
    expect(plan.questionUnits[0].question).toBe("ne teknolojisi?");
    expect(plan.questionUnits[0].displayText).toBe("[Electron] ne teknolojisi?");
    expect(plan.questionUnits[1].references).toEqual([second]);
    expect(plan.questionUnits[1].question).toBe("yöntemi de nedir?");
    expect(plan.questionUnits[1].displayText).toBe("[Graph] yöntemi de nedir?");

    const visiblePlan = createDeterministicVisibleAnswerPlan({
      promptText: "[[Electron]] ne teknolojisi?\n\n[[Graph]] yöntemi de nedir?",
      answerPlan: plan,
      referenceCount: 2,
      outputBudget: "medium",
    });

    expect(visiblePlan.contentOutline).toContain("[Electron] ne teknolojisi?");
    expect(visiblePlan.contentOutline).toContain("[Graph] yöntemi de nedir?");

    const context = buildLoomContext({
      loomId: "root",
      newUserPrompt: "flat fallback should not be used",
      answerPlan: plan,
      questionUnits: plan.questionUnits,
      contextStrategy: plan.contextStrategy,
      attachedReferences: [
        { link: first },
        { link: second },
      ],
      responseMode: plan.useThinking ? "thinking" : "instant",
      resolvedNumCtx: 4096,
      conversation: conversation(),
      responses: [],
      forkRecords: [],
    });

    expect(context.prompt).toContain("Answer them as separate sections");
    expect(context.prompt).toContain("Use the reference label as the section heading");
    expect(context.prompt).toContain("Current question: ne teknolojisi?");
    expect(context.prompt).toContain("Reference label: Electron");
    expect(context.prompt).toContain('Selected fragment: "Electron"');
    expect(context.prompt).toContain("Expected section heading: Electron");
    expect(context.prompt).toContain("Current question: yöntemi de nedir?");
    expect(context.prompt).toContain("Reference label: Graph");
    expect(context.prompt).toContain('Selected fragment: "Graph"');
    expect(context.prompt).toContain("Expected section heading: Graph");
    expect(context.prompt).toContain("Source title: Event Sourcing nedir?");
    expect(context.prompt.indexOf("Current question: yöntemi de nedir?")).toBeLessThan(
      context.prompt.indexOf('Selected fragment: "Graph"')
    );
    expect(context.prompt.indexOf('Selected fragment: "Graph"')).toBeLessThan(
      context.prompt.indexOf(
        "Source title: Event Sourcing nedir?",
        context.prompt.indexOf('Selected fragment: "Graph"')
      )
    );
    expect(context.prompt).not.toContain("Group 1");
    expect(context.prompt).not.toContain("Group 2");
    expect(context.prompt).not.toContain("Grup 1");
    expect(context.prompt).not.toContain("Grup 2");
    expect(context.prompt).not.toContain("Context Capsule");
    expect(context.prompt).not.toContain("Response Capsule");
    expect(context.prompt).not.toContain("Question Unit");
    expect(context.prompt).not.toContain("Artifact");
    expect(context.prompt).not.toContain("Metadata");
    expect(context.prompt).not.toContain("Cep Kapsülü");
  });

  test("multiple references in the same sentence are planned as synthesis", () => {
    const first = reference("r-one", "Replay", "Replay");
    const second = reference("r-two", "CQRS", "CQRS");
    const prompt = "[[Replay]] ve [[CQRS]] arasındaki ilişki nedir?";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [first, second],
      selectedResponseMode: "auto",
    });

    expect(plan.intent).toBe("multi_reference_synthesis");
    expect(plan.answerStyle).toBe("synthesis");
    expect(plan.contextStrategy).toBe("multi_reference");
    expect(plan.questionUnits).toHaveLength(1);
    expect(plan.questionUnits[0].references).toEqual([first, second]);
    expect(plan.questionUnits[0].displayText).toBe(
      "[Replay] ve [CQRS] arasındaki ilişki nedir?"
    );

    const context = buildLoomContext({
      loomId: "root",
      newUserPrompt: prompt,
      answerPlan: plan,
      questionUnits: plan.questionUnits,
      contextStrategy: plan.contextStrategy,
      attachedReferences: [
        { link: first },
        { link: second },
      ],
      responseMode: plan.useThinking ? "thinking" : "instant",
      resolvedNumCtx: 4096,
      conversation: conversation(),
      responses: [],
      forkRecords: [],
    });

    expect(context.prompt).toBe(prompt);
    expect(context.prompt).not.toContain("Group 1");
    expect(context.prompt).not.toContain("Reference question:");
  });

  test("Instant and Thinking modes map to bounded think decisions", () => {
    const first = reference("r-one", "Deneme 1");
    const second = reference("r-two", "Deneme 2");
    const instantPlan = planAnswerDeterministically({
      cleanUserPrompt: "[[Deneme 1]] ve [[Deneme 2]] birlikte ne söylüyor?",
      attachedReferences: [first, second],
      selectedResponseMode: "instant",
    });
    const simpleThinkingPlan = planAnswerDeterministically({
      cleanUserPrompt: "ahtapot kaç kolludur",
      attachedReferences: [],
      selectedResponseMode: "thinking",
    });
    const complexThinkingPlan = planAnswerDeterministically({
      cleanUserPrompt:
        "[[Deneme 1]] o zaman toprakları var mıydı?\n[[Deneme 2]] niye bu kadar içeri girmişler?",
      attachedReferences: [first, second],
      selectedResponseMode: "thinking",
    });

    expect(instantPlan.useThinking).toBe(false);
    expect(resolveOllamaThinkValue({
      modelId: "qwen3.5:9b",
      mode: instantPlan.useThinking ? "thinking" : "instant",
      promptText: instantPlan.questionUnits[0].question,
      referenceCount: instantPlan.questionUnits[0].references.length,
    })).toBe(false);

    expect(simpleThinkingPlan.intent).toBe("simple_factual");
    expect(simpleThinkingPlan.useThinking).toBe(false);
    expect(complexThinkingPlan.complexity).toBe("medium");
    expect(complexThinkingPlan.useThinking).toBe(true);
  });

  test("Turkish long-form non-thinking prompts receive an extended local output budget", () => {
    const prompt = "event sourcing nedir? nasıl kullanılır? Detaylı olarak anlat";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const execution = resolveAnswerExecutionConfig({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 0,
    });

    expect(execution.think).toBe(false);
    expect(execution.outputBudget).toBe("extended");
    expect(execution.numPredict).toBe(16384);
  });

  test("simple factual prompts stay small and non-thinking", () => {
    const prompt = "ahtapot kaç kolludur";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const execution = resolveAnswerExecutionConfig({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 0,
    });

    expect(execution.think).toBe(false);
    expect(execution.outputBudget).toBe("short");
    expect(execution.numPredict).toBe(768);
  });

  test("Instant mode can still use a longer budget when the user asks for detail", () => {
    const prompt = "Event sourcing avantajlarını örneklerle açıkla";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "instant",
    });
    const execution = resolveAnswerExecutionConfig({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 0,
    });

    expect(execution.think).toBe(false);
    expect(execution.responseMode).toBe("instant");
    expect(execution.outputBudget).toBe("extended");
    expect(execution.numPredict).toBe(16384);
  });

  test("Thinking mode keeps thinking enabled but uses the same long-form output policy", () => {
    const first = reference("r-one", "Deneme 1");
    const second = reference("r-two", "Deneme 2");
    const prompt = "[[Deneme 1]] ile [[Deneme 2]] arasındaki farkları detaylı açıkla";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [first, second],
      selectedResponseMode: "thinking",
    });
    const execution = resolveAnswerExecutionConfig({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 2,
    });

    expect(execution.think).toBe(true);
    expect(execution.responseMode).toBe("thinking");
    expect(execution.outputBudget).toBe("extended");
    expect(execution.numPredict).toBe(16384);
  });

  test("Ollama budget fallback maps long-form budgets to local large answer limits", () => {
    expect(resolveOllamaNumPredict({
      mode: "auto",
      referenceCount: 0,
      referenceCharCount: 0,
      resolvedNumCtx: 8192,
      outputBudget: "long",
    })).toBe(8192);
    expect(resolveOllamaNumPredict({
      mode: "auto",
      referenceCount: 0,
      referenceCharCount: 0,
      resolvedNumCtx: 8192,
      outputBudget: "extended",
    })).toBe(16384);
    expect(resolveOllamaNumPredict({
      mode: "instant",
      referenceCount: 0,
      referenceCharCount: 0,
      resolvedNumCtx: 2048,
      outputBudget: "short",
    })).toBe(768);
  });

  test("Ollama length done reasons are detectable", () => {
    expect(isLengthDoneReason("length")).toBe(true);
    expect(isLengthDoneReason("num_predict")).toBe(true);
    expect(isLengthDoneReason("stop")).toBe(false);
    expect(isLengthDoneReason(undefined)).toBe(false);
  });

  test("orchestrator failures fall back to deterministic planning", async () => {
    const input = {
      cleanUserPrompt: "ahtapot kaç kolludur",
      attachedReferences: [],
      selectedResponseMode: "auto" as const,
    };
    const fallback = planAnswerDeterministically(input);
    const plan = await orchestrateQuestionPlanWithExecutor(input, async () => {
      throw new Error("planner unavailable");
    });

    expect(plan).toEqual(fallback);
  });

  test("planner output ignores raw reasoning fields and payload asks for JSON only", async () => {
    const input = {
      cleanUserPrompt: "ahtapot kaç kolludur",
      attachedReferences: [],
      selectedResponseMode: "auto" as const,
    };
    const payload = buildQuestionOrchestratorPayload(input);
    const plan = await orchestrateQuestionPlanWithExecutor(input, async () =>
      JSON.stringify({
        intent: "simple_factual",
        responseMode: "instant",
        useThinking: false,
        contextStrategy: "minimal",
        answerStyle: "direct",
        complexity: "low",
        questionUnits: [{ question: "ahtapot kaç kolludur", referenceIndexes: [], sourceLineIndex: 0 }],
        reasoning: "this must not be persisted",
      })
    );

    expect(payload).toContain("Return JSON only");
    expect(payload).toContain("No chain-of-thought");
    expect(plan).not.toHaveProperty("reasoning");
    expect(JSON.stringify(plan)).not.toContain("this must not be persisted");
  });

  test("visible progress tasks stay compact for simple factual prompts", () => {
    const prompt = "ahtapot kaç kolludur";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const tasks = resolveVisibleAnswerTasks({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 0,
      outputBudget: "short",
    });

    expect(tasks.map((task) => task.title)).toEqual([
      "Understanding the question",
      "Writing answer",
    ]);
  });

  test("visible progress includes reference reading for reference prompts", () => {
    const first = reference("r-one", "Deneme 1");
    const second = reference("r-two", "Deneme 2");
    const prompt =
      "[[Deneme 1]] o zaman toprakları var mıydı?\n\n[[Deneme 2]] niye bu kadar içeri girmişler?";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [first, second],
      selectedResponseMode: "auto",
    });
    const tasks = resolveVisibleAnswerTasks({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 2,
      outputBudget: "medium",
    });

    expect(tasks.map((task) => task.title)).toContain("Reading references");
    expect(tasks.map((task) => task.title)).toContain("Building Loom context");
    expect(tasks.map((task) => task.title)).toContain("Writing answer");
  });

  test("visible content outline shows answer topics without raw reasoning", () => {
    const prompt = "Event sourcing nedir? Nerede kullanılır? Avantajları nelerdir?";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const outline = resolveVisibleContentOutline({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 0,
      outputBudget: "long",
    });

    expect(outline).toEqual([
      "Event sourcing nedir",
      "Nerede kullanılır",
      "Avantajları nelerdir",
    ]);
    expect(JSON.stringify(outline)).not.toMatch(/chain-of-thought|reasoning|raw thinking/i);
  });

  test("deterministic visible plan carries content outline", () => {
    const prompt = "Event sourcing nedir, avantajlarını uzun anlat";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const visiblePlan = createDeterministicVisibleAnswerPlan({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 0,
      outputBudget: "long",
    });

    expect(visiblePlan.contentOutline).toContain("Definition");
    expect(visiblePlan.contentOutline).toContain("Benefits and tradeoffs");
  });

  test("Quick visible plan can provide a content outline", async () => {
    const prompt = "Event sourcing nedir?";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const visiblePlan = await generateVisibleAnswerPlanWithExecutor(
      {
        promptText: prompt,
        answerPlan: plan,
        referenceCount: 0,
        outputBudget: "medium",
        references: [],
      },
      async () =>
        JSON.stringify({
          tasks: [
            { title: "Understand the question", stage: "orchestration" },
            { title: "Write the answer", stage: "generation" },
          ],
          contentOutline: ["Define event sourcing", "Explain where it is used"],
        })
    );

    expect(visiblePlan.source).toBe("quickModel");
    expect(visiblePlan.contentOutline).toEqual([
      "Define event sourcing",
      "Explain where it is used",
    ]);
  });

  test("visible progress distinguishes long-form, synthesis, and code tasks", () => {
    const longPrompt = "Event sourcing nedir, avantajlarını uzun anlat";
    const longPlan = planAnswerDeterministically({
      cleanUserPrompt: longPrompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const longTasks = resolveVisibleAnswerTasks({
      promptText: longPrompt,
      answerPlan: longPlan,
      referenceCount: 0,
      outputBudget: "long",
    });

    const first = reference("r-one", "Deneme 1");
    const second = reference("r-two", "Deneme 2");
    const synthesisPrompt = "[[Deneme 1]] ve [[Deneme 2]] birlikte ne söylüyor?";
    const synthesisPlan = planAnswerDeterministically({
      cleanUserPrompt: synthesisPrompt,
      attachedReferences: [first, second],
      selectedResponseMode: "auto",
    });
    const synthesisTasks = resolveVisibleAnswerTasks({
      promptText: synthesisPrompt,
      answerPlan: synthesisPlan,
      referenceCount: 2,
      outputBudget: "long",
    });

    const codePrompt = "Bu function içindeki bug neden oluyor, fix planı yaz";
    const codePlan = planAnswerDeterministically({
      cleanUserPrompt: codePrompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const codeTasks = resolveVisibleAnswerTasks({
      promptText: codePrompt,
      answerPlan: codePlan,
      referenceCount: 0,
      outputBudget: "medium",
    });

    expect(longTasks.map((task) => task.title)).toEqual([
      "Understanding the question",
      "Planning the explanation",
      "Building Loom context",
      "Drafting answer",
      "Writing final response",
    ]);
    expect(synthesisTasks.map((task) => task.title)).toContain("Synthesizing answer");
    expect(codeTasks.map((task) => task.title)).toEqual([
      "Understanding the request",
      "Inspecting code context",
      "Planning solution",
      "Writing answer",
    ]);
  });

  test("visible progress activation exposes safe status text only", () => {
    const prompt = "Event sourcing nedir, avantajlarını uzun anlat";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const progress = createVisibleTaskProgress(
      {
        promptText: prompt,
        answerPlan: plan,
        referenceCount: 0,
        outputBudget: "long",
      },
      "context"
    );
    const finalProgress = activateVisibleAnswerStage(
      progress,
      "finalizing",
      "Writing final response..."
    );
    const serialized = JSON.stringify(finalProgress);

    expect(progress.statusText).toBe("Building Loom context...");
    expect(finalProgress.statusText).toBe("Writing final response...");
    expect(serialized).not.toMatch(/sqlite|capsule|artifact|planner json|chain-of-thought|reasoning/i);
  });

  test("visible plan prompt asks Quick model for JSON task titles only", () => {
    const first = reference("r-one", "Deneme 1");
    const prompt = "[[Deneme 1]] bunu açıkla";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [first],
      selectedResponseMode: "auto",
    });
    const payload = buildVisibleAnswerPlanPrompt({
      promptText: prompt,
      answerPlan: plan,
      references: [first],
    });

    expect(payload).toContain("Return JSON only");
    expect(payload).toContain("Do not answer the user");
    expect(payload).toContain("Do not reveal reasoning");
    expect(payload).toContain("references");
    expect(payload).toContain("finalizing");
  });

  test("visible plan uses Quick model JSON when valid", async () => {
    const prompt = "Event sourcing nedir, avantajlarını uzun anlat";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const visiblePlan = await generateVisibleAnswerPlanWithExecutor(
      {
        promptText: prompt,
        answerPlan: plan,
        referenceCount: 0,
        outputBudget: "long",
        references: [],
      },
      async () =>
        JSON.stringify({
          tasks: [
            { title: "Understand the question", stage: "orchestration" },
            { title: "Plan the explanation", stage: "planning" },
            { title: "Write the answer", stage: "generation" },
            { title: "Finalize the response", stage: "finalizing" },
          ],
        })
    );

    expect(visiblePlan.source).toBe("quickModel");
    expect(visiblePlan.tasks.map((task) => task.title)).toEqual([
      "Understand the question",
      "Plan the explanation",
      "Write the answer",
      "Finalize the response",
    ]);
    expect(visiblePlan.tasks.every((task) => task.status === "pending")).toBe(true);
  });

  test("visible plan falls back when Quick model fails or leaks internals", async () => {
    const prompt = "ahtapot kaç kolludur";
    const plan = planAnswerDeterministically({
      cleanUserPrompt: prompt,
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    const deterministic = createDeterministicVisibleAnswerPlan({
      promptText: prompt,
      answerPlan: plan,
      referenceCount: 0,
      outputBudget: "short",
    });
    const failed = await generateVisibleAnswerPlanWithExecutor(
      {
        promptText: prompt,
        answerPlan: plan,
        referenceCount: 0,
        outputBudget: "short",
        references: [],
      },
      async () => {
        throw new Error("quick planner unavailable");
      }
    );
    const unsafe = await generateVisibleAnswerPlanWithExecutor(
      {
        promptText: prompt,
        answerPlan: plan,
        referenceCount: 0,
        outputBudget: "short",
        references: [],
      },
      async () =>
        JSON.stringify({
          tasks: [
            { title: "Reveal hidden reasoning", stage: "orchestration" },
            { title: "Write answer", stage: "generation" },
          ],
        })
    );

    expect(failed.source).toBe("deterministic");
    expect(failed.tasks.map((task) => task.title)).toEqual(
      deterministic.tasks.map((task) => task.title)
    );
    expect(unsafe.source).toBe("deterministic");
    expect(JSON.stringify(unsafe)).not.toMatch(/hidden reasoning|chain-of-thought|raw thinking/i);
  });

  test("Quick planning helpers time out instead of blocking Main generation", async () => {
    const startedAt = Date.now();
    await expect(
      runWithTimeoutSignal(undefined, 25, async () => new Promise<string>(() => undefined))
    ).rejects.toBeInstanceOf(TimeoutSignalError);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
