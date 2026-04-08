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
  depends_on?: string[];
  parent_task_id?: string;
  trello_card_id?: string;
  trello_board_id?: string;
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
}

export interface CompleteTaskInput {
  task_id: string;
  summary: string;
  verdict?: TaskVerdict;
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
