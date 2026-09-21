import type { Autonomy } from "@nerilo/protocol";

export function autonomyStatusLabel(
  state: Pick<Autonomy, "mode" | "status"> | null | undefined,
): string {
  if (!state || state.mode === "off") return "Autopilot";
  if (state.status === "merged") return "Autopilot complete";
  if (state.status === "closed") return "Autopilot ended";
  if (state.status === "blocked") return "Autopilot blocked";
  if (state.status === "publishing") return "Autopilot publishing";
  return "Autopilot on";
}
