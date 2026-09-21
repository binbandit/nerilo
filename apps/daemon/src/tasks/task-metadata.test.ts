import { afterEach, expect, test } from "bun:test";
import {
  taskSchema,
  projectSchema,
  turnSchema,
  requestLabel,
  autopilotPromptPrefix,
} from "@nerilo/protocol";
import { Store } from "../platform/store";
import { summarizeTask, type MetadataInput } from "./task-metadata";
import { Engine } from "./engine";
import { createApi } from "../http/api";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});
function fixture(titleSource?: "prompt" | "manual" | "ai") {
  const store = new Store(":memory:");
  stores.push(store);
  const task = taskSchema.parse({
    id: "task",
    projectId: "project",
    title: "Please improve validation",
    titleSource,
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "ready",
    sessionId: "native-session",
    baseCommit: "base",
    includeChanges: false,
    pending: [],
    activeTurnId: null,
    createdAt: "before",
    updatedAt: "before",
    archived: false,
    error: null,
    stopRequested: false,
  });
  const turn = turnSchema.parse({
    id: "turn",
    taskId: task.id,
    inputId: "input",
    prompt: "Please improve validation and explain the errors.",
    status: "finished",
    container: "container",
    cursor: 20,
    startedAt: "before",
    endedAt: "after",
    result: {
      exitCode: 0,
      sessionId: "native-session",
      summary: "Implemented validation. All five tests passed.",
      diff: "original patch",
      changes: [],
      verification: null,
      baseCommit: "base",
      headCommit: "head",
    },
  });
  store.put("task", task.id, task);
  store.put("turn", turn.id, turn);
  return { store, task, turn };
}
const metadata = {
  title: "Improve project validation",
  promptSummary: "Improve validation and explain folder errors",
};

test.each(["prompt", "manual", "ai"] as const)(
  "previewing an AI name leaves a %s title, turn, and history unchanged",
  async (source) => {
    const { store, task, turn } = fixture(source);
    expect(
      await summarizeTask(store, task.id, async () => metadata, "preview"),
    ).toEqual(metadata);
    expect(store.get("task", task.id)).toEqual(task);
    expect(store.get("turn", turn.id)).toEqual(turn);
    expect(store.events(task.id)).toHaveLength(0);
  },
);

test("the name preview endpoint returns a suggestion without applying it", async () => {
  const { store, task, turn } = fixture("prompt");
  store.put(
    "project",
    task.projectId,
    projectSchema.parse({
      id: task.projectId,
      name: "Fixture",
      path: "/tmp/fixture",
      branch: "main",
      createdAt: "before",
    }),
  );
  const api = createApi(store, new Engine(store, true), "test");
  const response = await api(
    new Request(`http://localhost/tasks/${task.id}/metadata/preview`, {
      method: "POST",
      headers: { Authorization: "Bearer test" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    title: "Verify isolated workspace",
  });
  expect(store.get("task", task.id)).toEqual(task);
  expect(store.get("turn", turn.id)).toEqual(turn);
  expect(store.events(task.id)).toHaveLength(0);
});

test("Autopilot labels describe the current action and preserve the full instructions", async () => {
  const { store, task, turn } = fixture("ai");
  const prompt = "Resolve the latest branch conflict and run checks.";
  const followup = turnSchema.parse({
    ...turn,
    id: "repair-turn",
    prompt,
    requestOrigin: { kind: "autopilot", action: "update-base" },
    result: { ...turn.result!, metadata },
  });
  store.put("turn", followup.id, followup);
  const updated = await summarizeTask(store, task.id, async () => {
    throw new Error("Cached title should be reused");
  });
  expect(updated.promptSummary).toBe("Update branch to latest base");
  expect(store.get("turn", followup.id)?.prompt).toBe(prompt);
  expect(store.get("turn", followup.id)?.requestOrigin).toEqual(
    followup.requestOrigin,
  );
  expect(store.get("task", task.id)?.title).toBe(task.title);
});

test("follow-up metadata receives the current request separately from the original task", async () => {
  const { store, task, turn } = fixture("ai");
  const prompt = "Add tests for a folder without a Git repository.";
  store.put("turn", "followup", { ...turn, id: "followup", prompt });
  await summarizeTask(store, task.id, async (input) => {
    expect(input.taskPrompt).toBe(turn.prompt);
    expect(input.prompt).toBe(prompt);
    return {
      ...metadata,
      promptSummary: "Test a folder without a Git repository",
    };
  });
  expect(store.get("turn", "followup")?.result?.metadata?.promptSummary).toBe(
    "Test a folder without a Git repository",
  );
});

test("legacy automatic instructions need their exact generated preamble", () => {
  expect(requestLabel("Address PR feedback and checks")).toBeNull();
  expect(
    requestLabel(`Please explain this:\n${autopilotPromptPrefix}\n\nFeedback`),
  ).toBeNull();
  expect(requestLabel(`${autopilotPromptPrefix}\n\nFeedback`)).toBe(
    "Address PR feedback and checks",
  );
  expect(
    requestLabel(
      `${autopilotPromptPrefix}\n\nUpdate this task branch onto the current base ${"a".repeat(40)}. The base is available at refs/remotes/nerilo/base. More instructions`,
    ),
  ).toBe("Update branch to latest base");
  expect(
    requestLabel("Instructions", { kind: "autopilot", action: "repair" }),
  ).toBe("Address PR feedback and checks");
});

test("review request labels use durable comment counts while preserving full instructions", async () => {
  const { store, task, turn } = fixture("ai");
  const prompt =
    'Review context\n{"comments":[{"comment":"Handle empty names"}]}';
  const review = turnSchema.parse({
    ...turn,
    id: "review-turn",
    prompt,
    requestOrigin: { kind: "review", commentCount: 1 },
    result: { ...turn.result!, metadata },
  });
  store.put("turn", review.id, review);
  const updated = await summarizeTask(store, task.id, async () => {
    throw new Error("Cached title should be reused");
  });
  expect(updated.promptSummary).toBe("Review feedback · 1 comment");
  expect(store.get("turn", review.id)?.prompt).toBe(prompt);
  expect(store.get("turn", review.id)?.requestOrigin).toEqual({
    kind: "review",
    commentCount: 1,
  });
  expect(requestLabel(prompt, { kind: "review", commentCount: 4 })).toBe(
    "Review feedback · 4 comments",
  );
  expect(requestLabel("Review feedback · 4 comments")).toBeNull();
  expect(
    requestLabel(prompt, {
      kind: "autopilot",
      action: "repair",
      summary: "Resolve the failing check",
    }),
  ).toBe("Resolve the failing check");
});

test("AI labels enrich auto-titled tasks without changing source conversation or execution", async () => {
  const { store, task, turn } = fixture("prompt");
  await summarizeTask(store, task.id, async (input) => {
    expect(input.prompt).toBe(turn.prompt);
    expect(input.answer).toBe(turn.result!.summary);
    return metadata;
  });
  expect(store.get("task", task.id)).toEqual({
    ...task,
    title: metadata.title,
    titleSource: "ai",
  });
  expect(store.get("turn", turn.id)).toEqual({
    ...turn,
    result: { ...turn.result!, metadata },
  });
});

test("legacy and manually named tasks keep their title until explicit AI rename", async () => {
  const { store, task } = fixture();
  expect(task.titleSource).toBe("manual");
  await summarizeTask(store, task.id, async () => metadata);
  expect(store.get("task", task.id)?.title).toBe(task.title);
  await summarizeTask(
    store,
    task.id,
    async () => {
      throw new Error("Cached metadata should be reused");
    },
    true,
  );
  expect(store.get("task", task.id)?.title).toBe(metadata.title);
});

test("a manual rename during generation wins even over an explicit AI rename", async () => {
  const { store, task } = fixture("prompt");
  await summarizeTask(
    store,
    task.id,
    async () => {
      store.put("task", task.id, {
        ...task,
        title: "My chosen name",
        titleSource: "manual",
      });
      return metadata;
    },
    true,
  );
  expect(store.get("task", task.id)?.title).toBe("My chosen name");
  expect(store.get("turn", "turn")?.result?.metadata).toEqual(metadata);
});

test("generation failure and malformed output leave successful work intact", async () => {
  const { store, task, turn } = fixture("prompt");
  await expect(
    summarizeTask(store, task.id, async () => {
      throw new Error("Unavailable");
    }),
  ).rejects.toThrow();
  await expect(
    summarizeTask(store, task.id, async () => ({
      ...metadata,
      title: "bad\nlabel",
    })),
  ).rejects.toThrow();
  expect(store.get("task", task.id)).toEqual(task);
  expect(store.get("turn", turn.id)).toEqual(turn);
  expect(store.events(task.id)).toHaveLength(0);
});

test("metadata input is bounded, stays on its original turn, and preserves newly queued work", async () => {
  const { store, task, turn } = fixture("prompt");
  store.put("turn", turn.id, {
    ...turn,
    prompt: "a".repeat(30000),
    result: { ...turn.result!, summary: "b".repeat(50000) },
  });
  let captured: MetadataInput | undefined;
  await summarizeTask(store, task.id, async (input) => {
    captured = input;
    store.put("task", task.id, {
      ...task,
      status: "working",
      activeTurnId: "next",
      pending: [
        { id: "later", text: "More work", createdAt: "now", scheduledAt: null },
      ],
    });
    store.put("turn", "next", {
      ...turn,
      id: "next",
      prompt: "Follow up",
      result: null,
      status: "running",
    });
    return metadata;
  });
  expect(captured?.taskPrompt).toHaveLength(12000);
  expect(captured?.prompt).toHaveLength(16000);
  expect(captured?.answer).toHaveLength(12000);
  expect(store.get("turn", "next")?.result).toBeNull();
  expect(store.get("task", task.id)?.activeTurnId).toBe("next");
  expect(store.get("task", task.id)?.pending).toHaveLength(1);
  expect(store.get("task", task.id)?.status).toBe("working");
});
