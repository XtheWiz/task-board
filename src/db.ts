import { Database } from "bun:sqlite";
import { randomUUIDv7 } from "bun";
import type {
  Task,
  TaskStatus,
  TaskVerdict,
  TaskUpdate as TaskUpdateType,
  UpdateType,
  CreateTaskInput,
  TaskTemplate,
  TaskMetrics,
} from "./types.ts";

const DB_PATH = process.env["TASKBOARD_DB"] || "taskboard.db";

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH, { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        scope TEXT,
        context_files TEXT,
        constraints TEXT,
        done_when TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        summary TEXT,
        updates TEXT DEFAULT '[]',
        trello_card_id TEXT,
        trello_board_id TEXT,
        trello_card_url TEXT
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    // Migrate existing DBs — add columns if missing
    const migrations = [
      "ALTER TABLE tasks ADD COLUMN trello_card_id TEXT",
      "ALTER TABLE tasks ADD COLUMN trello_board_id TEXT",
      "ALTER TABLE tasks ADD COLUMN verdict TEXT",
      "ALTER TABLE tasks ADD COLUMN depends_on TEXT",
      "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT",
      "ALTER TABLE tasks ADD COLUMN trello_card_url TEXT",
      "ALTER TABLE tasks ADD COLUMN allow_self_pass INTEGER DEFAULT 0",
      "ALTER TABLE tasks ADD COLUMN claimed_by TEXT",
    ];
    for (const sql of migrations) {
      try {
        db.exec(sql);
      } catch {}
    }

    // Templates table
    db.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        title_template TEXT NOT NULL,
        description_template TEXT,
        scope TEXT,
        constraints TEXT,
        done_when TEXT NOT NULL
      )
    `);
  }
  return db;
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row["id"] as string,
    role: row["role"] as string,
    title: row["title"] as string,
    description: row["description"] as string | undefined,
    scope: parseJson(row["scope"] as string | null),
    context_files: parseJson(row["context_files"] as string | null),
    constraints: parseJson(row["constraints"] as string | null),
    done_when: row["done_when"] as string,
    status: row["status"] as TaskStatus,
    assigned_at: row["assigned_at"] as string,
    completed_at: row["completed_at"] as string | undefined,
    summary: row["summary"] as string | undefined,
    updates: parseJson(row["updates"] as string | null) ?? [],
    verdict: (row["verdict"] as TaskVerdict) || undefined,
    depends_on: parseJson(row["depends_on"] as string | null),
    parent_task_id: (row["parent_task_id"] as string) || undefined,
    trello_card_id: (row["trello_card_id"] as string) || undefined,
    trello_board_id: (row["trello_board_id"] as string) || undefined,
    trello_card_url: (row["trello_card_url"] as string) || undefined,
    allow_self_pass: row["allow_self_pass"]
      ? Boolean(row["allow_self_pass"])
      : false,
    claimed_by: (row["claimed_by"] as string) || undefined,
  };
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function createTask(input: CreateTaskInput): Task {
  const id = randomUUIDv7();
  const stmt = getDb().prepare(`
    INSERT INTO tasks (id, role, title, description, scope, context_files, constraints, done_when, depends_on, parent_task_id, trello_card_id, trello_board_id, allow_self_pass)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    input.role.toLowerCase(),
    input.title,
    input.description ?? null,
    input.scope ? JSON.stringify(input.scope) : null,
    input.context_files ? JSON.stringify(input.context_files) : null,
    input.constraints ? JSON.stringify(input.constraints) : null,
    input.done_when,
    input.depends_on ? JSON.stringify(input.depends_on) : null,
    input.parent_task_id ?? null,
    input.trello_card_id ?? null,
    input.trello_board_id ?? null,
    input.allow_self_pass ? 1 : 0,
  );
  return getTask(id)!;
}

export function getTask(id: string): Task | null {
  const row = getDb()
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  return row ? rowToTask(row) : null;
}

export function receiveTask(role: string): Task | null {
  const normalizedRole = role.toLowerCase();
  const claimStamp = `${normalizedRole}-${Date.now()}`;

  // Atomic claim: use a transaction so two simultaneous callers can't double-claim.
  // Priority: pending tasks first, then unclaimed in_progress (legacy/orphaned).
  return getDb().transaction(() => {
    const rows = getDb()
      .prepare(
        "SELECT * FROM tasks WHERE role = ? AND status IN ('pending', 'in_progress') ORDER BY assigned_at ASC",
      )
      .all(normalizedRole) as Record<string, unknown>[];

    let legacyInProgress: Task | null = null;

    for (const row of rows) {
      const task = rowToTask(row);
      if (!areDependenciesMet(task)) continue;

      if (task.status === "pending") {
        // Claim this pending task atomically
        getDb()
          .prepare(
            "UPDATE tasks SET status = 'in_progress', claimed_by = ? WHERE id = ?",
          )
          .run(claimStamp, task.id);
        return getTask(task.id);
      }

      // in_progress + already claimed — skip (another agent holds it)
      if (task.claimed_by) continue;

      // in_progress + no claimed_by — legacy task, keep as fallback
      if (!legacyInProgress) legacyInProgress = task;
    }

    // No pending tasks — claim the first unclaimed in_progress (legacy)
    if (legacyInProgress) {
      getDb()
        .prepare("UPDATE tasks SET claimed_by = ? WHERE id = ?")
        .run(claimStamp, legacyInProgress.id);
      return getTask(legacyInProgress.id);
    }
    return null;
  })();
}

export function updateTask(
  id: string,
  status?: TaskStatus,
  message?: string,
  type?: UpdateType,
  from?: string,
): Task | null {
  const task = getTask(id);
  if (!task) return null;

  if (status) {
    getDb().prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  }

  if (message) {
    const updates: TaskUpdateType[] = task.updates ?? [];
    const entry: TaskUpdateType = {
      timestamp: new Date().toISOString(),
      message,
    };
    if (type) entry.type = type;
    if (from) entry.from = from;
    updates.push(entry);
    getDb()
      .prepare("UPDATE tasks SET updates = ? WHERE id = ?")
      .run(JSON.stringify(updates), id);
  }

  return getTask(id);
}

/** List subtasks of a parent task */
export function listSubtasks(parentId: string): Task[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY assigned_at ASC",
    )
    .all(parentId) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

/** Check if a task has unresolved questions (question without a following answer) */
function hasUnresolvedQuestions(task: Task): boolean {
  const updates = task.updates ?? [];
  let unanswered = 0;
  for (const u of updates) {
    if (u.type === "question") unanswered++;
    if (u.type === "answer") unanswered = Math.max(0, unanswered - 1);
  }
  return unanswered > 0;
}

/** List tasks that have unanswered questions */
export function listTasksWithQuestions(role?: string): Task[] {
  const tasks = listTasks(role, undefined, false);
  return tasks.filter((t) => t.status !== "done" && hasUnresolvedQuestions(t));
}

const VERDICT_QA_ROLES = new Set(["qa", "qa2"]);

export function completeTask(
  id: string,
  summary: string,
  verdict?: TaskVerdict,
  from?: string,
): Task | (Task & { _warning: string }) | null {
  const task = getTask(id);
  if (!task) return null;

  // Verdict role check: PASS/FAIL/PARTIAL restricted to qa/qa2 unless allow_self_pass
  if (verdict && verdict !== "BLOCKED") {
    const caller = from?.toLowerCase();
    if (!caller) {
      // Grace period: log warning but allow
      console.warn(
        `[verdict_role_check] complete_task called with verdict=${verdict} but no 'from' field — accepted with warning (grace period)`,
      );
    } else if (!VERDICT_QA_ROLES.has(caller) && !task.allow_self_pass) {
      return {
        ...task,
        _warning: `REJECTED: Only qa/qa2 may set verdict=${verdict}. Use allow_self_pass=true at task creation for infra/devops tasks. Caller: ${caller}`,
      } as Task & { _warning: string };
    }
  }

  if (verdict) {
    getDb()
      .prepare(
        "UPDATE tasks SET status = 'done', completed_at = datetime('now'), summary = ?, verdict = ? WHERE id = ?",
      )
      .run(summary, verdict, id);
  } else {
    getDb()
      .prepare(
        "UPDATE tasks SET status = 'done', completed_at = datetime('now'), summary = ? WHERE id = ?",
      )
      .run(summary, id);
  }

  return getTask(id);
}

/** Fan-out: create devteam-fix + qa-retest chain from a QA FAIL task in one call. */
export function autoChainOnFail(
  qaTaskId: string,
  fixRole: string = "devteam",
): { fixTask: Task; retestTask: Task } | { error: string } {
  const qaTask = getTask(qaTaskId);
  if (!qaTask) return { error: `QA task not found: ${qaTaskId}` };

  const fixTask = createTask({
    role: fixRole,
    title: `Fix: ${qaTask.title}`,
    description: `Auto-created from QA FAIL.\n\nParent QA task: ${qaTask.title} (${qaTaskId})\n\nFAIL summary:\n${qaTask.summary ?? "(no summary yet)"}`,
    done_when:
      "Bug is fixed, all acceptance criteria from parent QA task pass.",
    parent_task_id: qaTaskId,
    context_files: qaTask.context_files,
  });

  // Use qa-test template if it exists, otherwise create a basic retest task
  const tmpl = getTemplate("qa-test");
  let retestTask: Task;
  if (tmpl) {
    const fromTemplate = createTaskFromTemplate(
      "qa-test",
      qaTaskId,
      qaTask.title,
    );
    if (!fromTemplate) {
      return { error: "Failed to create retest task from qa-test template" };
    }
    // Inject depends_on after creation
    getDb()
      .prepare("UPDATE tasks SET depends_on = ? WHERE id = ?")
      .run(JSON.stringify([fixTask.id]), fromTemplate.id);
    retestTask = getTask(fromTemplate.id)!;
  } else {
    retestTask = createTask({
      role: "qa",
      title: `Retest: ${qaTask.title}`,
      description: `Auto-created retest for fix task ${fixTask.id}.\n\nOriginal QA FAIL: ${qaTask.title} (${qaTaskId})`,
      done_when:
        "All items from original QA task pass on simulator. Screenshot evidence attached.",
      depends_on: [fixTask.id],
      parent_task_id: qaTaskId,
      context_files: qaTask.context_files,
    });
  }

  return { fixTask, retestTask };
}

/** Walk the full task chain rooted at root_task_id. Returns ordered list of all linked tasks. */
export function listChain(rootTaskId: string): Task[] | { error: string } {
  const root = getTask(rootTaskId);
  if (!root) return { error: `Task not found: ${rootTaskId}` };

  const visited = new Set<string>();
  const result: Task[] = [];

  function collect(task: Task) {
    if (visited.has(task.id)) return; // cycle guard
    visited.add(task.id);
    result.push(task);

    // Walk down: direct children via parent_task_id
    const children = getDb()
      .prepare(
        "SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY assigned_at ASC",
      )
      .all(task.id) as Record<string, unknown>[];
    for (const row of children) {
      collect(rowToTask(row));
    }

    // Walk sideways: tasks that depend on this task (reverse depends_on)
    const dependents = getDb()
      .prepare("SELECT * FROM tasks ORDER BY assigned_at ASC")
      .all() as Record<string, unknown>[];
    for (const row of dependents) {
      const candidate = rowToTask(row);
      if (
        !visited.has(candidate.id) &&
        candidate.depends_on?.includes(task.id)
      ) {
        collect(candidate);
      }
    }
  }

  collect(root);
  return result;
}

export function listTasks(
  role?: string,
  status?: TaskStatus,
  includeArchived?: boolean,
): Task[] {
  let query = "SELECT * FROM tasks";
  const conditions: string[] = [];
  const params: string[] = [];

  if (role) {
    conditions.push("role = ?");
    params.push(role.toLowerCase());
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  // Auto-archive: exclude done tasks older than 30 days unless requested
  if (!includeArchived && status !== "done") {
    conditions.push(
      "(status != 'done' OR completed_at > datetime('now', '-30 days'))",
    );
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY assigned_at DESC";

  const rows = getDb()
    .prepare(query)
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

/** Check if all dependencies of a task are done */
export function areDependenciesMet(task: Task): boolean {
  if (!task.depends_on || task.depends_on.length === 0) return true;
  for (const depId of task.depends_on) {
    const dep = getTask(depId);
    if (!dep || dep.status !== "done") return false;
  }
  return true;
}

/** Get unblocked dependency info for a task */
export function getDependencyStatus(task: Task): {
  met: boolean;
  blocking: string[];
} {
  if (!task.depends_on || task.depends_on.length === 0) {
    return { met: true, blocking: [] };
  }
  const blocking: string[] = [];
  for (const depId of task.depends_on) {
    const dep = getTask(depId);
    if (!dep || dep.status !== "done") {
      blocking.push(depId);
    }
  }
  return { met: blocking.length === 0, blocking };
}

// --- Template functions ---

export function saveTemplate(template: TaskTemplate): TaskTemplate {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO templates (id, name, role, title_template, description_template, scope, constraints, done_when)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    template.id,
    template.name,
    template.role,
    template.title_template,
    template.description_template ?? null,
    template.scope ? JSON.stringify(template.scope) : null,
    template.constraints ? JSON.stringify(template.constraints) : null,
    template.done_when,
  );
  return template;
}

export function getTemplate(name: string): TaskTemplate | null {
  const row = getDb()
    .prepare("SELECT * FROM templates WHERE name = ?")
    .get(name) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    role: row["role"] as string,
    title_template: row["title_template"] as string,
    description_template: row["description_template"] as string | undefined,
    scope: parseJson(row["scope"] as string | null),
    constraints: parseJson(row["constraints"] as string | null),
    done_when: row["done_when"] as string,
  };
}

export function listTemplates(): TaskTemplate[] {
  const rows = getDb()
    .prepare("SELECT * FROM templates ORDER BY name")
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row["id"] as string,
    name: row["name"] as string,
    role: row["role"] as string,
    title_template: row["title_template"] as string,
    description_template: row["description_template"] as string | undefined,
    scope: parseJson(row["scope"] as string | null),
    constraints: parseJson(row["constraints"] as string | null),
    done_when: row["done_when"] as string,
  }));
}

export function createTaskFromTemplate(
  templateName: string,
  parentTaskId?: string,
  titleSuffix?: string,
): Task | null {
  const tmpl = getTemplate(templateName);
  if (!tmpl) return null;

  // Inherit context_files from parent if available
  let contextFiles: string[] | undefined;
  let description = tmpl.description_template;

  if (parentTaskId) {
    const parent = getTask(parentTaskId);
    if (parent) {
      contextFiles = parent.context_files;
      // Prepend parent reference to description
      const parentRef = `Parent task: ${parent.title} (${parentTaskId})\n\n`;
      description = parentRef + (description ?? "");
    }
  }

  const title = titleSuffix
    ? tmpl.title_template.replace("{suffix}", titleSuffix)
    : tmpl.title_template;

  return createTask({
    role: tmpl.role,
    title,
    description,
    scope: tmpl.scope,
    context_files: contextFiles,
    constraints: tmpl.constraints,
    done_when: tmpl.done_when,
    parent_task_id: parentTaskId,
  });
}

export function getSyncState(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM sync_state WHERE key = ?")
    .get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSyncState(key: string, value: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)")
    .run(key, value);
}

export function findTaskByTrelloCard(cardId: string): Task | null {
  const row = getDb()
    .prepare("SELECT * FROM tasks WHERE trello_card_id = ?")
    .get(cardId) as Record<string, unknown> | null;
  return row ? rowToTask(row) : null;
}

/** Store Trello card ID + URL back on a Task Board task (called after create_trello_card). */
export function setTrelloCard(
  taskId: string,
  cardId: string,
  cardUrl: string,
): void {
  getDb()
    .prepare(
      "UPDATE tasks SET trello_card_id = ?, trello_card_url = ? WHERE id = ?",
    )
    .run(cardId, cardUrl, taskId);
}

// --- Metrics ---

export function getMetrics(role?: string, days: number = 30): TaskMetrics {
  const d = getDb();
  const dateFilter = `datetime('now', '-${days} days')`;

  // Role filter helper
  const roleWhere = role ? ` AND role = '${role.toLowerCase()}'` : "";

  // 1. Cycle time per role (avg minutes from assigned to completed)
  const cycleRows = d
    .prepare(
      `SELECT role,
        ROUND(AVG((julianday(completed_at) - julianday(assigned_at)) * 24 * 60)) as avg_minutes,
        COUNT(*) as count
      FROM tasks
      WHERE status = 'done' AND completed_at IS NOT NULL
        AND assigned_at > ${dateFilter}${roleWhere}
      GROUP BY role ORDER BY avg_minutes DESC`,
    )
    .all() as { role: string; avg_minutes: number; count: number }[];

  // 2. Rejection rate per role (verdict breakdown)
  const rejectionRows = d
    .prepare(
      `SELECT role,
        COUNT(*) as total,
        SUM(CASE WHEN verdict = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN verdict = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN verdict = 'PARTIAL' THEN 1 ELSE 0 END) as partial,
        SUM(CASE WHEN verdict = 'BLOCKED' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN verdict IS NULL THEN 1 ELSE 0 END) as no_verdict
      FROM tasks
      WHERE status = 'done'
        AND assigned_at > ${dateFilter}${roleWhere}
      GROUP BY role ORDER BY role`,
    )
    .all() as {
    role: string;
    total: number;
    pass: number;
    fail: number;
    partial: number;
    blocked: number;
    no_verdict: number;
  }[];

  // 3. Verdict distribution (totals)
  const verdictRow = d
    .prepare(
      `SELECT
        SUM(CASE WHEN verdict = 'PASS' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN verdict = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN verdict = 'PARTIAL' THEN 1 ELSE 0 END) as partial,
        SUM(CASE WHEN verdict = 'BLOCKED' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN verdict IS NULL THEN 1 ELSE 0 END) as none
      FROM tasks
      WHERE status = 'done'
        AND assigned_at > ${dateFilter}${roleWhere}`,
    )
    .get() as {
    pass: number;
    fail: number;
    partial: number;
    blocked: number;
    none: number;
  };

  // 4. Throughput (tasks completed per day)
  const throughputRows = d
    .prepare(
      `SELECT DATE(completed_at) as date, COUNT(*) as count
      FROM tasks
      WHERE status = 'done' AND completed_at IS NOT NULL
        AND completed_at > ${dateFilter}${roleWhere}
      GROUP BY DATE(completed_at)
      ORDER BY date DESC`,
    )
    .all() as { date: string; count: number }[];

  // 5. Total tasks in period
  const totalRow = d
    .prepare(
      `SELECT COUNT(*) as total FROM tasks
      WHERE assigned_at > ${dateFilter}${roleWhere}`,
    )
    .get() as { total: number };

  // 6. Average fix loops (tasks sharing same parent chain)
  const parentRows = d
    .prepare(
      `SELECT parent_task_id, COUNT(*) as chain_length
      FROM tasks
      WHERE parent_task_id IS NOT NULL
        AND assigned_at > ${dateFilter}${roleWhere}
      GROUP BY parent_task_id`,
    )
    .all() as { parent_task_id: string; chain_length: number }[];

  const avgFixLoops =
    parentRows.length > 0
      ? parentRows.reduce((sum, r) => sum + r.chain_length, 0) /
        parentRows.length
      : 0;

  // Tasks per day
  const activeDays = throughputRows.length || 1;
  const totalCompleted = throughputRows.reduce((s, r) => s + r.count, 0);
  const tasksPerDay = Math.round((totalCompleted / activeDays) * 10) / 10;

  return {
    period_days: days,
    total_tasks: totalRow.total,
    cycle_time: cycleRows,
    rejection_rate: rejectionRows,
    verdict_distribution: {
      PASS: verdictRow?.pass ?? 0,
      FAIL: verdictRow?.fail ?? 0,
      PARTIAL: verdictRow?.partial ?? 0,
      BLOCKED: verdictRow?.blocked ?? 0,
      none: verdictRow?.none ?? 0,
    },
    throughput: throughputRows,
    avg_fix_loops: Math.round(avgFixLoops * 10) / 10,
    tasks_per_day: tasksPerDay,
  };
}
