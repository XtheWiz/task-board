# Task Board

A lightweight MCP task board for AI agent teams. Agents receive tasks, post updates, and complete work — all through MCP tools. No channels, no chat, no noise.

Built for multi-agent workflows where a coordinator (like a Product Owner) assigns tasks to specialized agents (DevTeam, QA, UXUI, etc.) and tracks progress.

## Why

When running multiple AI agents (Claude Code tabs, Codex, Gemini CLI), they need a way to coordinate. Chat channels are noisy and token-expensive. File-based handoffs get messy at scale.

Task Board gives each agent exactly what it needs: **its current task, nothing more.**

| Feature                        | Chat/Walkie | File-based       | Task Board |
| ------------------------------ | ----------- | ---------------- | ---------- |
| Token cost per interaction     | ~200-600    | 0 (manual carry) | ~50        |
| Agent sees irrelevant messages | Yes         | N/A              | No         |
| Scales with team size          | Poorly      | Poorly           | Well       |
| Project file clutter           | None        | Yes              | None       |
| Structured task scoping        | No          | Manual           | Built-in   |

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
  role: "devteam",
  title: "Fix playStyles bug in create match flow",
  description: "Match Vibe toggle doesn't populate playStyles list",
  scope: ["Fix create_match_screen.dart"],
  context_files: ["apps/mobile/lib/presentation/screens/create_match_screen.dart"],
  constraints: {
    must: ["Sync matchVibe to selectedPlayStyles"],
    must_not: ["Change the Match Vibe UI"]
  },
  done_when: "Match submits with correct playStyles payload"
})
```

### `receive_task`

Pull your current task. Automatically marks it as `in_progress`.

```
receive_task({ role: "devteam" })
```

Returns the oldest pending/in-progress task for that role. If a task is `pending`, it transitions to `in_progress` when received.

### `update_task`

Post a progress update or change task status.

```
update_task({
  task_id: "abc-123",
  status: "blocked",
  message: "Waiting for API contract update from backend team"
})
```

### `complete_task`

Mark a task as done with a summary of what was accomplished.

```
complete_task({
  task_id: "abc-123",
  summary: "Fixed in create_match_screen.dart:291-293. Synced matchVibe → selectedPlayStyles. Tests pass (648 green)."
})
```

### `list_tasks`

See all tasks, optionally filtered by role and/or status.

```
list_tasks({})                          // All tasks
list_tasks({ role: "devteam" })         // DevTeam's tasks
list_tasks({ status: "pending" })       // All pending
list_tasks({ role: "qa", status: "done" }) // QA's completed tasks
```

## Workflow Example

```
PO session:
  → create_task(role: "devteam", title: "Fix X", done_when: "...")

DevTeam session:
  → receive_task(role: "devteam")    // Gets the task, marks in_progress
  → (does the work)
  → update_task(task_id, message: "halfway done, tests passing")
  → complete_task(task_id, summary: "Fixed in file.dart, commit abc123")

PO session:
  → list_tasks()                     // Sees all tasks with statuses
```

## Task Lifecycle

```
pending → in_progress → done
                ↓
             blocked
```

- Tasks are created as `pending`
- `receive_task` automatically transitions to `in_progress`
- Agents can mark tasks as `blocked` with a reason
- `complete_task` marks as `done` with a summary

## Configuration

| Environment Variable | Default        | Description                  |
| -------------------- | -------------- | ---------------------------- |
| `TASKBOARD_DB`       | `taskboard.db` | Path to SQLite database file |

## License

MIT
