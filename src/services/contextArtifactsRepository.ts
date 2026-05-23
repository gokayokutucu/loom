/*
 * Legacy/dev/test-only browser artifact repository after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { ResponseContextCapsule } from "./responseContextCapsule";
import type { LoomCheckpointSummary } from "./loomContextBuilder";
import { localStorageAdapter } from "./storage";

export type ContextArtifactStatus = "pending" | "ready" | "stale" | "failed";
export type ContextArtifactGenerator = "heuristic" | "quickModel";

export interface PersistedResponseContextCapsule {
  capsuleId: string;
  responseId: string;
  loomId: string;
  responseCode?: string;
  title: string;
  summary: string;
  keyPoints: string[];
  keywords: string[];
  entities: string[];
  codeBlocks: ResponseContextCapsule["codeBlocks"];
  canonicalUri?: string;
  sourceHash: string;
  generator: ContextArtifactGenerator;
  status: ContextArtifactStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedLoomCheckpointSummary {
  checkpointId: string;
  loomId: string;
  upToResponseId: string;
  summary: LoomCheckpointSummary;
  decisions: string[];
  constraints: string[];
  openQuestions: string[];
  entities: string[];
  wefts: string[];
  references: string[];
  sourceHash: string;
  status: ContextArtifactStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedWeftOriginContext {
  contextId: string;
  weftLoomId: string;
  originLoomId: string;
  originResponseId: string;
  originCapsuleId?: string;
  originSummary: string;
  sourceHash: string;
  status: ContextArtifactStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ContextBuildJob {
  jobId: string;
  jobType: "response_capsule" | "loom_checkpoint" | "weft_origin";
  loomId: string;
  responseId?: string;
  status: ContextArtifactStatus;
  priority: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface ContextArtifactEvent {
  eventId: string;
  artifactType: "response_context_capsule" | "loom_checkpoint_summary" | "weft_origin_context";
  artifactId: string;
  eventType: "created" | "updated" | "marked_stale" | "failed" | "used_fallback";
  payload: Record<string, unknown>;
  createdAt: number;
}

interface ContextArtifactsState {
  responseCapsules: Record<string, PersistedResponseContextCapsule>;
  checkpointSummaries: Record<string, PersistedLoomCheckpointSummary>;
  weftOriginContexts: Record<string, PersistedWeftOriginContext>;
  jobs: Record<string, ContextBuildJob>;
  events: Record<string, ContextArtifactEvent>;
}

export interface ContextArtifactsRepository {
  ensureSchema(): Promise<void>;
  getResponseCapsule(input: {
    loomId: string;
    responseId: string;
  }): Promise<PersistedResponseContextCapsule | undefined>;
  upsertResponseCapsule(input: PersistedResponseContextCapsule): Promise<void>;
  getCheckpoint(input: {
    loomId: string;
    upToResponseId: string;
  }): Promise<PersistedLoomCheckpointSummary | undefined>;
  upsertCheckpoint(input: PersistedLoomCheckpointSummary): Promise<void>;
  getWeftOriginContext(input: {
    weftLoomId: string;
  }): Promise<PersistedWeftOriginContext | undefined>;
  upsertWeftOriginContext(input: PersistedWeftOriginContext): Promise<void>;
  createJob(input: Omit<ContextBuildJob, "jobId" | "createdAt">): Promise<ContextBuildJob>;
  finishJob(input: {
    jobId: string;
    status: ContextArtifactStatus;
    error?: string;
  }): Promise<void>;
  recordEvent(input: Omit<ContextArtifactEvent, "eventId" | "createdAt">): Promise<void>;
}

const CONTEXT_ARTIFACTS_STORAGE_KEY = "loom-context-artifacts-sqlite-v1";

const emptyState: ContextArtifactsState = {
  responseCapsules: {},
  checkpointSummaries: {},
  weftOriginContexts: {},
  jobs: {},
  events: {},
};

export const contextArtifactSchemaSql = [
  `CREATE TABLE IF NOT EXISTS response_context_capsules (
    capsule_id TEXT PRIMARY KEY,
    response_id TEXT NOT NULL,
    loom_id TEXT NOT NULL,
    response_code TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    key_points_json TEXT NOT NULL,
    keywords_json TEXT NOT NULL,
    entities_json TEXT NOT NULL,
    code_blocks_json TEXT NOT NULL,
    canonical_uri TEXT,
    source_hash TEXT NOT NULL,
    generator TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS loom_checkpoint_summaries (
    checkpoint_id TEXT PRIMARY KEY,
    loom_id TEXT NOT NULL,
    up_to_response_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    decisions_json TEXT NOT NULL,
    constraints_json TEXT NOT NULL,
    open_questions_json TEXT NOT NULL,
    entities_json TEXT NOT NULL,
    wefts_json TEXT NOT NULL,
    references_json TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS weft_origin_contexts (
    context_id TEXT PRIMARY KEY,
    weft_loom_id TEXT NOT NULL,
    origin_loom_id TEXT NOT NULL,
    origin_response_id TEXT NOT NULL,
    origin_capsule_id TEXT,
    origin_summary TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS context_build_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    loom_id TEXT NOT NULL,
    response_id TEXT,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );`,
  `CREATE TABLE IF NOT EXISTS context_artifact_events (
    event_id TEXT PRIMARY KEY,
    artifact_type TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );`,
];

function stateWithDefaults(state: Partial<ContextArtifactsState>): ContextArtifactsState {
  return {
    responseCapsules: state.responseCapsules ?? {},
    checkpointSummaries: state.checkpointSummaries ?? {},
    weftOriginContexts: state.weftOriginContexts ?? {},
    jobs: state.jobs ?? {},
    events: state.events ?? {},
  };
}

function responseCapsuleKey(loomId: string, responseId: string) {
  return `${loomId}:${responseId}`;
}

function checkpointKey(loomId: string, upToResponseId: string) {
  return `${loomId}:${upToResponseId}`;
}

function idFor(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

class BrowserContextArtifactsRepository implements ContextArtifactsRepository {
  private readState(): ContextArtifactsState {
    return stateWithDefaults(
      localStorageAdapter.get<Partial<ContextArtifactsState>>(
        CONTEXT_ARTIFACTS_STORAGE_KEY,
        emptyState
      )
    );
  }

  private writeState(state: ContextArtifactsState) {
    localStorageAdapter.set(CONTEXT_ARTIFACTS_STORAGE_KEY, state);
  }

  async ensureSchema() {
    const state = this.readState();
    this.writeState(state);
  }

  async getResponseCapsule(input: { loomId: string; responseId: string }) {
    return this.readState().responseCapsules[responseCapsuleKey(input.loomId, input.responseId)];
  }

  async upsertResponseCapsule(input: PersistedResponseContextCapsule) {
    const state = this.readState();
    state.responseCapsules[responseCapsuleKey(input.loomId, input.responseId)] = input;
    this.writeState(state);
  }

  async getCheckpoint(input: { loomId: string; upToResponseId: string }) {
    return this.readState().checkpointSummaries[checkpointKey(input.loomId, input.upToResponseId)];
  }

  async upsertCheckpoint(input: PersistedLoomCheckpointSummary) {
    const state = this.readState();
    state.checkpointSummaries[checkpointKey(input.loomId, input.upToResponseId)] = input;
    this.writeState(state);
  }

  async getWeftOriginContext(input: { weftLoomId: string }) {
    return this.readState().weftOriginContexts[input.weftLoomId];
  }

  async upsertWeftOriginContext(input: PersistedWeftOriginContext) {
    const state = this.readState();
    state.weftOriginContexts[input.weftLoomId] = input;
    this.writeState(state);
  }

  async createJob(input: Omit<ContextBuildJob, "jobId" | "createdAt">) {
    const state = this.readState();
    const job: ContextBuildJob = {
      ...input,
      jobId: idFor("ctx-job"),
      createdAt: Date.now(),
      startedAt: Date.now(),
    };
    state.jobs[job.jobId] = job;
    this.writeState(state);
    return job;
  }

  async finishJob(input: { jobId: string; status: ContextArtifactStatus; error?: string }) {
    const state = this.readState();
    const job = state.jobs[input.jobId];
    if (!job) return;
    state.jobs[input.jobId] = {
      ...job,
      status: input.status,
      error: input.error,
      finishedAt: Date.now(),
    };
    this.writeState(state);
  }

  async recordEvent(input: Omit<ContextArtifactEvent, "eventId" | "createdAt">) {
    const state = this.readState();
    const event: ContextArtifactEvent = {
      ...input,
      eventId: idFor("ctx-event"),
      createdAt: Date.now(),
    };
    state.events[event.eventId] = event;
    this.writeState(state);
  }
}

export const contextArtifactsRepository: ContextArtifactsRepository =
  new BrowserContextArtifactsRepository();
