import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tickAutonomy, autonomyStatus } from "./tasks/autonomy";
import { observePullRequest } from "./git/pr-observer";
import { SKILLS_REQUEST_LIMIT } from "@nerilo/protocol";
import { Store } from "./platform/store";
import { Engine } from "./tasks/engine";
import { createApi } from "./http/api";
import { refreshLinkedPullRequests } from "./git/pull-requests";
import { dataDir, port, token } from "./platform/config";

const lock = join(dataDir, "daemon.pid");
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8"));
  if (Number.isSafeInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      throw new Error(`Nerilo daemon is already running (PID ${pid}).`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
    }
  }
  unlinkSync(lock);
}
writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
const store = new Store(join(dataDir, "nerilo.sqlite"));
const engine = new Engine(store);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 0,
  maxRequestBodySize: SKILLS_REQUEST_LIMIT,
  fetch: createApi(store, engine, token),
});
const tick = setInterval(
  () =>
    void engine
      .tick()
      .catch((e) =>
        console.error("Scheduler:", e instanceof Error ? e.message : String(e)),
      ),
  1000,
);
let tickingAutonomy = false;
const autonomyTick = setInterval(() => {
  if (tickingAutonomy) return;
  tickingAutonomy = true;
  void tickAutonomy(store, engine)
    .catch((reason) => console.error("Autopilot:", String(reason)))
    .finally(() => {
      tickingAutonomy = false;
    });
}, 15000);
let refreshingPRs = false;
const prTick = setInterval(() => {
  if (refreshingPRs) return;
  refreshingPRs = true;
  void refreshLinkedPullRequests(store, {
    observe: observePullRequest,
    autopilotObserves: (taskId, url) => {
      const state = autonomyStatus(store, taskId);
      return Boolean(
        state &&
        state.mode !== "off" &&
        state.prUrl === url &&
        !["merged", "closed", "blocked"].includes(state.status) &&
        store.get("task", taskId)?.status !== "paused",
      );
    },
  })
    .catch((e) => console.error("PR refresh:", String(e)))
    .finally(() => {
      refreshingPRs = false;
    });
}, 60000);
console.log(`Nerilo daemon ready at http://127.0.0.1:${server.port}`);
const shutdown = () => {
  clearInterval(tick);
  clearInterval(prTick);
  clearInterval(autonomyTick);
  server.stop(true);
  store.db.close();
  try {
    unlinkSync(lock);
  } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
void engine
  .tick()
  .catch((error) =>
    console.error(
      "Scheduler:",
      error instanceof Error ? error.message : String(error),
    ),
  );
