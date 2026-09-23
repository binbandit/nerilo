"use client";
import { providerNames } from "@nerilo/protocol";

import { useRef, useState } from "react";
import { useApiMutation } from "@/lib/use-api-mutation";
import { GithubAccountPicker } from "@/features/settings/github-account-picker";
import { MessageComposer } from "@/components/composer/message-composer";
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
  type GithubAccountSelection,
} from "@nerilo/protocol";
import {
  Button,
  Text,
  Heading,
  TextInput,
  relativeTime,
} from "@/components/ui/ui";

import {
  StartingPointPicker,
  HomeTaskOptions,
} from "@/features/home/home-controls";
import { ModelPicker } from "@/components/composer/model-picker";
import { AgentToolsPicker } from "@/components/composer/agent-tools-picker";
import { useDraft } from "@/lib/use-draft";
import { EditorModal } from "@/components/editors/editors";
import { MachinePicker } from "@/features/machines/machine-controls";
import { SetupChecklist } from "@/features/home/setup-checklist";
import { NeriloMark } from "@/components/ui/brand";

export function Home({
  data,
  onTask,
  projectFilter,
  archive = false,
  onRestoreProject,
  openSettings,
}: {
  data: Snapshot;
  onTask: (id: string) => void;
  projectFilter?: string;
  archive?: boolean;

  onRestoreProject: (project: Project) => void;
  openSettings: (section: "connections" | "environment") => void;
}) {
  const { mutateAsync: send } = useApiMutation();
  const [search, onSearch] = useState("");
  const [projectEditor, setProjectEditor] = useState(false);
  const projectPicker = useRef<HTMLDivElement>(null);
  const currentProject = data.projects.find((p) => p.id === projectFilter);
  const projects = data.projects.filter((p) => !p.archived);
  const [prompt, setPrompt] = useDraft(`new:${projectFilter ?? "home"}`);
  const [preferredProject, setProject] = useState(
    projectFilter ?? projects[0]?.id ?? "",
  );
  const selectedProject = projectFilter
    ? projects.find((project) => project.id === projectFilter)
    : (projects.find((project) => project.id === preferredProject) ??
      projects[0]);
  const project = selectedProject?.id ?? "";
  const [githubChoice, setGithubChoice] = useState<{
    project: string;
    account: GithubAccountSelection | null;
  } | null>(null);
  const githubAccount =
    githubChoice?.project === project ? githubChoice.account : null;
  const localProject = Boolean(selectedProject?.path);
  const initialPreset =
    data.presets.find(
      (preset) => data.runtime.connections[preset.provider].ready,
    ) ?? data.presets[0];
  const [preset, setPreset] = useState(initialPreset?.id ?? "");
  const [execution, setExecution] = useState<Execution>({
    provider: initialPreset?.provider ?? "codex",
    model: initialPreset?.model ?? "",
    effort: "",
  });
  const [tools, setTools] = useState<AgentTools>({
    skillIds: null,
    mcpServerIds: null,
  });
  const [autonomy, setAutonomy] = useState("off");
  const [includeChanges, setIncludeChanges] = useState(false);
  const [includeUntracked, setIncludeUntracked] = useState(false);
  // Choices persist across project switches; Autopilot needs a committed start.
  const workingChanges = localProject && includeChanges;
  const taskAutonomy = workingChanges ? "off" : autonomy;
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const toast = useToast();
  const [error, setError] = useState("");
  const runtimeReady =
    data.runtime.docker &&
    data.runtime.image &&
    data.runtime.connections[execution.provider].ready;
  const setupNeeded =
    !data.runtime.docker ||
    !data.runtime.image ||
    !projects.length ||
    !Object.values(data.runtime.connections).some(
      (connection) => connection.ready,
    );
  const projectsById = new Map(
    data.projects.map((project) => [project.id, project]),
  );
  const searchText = search.toLowerCase();
  const visible = data.tasks.filter(
    (t) =>
      (currentProject?.archived ||
        (t.archived || Boolean(projectsById.get(t.projectId)?.archived)) ===
          archive) &&
      (!projectFilter || t.projectId === projectFilter) &&
      t.title.toLowerCase().includes(searchText),
  );
  const submit = async (value: string) => {
    if (
      submitting.current ||
      !value.trim() ||
      currentProject?.archived ||
      !runtimeReady
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const task = taskSchema.parse(
        await send({
          path: "tasks",
          body: {
            projectId: projectFilter ?? project,
            githubAccount,
            presetId: preset,
            prompt: value,
            includeChanges: workingChanges,
            includeUntracked: workingChanges && includeUntracked,
            execution,
            tools,
          },
        }),
      );
      setPrompt("");
      setTools({ skillIds: null, mcpServerIds: null });
      if (taskAutonomy !== "off") {
        try {
          await send({
            path: `tasks/${task.id}/autonomy`,
            body: { mode: taskAutonomy },
          });
        } catch (e) {
          toast({
            type: "error",
            body: `Task created, but Autopilot could not be enabled. ${e instanceof Error ? e.message : String(e)} You can try again from this task's Autopilot menu.`,
            uniqueID: `task-autonomy-${task.id}`,
          });
        }
      }

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
        {!archive && !currentProject && (
          <div className="welcome-mark" aria-hidden="true">
            <NeriloMark />
          </div>
        )}
      </div>
      {!archive && !currentProject?.archived && setupNeeded && (
        <SetupChecklist
          data={data}
          addProject={() => setProjectEditor(true)}
          openSettings={openSettings}
        />
      )}
      {currentProject?.archived ? (
        <div className="project-archive-notice">
          <Text color="secondary">This project is archived.</Text>
          <Button
            label="Restore project"
            size="sm"
            onClick={() => onRestoreProject(currentProject)}
          />
        </div>
      ) : !archive && projects.length > 0 ? (
        <section
          className="new-task"
          aria-label="New task"
          data-keyboard-region="composer"
        >
          <MessageComposer
            className="home-composer"
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
                <div className="home-context-controls">
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
                </div>
                <div className="home-agent-controls">
                  <GithubAccountPicker
                    compact
                    scope="task"
                    value={githubAccount}
                    inherited={selectedProject?.githubAccount}
                    disabled={busy}
                    onChange={(account) =>
                      setGithubChoice({ project, account })
                    }
                  />
                  <ModelPicker
                    value={execution}
                    onChange={setExecution}
                    connections={data.runtime.connections}
                  />
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
                    autonomy={taskAutonomy}
                    onAutonomy={setAutonomy}
                    workingChanges={workingChanges}
                  />
                </div>
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
                  !prompt.trim() ||
                  !preset ||
                  !(projectFilter ?? project) ||
                  !runtimeReady
                }
                isLoading={busy}
                onClick={() => void submit(prompt)}
              />
            }
          />
          {!runtimeReady && (
            <div className="composer-readiness" role="status">
              <span>
                {!data.runtime.docker
                  ? "Open Docker Desktop to start a task. Your draft is saved."
                  : !data.runtime.image
                    ? "Prepare the agent environment to start. Your draft is saved."
                    : `Connect ${providerNames[execution.provider]} to start, or choose your connected agent.`}
              </span>
              <Button
                label="Finish setup"
                size="sm"
                variant="ghost"
                onClick={() =>
                  openSettings(
                    !data.runtime.docker || !data.runtime.image
                      ? "environment"
                      : "connections",
                  )
                }
              />
            </div>
          )}
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
                          {projectsById.get(task.projectId)?.name} ·{" "}
                          {task.error
                            ? "An action is needed"
                            : task.pending.length
                              ? `${task.pending.length} queued ${task.pending.length === 1 ? "message" : "messages"}`
                              : providerNames[task.provider]}
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
            setProject(added.id);
          }}
        />
      )}
    </div>
  );
}
