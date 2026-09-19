import { expect, test } from "bun:test";
import { projectName } from "./project-name";

test("project names derive from repository URLs and local folders without URL query data", () => {
  expect(projectName("owner/nerilo")).toBe("nerilo");
  expect(projectName("https://github.com/owner/nerilo.git?tab=readme")).toBe(
    "nerilo",
  );
  expect(projectName(" /Users/me/Projects/My project/ ")).toBe("My project");
  expect(projectName("/Users/me/Projects/C# examples/")).toBe("C# examples");
  expect(projectName("C:\\Projects\\Nerilo\\")).toBe("Nerilo");
  expect(projectName("owner/" + "x".repeat(100))).toHaveLength(80);
});
