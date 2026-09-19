export function selectedMachine(search: string) {
  return new URLSearchParams(search).get("machine") || "local";
}

export function machineApiUrl(path: string, search: string) {
  const url = new URL(`/api/${path}`, "http://nerilo.local");
  url.searchParams.set("machine", selectedMachine(search));
  return `${url.pathname}${url.search}`;
}

export function machineStorageKey(key: string, search: string) {
  const machine = selectedMachine(search);
  // Keep existing local drafts, and carry an unsent home prompt between machines.
  return machine === "local" || key === "nerilo-draft:new:home"
    ? key
    : `${key}:machine:${machine}`;
}
