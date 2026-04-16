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
      depends_on: z
        .array(z.string())
        .optional()
        .describe(
          "Task IDs this task depends on — task won't be receivable until all dependencies are done",
        ),
      parent_task_id: z
        .string()
        .optional()
        .describe(
          "Parent task ID — links this task to a prior task for context chain",
        ),
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
    "Post a typed update on any task. Use type to categorize: 'question' for decisions needed, 'answer' to resolve a question, 'progress' for status updates, 'finding' for discoveries, 'blocker' for impediments. Any agent can post on any task (cross-agent).",
    {
      task_id: z.string().describe("The task ID to update"),
      status: z
        .enum(["pending", "in_progress", "blocked"])
        .optional()
        .describe("New status"),
      message: z.string().optional().describe("Update message"),
      type: z
        .enum(["progress", "question", "answer", "finding", "blocker"])
        .optional()
        .describe(
          "Update type — question: needs decision, answer: resolves a question, progress: status update, finding: discovery, blocker: impediment",
        ),
      from: z
        .string()
        .optional()
        .describe(
          "Role posting this update (e.g. 'devteam', 'po', 'qa') — enables cross-agent communication",
        ),
    },
    async ({ task_id, status, message, type, from }) => {
      const task = db.updateTask(task_id, status, message, type, from);
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
    "Mark a task as done with a completion summary and optional verdict",
    {
      task_id: z.string().describe("The task ID to complete"),
      summary: z
        .string()
        .describe(
          "What was done — include file paths, commit hashes, key decisions",
        ),
      verdict: z
        .enum(["PASS", "FAIL", "PARTIAL", "BLOCKED"])
        .optional()
        .describe(
          "Task outcome verdict (especially for QA tasks). PASS = all checks passed, FAIL = defects found, PARTIAL = some checks passed but gaps remain, BLOCKED = could not test",
        ),
    },
    async ({ task_id, summary, verdict }) => {
      const task = db.completeTask(task_id, summary, verdict);
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
    "List all tasks, optionally filtered by role and/or status. Done tasks older than 30 days are auto-archived (hidden) unless include_archived is true.",
    {
      role: z.string().optional().describe("Filter by role"),
      status: z
        .enum(["pending", "in_progress", "done", "blocked"])
        .optional()
        .describe("Filter by status"),
      include_archived: z
        .boolean()
        .optional()
        .describe(
          "Include done tasks older than 30 days (default: false, they are hidden)",
        ),
    },
    async ({ role, status, include_archived }) => {
      const tasks = db.listTasks(role, status, include_archived);
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
        verdict: t.verdict,
        depends_on: t.depends_on,
        parent_task_id: t.parent_task_id,
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

  // --- Template tools ---

  server.tool(
    "save_template",
    "Save a reusable task template (e.g., 'qa-retest', 'qa2-real-device'). Templates auto-populate scope, constraints, and done_when when creating tasks.",
    {
      name: z
        .string()
        .describe(
          "Unique template name (e.g., 'qa-retest', 'qa2-real-device', 'devteam-bugfix')",
        ),
      role: z.string().describe("Role this template creates tasks for"),
      title_template: z
        .string()
        .describe(
          "Title template — use {suffix} as placeholder for dynamic part",
        ),
      description_template: z
        .string()
        .optional()
        .describe("Description template"),
      scope: z.array(z.string()).optional().describe("Default scope items"),
      constraints: z
        .object({
          must: z.array(z.string()).optional(),
          must_not: z.array(z.string()).optional(),
        })
        .optional()
        .describe("Default constraints"),
      done_when: z.string().describe("Default exit criteria"),
    },
    async (params) => {
      const template = db.saveTemplate({
        id: params.name,
        ...params,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Template '${template.name}' saved.\n${JSON.stringify(template, null, 2)}`,
          },
        ],
      };
    },
  );

  server.tool(
    "create_from_template",
    "Create a task from a saved template, optionally linking to a parent task (inherits context_files from parent).",
    {
      template: z.string().describe("Template name (e.g., 'qa-retest')"),
      parent_task_id: z
        .string()
        .optional()
        .describe(
          "Parent task ID — inherits context_files and links for traceability",
        ),
      title_suffix: z
        .string()
        .optional()
        .describe("Replaces {suffix} in the title template"),
    },
    async ({ template, parent_task_id, title_suffix }) => {
      const task = db.createTaskFromTemplate(
        template,
        parent_task_id,
        title_suffix,
      );
      if (!task) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Template not found: '${template}'. Use list_templates to see available templates.`,
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
    "list_templates",
    "List all saved task templates",
    {},
    async () => {
      const templates = db.listTemplates();
      if (templates.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No templates saved. Use save_template to create one.",
            },
          ],
        };
      }
      const summary = templates.map((t) => ({
        name: t.name,
        role: t.role,
        title: t.title_template,
        done_when: t.done_when,
      }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(summary, null, 2) },
        ],
      };
    },
  );

  // --- Metrics ---

  server.tool(
    "task_metrics",
    "Get task board metrics: cycle time per role, rejection rate, verdict distribution, throughput, and fix loop stats. All computed from existing task data.",
    {
      role: z.string().optional().describe("Filter metrics to a specific role"),
      days: z
        .number()
        .optional()
        .describe("Number of days to analyze (default: 30)"),
    },
    async ({ role, days }) => {
      const metrics = db.getMetrics(role, days ?? 30);

      // Format human-readable summary
      const lines: string[] = [];
      lines.push(
        `=== Task Metrics (last ${metrics.period_days} days${role ? `, role: ${role}` : ""}) ===`,
      );
      lines.push(`Total tasks: ${metrics.total_tasks}`);
      lines.push(
        `Throughput: ${metrics.tasks_per_day} tasks/day (${metrics.throughput.length} active days)`,
      );
      lines.push("");

      // Cycle time
      lines.push("Cycle time (avg):");
      if (metrics.cycle_time.length === 0) {
        lines.push("  No completed tasks in period");
      }
      for (const ct of metrics.cycle_time) {
        const hours = Math.floor(ct.avg_minutes / 60);
        const mins = Math.round(ct.avg_minutes % 60);
        const display = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        lines.push(`  ${ct.role}: ${display} (${ct.count} tasks)`);
      }
      lines.push("");

      // Rejection rate
      lines.push("Verdict breakdown by role:");
      for (const r of metrics.rejection_rate) {
        const rejectPct =
          r.total > 0
            ? Math.round(((r.fail + r.partial + r.blocked) / r.total) * 100)
            : 0;
        lines.push(
          `  ${r.role}: ${r.pass}P ${r.fail}F ${r.partial}PT ${r.blocked}BL ${r.no_verdict}? (${rejectPct}% non-pass)`,
        );
      }
      lines.push("");

      // Verdict totals
      const v = metrics.verdict_distribution;
      lines.push(
        `Verdict totals: PASS:${v.PASS} FAIL:${v.FAIL} PARTIAL:${v.PARTIAL} BLOCKED:${v.BLOCKED} none:${v.none}`,
      );
      lines.push("");

      // Fix loops
      if (metrics.avg_fix_loops > 0) {
        lines.push(
          `Avg fix loops: ${metrics.avg_fix_loops} rounds per parent task`,
        );
      }

      // Daily throughput (last 7 days)
      const recent = metrics.throughput.slice(0, 7);
      if (recent.length > 0) {
        lines.push("");
        lines.push("Daily throughput (last 7 days):");
        for (const d of recent) {
          lines.push(`  ${d.date}: ${d.count} tasks`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  // --- Subtasks ---

  server.tool(
    "list_subtasks",
    "List all subtasks of a parent task. Shows progress rollup (e.g. '2/4 done').",
    {
      parent_task_id: z
        .string()
        .describe("The parent task ID to list subtasks for"),
    },
    async ({ parent_task_id }) => {
      const parent = db.getTask(parent_task_id);
      if (!parent) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Parent task not found: " + parent_task_id,
            },
          ],
        };
      }
      const subtasks = db.listSubtasks(parent_task_id);
      if (subtasks.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Task "${parent.title}" has no subtasks.`,
            },
          ],
        };
      }
      const done = subtasks.filter((t) => t.status === "done").length;
      const summary = subtasks.map((t) => ({
        id: t.id,
        title: t.title,
        role: t.role,
        status: t.status,
        verdict: t.verdict,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: `${parent.title} — ${done}/${subtasks.length} subtasks done\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    },
  );

  // --- Unresolved questions ---

  server.tool(
    "list_questions",
    "List tasks with unanswered questions. Use this to see what decisions are pending.",
    {
      role: z
        .string()
        .optional()
        .describe("Filter to questions on tasks assigned to this role"),
    },
    async ({ role }) => {
      const tasks = db.listTasksWithQuestions(role);
      if (tasks.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "No unresolved questions" + (role ? ` for role: ${role}` : ""),
            },
          ],
        };
      }
      const summary = tasks.map((t) => {
        const questions = (t.updates ?? []).filter(
          (u) => u.type === "question",
        );
        const answers = (t.updates ?? []).filter((u) => u.type === "answer");
        return {
          task_id: t.id,
          task_title: t.title,
          role: t.role,
          unanswered: questions.length - answers.length,
          latest_question: questions[questions.length - 1]?.message,
          asked_by: questions[questions.length - 1]?.from,
        };
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );
}
