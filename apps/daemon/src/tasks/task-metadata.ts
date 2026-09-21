import {
  taskMetadataSchema,
  requestLabel,
  type TaskMetadata,
  type Turn,
} from "@nerilo/protocol";
import type { Store } from "../platform/store";

export type MetadataInput = {
  taskPrompt: string;
  prompt: string;
  answer: string;
};
export type MetadataGenerator = (
  input: MetadataInput,
  turn: Turn,
) => Promise<TaskMetadata>;

export async function summarizeTask(
  store: Store,
  taskId: string,
  generate: MetadataGenerator,
  rename: boolean | "preview" = false,
) {
  const task = store.get("task", taskId);
  if (!task) throw new Error("Task no longer exists.");
  const turns = store.all("turn").filter((turn) => turn.taskId === taskId);
  const turn = turns.at(-1);
  if (!turn?.result)
    throw new Error("Wait for a response before summarizing this task.");
  const label = requestLabel(turn.prompt, turn.requestOrigin);
  const generated = taskMetadataSchema.parse(
    turn.result.metadata ??
      (await generate(
        {
          taskPrompt: (turns[0]?.prompt ?? turn.prompt).slice(0, 12000),
          prompt: (label ? `${label}\n\n${turn.prompt}` : turn.prompt).slice(
            0,
            16000,
          ),
          answer: turn.result.summary.slice(0, 12000),
        },
        turn,
      )),
  );
  const metadata = label ? { ...generated, promptSummary: label } : generated;
  if (rename === "preview") return metadata;
  store.transaction(() => {
    const currentTask = store.get("task", taskId);
    const currentTurn = store.get("turn", turn.id);
    if (!currentTask || !currentTurn?.result) return;
    store.put("turn", turn.id, {
      ...currentTurn,
      result: { ...currentTurn.result, metadata },
    });
    // A manual edit made while the request was running always wins.
    if (
      currentTask.title === task.title &&
      currentTask.titleSource === task.titleSource &&
      (rename || currentTask.titleSource === "prompt")
    )
      store.put("task", taskId, {
        ...currentTask,
        title: metadata.title,
        titleSource: "ai",
      });
    store.event({
      taskId,
      turnId: turn.id,
      kind: "system",
      text: "Task summary updated.",
    });
  });
  return metadata;
}
