"use client";
import {
  Check,
  FileDiff,
  GitBranch,
  GitPullRequest,
  SlidersHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSubMenu,
} from "@astryxdesign/core/DropdownMenu";
import type { Snapshot } from "@nerilo/protocol";
import "@/features/home/home-controls.css";
import "@/components/ui/compact-picker.css";

type StartingPoint = "commit" | "changes" | "new-files";
export function StartingPointPicker({
  branch,
  local,
  value,
  onChange,
}: {
  branch: string;
  local: boolean;
  value: StartingPoint;
  onChange: (value: StartingPoint) => void;
}) {
  if (!local)
    return (
      <span className="composer-branch" title={`Starting branch: ${branch}`}>
        <GitBranch size={14} />
        <span>{branch}</span>
      </span>
    );
  const options = [
    { id: "commit", label: "Latest commit", detail: branch },
    { id: "changes", label: "Working changes", detail: "Tracked files" },
    {
      id: "new-files",
      label: "Changes + new files",
      detail: "Excludes ignored files",
    },
  ] as const;
  return (
    <DropdownMenu
      placement="above"
      alignment="start"
      menuWidth={260}
      button={{
        label:
          value === "commit"
            ? branch
            : value === "changes"
              ? "Working changes"
              : "Changes + new files",
        "aria-label": `Starting point: ${options.find((option) => option.id === value)?.label}`,
        icon:
          value === "commit" ? <GitBranch size={14} /> : <FileDiff size={14} />,
        variant: "ghost",
        size: "sm",
        className: "starting-point-trigger",
      }}
    >
      <DropdownMenuRadioGroup
        label="Start from"
        value={value}
        onChange={(next) => {
          if (next === "commit" || next === "changes" || next === "new-files")
            onChange(next);
        }}
      >
        {options.map((option) => (
          <DropdownMenuRadioItem
            key={option.id}
            value={option.id}
            className="compact-picker-option"
            label={
              <span title={option.id === "commit" ? branch : option.detail}>
                {option.label}
              </span>
            }
            icon={
              option.id === "commit" ? (
                <GitBranch size={14} />
              ) : (
                <FileDiff size={14} />
              )
            }
            endContent={
              <span className="compact-picker-check" aria-hidden="true">
                {value === option.id && <Check size={13} />}
              </span>
            }
          />
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

export function HomeTaskOptions({
  presets,
  preset,
  onPreset,
  autonomy,
  onAutonomy,
  workingChanges,
}: {
  presets: Snapshot["presets"];
  preset: string;
  onPreset: (id: string) => void;
  autonomy: string;
  onAutonomy: (mode: string) => void;
  workingChanges: boolean;
}) {
  return (
    <DropdownMenu
      placement="above"
      alignment="end"
      menuWidth={250}
      hasChevron={false}
      button={{
        label:
          autonomy === "off"
            ? "Task options"
            : autonomy === "pr"
              ? "Open PR"
              : "Merge PR",
        "aria-label": `Task options: ${presets.find((p) => p.id === preset)?.name ?? "Agent"}, ${autonomy === "off" ? "manual" : autonomy === "pr" ? "open pull request" : "through merge"}`,
        isIconOnly: autonomy === "off",
        icon:
          autonomy === "off" ? (
            <SlidersHorizontal size={15} />
          ) : (
            <GitPullRequest size={15} />
          ),
        size: "sm",
        variant: "ghost",
        className: "home-task-options",
      }}
    >
      <DropdownMenuSubMenu
        label={
          <span className="start-option-row">
            <span>Agent</span>
            <small>{presets.find((p) => p.id === preset)?.name}</small>
          </span>
        }
        menuWidth={220}
      >
        <DropdownMenuRadioGroup
          label="Agent preset"
          value={preset}
          onChange={onPreset}
        >
          {presets.map((p) => (
            <DropdownMenuRadioItem
              key={p.id}
              label={p.name}
              value={p.id}
              className="compact-picker-option"
              endContent={
                <span className="compact-picker-check" aria-hidden="true">
                  {p.id === preset && <Check size={13} />}
                </span>
              }
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubMenu>
      <DropdownMenuSubMenu
        label={
          <span className="start-option-row">
            <span>Finish at</span>
            <small>
              {autonomy === "off"
                ? "Review"
                : autonomy === "pr"
                  ? "Pull request"
                  : "Merge"}
            </small>
          </span>
        }
        menuWidth={252}
      >
        <DropdownMenuRadioGroup
          label="Finish at"
          value={autonomy}
          onChange={onAutonomy}
        >
          {[
            { value: "off", label: "Ready for my review" },
            { value: "pr", label: "Open PR and address feedback" },
            { value: "merge", label: "Squash merge when ready" },
          ].map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              label={option.label}
              value={option.value}
              className="compact-picker-option"
              isDisabled={workingChanges && option.value !== "off"}
              endContent={
                <span className="compact-picker-check" aria-hidden="true">
                  {autonomy === option.value && <Check size={13} />}
                </span>
              }
            />
          ))}
        </DropdownMenuRadioGroup>
        {workingChanges && (
          <p className="start-option-hint">
            Autopilot needs a committed starting point.
          </p>
        )}
      </DropdownMenuSubMenu>
    </DropdownMenu>
  );
}
