import { agentSkillsSchema } from "@nerilo/protocol";
import type { Store } from "./store";

export function saveAgentSkills(store: Store, input: unknown) {
  const skills = agentSkillsSchema.parse(input);
  const previous = store.get("settings", "default")!;
  store.put("settings", "default", { ...previous, skills });
  store.event({
    taskId: null,
    turnId: null,
    kind: "system",
    text: "Skills updated. Changes apply to the next agent turn.",
  });
  return skills;
}
