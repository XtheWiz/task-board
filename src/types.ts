export type TaskStatus = "pending" | "in_progress" | "done" | "blocked";

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
  assigned_at: string;
  completed_at?: string;
  summary?: string;
  updates?: TaskUpdate[];
}

export interface TaskUpdate {
  timestamp: string;
  message: string;
}

export interface CreateTaskInput {
  role: string;
  title: string;
  description?: string;
  scope?: string[];
  context_files?: string[];
  constraints?: { must?: string[]; must_not?: string[] };
  done_when: string;
}

export interface UpdateTaskInput {
  task_id: string;
  status?: TaskStatus;
  message?: string;
}

export interface CompleteTaskInput {
  task_id: string;
  summary: string;
}
