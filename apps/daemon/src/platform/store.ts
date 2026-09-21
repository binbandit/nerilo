import { Database } from "bun:sqlite";
import { z } from "zod";
import {
  eventSchema,
  taskSchema,
  turnSchema,
  projectSchema,
  presetSchema,
  noteSchema,
  settingsSchema,
  sandboxDefaults,
  type TaskEvent,
  repositoryEventSchema,
  type RepositoryEvent,
} from "@nerilo/protocol";

const schemas = {
  task: taskSchema,
  turn: turnSchema,
  project: projectSchema,
  preset: presetSchema,
  note: noteSchema,
  settings: settingsSchema,
};
type Kind = keyof typeof schemas;
type RecordFor<K extends Kind> = z.infer<(typeof schemas)[K]>;

function hydrateRepositoryEvidence(
  value: RepositoryEvent,
  firstObserved: string,
  importedPR?: { url: string; number: number } | null,
): RepositoryEvent {
  if (
    importedPR &&
    value.kind === "pr-opened" &&
    value.timeSource === "observed" &&
    value.prUrl === importedPR.url &&
    value.id === `pr-linked:${importedPR.url}`
  )
    return {
      ...value,
      kind: "pr-linked",
      summary: `Observed existing pull request #${importedPR.number}`,
    };
  if (
    value.evidenceVersion === 2 ||
    !["feedback", "review", "ci", "merged", "closed"].includes(value.kind) ||
    value.timeSource === "nerilo"
  )
    return value;
  return {
    ...value,
    // Earlier records attached the current PR pair to older GitHub events.
    // Only CI's head was verified against the event itself at capture time.
    headSha: value.kind === "ci" ? value.headSha : null,
    baseSha: null,
    observedHeadSha: value.observedHeadSha ?? value.headSha,
    observedBaseSha: value.observedBaseSha ?? value.baseSha,
    observedAt: value.observedAt ?? firstObserved,
  };
}

export class Store {
  readonly db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;",
    );
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,taskId TEXT,turnId TEXT,kind TEXT NOT NULL,text TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_task ON events(taskId,seq);
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, response TEXT NOT NULL);`);
    const eventColumns = this.db
      .query<{ name: string }, []>("PRAGMA table_info(events)")
      .all();
    if (!eventColumns.some((column) => column.name === "repository"))
      this.db.exec("ALTER TABLE events ADD COLUMN repository TEXT");
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS events_repository_id ON events(taskId,json_extract(repository,'$.id')) WHERE repository IS NOT NULL",
    );
    const version = this.db
      .query<{ user_version: number }, []>("PRAGMA user_version")
      .get()!.user_version;
    if (version < 2)
      this.transaction(() => {
        const turns = this.all("turn");
        for (const turn of turns) {
          if (
            turn.status === "failed" &&
            turn.result?.exitCode === 0 &&
            turn.result.verification?.exitCode
          )
            this.put("turn", turn.id, { ...turn, status: "finished" });
        }
        for (const task of this.all("task")) {
          const result = turns
            .filter((turn) => turn.taskId === task.id)
            .at(-1)?.result;
          if (
            task.status === "failed" &&
            !task.activeTurnId &&
            task.error ===
              "Verification failed. Review the output or send a follow-up." &&
            result?.exitCode === 0 &&
            result.verification?.exitCode
          )
            this.put("task", task.id, {
              ...task,
              status: "check_failed",
              error: null,
            });
        }
        this.db.exec("PRAGMA user_version=2");
      });
    if (!this.get("settings", "default"))
      this.put("settings", "default", {
        mcpServers: [],
        skills: [],
        keybindings: {},
        sandbox: sandboxDefaults,
        concurrency: 2,
        appearance: "light",
        sidebarOrder: { projects: [], tasks: {} },
      });
    if (!this.all("preset").length) {
      this.put("preset", "programmer", {
        id: "programmer",
        name: "Programmer",
        provider: "codex",
        model: "",
        instructions:
          "Implement the requested work carefully. Inspect the project before editing. Run relevant checks. Summarize changes, validation, and limitations. Do not push or publish unless the user specifically requests it.",
      });
      this.put("preset", "reviewer", {
        id: "reviewer",
        name: "Reviewer",
        provider: "codex",
        model: "",
        instructions:
          "Review the project for actionable correctness, security, and regression issues. Cite files and explain impact. Do not edit files unless the user specifically asks for a fix.",
      });
      this.put("preset", "claude", {
        id: "claude",
        name: "Claude Code",
        provider: "claude",
        model: "",
        instructions:
          "Complete the requested work, verify it, and explain the outcome. Do not push or publish unless explicitly requested.",
      });
    }
  }
  get<K extends Kind>(kind: K, id: string): RecordFor<K> | null {
    const row = this.db
      .query<{ data: string }, [string, string]>(
        "SELECT data FROM records WHERE kind=? AND id=?",
      )
      .get(kind, id);
    return row
      ? (schemas[kind].parse(JSON.parse(row.data)) as RecordFor<K>)
      : null;
  }
  all<K extends Kind>(kind: K): RecordFor<K>[] {
    return this.db
      .query<{ data: string }, [string]>(
        kind === "turn"
          ? "SELECT data FROM records WHERE kind=? ORDER BY json_extract(data,'$.startedAt'),rowid"
          : "SELECT data FROM records WHERE kind=? ORDER BY rowid",
      )
      .all(kind)
      .map((row) => schemas[kind].parse(JSON.parse(row.data)) as RecordFor<K>);
  }
  put<K extends Kind>(kind: K, id: string, value: RecordFor<K>) {
    this.db
      .query(
        "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, id, JSON.stringify(schemas[kind].parse(value)));
  }
  remove(kind: Kind, id: string) {
    this.db.query("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  event(input: Omit<TaskEvent, "seq" | "createdAt">) {
    return Number(
      this.db
        .query(
          "INSERT INTO events(taskId,turnId,kind,text,createdAt,repository) VALUES(?,?,?,?,?,?)",
        )
        .run(
          input.taskId,
          input.turnId,
          input.kind,
          input.text.slice(0, 60000),
          new Date().toISOString(),
          input.repository
            ? JSON.stringify(repositoryEventSchema.parse(input.repository))
            : null,
        ).lastInsertRowid,
    );
  }
  repositoryEvent(
    taskId: string,
    value: RepositoryEvent,
    turnId: string | null = null,
  ) {
    const repository = repositoryEventSchema.parse(value);
    return this.transaction(() => {
      const existing = this.db
        .query<
          { seq: number; repository: string; createdAt: string },
          [string, string]
        >(
          "SELECT seq,repository,createdAt FROM events WHERE taskId=? AND json_extract(repository,'$.id')=?",
        )
        .get(taskId, repository.id);
      if (existing && repository.evidenceVersion === 2) {
        const previous = repositoryEventSchema.parse(
          JSON.parse(existing.repository),
        );
        if (
          previous.evidenceVersion !== 2 ||
          (!previous.headSha && repository.headSha)
        ) {
          const hydrated = hydrateRepositoryEvidence(
            previous,
            existing.createdAt,
          );
          const corrected = {
            ...hydrated,
            evidenceVersion: repository.evidenceVersion,
            headSha: repository.headSha,
            baseSha: repository.baseSha,
            observedHeadSha:
              hydrated.observedHeadSha ?? repository.observedHeadSha,
            observedBaseSha:
              hydrated.observedBaseSha ?? repository.observedBaseSha,
            observedAt: hydrated.observedAt ?? repository.observedAt,
          };
          this.db
            .query("UPDATE events SET repository=? WHERE seq=?")
            .run(JSON.stringify(corrected), existing.seq);
        }
      }
      return (
        existing?.seq ??
        this.event({
          taskId,
          turnId,
          kind: "system",
          text: repository.summary,
          repository,
        })
      );
    });
  }
  events(taskId: string) {
    const source = this.get("task", taskId)?.source;
    return this.db
      .query<
        Omit<TaskEvent, "repository"> & { repository: string | null },
        [string]
      >("SELECT * FROM events WHERE taskId=? ORDER BY seq")
      .all(taskId)
      .map((row) => {
        const stored = row.repository
          ? repositoryEventSchema.parse(JSON.parse(row.repository))
          : undefined;
        const repository = stored
          ? hydrateRepositoryEvidence(stored, row.createdAt, source)
          : undefined;
        return eventSchema.parse({
          ...row,
          text:
            stored && repository && row.text === stored.summary
              ? repository.summary
              : row.text,
          repository,
        });
      });
  }
  sequence() {
    return this.db
      .query<{ seq: number }, []>(
        "SELECT COALESCE(MAX(seq),0) AS seq FROM events",
      )
      .get()!.seq;
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  commandResult(id: string): unknown {
    const record = this.db
      .query<{ response: string }, [string]>(
        "SELECT response FROM commands WHERE id=?",
      )
      .get(id);
    return record ? (JSON.parse(record.response) as unknown) : null;
  }
  command(id: string, fn: () => unknown): unknown {
    return this.transaction(() => {
      const existing = this.db
        .query<{ response: string }, [string]>(
          "SELECT response FROM commands WHERE id=?",
        )
        .get(id);
      if (existing) return JSON.parse(existing.response) as unknown;
      const response = fn();
      this.db
        .query("INSERT INTO commands(id,response) VALUES(?,?)")
        .run(id, JSON.stringify(response));
      return response;
    });
  }
}
