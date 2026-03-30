import { Database } from "bun:sqlite";
import { randomUUIDv7 } from "bun";
import type {
  Task,
  TaskStatus,
  TaskUpdate as TaskUpdateType,
  CreateTaskInput,
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
        updates TEXT DEFAULT '[]'
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
    INSERT INTO tasks (id, role, title, description, scope, context_files, constraints, done_when)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
  const row = getDb()
    .prepare(
      "SELECT * FROM tasks WHERE role = ? AND status IN ('pending', 'in_progress') ORDER BY assigned_at ASC LIMIT 1",
    )
    .get(role.toLowerCase()) as Record<string, unknown> | null;
  if (!row) return null;
  const task = rowToTask(row);
  if (task.status === "pending") {
    getDb()
      .prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?")
      .run(task.id);
    task.status = "in_progress";
  }
  return task;
}

export function updateTask(
  id: string,
  status?: TaskStatus,
  message?: string,
): Task | null {
  const task = getTask(id);
  if (!task) return null;

  if (status) {
    getDb().prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  }

  if (message) {
    const updates: TaskUpdateType[] = task.updates ?? [];
    updates.push({ timestamp: new Date().toISOString(), message });
    getDb()
      .prepare("UPDATE tasks SET updates = ? WHERE id = ?")
      .run(JSON.stringify(updates), id);
  }

  return getTask(id);
}

export function completeTask(id: string, summary: string): Task | null {
  const task = getTask(id);
  if (!task) return null;

  getDb()
    .prepare(
      "UPDATE tasks SET status = 'done', completed_at = datetime('now'), summary = ? WHERE id = ?",
    )
    .run(summary, id);

  return getTask(id);
}

export function listTasks(role?: string, status?: TaskStatus): Task[] {
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

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY assigned_at DESC";

  const rows = getDb()
    .prepare(query)
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToTask);
}
