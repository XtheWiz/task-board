# Task Board

A lightweight MCP task board for AI agent teams. Agents receive tasks, post updates, and complete work — all through MCP tools. No channels, no chat, no noise.

Built for multi-agent workflows where a coordinator assigns tasks to specialized agents (backend, frontend, QA, etc.) and tracks progress.

## Why

When running multiple AI agents (Claude Code tabs, Codex, Gemini CLI), they need a way to coordinate. Chat channels are noisy and token-expensive. File-based handoffs get messy at scale.

Task Board gives each agent exactly what it needs: **its current task, nothing more.**

| Feature                        | Chat channels | File-based       | Task Board |
| ------------------------------ | ------------- | ---------------- | ---------- |
| Token cost per interaction     | ~200-600      | 0 (manual carry) | ~50        |
| Agent sees irrelevant messages | Yes           | N/A              | No         |
| Scales with team size          | Poorly        | Poorly           | Well       |
| Project file clutter           | None          | Yes              | None       |
| Structured task scoping        | No            | Manual           | Built-in   |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+

### Install

```bash
git clone https://github.com/XtheWiz/task-board.git
cd task-board
bun install
```

### Add to Claude Code

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "taskboard": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/task-board/src/index.ts"],
      "env": {
        "TASKBOARD_DB": "/absolute/path/to/taskboard.db"
      }
    }
  }
}
```

The `TASKBOARD_DB` path controls where the SQLite database is stored. Keep it outside your project to avoid git clutter. If omitted, defaults to `taskboard.db` in the current directory.

## Tools

### `create_task`

Assign a task to a role with scope and done criteria.

```
create_task({
  role: "backend",
  title: "Add rate limiting to auth endpoints",
  description: "Login and register endpoints need rate limiting to prevent brute force",
  scope: ["Add rate limiter middleware", "Apply to /auth/* routes"],
  context_files: ["src/middleware/auth.ts", "src/routes/auth.ts"],
  constraints: {
    must: ["Use sliding window algorithm", "Return 429 with Retry-After header"],
    must_not: ["Change existing auth logic", "Add new dependencies"]
  },
  done_when: "Rate limiter active on auth routes, returns 429 after 5 attempts per minute"
})
```

### `receive_task`

Pull your current task. Automatically marks it as `in_progress`.

```
receive_task({ role: "backend" })
```

Returns the oldest pending/in-progress task for that role. If a task is `pending`, it transitions to `in_progress` when received.

### `update_task`

Post a progress update or change task status.

```
update_task({
  task_id: "abc-123",
  status: "blocked",
  message: "Need Redis connection config before implementing sliding window"
})
```

### `complete_task`

Mark a task as done with a summary of what was accomplished. Optionally include a verdict for quality-gate workflows.

```
complete_task({
  task_id: "abc-123",
  summary: "Added sliding window rate limiter in src/middleware/rate-limit.ts. Applied to all /auth/* routes. Tests pass.",
  verdict: "PASS"
})
```

Verdict values: `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`. Useful for QA tasks where downstream routing depends on the outcome. The verdict is stored and shown in `list_tasks` output.

### `list_tasks`

See all tasks, optionally filtered by role and/or status. Done tasks older than 30 days are auto-archived (hidden by default).

```
list_tasks({})                                          // Active + recent done
list_tasks({ role: "backend" })                         // Backend's tasks
list_tasks({ status: "pending" })                       // All pending
list_tasks({ role: "qa", status: "done" })              // QA's completed tasks
list_tasks({ include_archived: true })                  // Include tasks done 30+ days ago
```

## Task Dependencies

Tasks can declare dependencies on other tasks. A dependent task won't be returned by `receive_task` until all its dependencies are done.

```
// Create a dev task
create_task({
  role: "backend",
  title: "Fix auth middleware",
  done_when: "401 errors resolved"
})
// → returns task with id "task-A"

// Create a QA task that depends on the dev task
create_task({
  role: "qa",
  title: "Retest auth flow",
  done_when: "Auth flow verified on device",
  depends_on: ["task-A"]
})

// QA calls receive_task — gets nothing (task-A not done yet)
receive_task({ role: "qa" })
// → "No pending tasks for role: qa"

// After backend completes task-A, QA can now receive the retest task
receive_task({ role: "qa" })
// → returns the retest task
```

## Task Templates

Save reusable task templates to avoid repeating the same scope, constraints, and done_when for recurring task types (e.g., QA retests, bug fixes, code reviews).

### `save_template`

```
save_template({
  name: "qa-retest",
  role: "qa",
  title_template: "QA: Retest {suffix}",
  scope: ["Verify fix on device", "Screenshot proof for each step"],
  constraints: { must: ["Use production environment"], must_not: ["Skip screenshot proof"] },
  done_when: "All fixes verified with screenshots"
})
```

### `create_from_template`

Create a task from a template. Optionally link to a parent task — `context_files` are inherited automatically.

```
create_from_template({
  template: "qa-retest",
  parent_task_id: "task-A",
  title_suffix: "auth middleware fix"
})
// → Creates "QA: Retest auth middleware fix" with parent's context_files
```

### `list_templates`

```
list_templates({})
// → [{ name: "qa-retest", role: "qa", title: "QA: Retest {suffix}", ... }]
```

## Workflow Example

```
Coordinator session:
  → create_task(role: "backend", title: "Add rate limiting", done_when: "...")

Backend session:
  → receive_task(role: "backend")    // Gets the task, marks in_progress
  → (does the work)
  → update_task(task_id, message: "Middleware done, writing tests")
  → complete_task(task_id, summary: "Rate limiter added, 12 tests pass")

Coordinator session:
  → list_tasks()                     // Sees all tasks with statuses
```

### Pipeline workflow with dependencies

```
Coordinator:
  → dev_task = create_task(role: "backend", title: "Fix bug", ...)
  → create_task(role: "qa", title: "Retest fix", depends_on: [dev_task.id], ...)

Backend:
  → receive_task(role: "backend")    // Gets fix task
  → complete_task(task_id, summary: "Fixed", verdict: "PASS")

QA (auto-unblocked):
  → receive_task(role: "qa")         // Now available — dependency met
  → complete_task(task_id, summary: "Verified", verdict: "PASS")
```

## Trello Integration

Bridge human project management with AI agent execution. Tag Trello cards with `[agent]` and they sync into Task Board.

### How it works

1. **Humans** create cards on Trello as usual
2. **You** review and add an `[agent]` label (or title prefix like `[backend]`, `[qa]`)
3. **`sync_trello`** pulls tagged cards into Task Board as tasks
4. **Agents** receive and complete tasks normally
5. **`complete_task`** auto-pushes results back — moves card to "Review" list with a summary comment

### Setup

Add Trello env vars to your MCP config:

```json
{
  "mcpServers": {
    "taskboard": {
      "command": "bun",
      "args": ["run", "/path/to/task-board/src/index.ts"],
      "env": {
        "TASKBOARD_DB": "/path/to/taskboard.db",
        "TRELLO_API_KEY": "your-api-key",
        "TRELLO_TOKEN": "your-token",
        "TRELLO_BOARD_ID": "your-board-id",
        "TRELLO_REVIEW_LIST": "Review"
      }
    }
  }
}
```

Get your API key at [trello.com/app-key](https://trello.com/app-key). Generate a token with read/write access.

### Role mapping

| Trello card                     | Task Board role            |
| ------------------------------- | -------------------------- |
| `[agent]` label or title prefix | `po` (coordinator triages) |
| `[backend]` label or prefix     | `backend`                  |
| `[qa]` label or prefix          | `qa`                       |
| `[anything]`                    | That role name             |

Labels take priority over title prefixes.

### Smart description parsing

If a Trello card description contains structured headers, they're extracted:

```
Scope:
- Add rate limiter middleware
- Apply to /auth/* routes

Done when: Rate limiter returns 429 after 5 attempts

The login endpoint is getting hit by bots.
```

Parsed as:

- `scope`: `["Add rate limiter middleware", "Apply to /auth/* routes"]`
- `done_when`: `"Rate limiter returns 429 after 5 attempts"`
- `description`: `"The login endpoint is getting hit by bots."`

If no headers are found, the full description is used as-is and `done_when` defaults to `"PO to define"`.

### `sync_trello`

Pull `[agent]`-tagged cards from Trello. Only fetches cards modified since last sync.

```
sync_trello({})
// → "Synced: 3 new task(s) created, 1 already synced"
```

### `push_trello`

Manually push a task back to Trello (auto-fires on `complete_task` for linked cards).

```
push_trello({ task_id: "abc-123" })
// → "Card moved to Review with summary comment"
```

## Task Lifecycle

```
pending → in_progress → done (with optional verdict)
                ↓
             blocked
```

- Tasks are created as `pending`
- `receive_task` automatically transitions to `in_progress` (skips tasks with unmet dependencies)
- Agents can mark tasks as `blocked` with a reason
- `complete_task` marks as `done` with a summary and optional verdict (`PASS`/`FAIL`/`PARTIAL`/`BLOCKED`)
- Done tasks older than 30 days are auto-archived (hidden from `list_tasks` by default)

## Metrics

Get computed stats from your task history — cycle time, rejection rates, throughput, and fix loop analysis. All derived from existing task data, no extra tracking required.

### `task_metrics`

```
task_metrics({})                    // Full dashboard (last 30 days)
task_metrics({ role: "qa" })        // QA-specific stats
task_metrics({ days: 7 })           // Last 7 days only
```

Example output:

```
=== Task Metrics (last 30 days) ===
Total tasks: 69
Throughput: 8.5 tasks/day (8 active days)

Cycle time (avg):
  devteam: 1h 42m (12 tasks)
  qa: 38m (8 tasks)
  qa2: 44m (5 tasks)

Verdict breakdown by role:
  devteam: 10P 0F 0PT 0BL 2? (0% non-pass)
  qa: 5P 0F 2PT 1BL 0? (38% non-pass)
  qa2: 1P 0F 0PT 3BL 1? (60% non-pass)

Verdict totals: PASS:16 FAIL:0 PARTIAL:2 BLOCKED:4 none:3

Avg fix loops: 2.3 rounds per parent task

Daily throughput (last 7 days):
  2026-04-08: 12 tasks
  2026-04-07: 10 tasks
```

**What each metric tells you:**

- **Cycle time** — which roles are fast/slow? Is QA bottlenecked?
- **Rejection rate** — "QA rejects 40% of DevTeam work" → systemic quality issue
- **Fix loops** — how many rounds does it take to get to PASS? High = fix quality problem
- **Throughput** — are you speeding up or slowing down?

## Configuration

| Environment Variable | Default        | Description                                 |
| -------------------- | -------------- | ------------------------------------------- |
| `TASKBOARD_DB`       | `taskboard.db` | Path to SQLite database file                |
| `TRELLO_API_KEY`     | —              | Trello API key (optional, for Trello sync)  |
| `TRELLO_TOKEN`       | —              | Trello user token with read/write access    |
| `TRELLO_BOARD_ID`    | —              | Trello board ID to sync                     |
| `TRELLO_REVIEW_LIST` | `Review`       | Name of the Trello list for completed tasks |

## Changelog

### v0.3.1

- **Task metrics** — `task_metrics` tool computes cycle time per role, rejection rates, verdict distribution, daily throughput, and fix loop analysis from existing task data. Filter by role or time period.

### v0.3.0

- **Verdict on complete_task** — optional `verdict` field (`PASS`/`FAIL`/`PARTIAL`/`BLOCKED`) for quality-gate workflows. Stored in DB, visible in `list_tasks`.
- **Task dependencies** — `depends_on` field on `create_task`. Tasks with unmet dependencies are skipped by `receive_task` until all dependencies are done.
- **Task templates** — `save_template`, `create_from_template`, `list_templates` tools. Define reusable task shapes with `{suffix}` placeholders. Templates inherit `context_files` from parent tasks for traceability.
- **Auto-archive** — `list_tasks` hides done tasks older than 30 days by default. Use `include_archived: true` to see everything.
- **Parent task linking** — `parent_task_id` field on `create_task` links related tasks for context chain (e.g., a QA retest linked to the dev fix it's verifying).

### v0.2.0

- Trello integration (`sync_trello`, `push_trello`)
- Auto-push to Trello on `complete_task` for linked cards
- Smart description parsing from Trello card content

### v0.1.0

- Initial release — `create_task`, `receive_task`, `update_task`, `complete_task`, `list_tasks`

## License

MIT
