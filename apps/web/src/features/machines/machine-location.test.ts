import { expect, test } from "bun:test";
import {
  machineApiUrl,
  machineStorageKey,
} from "@/features/machines/machine-location";

test("task requests, downloads and events stay on the selected machine", () => {
  const selection = "?machine=workstation&other=value";
  expect(machineApiUrl("tasks/task-a/follow-up", selection)).toBe(
    "/api/tasks/task-a/follow-up?machine=workstation",
  );
  expect(machineApiUrl("tasks/task-a/patch", selection)).toBe(
    "/api/tasks/task-a/patch?machine=workstation",
  );
  expect(machineApiUrl("events?after=42", selection)).toBe(
    "/api/events?after=42&machine=workstation",
  );
  expect(machineApiUrl("snapshot?machine=wrong", selection)).toBe(
    "/api/snapshot?machine=workstation",
  );
  expect(machineApiUrl("snapshot", "")).toBe("/api/snapshot?machine=local");
});

test("drafts are isolated while the unsent home prompt travels with the user", () => {
  expect(machineStorageKey("nerilo-draft:task:one", "")).toBe(
    "nerilo-draft:task:one",
  );
  expect(machineStorageKey("nerilo-draft:task:one", "?machine=two")).toBe(
    "nerilo-draft:task:one:machine:two",
  );
  expect(machineStorageKey("nerilo-draft:new:home", "?machine=two")).toBe(
    "nerilo-draft:new:home",
  );
});
