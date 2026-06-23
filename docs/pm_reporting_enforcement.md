# PM Reporting Contract Enforcement

Status: ACTIVE
Task: PM-REPORTING-CONTRACT-ENFORCEMENT-001

## 1. Objective

To solve the persistent issue of inconsistent roadmap reporting across different AI agents (Claude, Gemini, Codex, and future agents). Currently, reporting is advisory, leading to differing progress percentages, differing ACTIVE/NEXT task assumptions, and divergent remaining work estimates. This document defines the strict enforcement layer that makes `docs/pm_reporting_contract.md` mandatory.

## 2. The Contract

**A task report missing any mandatory section is INVALID.** 

Any agent that completes a task, milestone, or emits a final status update MUST include the exact `ROADMAP STATUS` structure. If an agent outputs a report that skips sections, invents percentages, or guesses states, the report is rejected and must be regenerated following the strict derivation rules.

## 3. Mandatory Report Structure

The following exact structure must be present at the end of every agent task report:

```markdown
### ROADMAP STATUS

**Current Phase**: [Phase ID and Name]
**Current Epic**: [Epic Name]
**Current Task**: [Task ID]

### PROGRESS

**Overall Project Progress**: [Z]%
**Current Phase Progress**: [X]%
**Current Epic Progress**: [Y]%

### REMAINING BIG BLOCKS
1. [Block 1]
2. [Block 2]
...

### CRITICAL PATH
- [Ordered list of Phases/Tasks that gate production]

### ESTIMATED REMAINING WORK
- Current Epic: [N] engineering days
- Current Phase: [N] engineering days
- Entire Project: [N] engineering days

### LEDGER

**LOCKED**
- [Task ID] (Phase, Epic)

**ACTIVE**
- [Task ID] (Phase, Epic)

**NEXT**
- [Task ID] (Phase, Epic)

**HOLD-BACKLOG**
- [Task ID] (Phase, Epic)

### NEXT RECOMMENDED TASK
- [Exact Task ID]
```

## 4. Agent Enforcement Rules

All agents (Claude, Gemini, Codex, specialized PM agents, and future agents) must adhere to these derivation rules:

1. **Strict Sourcing**: Agents MUST derive values only from:
   - `docs/loom_master_roadmap.md`
   - `docs/pm_operating_model.md`
   - `docs/ledger_contract.md`
   - `docs/pm_reporting_contract.md`
2. **No Invention**: Agents MUST NOT invent percentages. Percentages must be strictly calculated using the formulas in `pm_reporting_contract.md` Section 4 (derived from physical `- [x]` checklists in the `_PM/Agent-PM/Tasks/` directory).
3. **No Guessing**: Agents MUST NOT guess `ACTIVE` or `NEXT` tasks. Selection must strictly follow the priority queue logic defined in `pm_operating_model.md` Sections 3 and 4.
4. **No Stale Values**: Agents MUST NOT use stale ledger prose (e.g., historical ledger files that are deprecated). They must actively regenerate the ledger blocks from the live roadmap and task states.

## 5. Drift Detection (`report_drift_detected`)

A strict system event or state flag called `report_drift_detected` must be triggered by any agent (or validation script) when:

- The reported `ACTIVE` task differs from the canonical `docs/loom_master_roadmap.md` without formal promotion.
- The reported progress percentage mathematically differs from the physical checklist count.
- The reported critical path deviates from the dependency tree established in the roadmap.
- The estimated remaining work differs from the formula `(Unchecked Task Items * 0.5) + (Unchecked Test Items * 0.25) + (Unchecked QA Items * 0.25)`.

When `report_drift_detected` is true:
1. The promotion of any task to `LOCKED` is halted.
2. The agent must append a `### DRIFT WARNING` block to the report explaining the discrepancy.
3. The discrepancy must be resolved by a human or a dedicated PM-reconciliation turn before normal execution resumes.

## 6. Recommendations for Governance Docs

### 6.1 AGENTS.md Additions

Replace the existing ad-hoc reporting rules in Section 12 and 13 with a hard mandate to follow the new PM reporting enforcement contract:
- **Rule addition**: "Every task completion report must strictly include the `ROADMAP STATUS` block as defined in `docs/pm_reporting_enforcement.md` and `docs/pm_reporting_contract.md`. Reports missing sections, containing guessed percentages, or relying on stale ledger values are contract violations."
- **Rule addition**: "Agents must run the `report_drift_detected` check before finalizing their turn. If drift is detected, they must halt `LOCKED` promotion and output a `### DRIFT WARNING`."

### 6.2 CLAUDE.md Additions

For Claude (and any model using project-specific instructions):
- **Rule addition**: "You are bound by the PM Reporting Contract (`docs/pm_reporting_enforcement.md`). Do not invent progress. You must mathematically derive progress from `_PM/Agent-PM/Tasks/` checklists. Do not guess `NEXT` tasks; use the logic in `docs/pm_operating_model.md`. Your final output for any task MUST include the exact `ROADMAP STATUS` structure."

### 6.3 PM Skill Additions

For specialized PM agents/skills:
- **Skill update**: The PM skill script must programmatically run the `report_drift_detected` check by comparing the agent's proposed output variables against the physical files. 
- **Skill update**: The PM skill should automatically pull the `Depends On` column from `docs/loom_master_roadmap.md` to deterministically print the `CRITICAL PATH` section. 
