import { createHash } from "node:crypto";
import { z } from "zod";
import { autonomySchema, type Provider, type Task } from "@nerilo/protocol";
import { Store } from "../platform/store";
import { generateStateSummary } from "../agents/ai-suggestions";

type Generator = (
  provider: Provider,
  model: string,
  context: string,
) => Promise<{ summary: string }>;
const sentence = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[^\r\n\x00-\x1f]+$/);
type Saved = {
  taskId: string;
  turnId: string;
  text: string;
  fingerprint: string;
  status: Task["status"] | null;
  publication: string | null;
};
const initialized = new WeakSet<Store>();
function initialize(store: Store) {
  if (initialized.has(store)) return;
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS task_state_summary(taskId TEXT PRIMARY KEY, turnId TEXT NOT NULL, text TEXT NOT NULL, fingerprint TEXT NOT NULL)",
  );
  const columns = store.db
    .query<{ name: string }, []>("PRAGMA table_info(task_state_summary)")
    .all();
  if (!columns.some((column) => column.name === "status"))
    store.db.exec("ALTER TABLE task_state_summary ADD COLUMN status TEXT");
  if (!columns.some((column) => column.name === "publication"))
    store.db.exec("ALTER TABLE task_state_summary ADD COLUMN publication TEXT");
  initialized.add(store);
}
function latestTurn(store: Store, taskId: string) {
  return store
    .all("turn")
    .filter((turn) => turn.taskId === taskId)
    .at(-1);
}
function pullRequestEvidence(store: Store, task: Task) {
  const exists = store.db
    .query(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_autonomy'",
    )
    .get();
  let autonomy = null;
  if (exists) {
    const row = store.db
      .query<{ data: string }, [string]>(
        "SELECT data FROM task_autonomy WHERE taskId=?",
      )
      .get(task.id);
    if (row) {
      try {
        const parsed = autonomySchema.safeParse(JSON.parse(row.data));
        if (parsed.success) {
          const { mode, status, detail, prUrl, branch, base } = parsed.data;
          autonomy = {
            mode,
            status,
            detail: detail.slice(0, 1500),
            prUrl,
            branch,
            base,
          };
        }
      } catch {}
    }
  }
  return {
    autonomy,
    recentRepositoryActivity: store
      .events(task.id)
      .filter((event) => event.repository)
      .slice(-10)
      .map(({ repository }) => ({
        id: repository!.id,
        kind: repository!.kind,
        summary: repository!.summary,
        headSha: repository!.headSha,
        status: repository!.status,
      })),
    pullRequests: task.pullRequests.map(
      ({ url, state, checks, review, conflicts, checkRuns }) => ({
        url,
        state,
        checks,
        review,
        conflicts,
        checkRuns: checkRuns
          .slice(0, 20)
          .map(({ name, state }) => ({ name: name.slice(0, 200), state })),
      }),
    ),
  };
}
export function readStateSummary(store: Store, taskId: string) {
  initialize(store);
  const task = store.get("task", taskId);
  if (!task) throw new Error("Task not found.");
  const saved = store.db
    .query<Saved, [string]>("SELECT * FROM task_state_summary WHERE taskId=?")
    .get(taskId);
  const current = latestTurn(store, taskId);
  return saved &&
    saved.turnId === current?.id &&
    saved.status === task.status &&
    saved.publication === JSON.stringify(pullRequestEvidence(store, task))
    ? { text: saved.text, turnId: saved.turnId }
    : { text: null, turnId: current?.id ?? null };
}

export class StateSummaryService {
  private running = new Map<string, Promise<void>>();
  private requestedAt = new Map<string, number>();
  private finalPending = new Set<string>();
  private refreshPending = new Set<string>();
  private scheduled = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private store: Store,
    private generate: Generator = generateStateSummary,
    private interval = 45000,
  ) {
    initialize(store);
  }
  private schedule(taskId: string) {
    if (this.scheduled.has(taskId)) return;
    const delay = Math.max(
      1,
      this.interval - (Date.now() - (this.requestedAt.get(taskId) ?? 0)),
    );
    const timer = setTimeout(() => {
      this.scheduled.delete(taskId);
      void Promise.resolve()
        .then(() => this.refresh(taskId))
        .catch(() => {});
    }, delay);
    timer.unref();
    this.scheduled.set(taskId, timer);
  }
  refresh(taskId: string, force = false): Promise<void> {
    if (force) {
      clearTimeout(this.scheduled.get(taskId));
      this.scheduled.delete(taskId);
    }
    const running = this.running.get(taskId);
    if (running) {
      if (force) this.finalPending.add(taskId);
      else this.refreshPending.add(taskId);
      return running;
    }
    if (
      !force &&
      Date.now() - (this.requestedAt.get(taskId) ?? 0) < this.interval
    ) {
      this.schedule(taskId);
      return Promise.resolve();
    }
    const task = this.store.get("task", taskId);
    const turn = latestTurn(this.store, taskId);
    if (!task || task.archived || !turn) return Promise.resolve();
    const publication = pullRequestEvidence(this.store, task);
    const context = JSON.stringify({
      status: task.status,
      ...publication,
      prompt: turn.prompt.slice(0, 5000),
      recentActivity: this.store
        .events(taskId)
        .filter(
          (event) =>
            event.turnId === turn.id &&
            ["activity", "assistant", "check", "error"].includes(event.kind),
        )
        .slice(-10)
        .map((event) => ({ kind: event.kind, text: event.text.slice(-1500) })),
      response: turn.result?.summary.slice(-6000),
      exitCode: turn.result?.exitCode,
      verification: turn.result?.verification
        ? {
            ...turn.result.verification,
            output: turn.result.verification.output.slice(-2500),
          }
        : null,
      error: task.error,
    });
    const fingerprint = createHash("sha256").update(context).digest("hex");
    const saved = this.store.db
      .query<Saved, [string]>("SELECT * FROM task_state_summary WHERE taskId=?")
      .get(taskId);
    if (
      saved?.turnId === turn.id &&
      saved.fingerprint === fingerprint &&
      saved.status === task.status
    )
      return Promise.resolve();
    this.requestedAt.set(taskId, Date.now());
    const execution = turn.execution ?? task;
    const generation = this.generate(
      execution.provider,
      execution.model,
      context,
    )
      .then((result) => {
        const text = sentence.parse(result.summary);
        const current = this.store.get("task", taskId);
        if (
          !current ||
          current.archived ||
          current.status !== task.status ||
          JSON.stringify(pullRequestEvidence(this.store, current)) !==
            JSON.stringify(publication) ||
          latestTurn(this.store, taskId)?.id !== turn.id
        )
          return;
        this.store.transaction(() => {
          this.store.db
            .query(
              "INSERT INTO task_state_summary(taskId,turnId,text,fingerprint,status,publication) VALUES(?,?,?,?,?,?) ON CONFLICT(taskId) DO UPDATE SET turnId=excluded.turnId,text=excluded.text,fingerprint=excluded.fingerprint,status=excluded.status,publication=excluded.publication",
            )
            .run(
              taskId,
              turn.id,
              text,
              fingerprint,
              task.status,
              JSON.stringify(publication),
            );
          this.store.event({
            taskId,
            turnId: turn.id,
            kind: "system",
            text: "Task state summary updated.",
          });
        });
      })
      .catch(() => {})
      .finally(() => {
        this.running.delete(taskId);
        const pending = this.refreshPending.delete(taskId);
        if (this.finalPending.delete(taskId)) void this.refresh(taskId, true);
        else if (pending) this.schedule(taskId);
      });
    this.running.set(taskId, generation);
    return generation;
  }
}
const services = new WeakMap<Store, StateSummaryService>();
export function refreshStateSummary(
  store: Store,
  taskId: string,
  options: { force?: boolean; fixture?: boolean } = {},
) {
  let service = services.get(store);
  if (!service) {
    service = new StateSummaryService(
      store,
      options.fixture
        ? async () => ({
            summary: "Verifying the requested workspace changes.",
          })
        : generateStateSummary,
    );
    services.set(store, service);
  }
  return service.refresh(taskId, options.force).catch(() => {});
}
