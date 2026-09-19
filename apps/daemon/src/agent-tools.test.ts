import { expect, spyOn, test } from "bun:test";
import {
  agentToolsSchema,
  parseAgentSkill,
  projectSchema,
  resolveAgentTools,
  sandboxDefaults,
  settingsSchema,
  taskInput,
  taskSchema,
  type McpServer,
} from "@nerilo/protocol";
import { createApi } from "./api";
import { taskAgentTools } from "./agent-tools";
import { Engine } from "./engine";
import { Store } from "./store";

const inherited = { skillIds: null, mcpServerIds: null };
const local = {
  id: "local",
  name: "Local",
  enabled: true,
  transport: "stdio",
  command: "node",
  args: [],
  env: { TOKEN: "private-mcp-secret" },
} satisfies McpServer;
const remote = {
  id: "remote",
  name: "Remote",
  enabled: true,
  transport: "http",
  url: "https://example.com/mcp",
  headers: {},
} satisfies McpServer;
const skill = parseAgentSkill({
  id: "review",
  enabled: true,
  files: [
    {
      path: "SKILL.md",
      content:
        "---\nname: review\ndescription: Review the work\n---\nPrivate skill instructions.",
    },
  ],
});
const settings = settingsSchema.parse({
  skills: [skill],
  mcpServers: [local, remote],
});

test("task tools inherit defaults, allow explicit none, and ignore removed or globally disabled tools", () => {
  expect(
    taskInput.parse({ projectId: "p", prompt: "Hi", presetId: "programmer" })
      .tools,
  ).toEqual(inherited);
  expect(resolveAgentTools(settings, inherited)).toEqual({
    skills: [skill],
    mcpServers: [local, remote],
  });
  expect(
    resolveAgentTools(settings, { skillIds: [], mcpServerIds: [] }),
  ).toEqual({ skills: [], mcpServers: [] });
  const selection = {
    skillIds: ["review", "removed"],
    mcpServerIds: ["local", "removed"],
  };
  const snapshot = resolveAgentTools(settings, selection);
  const updated = {
    ...settings,
    skills: [],
    mcpServers: [{ ...local, enabled: false }, remote],
  };
  expect(resolveAgentTools(updated, selection)).toEqual({
    skills: [],
    mcpServers: [],
  });
  expect(snapshot).toEqual({ skills: [skill], mcpServers: [local] });
  expect(
    agentToolsSchema.safeParse({
      skillIds: ["review", "review"],
      mcpServerIds: null,
    }).success,
  ).toBe(false);
});

test("sandbox networking checks only MCP servers selected for this task", () => {
  const sandbox = { ...sandboxDefaults, network: "provider-only" as const };
  expect(
    taskAgentTools(
      settings,
      { skillIds: null, mcpServerIds: ["local"] },
      sandbox,
    ).mcpServers,
  ).toEqual([local]);
  expect(
    taskAgentTools(settings, { skillIds: null, mcpServerIds: [] }, sandbox)
      .mcpServers,
  ).toEqual([]);
  expect(() => taskAgentTools(settings, inherited, sandbox)).toThrow(
    "HTTP MCP servers need Internet access",
  );
  expect(() =>
    taskAgentTools(
      settings,
      { skillIds: null, mcpServerIds: ["remote"] },
      sandbox,
    ),
  ).toThrow("HTTP MCP servers need Internet access");
});

test("task tools API preserves new-task selection and updates running tasks without consuming input or exposing tool contents", async () => {
  const store = new Store(":memory:");
  const engine = new Engine(store, true);
  const tick = spyOn(engine, "tick").mockResolvedValue();
  const api = createApi(store, engine, "test");
  const post = (path: string, body: unknown) =>
    api(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }),
    );
  const project = projectSchema.parse({
    id: "project",
    name: "Tools",
    path: "/unused",
    branch: "main",
    createdAt: "now",
  });
  try {
    store.put("project", project.id, project);
    store.put("settings", "default", settings);
    const input = {
      projectId: project.id,
      presetId: "programmer",
      prompt: "Review the work",
      tools: { skillIds: ["review"], mcpServerIds: [] },
    };
    const created = await post("/tasks", input);
    expect(created.status).toBe(201);
    const task = taskSchema.parse(await created.json());
    expect(task.tools).toEqual(input.tools);
    store.put("task", task.id, {
      ...task,
      status: "working",
      activeTurnId: "in-flight",
    });
    const changed = await post(`/tasks/${task.id}/tools`, inherited);
    expect(changed.status).toBe(200);
    const updated = store.get("task", task.id)!;
    expect(updated.tools).toEqual(inherited);
    expect(updated.status).toBe("working");
    expect(updated.activeTurnId).toBe("in-flight");
    expect(updated.pending).toEqual(task.pending);
    for (const tools of [
      { skillIds: ["unknown"], mcpServerIds: null },
      { skillIds: null, mcpServerIds: ["unknown"] },
    ]) {
      expect(
        (await post(`/tasks/${task.id}/tools`, tools)).status,
      ).toBeGreaterThanOrEqual(400);
      expect(store.get("task", task.id)).toEqual(updated);
      expect(
        (await post("/tasks", { ...input, tools })).status,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(store.all("task")).toHaveLength(1);
    const events = JSON.stringify(store.events(task.id));
    expect(events).toContain("Agent tools updated for the next turn.");
    expect(events).not.toContain("private-mcp-secret");
    expect(events).not.toContain("Private skill instructions.");

    const { tools: _tools, ...legacy } = task;
    expect(taskSchema.parse(legacy).tools).toEqual(inherited);
  } finally {
    tick.mockRestore();
    store.db.close();
  }
});
