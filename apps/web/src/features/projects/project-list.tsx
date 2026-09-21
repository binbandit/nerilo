"use client";
import { useState } from "react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import {
  Archive,
  ArchiveRestore,
  FolderGit2,
  GitBranch,
  MoreHorizontal,
  Settings2,
  Trash2,
} from "lucide-react";
import type { Snapshot } from "@nerilo/protocol";
import { Heading, Text } from "@/components/ui/ui";
import type { Editor } from "@/components/editors/editors";
import type { ProjectAction } from "@/features/projects/project-action-dialog";

export function ProjectList({
  data,
  edit,
  onProject,
  onAction,
}: {
  data: Snapshot;
  edit: (editor: Editor) => void;
  onProject: (id: string) => void;
  onAction: (value: ProjectAction) => void;
}) {
  const [archived, setArchived] = useState(false);
  const projects = data.projects
    .filter((project) => project.archived === archived)
    .map((project) => ({
      ...project,
      taskCount: data.tasks.filter((task) => task.projectId === project.id)
        .length,
    }));
  return (
    <>
      <SegmentedControl
        size="sm"
        label="Project list"
        value={archived ? "archived" : "active"}
        onChange={(value) => setArchived(value === "archived")}
      >
        <SegmentedControlItem value="active" label="Active" />
        <SegmentedControlItem value="archived" label="Archived" />
      </SegmentedControl>
      <div className="management-list">
        {projects.map((project) => (
          <article className="management-row" key={project.id}>
            <div className="management-icon">
              <FolderGit2 size={18} />
            </div>
            <div className="management-copy">
              <Heading level={2}>
                <a
                  className="management-project-link"
                  href={`#project/${project.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onProject(project.id);
                  }}
                >
                  {project.name}
                </a>
              </Heading>
              <p
                className="management-source"
                title={project.repository ?? project.path}
              >
                {project.repository ?? project.path}
              </p>
              <div className="management-metadata">
                <span className="management-branch" title={project.branch}>
                  <GitBranch size={12} />
                  <span>{project.branch}</span>
                </span>
                <Text type="supporting">
                  {project.taskCount}{" "}
                  {project.taskCount === 1 ? "task" : "tasks"}
                </Text>
              </div>
            </div>
            <div className="row">
              <DropdownMenu
                button={{
                  label: `Options for ${project.name}`,
                  isIconOnly: true,
                  size: "sm",
                  variant: "ghost",
                  icon: <MoreHorizontal size={16} />,
                }}
                items={[
                  {
                    label: "Project settings",
                    isDisabled: archived,
                    icon: <Settings2 size={15} />,
                    onClick: () => edit({ kind: "project", value: project }),
                  },
                  { type: "divider" },
                  {
                    label: archived ? "Restore project" : "Archive project",
                    icon: archived ? (
                      <ArchiveRestore size={15} />
                    ) : (
                      <Archive size={15} />
                    ),
                    onClick: () =>
                      onAction({
                        project,
                        action: archived ? "restore" : "archive",
                      }),
                  },
                  {
                    label: "Delete project…",
                    icon: <Trash2 size={15} />,
                    onClick: () => onAction({ project, action: "delete" }),
                  },
                ]}
              />
            </div>
          </article>
        ))}
        {!projects.length && (
          <div className="empty-list">
            <FolderGit2 size={28} />
            <Text color="secondary">
              {archived
                ? "No archived projects."
                : "Add a local folder or a public or private GitHub repository to begin."}
            </Text>
          </div>
        )}
      </div>
    </>
  );
}
