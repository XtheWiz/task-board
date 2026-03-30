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

Mark a task as done with a summary of what was accomplished.

```
complete_task({
  task_id: "abc-123",
  summary: "Added sliding window rate limiter in src/middleware/rate-limit.ts. Applied to all /auth/* routes. Tests pass."
})
```

### `list_tasks`

See all tasks, optionally filtered by role and/or status.

```
list_tasks({})                              // All tasks
list_tasks({ role: "backend" })             // Backend's tasks
list_tasks({ status: "pending" })           // All pending
list_tasks({ role: "qa", status: "done" })  // QA's completed tasks
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
pending → in_progress → done
                ↓
             blocked
```

- Tasks are created as `pending`
- `receive_task` automatically transitions to `in_progress`
- Agents can mark tasks as `blocked` with a reason
- `complete_task` marks as `done` with a summary

## Configuration

| Environment Variable | Default        | Description                                 |
| -------------------- | -------------- | ------------------------------------------- |
| `TASKBOARD_DB`       | `taskboard.db` | Path to SQLite database file                |
| `TRELLO_API_KEY`     | —              | Trello API key (optional, for Trello sync)  |
| `TRELLO_TOKEN`       | —              | Trello user token with read/write access    |
| `TRELLO_BOARD_ID`    | —              | Trello board ID to sync                     |
| `TRELLO_REVIEW_LIST` | `Review`       | Name of the Trello list for completed tasks |

## License

MIT
