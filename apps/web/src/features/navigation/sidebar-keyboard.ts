export type SidebarRow =
  | { key: string; kind: "project"; id: string; open: boolean }
  | { key: string; kind: "task"; id: string; projectId: string };

export function sidebarDestination(
  rows: SidebarRow[],
  current: string,
  key: string,
): { focus?: string; expanded?: { id: string; open: boolean } } | null {
  const index = rows.findIndex((row) => row.key === current);
  if (index < 0) return null;
  const row = rows[index];
  if (key === "Home") return { focus: rows[0]?.key };
  if (key === "End") return { focus: rows.at(-1)?.key };
  if (key === "ArrowDown" || key === "ArrowUp")
    return {
      focus:
        rows[
          Math.max(
            0,
            Math.min(rows.length - 1, index + (key === "ArrowDown" ? 1 : -1)),
          )
        ]?.key,
    };
  if (key === "ArrowRight" && row.kind === "project") {
    if (!row.open) return { expanded: { id: row.id, open: true } };
    const next = rows[index + 1];
    return next?.kind === "task" && next.projectId === row.id
      ? { focus: next.key }
      : null;
  }
  if (key === "ArrowLeft") {
    if (row.kind === "task")
      return {
        focus: rows.find(
          (candidate) =>
            candidate.kind === "project" && candidate.id === row.projectId,
        )?.key,
      };
    if (row.open) return { expanded: { id: row.id, open: false } };
  }
  return null;
}

export function sidebarFocusAfterRemoval(
  rows: SidebarRow[],
  removed: string,
): string[] {
  const index = rows.findIndex((row) => row.key === removed);
  if (index < 0) return rows.map((row) => row.key);
  const row = rows[index];
  const siblings =
    row.kind === "task"
      ? rows.filter(
          (candidate) =>
            candidate.kind === "task" && candidate.projectId === row.projectId,
        )
      : rows.filter((candidate) => candidate.kind === "project");
  const siblingIndex = siblings.findIndex(
    (candidate) => candidate.key === removed,
  );
  return [
    ...siblings.slice(siblingIndex + 1),
    ...siblings.slice(0, siblingIndex).reverse(),
    ...rows.slice(0, index).reverse(),
    ...rows.slice(index + 1),
  ]
    .map((candidate) => candidate.key)
    .filter(
      (key, index, keys) => key !== removed && keys.indexOf(key) === index,
    );
}
