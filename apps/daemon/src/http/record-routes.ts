import { noteInput, presetInput, projectInput } from "@nerilo/protocol";
import { z } from "zod";
import { withGithubAccount } from "../git/github-context";
import { now } from "../platform/config";
import {
  archiveProject,
  deleteProject,
  requireAvailableProject,
} from "../projects/project-lifecycle";
import { readRemoteProject } from "../projects/remote-projects";
import type { Engine } from "../tasks/engine";
import { type ApiContext, json } from "./context";

async function validateProject(
  input: z.infer<typeof projectInput>,
  engine: Engine,
) {
  if (Boolean(input.path) === Boolean(input.repository))
    throw new Error("Choose a GitHub repository or a local folder.");
  return input.repository
    ? withGithubAccount(input.githubAccount, () =>
        readRemoteProject(input.repository!, undefined, input.branch),
      )
    : { ...(await engine.validateProject(input.path)), repository: null };
}

export async function handleRecordMutation(
  path: string,
  body: unknown,
  { store, engine }: ApiContext,
) {
  const requireUniqueProject = (
    validated: { path: string; repository: string | null },
    excluding?: string,
  ) => {
    const duplicate = store
      .all("project")
      .find(
        (p) =>
          p.id !== excluding &&
          (validated.repository
            ? p.repository?.toLowerCase() === validated.repository.toLowerCase()
            : p.path === validated.path),
      );
    if (duplicate)
      throw new Error(
        duplicate.archived
          ? "This project is archived. Restore it from Projects → Archived."
          : "This project is already added.",
      );
  };
  const projectAction = path.match(/^\/projects\/([^/]+)\/(archive|delete)$/);
  if (projectAction) {
    if (projectAction[2] === "delete")
      return json(await deleteProject(store, projectAction[1]));
    return json(
      archiveProject(
        store,
        projectAction[1],
        z.object({ archived: z.boolean() }).parse(body).archived,
      ),
    );
  }
  if (path === "/projects") {
    const input = projectInput.parse(body);
    const validated = await validateProject(input, engine);
    requireUniqueProject(validated);
    const project = {
      ...input,
      ...validated,
      id: crypto.randomUUID(),
      createdAt: now(),
      archived: false,
    };
    store.put("project", project.id, project);
    return json(project, 201);
  }
  if (path === "/presets") {
    const preset = { ...presetInput.parse(body), id: crypto.randomUUID() };
    store.put("preset", preset.id, preset);
    return json(preset, 201);
  }
  if (path === "/notes") {
    const note = {
      ...noteInput.parse(body),
      id: crypto.randomUUID(),
      updatedAt: now(),
    };
    if (note.projectId) requireAvailableProject(store, note.projectId);
    store.put("note", note.id, note);
    return json(note, 201);
  }
  const edit = path.match(/^\/(projects|presets|notes)\/([^/]+)$/);
  if (!edit) return;

  const kind =
    edit[1] === "projects"
      ? "project"
      : edit[1] === "presets"
        ? "preset"
        : "note";
  const id = edit[2];
  const existing = store.get(kind, id);
  if (!existing) throw new Error("Not found.");
  if (z.object({ remove: z.boolean().optional() }).parse(body).remove) {
    if (kind === "project")
      throw new Error(
        "Use the project deletion action to remove this project and its retained data.",
      );
    if (kind === "preset" && store.all("task").some((t) => t.presetId === id))
      throw new Error(
        "This agent preset is used by retained tasks. Edit it instead.",
      );
    store.remove(kind, id);
    return json({ ok: true });
  }
  if (kind === "project") {
    const previous = requireAvailableProject(store, id);
    const input = projectInput.parse({
      ...previous,
      ...z.record(z.string(), z.unknown()).parse(body),
    });
    const validated = await validateProject(input, engine);
    const current = requireAvailableProject(store, id);
    requireUniqueProject(validated, id);
    if (
      (current.repository !== validated.repository ||
        current.path !== validated.path) &&
      store.all("task").some((task) => task.projectId === id)
    )
      throw new Error(
        "This project has retained tasks. Add the other repository as a new project.",
      );
    store.put("project", id, {
      ...current,
      ...input,
      ...validated,
    });
  }
  if (kind === "preset")
    store.put("preset", id, { id, ...presetInput.parse(body) });
  if (kind === "note") {
    const old = store.get("note", id)!;
    if (old.projectId) requireAvailableProject(store, old.projectId);
    const input = noteInput.parse(body);
    if (input.projectId) requireAvailableProject(store, input.projectId);
    store.put("note", id, {
      id,
      ...input,
      updatedAt: now(),
    });
  }
  return json(store.get(kind, id));
}
