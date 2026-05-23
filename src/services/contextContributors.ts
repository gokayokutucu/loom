import type { LoomContextBuilderInput } from "./loomContextBuilder";

export interface ContextContribution {
  sourceId: string;
  title: string;
  content: string;
  tokensEstimate?: number;
  metadata?: Record<string, unknown>;
}

export interface ContextContributor {
  id: string;
  label: string;
  priority: number;
  canContribute(input: LoomContextBuilderInput): boolean;
  contribute(input: LoomContextBuilderInput): Promise<ContextContribution>;
}

function estimateTokens(content: string) {
  return Math.ceil(content.length / 4);
}

export const LoomCheckpointContributor: ContextContributor = {
  id: "loom-checkpoint",
  label: "Loom Checkpoint",
  priority: 10,
  canContribute(input) {
    return Boolean(input.checkpointSummary);
  },
  async contribute(input) {
    const summary = input.checkpointSummary;
    const content = summary
      ? [
          `Goal: ${summary.goal}`,
          summary.decisions.length > 0 ? `Decisions: ${summary.decisions.join("; ")}` : "",
          summary.constraints.length > 0 ? `Constraints: ${summary.constraints.join("; ")}` : "",
          summary.unresolvedQuestions.length > 0
            ? `Open questions: ${summary.unresolvedQuestions.join("; ")}`
            : "",
        ].filter(Boolean).join("\n")
      : "";
    return {
      sourceId: `${input.loomId}:checkpoint`,
      title: "Loom checkpoint",
      content,
      tokensEstimate: estimateTokens(content),
    };
  },
};

export const RecentTurnsContributor: ContextContributor = {
  id: "recent-turns",
  label: "Recent Turns",
  priority: 20,
  canContribute(input) {
    return input.responses.length > 0;
  },
  async contribute(input) {
    const recent = input.responses.slice(-4);
    const content = recent
      .map((response) => `${response.question}\n${response.title}`)
      .join("\n\n");
    return {
      sourceId: `${input.loomId}:recent-turns`,
      title: "Recent turns",
      content,
      tokensEstimate: estimateTokens(content),
      metadata: { responseCount: recent.length },
    };
  },
};

export const WeftOriginContributor: ContextContributor = {
  id: "weft-origin",
  label: "Weft Origin",
  priority: 30,
  canContribute(input) {
    return Boolean(input.activeWeftOrigin?.capsule);
  },
  async contribute(input) {
    const capsule = input.activeWeftOrigin?.capsule;
    const content = capsule
      ? `${capsule.title}\n${capsule.summary}`
      : "";
    return {
      sourceId: `${input.loomId}:weft-origin`,
      title: "Weft origin",
      content,
      tokensEstimate: estimateTokens(content),
      metadata: {
        originLoomId: input.activeWeftOrigin?.originLoomId,
        originResponseId: input.activeWeftOrigin?.originResponseId,
      },
    };
  },
};

export const AttachedReferencesContributor: ContextContributor = {
  id: "attached-references",
  label: "Attached References",
  priority: 40,
  canContribute(input) {
    return input.attachedReferences.length > 0;
  },
  async contribute(input) {
    const content = input.attachedReferences
      .map((reference) => {
        if (reference.capsule) {
          return `${reference.link.title}\n${reference.capsule.summary}`;
        }
        return `${reference.link.title}\n${reference.link.canonicalUri ?? reference.link.path}`;
      })
      .join("\n\n");
    return {
      sourceId: `${input.loomId}:attached-references`,
      title: "Attached References",
      content,
      tokensEstimate: estimateTokens(content),
      metadata: { referenceCount: input.attachedReferences.length },
    };
  },
};

export const ResponseCapsuleContributor: ContextContributor = {
  id: "response-capsules",
  label: "Response Capsules",
  priority: 50,
  canContribute(input) {
    return Boolean(input.responseCapsules && Object.keys(input.responseCapsules).length > 0);
  },
  async contribute(input) {
    const capsules = Object.values(input.responseCapsules ?? {}).slice(-6);
    const content = capsules
      .map((capsule) => `${capsule.title}\n${capsule.summary}`)
      .join("\n\n");
    return {
      sourceId: `${input.loomId}:response-capsules`,
      title: "Response capsules",
      content,
      tokensEstimate: estimateTokens(content),
      metadata: { capsuleCount: capsules.length },
    };
  },
};

export const builtInContextContributors: ContextContributor[] = [
  LoomCheckpointContributor,
  RecentTurnsContributor,
  WeftOriginContributor,
  AttachedReferencesContributor,
  ResponseCapsuleContributor,
];
