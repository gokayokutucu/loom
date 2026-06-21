# Loom PM Reporting Contract

Status: DESIGN ONLY
Task: PM-REPORTING-CONTRACT-001

## 1. Overview and Purpose

To prevent roadmap drift, silent ledger changes, and untracked side-quests, every AI Agent (Codex, Claude, Gemini, or SubAgent) executing a task MUST emit a structured PM Report upon task completion or significant milestone. This document defines the exact schema, calculation rules, and drift detection mechanisms that must be followed in every final response.

## 2. Mandatory Reporting Block: ROADMAP STATUS

Every task completion report must end with a block exactly formatted as follows. Do not invent new fields or omit fields. If a field has no data, write "None".

```text
### ROADMAP STATUS

**Current Phase**: [Phase ID and Name]
**Current Epic**: [Epic Name]
**Current Task**: [Task ID]

**Phase Progress**: [X]%
**Epic Progress**: [Y]%
**Overall Project Progress**: [Z]%

**Completed Since Last Report**:
- [List of specific checklist items or files merged]

**Remaining Tasks In Current Epic**:
- [List of Task IDs]

**Remaining Tasks In Current Phase**:
- [List of Task IDs]

**Critical Path**:
- [Ordered list of Phases/Tasks that gate production]

**Estimated Remaining Work**:
- Current Epic: [N] engineering days
- Current Phase: [N] engineering days
- Entire Project: [N] engineering days

**Remaining Big Blocks**:
1. [Block 1]
2. [Block 2]
...

**Dependencies**:
- [List of upstream tasks required before the next task can start]

**Blockers**:
- [List of hard blockers currently preventing progress]

**Recommended Next Task**:
- [Exact Task ID]
```

## 3. Required Ledger Block

Immediately following the `ROADMAP STATUS` block, the agent must output the updated, generated Ledger block per `docs/ledger_contract.md`:

```text
### LEDGER

**LOCKED**
- [Task ID] (Phase, Epic)

**ACTIVE**
- [Task ID] (Phase, Epic)

**NEXT**
- [Task ID] (Phase, Epic)

**HOLD-BACKLOG**
- [Task ID] (Phase, Epic)
```

## 4. Progress Rules

Progress must **never** be guessed by the LLM. It must be strictly derived from physical Markdown checklists (`- [ ]` vs `- [x]`).

**Aggregation Rules**:
1. **Task Progress**: Calculated from `_PM/Agent-PM/Tasks/[Task_ID].md`. 
   `Task Progress % = (checked items / total items) * 100`
2. **Epic Progress**: Sum of all checked items in all Tasks belonging to the Epic divided by the sum of all items in all Tasks belonging to the Epic.
3. **Phase Progress**: Sum of all checked Epic items divided by total Epic items in the Phase.
4. **Project Progress**: Sum of all checked items across all Phases divided by total items across all Phases.

## 5. Roadmap Drift Rules

Agents must explicitly cross-check the following for drift before generating the report:

1. **Checklist vs Ledger Drift**: Does the Task's internal `- [x]` checklist claim 100% completion, but the Task is still in the `ACTIVE` Ledger block?
2. **PM File Drift**: Does `Task_X.md` exist, but `Test_X.md` or `QA_X.md` is missing or unchecked?
3. **Roadmap vs Task Drift**: Is a Task actively being worked on that does not map to any Phase or Epic in `docs/loom_master_roadmap.md`?

*Drift Reaction*: If drift is detected, the agent MUST list the exact discrepancy under the "Blockers" or a special "Drift Warnings" section, and halt the promotion of the Task to `LOCKED` until human resolution.

## 6. Engineering Estimation Rules

To provide a repeatable and simple estimation model for future agents, we assign a baseline fixed weight to checklist items.

**The Baseline Model**:
- 1 Unchecked Task Item (`- [ ]`) = **0.5 Engineering Days**
- 1 Missing/Unchecked Test Item = **0.25 Engineering Days**
- 1 Missing/Unchecked QA Item = **0.25 Engineering Days**

**Calculation**:
- **Task Duration**: `(Unchecked Task Items * 0.5) + (Unchecked Test Items * 0.25) + (Unchecked QA Items * 0.25)`
- **Epic Duration**: Sum of all Task Durations in the Epic.
- **Phase Duration**: Sum of all Epic Durations in the Phase.
- **Overall Project Duration**: Sum of all Phase Durations.

*Note: This is an abstract velocity metric meant to track relative burndown, not a strict calendar commitment.*

## 7. Remaining Big Blocks

"Remaining Big Blocks" are generated dynamically by listing all **Phases** (from `docs/loom_master_roadmap.md`) that have a `Status` of `ACTIVE` or `NEXT`. 

*Example generation:*
1. P17 Memory Subsystem (ACTIVE)
2. P18 Agent Behavior (NEXT)
3. P20 Multi-Agent Execution Topology (NEXT)

## 8. Critical Path

The Critical Path is calculated by tracing the `Depends On` column in `docs/loom_master_roadmap.md` from the current `ACTIVE` Phase to the ultimate production launch Phase. Side branches (phases that no other phase depends on) are excluded.

*Example generation:*
P17 Memory Subsystem -> P18 Agent Behavior -> P20 Multi-Agent Topology

## 9. PM Skill Integration

Future PM agents must adhere to the following workflow to generate this report:

1. **Read Roadmap**: Parse `docs/loom_master_roadmap.md` to identify the `ACTIVE` Phase and its Epics.
2. **Read Task Files**: Parse `_PM/Agent-PM/Tasks/*.md` to count `- [ ]` and `- [x]` items for the current Epic/Phase.
3. **Read QA/Test Files**: Verify corresponding Test and QA checklists.
4. **Apply Estimation**: Multiply unchecked items by the weights defined in Section 6.
5. **Generate Output**: Format the results exactly as specified in Section 2 and 3.

## 10. Example Final Report

```text
### ROADMAP STATUS

**Current Phase**: P17 Memory Subsystem
**Current Epic**: Memory Core
**Current Task**: MEMORY-FORGET-001

**Phase Progress**: 81%
**Epic Progress**: 90%
**Overall Project Progress**: 75%

**Completed Since Last Report**:
- Implemented SQLite tombstoning for explicit memory.
- Added tests to Test_MEMORY-FORGET-001_v1.0.md.

**Remaining Tasks In Current Epic**:
- MEMORY-SYNC-002

**Remaining Tasks In Current Phase**:
- MEMORY-SYNC-002
- MEMORY-CLEANUP-001

**Critical Path**:
- P17 Memory Subsystem -> P18 Agent Behavior -> P20 Multi-Agent Topology

**Estimated Remaining Work**:
- Current Epic: 1.0 engineering days
- Current Phase: 3.5 engineering days
- Entire Project: 42.0 engineering days

**Remaining Big Blocks**:
1. P17 Memory Subsystem
2. P18 Agent Behavior
3. P20 Multi-Agent Execution Topology

**Dependencies**:
- None

**Blockers**:
- None

**Recommended Next Task**:
- MEMORY-SYNC-002

### LEDGER

**LOCKED**
- MEMORY-READ-POLICY-001 (P17, Memory Core)

**ACTIVE**
- MEMORY-FORGET-001 (P17, Memory Core)

**NEXT**
- MEMORY-SYNC-002 (P17, Memory Core)
- AGENT-BEHAVIOR-001 (P18, Core Logic)

**HOLD-BACKLOG**
- SETTINGS-IA-001 (P19, UI)
```
