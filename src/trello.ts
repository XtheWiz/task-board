import type { TrelloConfig, ParsedCard } from "./types.ts";
import * as db from "./db.ts";

const AGENT_TAG_REGEX = /^\[(\w+)\]\s*/;

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  labels: { name: string }[];
  idList: string;
  dateLastActivity: string;
}

interface TrelloList {
  id: string;
  name: string;
}

function getConfig(): TrelloConfig {
  const apiKey = process.env["TRELLO_API_KEY"];
  const token = process.env["TRELLO_TOKEN"];
  const boardId = process.env["TRELLO_BOARD_ID"];
  const reviewList = process.env["TRELLO_REVIEW_LIST"] || "Review";
  const claimedLabel = process.env["TRELLO_CLAIMED_LABEL"] || "claimed";

  if (!apiKey || !token || !boardId) {
    throw new Error(
      "Missing Trello config. Set TRELLO_API_KEY, TRELLO_TOKEN, and TRELLO_BOARD_ID env vars.",
    );
  }

  return { apiKey, token, boardId, reviewList, claimedLabel };
}

function trelloUrl(
  path: string,
  config: TrelloConfig,
  params?: Record<string, string>,
): string {
  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set("key", config.apiKey);
  url.searchParams.set("token", config.token);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function trelloGet<T>(
  path: string,
  config: TrelloConfig,
  params?: Record<string, string>,
): Promise<T> {
  const res = await fetch(trelloUrl(path, config, params));
  if (!res.ok)
    throw new Error(`Trello API error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function trelloPost(
  path: string,
  config: TrelloConfig,
  body?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(trelloUrl(path, config), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok)
    throw new Error(`Trello API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function trelloPut(
  path: string,
  config: TrelloConfig,
  params?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(trelloUrl(path, config, params), { method: "PUT" });
  if (!res.ok)
    throw new Error(`Trello API error: ${res.status} ${await res.text()}`);
  return res.json();
}

function parseRole(card: TrelloCard): string {
  // Labels take priority
  const agentLabel = card.labels.find((l) => {
    const name = l.name.toLowerCase();
    return name === "agent" || AGENT_TAG_REGEX.test(`[${name}]`);
  });
  if (agentLabel) {
    const name = agentLabel.name.toLowerCase();
    return name === "agent" ? "po" : name;
  }

  // Fall back to title prefix
  const match = card.name.match(AGENT_TAG_REGEX);
  if (match) {
    const tag = match[1]!.toLowerCase();
    return tag === "agent" ? "po" : tag;
  }

  return "po";
}

function cleanTitle(name: string): string {
  return name.replace(AGENT_TAG_REGEX, "").trim();
}

function parseDescription(desc: string): ParsedCard[
  | "description"
  | "scope"
  | "done_when"] & {
  description?: string;
  scope?: string[];
  done_when: string;
} {
  if (!desc.trim()) {
    return { done_when: "PO to define" };
  }

  let done_when = "PO to define";
  let scope: string[] | undefined;
  const remaining: string[] = [];

  const lines = desc.split("\n");
  let currentSection: "scope" | "done_when" | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const lowerTrimmed = trimmed.toLowerCase();

    if (
      lowerTrimmed.startsWith("done when:") ||
      lowerTrimmed.startsWith("done_when:")
    ) {
      const value = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      if (value) {
        done_when = value;
        currentSection = null;
      } else {
        currentSection = "done_when";
      }
    } else if (lowerTrimmed.startsWith("scope:")) {
      const value = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      if (value) {
        scope = [value];
        currentSection = null;
      } else {
        scope = [];
        currentSection = "scope";
      }
    } else if (currentSection === "scope" && trimmed.startsWith("-")) {
      scope = scope ?? [];
      scope.push(trimmed.slice(1).trim());
    } else if (currentSection === "done_when" && trimmed) {
      done_when = trimmed;
      currentSection = null;
    } else if (currentSection === "scope" && !trimmed) {
      currentSection = null;
    } else {
      remaining.push(line);
    }
  }

  const description = remaining.join("\n").trim() || undefined;
  return { description, scope: scope?.length ? scope : undefined, done_when };
}

export function parseCard(card: TrelloCard): ParsedCard {
  const role = parseRole(card);
  const title = cleanTitle(card.name);
  const parsed = parseDescription(card.desc);

  return {
    title,
    role,
    ...parsed,
  };
}

async function getOrCreateLabel(
  config: TrelloConfig,
  name: string,
  color: string = "sky",
): Promise<string> {
  const labels = await trelloGet<{ id: string; name: string }[]>(
    `/boards/${config.boardId}/labels`,
    config,
  );
  const existing = labels.find(
    (l) => l.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;

  const created = (await trelloPost(
    `/boards/${config.boardId}/labels`,
    config,
    {
      name,
      color,
    },
  )) as { id: string };
  return created.id;
}

function isClaimed(card: TrelloCard, claimedLabel: string): boolean {
  return card.labels.some(
    (l) => l.name.toLowerCase() === claimedLabel.toLowerCase(),
  );
}

async function claimCard(
  cardId: string,
  labelId: string,
  config: TrelloConfig,
): Promise<void> {
  await trelloPost(`/cards/${cardId}/idLabels`, config, { value: labelId });
}

async function getOrCreateReviewList(config: TrelloConfig): Promise<string> {
  const lists = await trelloGet<TrelloList[]>(
    `/boards/${config.boardId}/lists`,
    config,
  );
  const reviewListName = config.reviewList || "Review";
  const existing = lists.find(
    (l) => l.name.toLowerCase() === reviewListName.toLowerCase(),
  );
  if (existing) return existing.id;

  // Create the Review list
  const created = (await trelloPost("/lists", config, {
    name: reviewListName,
    idBoard: config.boardId,
    pos: "bottom",
  })) as TrelloList;
  return created.id;
}

function isAgentCard(card: TrelloCard): boolean {
  // Check labels
  const hasAgentLabel = card.labels.some((l) => {
    const name = l.name.toLowerCase();
    return name === "agent" || /^\w+$/.test(name);
  });
  if (hasAgentLabel) {
    // More specific: must have a label that looks like a role or "agent"
    const hasRoleLabel = card.labels.some((l) => {
      const name = l.name.toLowerCase();
      return (
        name === "agent" ||
        [
          "devteam",
          "qa",
          "uxui",
          "devops",
          "frontend",
          "backend",
          "webdev",
          "po",
        ].includes(name)
      );
    });
    if (hasRoleLabel) return true;
  }

  // Check title prefix
  return AGENT_TAG_REGEX.test(card.name);
}

export async function syncFromTrello(): Promise<{
  created: number;
  skipped: number;
  errors: string[];
}> {
  const config = getConfig();
  const lastSync = db.getSyncState("last_trello_sync");

  const params: Record<string, string> = {
    fields: "name,desc,labels,idList,dateLastActivity",
    filter: "open",
  };
  if (lastSync) {
    params["since"] = lastSync;
  }

  const cards = await trelloGet<TrelloCard[]>(
    `/boards/${config.boardId}/cards`,
    config,
    params,
  );

  const claimedLabelName = config.claimedLabel || "claimed";
  let claimedLabelId: string | null = null;

  let created = 0;
  let skipped = 0;
  let claimed = 0;
  const errors: string[] = [];

  for (const card of cards) {
    if (!isAgentCard(card)) {
      continue;
    }

    // Skip if claimed by another machine
    if (isClaimed(card, claimedLabelName)) {
      // But still skip-count if we already have it locally
      if (db.findTaskByTrelloCard(card.id)) {
        skipped++;
      } else {
        claimed++;
      }
      continue;
    }

    // Skip if already synced locally
    if (db.findTaskByTrelloCard(card.id)) {
      skipped++;
      continue;
    }

    try {
      const parsed = parseCard(card);
      db.createTask({
        role: parsed.role,
        title: parsed.title,
        description: parsed.description,
        scope: parsed.scope,
        done_when: parsed.done_when,
        trello_card_id: card.id,
        trello_board_id: config.boardId,
      });

      // Claim the card on Trello so other machines skip it
      if (!claimedLabelId) {
        claimedLabelId = await getOrCreateLabel(
          config,
          claimedLabelName,
          "sky",
        );
      }
      await claimCard(card.id, claimedLabelId, config);

      created++;
    } catch (e) {
      errors.push(
        `Card "${card.name}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  db.setSyncState("last_trello_sync", new Date().toISOString());

  return { created, skipped, claimed_by_others: claimed, errors };
}

export async function pushToTrello(
  taskId: string,
): Promise<{ success: boolean; message: string }> {
  const task = db.getTask(taskId);
  if (!task) return { success: false, message: "Task not found" };
  if (!task.trello_card_id)
    return { success: false, message: "Task has no linked Trello card" };

  const config = getConfig();

  try {
    // Add completion comment
    const comment = `✅ Completed by [${task.role}]:\n\n${task.summary || "No summary provided."}`;
    await trelloPost(`/cards/${task.trello_card_id}/actions/comments`, config, {
      text: comment,
    });

    // Move to Review list
    const reviewListId = await getOrCreateReviewList(config);
    await trelloPut(`/cards/${task.trello_card_id}`, config, {
      idList: reviewListId,
    });

    return {
      success: true,
      message: `Card moved to Review with summary comment`,
    };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
