# QA AGENT-RUN-INSPECTOR-PERSISTENCE-001 v1.0

## QA Checklist

- [x] UI remains under Settings / Advanced / Experimental Agent Run Inspector.
- [x] Live transient run testing remains available.
- [x] Durable history is Loom-scoped.
- [x] Durable run summaries do not include prompt text.
- [x] Durable event display does not include provider delta text.
- [x] Durable event display does not include tool output summaries.
- [x] Durable event display does not include raw thinking markers.
- [x] Durable event display does not include credentials or secret markers.
- [x] Main generation remains untouched.
- [x] Quick Ask remains untouched.
- [x] Full validation results recorded.
- [x] Commit hash recorded in final task report.

## Known Limitations

- Recent Runs requires a Loom ID because the current service list endpoint is Loom-scoped.
- This task does not add a global Agent Run history browser.
- This task does not modify service persistence contracts.
