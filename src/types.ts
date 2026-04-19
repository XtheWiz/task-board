export type TaskStatus = "pending" | "in_progress" | "done" | "blocked";
export type TaskVerdict = "PASS" | "FAIL" | "PARTIAL" | "BLOCKED";

export interface Task {
  id: string;
  role: string;
  title: string;
  description?: string;
  scope?: string[];
  context_files?: string[];
  constraints?: { must?: string[]; must_not?: string[] };
  done_when: string;
  status: TaskStatus;
  verdict?: TaskVerdict;
  depends_on?: string[];
  parent_task_id?: string;
  assigned_at: string;
  completed_at?: string;
  summary?: string;
  updates?: TaskUpdate[];
  trello_card_id?: string;
  trello_board_id?: string;
  trello_card_url?: string;
  allow_self_pass?: boolean;
  claimed_by?: string;
}

export type UpdateType =
  | "progress"
  | "question"
  | "answer"
  | "finding"
  | "blocker";

export interface TaskUpdate {
  timestamp: string;
  message: string;
  type?: UpdateType;
  from?: string;
}

export interface CreateTaskInput {
  role: string;
  title: string;
  description?: string;
  scope?: string[];
  context_files?: string[];
  constraints?: { must?: string[]; must_not?: string[] };
  done_when: string;
  depends_on?: string[];
  parent_task_id?: string;
  trello_card_id?: string;
  trello_board_id?: string;
  allow_self_pass?: boolean;
}

export interface TrelloConfig {
  apiKey: string;
  token: string;
  boardId: string;
  reviewList?: string;
  claimedLabel?: string;
}

export interface ParsedCard {
  title: string;
  role: string;
  description?: string;
  scope?: string[];
  done_when: string;
}

export interface UpdateTaskInput {
  task_id: string;
  status?: TaskStatus;
  message?: string;
  type?: UpdateType;
  from?: string;
}

export interface CompleteTaskInput {
  task_id: string;
  summary: string;
  verdict?: TaskVerdict;
}

export interface TaskMetrics {
  period_days: number;
  total_tasks: number;
  cycle_time: { role: string; avg_minutes: number; count: number }[];
  rejection_rate: {
    role: string;
    total: number;
    pass: number;
    fail: number;
    partial: number;
    blocked: number;
    no_verdict: number;
  }[];
  verdict_distribution: {
    PASS: number;
    FAIL: number;
    PARTIAL: number;
    BLOCKED: number;
    none: number;
  };
  throughput: { date: string; count: number }[];
  avg_fix_loops: number;
  tasks_per_day: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  role: string;
  title_template: string;
  description_template?: string;
  scope?: string[];
  constraints?: { must?: string[]; must_not?: string[] };
  done_when: string;
}
