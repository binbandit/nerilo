import { expect, test } from "bun:test";
import { coalesceRefresh } from "./refresh";

test("bursts of refreshes cannot overlap or lose a refresh requested during loading", async () => {
  let release = () => {};
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refresh = coalesceRefresh(async () => {
    calls++;
    maximum = Math.max(maximum, ++active);
    await gate;
    active--;
  });
  const first = refresh();
  await Promise.resolve();
  const second = refresh();
  const third = refresh();
  expect(calls).toBe(1);
  release();
  await Promise.all([first, second, third]);
  expect(calls).toBe(2);
  expect(maximum).toBe(1);
  await refresh();
  expect(calls).toBe(3);
});

test("a failed refresh does not leave future refreshes stuck", async () => {
  let calls = 0;
  const refresh = coalesceRefresh(async () => {
    if (++calls === 1) throw new Error("Disconnected");
  });
  await expect(refresh()).rejects.toThrow("Disconnected");
  await refresh();
  expect(calls).toBe(2);
});
