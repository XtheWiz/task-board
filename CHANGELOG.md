# Changelog

All notable changes to task-board are documented here.

## [0.6.0] — 2026-04-19

### Added

- **Pagination on `list_tasks`**: `limit` (default 50), `offset`, `since`, `until` params. Response includes `total_count`.
- **`CANCELLED` verdict**: new verdict value for intentionally skipped tasks. Excluded from cycle-time and rejection-rate metrics.
- **`cancel_task(task_id, reason, cancelled_by?)`**: convenience tool — marks a task done with verdict=CANCELLED.
- **`edit_task(task_id, fields, edited_by?)`**: edit mutable fields on pending/in_progress tasks with full `edit_history` audit log.
- **`bulk_create_tasks(tasks[])`**: atomically create multiple tasks in one call.
- **`bulk_complete(completions[])`**: atomically complete multiple tasks in one call.

### Changed

- `task_metrics` now excludes CANCELLED tasks from cycle-time and rejection-rate; shows CANCELLED as its own bucket in `verdict_distribution`.
- `complete_task` verdict enum now includes `CANCELLED`.

### Backwards compatible

- `list_tasks` callers without pagination params receive first 50 results (same as before).
- No schema changes break existing tasks.

---

## [0.5.0] — 2026-04-19

### Added

- **`auto_chain_on_fail(qa_task_id, fix_role?)`**: single call fans out from a QA FAIL — creates devteam-fix + qa-retest with `parent_task_id` and `depends_on` wired up automatically.
- **Verdict role check on `complete_task`**: PASS/FAIL/PARTIAL restricted to `qa`/`qa2` roles. Stops DevTeam self-approving fixes.
- **`allow_self_pass` flag on `create_task`**: opt-out of QA-only verdict restriction for infra/devops tasks (default `false`).
- **`list_chain(root_task_id)`**: recursive walk of full parent+depends_on chain from a root task. Cycle-safe.
- **Atomic `receive_task`**: SQLite transaction + `claimed_by` stamp prevents double-claim between parallel sub-agents.

### Changed

- `complete_task` gains `from` param for verdict attribution. Missing `from` with a verdict logs a warning and accepts (grace period).
- BLOCKED verdict remains unrestricted (anyone can set it).

---

## [0.4.1] — 2026-04-19

### Added

- **`create_trello_card`**: create a Trello card for a task filed directly in Task Board. Stores card URL back on the task for future auto-push.

---

## [0.4.0] — 2026-04-17

### Added

- **Typed updates**: `update_task` accepts `type` (`progress`/`question`/`answer`/`finding`/`blocker`) and `from` (role name).
- **Cross-agent posting**: any agent can post on any task.
- **`list_questions`**: find tasks with unanswered questions.
- **`list_subtasks`**: list subtasks of a parent task with progress rollup.

---

## [0.3.1] — 2026-04-15

### Added

- **`task_metrics`**: cycle time, rejection rates, verdict distribution, throughput, fix loop analysis.

---

## [0.3.0] — 2026-04-14

### Added

- **Verdict on `complete_task`**: `PASS`/`FAIL`/`PARTIAL`/`BLOCKED`.
- **Task dependencies**: `depends_on` field; tasks with unmet deps skipped by `receive_task`.
- **Task templates**: `save_template`, `create_from_template`, `list_templates`.
- **Auto-archive**: done tasks >30 days hidden by default.
- **Parent task linking**: `parent_task_id` for context chains.
