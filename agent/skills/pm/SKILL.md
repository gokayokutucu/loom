# Global Rule: Agent Project Management (Agent-PM) Protocol

## 1. The `_PM` Directory Mandate
For every project or workspace, you (the Agent) must initialize and rigorously maintain a local project management tracking system inside a root `_PM/Agent-PM/` directory. 

Do not rely solely on conversational memory. You must document, version, and track all work within this folder structure:

_PM/
└── Agent-PM/
    ├── Docs/
    │   ├── ADRs/      # Architectural Decision Records
    │   └── Guides/    # User Guides, API Docs, Setup Instructions
    ├── Plans/         # Versioned Implementation Plans
    ├── QA/            # Versioned QA checklists and audit reports
    ├── Tasks/         # Versioned task lists with state tracking
    └── Tests/         # Versioned test execution plans

## 2. Versioning & Tracking Protocols

Whenever you generate a plan, execute a task, or run a test, you MUST adhere to the following file management rules:

### A. Plans (`_PM/Agent-PM/Plans/`)
* **Rule:** Every time a new implementation phase is discussed, create a versioned plan document (e.g., `Phase1_Auth_v1.0.md`).
* **Content:** Include the objective, scope, and technical prerequisites. If a plan changes, do not overwrite the old one; create `v1.1.md` and explicitly state what changed in the changelog section.

### B. Tasks (`_PM/Agent-PM/Tasks/`)
* **Rule:** Break down Plans into actionable, versioned task files (e.g., `Task_Setup_Postgres_v1.0.md`).
* **Tracking:** Tasks MUST use Markdown checklists (`- [ ]`). 
* **State Updates:** As you complete steps in the codebase, you must return to the active Task file and update the state to checked (`- [x]`). 

### C. Tests (`_PM/Agent-PM/Tests/`)
* **Rule:** Before writing complex logic, define the test parameters in a versioned test file (e.g., `Test_i18n_Routing_v1.0.md`).
* **Tracking:** Include expected inputs and outputs using checklists. Once the actual code passes the test, check off the item (`- [x]`).

### D. QA (`_PM/Agent-PM/QA/`)
* **Rule:** Use this folder for post-implementation quality assurance checklists (e.g., `QA_Mobile_Responsiveness_v1.0.md`).
* **Tracking:** Check off items only after verifying no regressions exist in the primary application. 

### E. Documentation (`_PM/Agent-PM/Docs/`)
* **ADRs (`/ADRs/`):** For every major architecture choice (e.g., "Choosing Redis for Cache-Aside"), create an Architectural Decision Record using a standard format (Context, Decision, Consequences).
* **Guides (`/Guides/`):** Maintain living documentation for how to spin up the local environment, manage tenant provisioning, or deploy the application.

## 3. Execution Trigger
When a human says "Initialize PM", "Start Planning", or begins a new complex task, you must first verify this directory structure exists. If it does not, scaffold the folders immediately before writing any application code.