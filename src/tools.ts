import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as db from "./db.ts";
import { syncFromTrello, pushToTrello } from "./trello.ts";

export function registerTools(server: McpServer) {
  server.tool(
    "create_task",
    "Assign a task to a role with scope and done criteria",
    {
      role: z
        .string()
        .describe(
          "The role to assign this task to (e.g. backend, frontend, qa)",
        ),
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
      role: z.string().describe("Your role (e.g. backend, frontend, qa)"),
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

      // Auto-push to Trello if linked
      let trelloResult = "";
      if (task.trello_card_id) {
        try {
          const result = await pushToTrello(task_id);
          trelloResult = result.success
            ? "\n\nTrello: " + result.message
            : "\n\nTrello sync failed: " + result.message;
        } catch (e) {
          trelloResult =
            "\n\nTrello sync error: " +
            (e instanceof Error ? e.message : String(e));
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(task, null, 2) + trelloResult,
          },
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

  server.tool(
    "sync_trello",
    "Pull [agent]-tagged cards from Trello into Task Board. Syncs only new/modified cards since last sync.",
    {},
    async () => {
      try {
        const result = await syncFromTrello();
        const lines = [
          `Synced: ${result.created} new task(s) created, ${result.skipped} already synced, ${result.claimed_by_others} claimed by others`,
        ];
        if (result.errors.length > 0) {
          lines.push("Errors:", ...result.errors.map((e) => "  - " + e));
        }
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Sync failed: " + (e instanceof Error ? e.message : String(e)),
            },
          ],
        };
      }
    },
  );

  server.tool(
    "push_trello",
    "Manually push a completed task back to Trello — moves card to Review list and adds summary comment",
    {
      task_id: z.string().describe("The task ID to push to Trello"),
    },
    async ({ task_id }) => {
      try {
        const result = await pushToTrello(task_id);
        return {
          content: [{ type: "text" as const, text: result.message }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Push failed: " + (e instanceof Error ? e.message : String(e)),
            },
          ],
        };
      }
    },
  );
}
