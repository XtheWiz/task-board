import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as db from "./db.ts";

export function registerTools(server: McpServer) {
  server.tool(
    "create_task",
    "Assign a task to a role with scope and done criteria",
    {
      role: z
        .string()
        .describe("The role to assign this task to (e.g. devteam, qa, uxui)"),
      title: z.string().describe("Brief task title"),
      description: z
        .string()
        .optional()
        .describe("Detailed description of what needs to be done"),
      scope: z.array(z.string()).optional().describe("List of deliverables"),
      context_files: z
        .array(z.string())
        .optional()
        .describe("File paths relevant to this task"),
      constraints: z
        .object({
          must: z.array(z.string()).optional(),
          must_not: z.array(z.string()).optional(),
        })
        .optional()
        .describe("Constraints: what MUST and MUST NOT happen"),
      done_when: z
        .string()
        .describe("Explicit exit criteria — when is this task done?"),
    },
    async (params) => {
      const task = db.createTask(params);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(task, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "receive_task",
    "Pull your current task (filtered by role). Automatically marks it as in_progress.",
    {
      role: z.string().describe("Your role (e.g. devteam, qa, uxui)"),
    },
    async ({ role }) => {
      const task = db.receiveTask(role);
      if (!task) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No pending tasks for role: " + role,
            },
          ],
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(task, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "update_task",
    "Post a progress update or change task status",
    {
      task_id: z.string().describe("The task ID to update"),
      status: z
        .enum(["pending", "in_progress", "blocked"])
        .optional()
        .describe("New status"),
      message: z.string().optional().describe("Progress update message"),
    },
    async ({ task_id, status, message }) => {
      const task = db.updateTask(task_id, status, message);
      if (!task) {
        return {
          content: [
            { type: "text" as const, text: "Task not found: " + task_id },
          ],
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(task, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "complete_task",
    "Mark a task as done with a completion summary",
    {
      task_id: z.string().describe("The task ID to complete"),
      summary: z
        .string()
        .describe(
          "What was done — include file paths, commit hashes, key decisions",
        ),
    },
    async ({ task_id, summary }) => {
      const task = db.completeTask(task_id, summary);
      if (!task) {
        return {
          content: [
            { type: "text" as const, text: "Task not found: " + task_id },
          ],
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(task, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "list_tasks",
    "List all tasks, optionally filtered by role and/or status",
    {
      role: z.string().optional().describe("Filter by role"),
      status: z
        .enum(["pending", "in_progress", "done", "blocked"])
        .optional()
        .describe("Filter by status"),
    },
    async ({ role, status }) => {
      const tasks = db.listTasks(role, status);
      if (tasks.length === 0) {
        const filters = [role && `role=${role}`, status && `status=${status}`]
          .filter(Boolean)
          .join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `No tasks found${filters ? ` (${filters})` : ""}`,
            },
          ],
        };
      }
      const summary = tasks.map((t) => ({
        id: t.id,
        role: t.role,
        title: t.title,
        status: t.status,
        assigned_at: t.assigned_at,
        completed_at: t.completed_at,
        summary: t.summary,
      }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(summary, null, 2) },
        ],
      };
    },
  );
}
