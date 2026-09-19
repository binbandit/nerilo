"use client";
import { useEffect, useRef, useState } from "react";
import { MessageComposer } from "@/components/message-composer";
import { useToast } from "@astryxdesign/core/Toast";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuDivider,
} from "@astryxdesign/core/DropdownMenu";
import {
  ArrowUpRight,
  FolderPlus,
  ArrowRight,
  GitBranch,
  Search,
  Check,
} from "lucide-react";
import {
  taskSchema,
  projectSchema,
  type AgentTools,
  type Execution,
  type Project,
  type Snapshot,
  type Task,
} from "@nerilo/protocol";
import { Button, Text, Heading, TextInput, relativeTime } from "./ui";
import { mutate } from "@/lib/api";
import {
  StartingPointPicker,
  HomeTaskOptions,
} from "@/components/home-controls";
import { ModelPicker } from "@/components/model-picker";
import { AgentToolsPicker } from "@/components/agent-tools-picker";
import { useDraft } from "@/lib/use-draft";
import { EditorModal } from "@/components/editors";
import { MachinePicker } from "@/components/machine-controls";

export function Home({
  data,
  onTask,
  projectFilter,
  archive = false,
  refresh,
  onRestoreProject,
}: {
  data: Snapshot;
  onTask: (id: string) => void;
  projectFilter?: string;
  archive?: boolean;
  refresh: () => void;
  onRestoreProject: (project: Project) => void;
}) {
  const [search, onSearch] = useState("");
  const [projectEditor, setProjectEditor] = useState(false);
  const projectPicker = useRef<HTMLDivElement>(null);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const currentProject = data.projects.find((p) => p.id === projectFilter);
  const availableProjects = data.projects.filter((p) => !p.archived);
  const projects =
    createdProject && !data.projects.some((p) => p.id === createdProject.id)
      ? [...availableProjects, createdProject]
      : availableProjects;
  const [prompt, setPrompt] = useDraft(`new:${projectFilter ?? "home"}`);
  const [project, setProject] = useState(
    projectFilter ?? projects[0]?.id ?? "",
  );
  const selectedProject = projects.find(
    (p) => p.id === (projectFilter ?? project),
  );
  const localProject = Boolean(selectedProject?.path);
  const projectIds = projects.map((p) => p.id).join(",");
  useEffect(() => {
    if (!projectFilter && !projects.some((p) => p.id === project))
      setProject(projects[0]?.id ?? "");
  }, [projectIds, project, projectFilter]);
  const [preset, setPreset] = useState(data.presets[0]?.id ?? "");
  const [execution, setExecution] = useState<Execution>({
    provider: data.presets[0]?.provider ?? "codex",
    model: data.presets[0]?.model ?? "",
    effort: "",
  });
  const [tools, setTools] = useState<AgentTools>({
    skillIds: null,
    mcpServerIds: null,
  });
  const [autonomy, setAutonomy] = useState("off");
  const [includeChanges, setIncludeChanges] = useState(false);
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const toast = useToast();
  const [error, setError] = useState("");
  const visible = data.tasks.filter(
    (t) =>
      (currentProject?.archived ||
        (t.archived ||
          Boolean(
            data.projects.find((p) => p.id === t.projectId)?.archived,
          )) === archive) &&
      (!projectFilter || t.projectId === projectFilter) &&
      t.title.toLowerCase().includes(search.toLowerCase()),
  );
  const submit = async (value: string) => {
    if (submitting.current || !value.trim() || currentProject?.archived) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const task = taskSchema.parse(
        await mutate("tasks", {
          projectId: projectFilter ?? project,
          presetId: preset,
          prompt: value,
          includeChanges: localProject && includeChanges,
          includeUntracked: localProject && includeChanges && includeUntracked,
          execution,
          tools,
        }),
      );
      setPrompt("");
      setTools({ skillIds: null, mcpServerIds: null });
      if (autonomy !== "off") {
        try {
          await mutate(`tasks/${task.id}/autonomy`, { mode: autonomy });
        } catch (e) {
          toast({
            type: "error",
            body: `Task created, but Autopilot could not be enabled. ${e instanceof Error ? e.message : String(e)} You can try again from this task's Autopilot menu.`,
            uniqueID: `task-autonomy-${task.id}`,
          });
        }
      }
      refresh();
      onTask(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const groups: [string, Task[]][] = archive
    ? [["Archived tasks", visible]]
    : [
        [
          "Needs attention",
          visible.filter((t) =>
            ["failed", "paused", "check_failed"].includes(t.status),
          ),
        ],
        [
          "In motion",
          visible.filter((t) =>
            ["queued", "preparing", "working", "checking"].includes(t.status),
          ),
        ],
        ["Ready to review", visible.filter((t) => t.status === "ready")],
        ["Completed", visible.filter((t) => t.status === "complete")],
      ];
  return (
    <div
      className={`home-content ${!archive && !currentProject ? "home-start" : ""}`}
    >
      <div className="welcome">
        <Heading
          level={1}
          type={currentProject || archive ? undefined : "editorial"}
        >
          {archive
            ? "Archive"
            : currentProject
              ? currentProject.name
              : "Room to make."}
        </Heading>
      </div>
      {currentProject?.archived ? (
        <div className="project-archive-notice">
          <Text color="secondary">This project is archived.</Text>
          <Button
            label="Restore project"
            size="sm"
            onClick={() => onRestoreProject(currentProject)}
          />
        </div>
      ) : !archive && !projects.length ? (
        <section className="onboarding">
          <div className="arch-art" aria-hidden="true">
            <div />
          </div>
          <div>
            <Heading level={2}>Add a project</Heading>
            <Text as="p" color="secondary">
              Choose a GitHub repository or a local project.
            </Text>
            <Button
              label="Add project"
              variant="primary"
              icon={<FolderPlus size={16} />}
              onClick={() => setProjectEditor(true)}
            />
          </div>
        </section>
      ) : !archive ? (
        <section
          className="new-task"
          aria-label="New task"
          data-keyboard-region="composer"
        >
          <MessageComposer
            value={prompt}
            onChange={setPrompt}
            onSubmit={(value) => void submit(value)}
            placeholder="What would you like to work on?"
            density="spacious"
            elevation="none"
            isDisabled={busy}
            footerActions={
              <div
                className="composer-options"
                onClick={(event) => event.stopPropagation()}
              >
                <MachinePicker placement="above" />
                {!projectFilter && (
                  <div
                    ref={projectPicker}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DropdownMenu
                      placement="above"
                      alignment="start"
                      menuWidth={248}
                      button={{
                        label: selectedProject?.name ?? "Project",
                        "aria-label": `Project: ${selectedProject?.name ?? "Choose project"}`,
                        variant: "ghost",
                        size: "sm",
                      }}
                    >
                      <DropdownMenuRadioGroup
                        label="Project"
                        value={project}
                        onChange={setProject}
                      >
                        {projects.map((p) => (
                          <DropdownMenuRadioItem
                            key={p.id}
                            value={p.id}
                            label={p.name}
                            className="project-menu-option"
                            endContent={
                              <span
                                className="project-menu-check"
                                aria-hidden="true"
                              >
                                {p.id === project && <Check size={13} />}
                              </span>
                            }
                          />
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuDivider />
                      <DropdownMenuItem
                        label="New project…"
                        className="project-menu-option"
                        icon={<FolderPlus size={15} />}
                        onClick={() => setProjectEditor(true)}
                      />
                    </DropdownMenu>
                  </div>
                )}
                <StartingPointPicker
                  branch={selectedProject?.branch ?? "main"}
                  local={localProject}
                  value={
                    includeChanges
                      ? includeUntracked
                        ? "new-files"
                        : "changes"
                      : "commit"
                  }
                  onChange={(value) => {
                    setIncludeChanges(value !== "commit");
                    setIncludeUntracked(value === "new-files");
                    if (value !== "commit") setAutonomy("off");
                  }}
                />
                <ModelPicker value={execution} onChange={setExecution} />
                <AgentToolsPicker
                  skills={data.settings.skills}
                  servers={data.settings.mcpServers}
                  value={tools}
                  onChange={setTools}
                />
                <HomeTaskOptions
                  presets={data.presets}
                  preset={preset}
                  onPreset={(id) => {
                    setPreset(id);
                    const selected = data.presets.find(
                      (item) => item.id === id,
                    );
                    if (selected)
                      setExecution({
                        provider: selected.provider,
                        model: selected.model,
                        effort: "",
                      });
                  }}
                  autonomy={autonomy}
                  onAutonomy={setAutonomy}
                  workingChanges={includeChanges && localProject}
                />
              </div>
            }
            sendButton={
              <Button
                label="Start task"
                aria-label="Start task"
                className="home-start-button"
                variant="primary"
                icon={<ArrowUpRight size={16} />}
                isDisabled={
                  !prompt.trim() || !preset || !(projectFilter ?? project)
                }
                isLoading={busy}
                onClick={() => void submit(prompt)}
              />
            }
          />
        </section>
      ) : null}
      {error && (
        <div role="alert" className="error-note">
          {error}
        </div>
      )}
      {(archive || currentProject) && (
        <section className="work-list" aria-label="Your tasks">
          <div className="list-heading">
            <Heading level={2}>Tasks</Heading>
            <div className="search-field">
              <TextInput
                label="Search tasks"
                isLabelHidden
                placeholder="Find a task…"
                value={search}
                onChange={onSearch}
                hasClear
              />
            </div>
          </div>
          {!visible.length ? (
            <div className="empty-list">
              <Search size={24} />
              <Text as="p" color="secondary">
                {search
                  ? "No tasks match your search."
                  : archive
                    ? "Nothing archived yet."
                    : "No tasks yet."}
              </Text>
            </div>
          ) : (
            groups
              .filter(([, tasks]) => tasks.length)
              .map(([name, tasks]) => (
                <div className="task-group" key={name}>
                  <div className="group-label">
                    <Text type="label" color="secondary">
                      {name}
                    </Text>
                    <Text type="supporting">{tasks.length}</Text>
                  </div>
                  {tasks.map((task) => (
                    <button
                      className="task-row"
                      key={task.id}
                      onClick={() => onTask(task.id)}
                    >
                      <span
                        className={`task-indicator ${task.status}`}
                        aria-hidden="true"
                      />
                      <span className="task-row-copy">
                        <Text display="block" weight="medium">
                          {task.title}
                        </Text>
                        <Text type="supporting">
                          {
                            data.projects.find((p) => p.id === task.projectId)
                              ?.name
                          }{" "}
                          ·{" "}
                          {task.error
                            ? "An action is needed"
                            : task.pending.length
                              ? `${task.pending.length} queued ${task.pending.length === 1 ? "message" : "messages"}`
                              : task.provider === "codex"
                                ? "Codex"
                                : "Claude Code"}
                        </Text>
                      </span>
                      <span className="task-row-status">
                        <Text type="supporting">
                          {relativeTime(task.updatedAt)}
                        </Text>
                      </span>
                      <ArrowRight size={16} className="row-arrow" />
                    </button>
                  ))}
                </div>
              ))
          )}
        </section>
      )}
      {currentProject && (
        <div className="project-path">
          <GitBranch size={14} />
          <Text type="supporting">
            {currentProject.branch} ·{" "}
            {currentProject.repository ?? currentProject.path}
          </Text>
        </div>
      )}
      {projectEditor && (
        <EditorModal
          editor={{ kind: "project" }}
          snapshot={data}
          onClose={() => {
            setProjectEditor(false);
            requestAnimationFrame(() =>
              projectPicker.current?.querySelector("button")?.focus(),
            );
          }}
          onSaved={(result) => {
            const added = projectSchema.parse(result);
            setCreatedProject(added);
            setProject(added.id);
            refresh();
          }}
        />
      )}
    </div>
  );
}
