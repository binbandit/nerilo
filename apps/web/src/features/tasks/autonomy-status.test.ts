import { expect, test } from "bun:test";
import { autonomyStatusLabel } from "@/features/tasks/autonomy-status";

test.each(["pr", "merge"] as const)(
  "finished workflows do not appear active when %s mode remains configured",
  (mode) => {
    expect(autonomyStatusLabel({ mode, status: "merged" })).toBe(
      "Autopilot complete",
    );
    expect(autonomyStatusLabel({ mode, status: "closed" })).toBe(
      "Autopilot ended",
    );
    expect(autonomyStatusLabel({ mode, status: "reviewing" })).toBe(
      "Autopilot on",
    );
    expect(autonomyStatusLabel({ mode, status: "blocked" })).toBe(
      "Autopilot blocked",
    );
    expect(autonomyStatusLabel({ mode, status: "publishing" })).toBe(
      "Autopilot publishing",
    );
  },
);

test("disabled or absent workflows retain the neutral action", () => {
  expect(autonomyStatusLabel(undefined)).toBe("Autopilot");
  expect(autonomyStatusLabel(null)).toBe("Autopilot");
  expect(autonomyStatusLabel({ mode: "off", status: "off" })).toBe("Autopilot");
});
