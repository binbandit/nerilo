export function projectName(source: string) {
  const input = source.trim();
  const path = (
    /^https?:\/\//i.test(input) ? input.split(/[?#]/, 1)[0] : input
  ).replace(/[\\/]+$/, "");
  return (
    path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.git$/i, "") || "New project"
  ).slice(0, 80);
}
