"use client";

import {
  useEffect,
  useRef,
  useLayoutEffect,
  useState,
  useOptimistic,
  startTransition,
  useMemo,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import {
  MoreHorizontal,
  Trash2,
  GitPullRequest,
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  MessageSquareText,
  CirclePause,
  Folder,
  FolderPlus,
  ListFilter,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
  Keyboard,
} from "lucide-react";
import type { Snapshot, Task, SidebarOrder } from "@nerilo/protocol";
import {
  labels,
  activeStatuses,
  ordered,
  reorder,
  matchesShortcut,
  effectiveBindings,
  formatShortcut,
  ariaShortcut,
  type ShortcutAction,
} from "@nerilo/protocol";

import { useApiMutation } from "@/lib/use-api-mutation";
import { useStoredString } from "@/lib/use-stored-string";
import { MachinePicker } from "@/features/machines/machine-controls";
import { Button, TextInput } from "@/components/ui/ui";
import { TaskContextMenu } from "@/features/tasks/task-context-menu";
import { PullRequests } from "@/features/review/pull-requests";
import type { ProjectAction } from "@/features/projects/project-action-dialog";
import type { Editor } from "@/components/editors/editors";
import {
  sidebarDestination,
  sidebarFocusAfterRemoval,
  type SidebarRow,
} from "@/features/navigation/sidebar-keyboard";
import {
  useKeyboardBindings,
  useShortcutPlatform,
} from "@/features/navigation/shortcut-preferences";
import "@/features/navigation/sidebar-keyboard.css";
import { NeriloWordmark } from "@/components/ui/brand";
import { duplicateTaskLabels } from "@/features/navigation/task-label";

type Filter = "all" | "active" | "attention" | "complete" | "prs";
type DragItem = { kind: "project" | "task"; id: string; projectId?: string };
type DropTarget = DragItem & { edge: "before" | "after" };
const emptyOrder: SidebarOrder = { projects: [], tasks: {} };
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All tasks" },
  { value: "active", label: "Running" },
  { value: "attention", label: "Needs attention" },
  { value: "complete", label: "Completed" },
  { value: "prs", label: "With pull requests" },
];

export function Sidebar({
  data,
  route,
  offline,
  mobile,
  onClose,
  onCollapse,
  nav,
  edit,
  searchRequest = 0,
  onSearchClose,
  onShowShortcuts,
  onStartTask,
  onProjectAction,
}: {
  data: Snapshot | null;
  route: string;
  offline: string;
  mobile: boolean;
  onClose: () => void;
  onCollapse: () => void;
  nav: (route: string) => void;
  edit: (editor: Editor) => void;

  searchRequest?: number;
  onSearchClose?: () => void;
  onShowShortcuts?: () => void;
  onStartTask?: (projectId?: string) => void;
  onProjectAction: (value: ProjectAction) => void;
}) {
  const { mutateAsync: send } = useApiMutation("settings");
  const bindings = useKeyboardBindings();
  const mac = useShortcutPlatform();
  const shortcuts = effectiveBindings(bindings);
  const hint = (action: ShortcutAction) =>
    shortcuts[action].map((chord) => formatShortcut(chord, mac)).join(" or ");
  const aria = (...actions: ShortcutAction[]) =>
    actions
      .flatMap((action) =>
        shortcuts[action].map((chord) => ariaShortcut(chord, mac)),
      )
      .join(" ") || undefined;
  const [searchState, setSearchState] = useState({ open: false, request: 0 });
  const searching = searchState.open || searchRequest > searchState.request;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const taskLabels = useMemo(
    () => duplicateTaskLabels(data?.tasks ?? []),
    [data?.tasks],
  );
  const [storedCollapsed, storeCollapsed] = useStoredString(
    "nerilo-collapsed-projects",
  );
  const collapsed = useMemo(() => {
    try {
      const value: unknown = JSON.parse(storedCollapsed);
      if (
        Array.isArray(value) &&
        value.every((id): id is string => typeof id === "string")
      )
        return value;
    } catch {}
    return [];
  }, [storedCollapsed]);
  const [searchCollapsed, setSearchCollapsed] = useState<string[]>([]);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<{
    removed?: string;
    candidates: string[];
  } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const lastFocusedRow = useRef<string | null>(null);
  const priorRows = useRef<SidebarRow[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const [order, setOrder] = useOptimistic(
    data?.settings.sidebarOrder ?? emptyOrder,
  );
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const drag = useRef<DragItem | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const saving = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  const [orderError, setOrderError] = useState("");
  const projects = ordered(
    data?.projects.filter((project) => !project.archived) ?? [],
    order.projects,
  );
  const projectTasks = (projectId: string) =>
    ordered(
      data?.tasks.filter((task) => task.projectId === projectId) ?? [],
      order.tasks[projectId] ?? [],
    );
  // Rows the user can see; hidden tasks and projects keep their stored order.
  const visibleSiblings = (item: DragItem) =>
    item.kind === "project"
      ? projects.filter(
          (project) =>
            !(query || filter !== "all") ||
            projectTasks(project.id).some(matches),
        )
      : projectTasks(item.projectId!).filter(matches);
  const move = (item: DragItem, overId: string, edge: "before" | "after") => {
    if (saving.current || item.id === overId) return;
    const rowKey = `${item.kind}:${item.id}`;
    if (document.activeElement === rowRefs.current.get(rowKey))
      pendingFocus.current = { candidates: [rowKey] };
    const ids = (
      item.kind === "project" ? projects : projectTasks(item.projectId!)
    ).map((value) => value.id);
    const next = reorder(ids, item.id, overId, edge);
    const visible = new Set(visibleSiblings(item).map((value) => value.id));
    const position = next.filter((id) => visible.has(id)).indexOf(item.id) + 1;
    saving.current = true;
    setOrderError("");
    startTransition(async () => {
      setOrder(
        item.kind === "project"
          ? { ...order, projects: next }
          : { ...order, tasks: { ...order.tasks, [item.projectId!]: next } },
      );
      try {
        await send({
          path: "sidebar-order",
          body: {
            kind: item.kind,
            id: item.id,
            overId,
            edge,
          },
        });

        setAnnouncement(
          `${item.kind === "project" ? "Project" : "Task"} moved to position ${position}.`,
        );
      } catch (error) {
        setOrderError(error instanceof Error ? error.message : String(error));
      } finally {
        saving.current = false;
      }
    });
  };
  const compatible = (target: DragItem) =>
    drag.current &&
    drag.current.id !== target.id &&
    drag.current.kind === target.kind &&
    (target.kind === "project" || drag.current.projectId === target.projectId);
  const dragStart = (event: DragEvent, item: DragItem) => {
    if (saving.current) {
      event.preventDefault();
      return;
    }
    drag.current = item;
    setDragging(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-nerilo-order", item.id);
  };
  const dragOver = (event: DragEvent<HTMLElement>, item: DragItem) => {
    if (!compatible(item)) {
      setDrop(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDrop({
      ...item,
      edge: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  };
  const dragEnd = () => {
    drag.current = null;
    setDragging(null);
    setDrop(null);
  };
  const dragDrop = (event: DragEvent, target: DragItem) => {
    if (!compatible(target) || !drop || drop.id !== target.id) return;
    event.preventDefault();
    event.stopPropagation();
    const item = drag.current!;
    dragEnd();
    void move(item, target.id, drop.edge);
  };
  const keyboardMove = (event: ReactKeyboardEvent, item: DragItem) => {
    const up = matchesShortcut(event, "reorder-up", bindings, mac);
    if (!up && !matchesShortcut(event, "reorder-down", bindings, mac))
      return false;
    event.preventDefault();
    event.stopPropagation();
    const siblings = visibleSiblings(item);
    const offset = up ? -1 : 1;
    const neighbor =
      siblings[siblings.findIndex((value) => value.id === item.id) + offset];
    if (neighbor)
      void move(item, neighbor.id, offset === -1 ? "before" : "after");
    return true;
  };
  useEffect(() => {
    if (searching) searchRef.current?.querySelector("input")?.focus();
  }, [searching, searchRequest]);
  const updateQuery = (value: string) => {
    setQuery(value);
    setSearchCollapsed([]);
  };
  const toggle = (id: string) => {
    if (query) {
      setSearchCollapsed((value) =>
        value.includes(id)
          ? value.filter((item) => item !== id)
          : [...value, id],
      );
      return;
    }
    const next = collapsed.includes(id)
      ? collapsed.filter((value) => value !== id)
      : [...collapsed, id];
    storeCollapsed(JSON.stringify(next));
  };
  const matches = (task: Task) =>
    !task.archived &&
    (taskLabels.get(task.id) ?? task.title)
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (filter === "all" ||
      (filter === "active" && activeStatuses.includes(task.status)) ||
      (filter === "attention" &&
        ["failed", "paused", "check_failed"].includes(task.status)) ||
      (filter === "complete" && task.status === "complete") ||
      (filter === "prs" && task.pullRequests.length > 0));
  const isProjectOpen = (id: string) =>
    query.length > 0 ? !searchCollapsed.includes(id) : !collapsed.includes(id);
  const rows: SidebarRow[] = projects.flatMap((project) => {
    const tasks = projectTasks(project.id).filter(matches);
    if ((query || filter !== "all") && !tasks.length) return [];
    const open = isProjectOpen(project.id);
    return [
      {
        key: `project:${project.id}`,
        kind: "project" as const,
        id: project.id,
        open,
      },
      ...(open
        ? tasks.map((task) => ({
            key: `task:${task.id}`,
            kind: "task" as const,
            id: task.id,
            projectId: project.id,
          }))
        : []),
    ];
  });
  useLayoutEffect(() => {
    const prior = priorRows.current;
    priorRows.current = rows;
    if (
      !pendingFocus.current &&
      lastFocusedRow.current &&
      !rows.some((row) => row.key === lastFocusedRow.current) &&
      document.activeElement === document.body
    )
      pendingFocus.current = {
        candidates: sidebarFocusAfterRemoval(prior, lastFocusedRow.current),
      };
    const pending = pendingFocus.current;
    if (
      !pending ||
      (pending.removed && rows.some((row) => row.key === pending.removed))
    )
      return;
    const target = pending.candidates
      .map((key) => rowRefs.current.get(key))
      .find((element) => element?.isConnected);
    if (target) target.focus();
    else asideRef.current?.querySelector<HTMLButtonElement>(".brand")?.focus();
    pendingFocus.current = null;
  });
  const rowKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    item: DragItem,
  ) => {
    if (event.nativeEvent.isComposing) return;
    if (
      item.kind === "project" &&
      matchesShortcut(event, "context-menu", bindings, mac)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const options = event.currentTarget
        .closest(".workspace-heading")
        ?.querySelector<HTMLButtonElement>(".workspace-actions button");
      options?.focus();
      options?.click();
      return;
    }
    if (keyboardMove(event, item)) return;
    const rowActions: [ShortcutAction, string][] = [
      ["row-next", "ArrowDown"],
      ["row-previous", "ArrowUp"],
      ["row-first", "Home"],
      ["row-last", "End"],
      ["row-expand", "ArrowRight"],
      ["row-collapse", "ArrowLeft"],
    ];
    const action = rowActions.find(([action]) =>
      matchesShortcut(event, action, bindings, mac),
    );
    if (!action) return;
    const destination = sidebarDestination(
      rows,
      `${item.kind}:${item.id}`,
      action[1],
    );
    if (!destination) return;
    event.preventDefault();
    event.stopPropagation();
    if (destination.expanded) toggle(destination.expanded.id);
    if (destination.focus) rowRefs.current.get(destination.focus)?.focus();
  };
  const closeSearch = () => {
    setSearchState({ open: false, request: searchRequest });
    updateQuery("");
    onSearchClose?.();
    asideRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-label="Search tasks"]')
      ?.focus();
  };
  const start = (project?: string) => {
    if (onStartTask) onStartTask(project);
    else nav(project ? `project/${project}` : "home");
  };
  return (
    <aside
      className={`sidebar ${mobile ? "open" : ""}`}
      aria-label="Workspace navigation"
      ref={asideRef}
      data-keyboard-region="navigation"
      onFocusCapture={(event) => {
        const row =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[data-sidebar-row]")
            : null;
        if (row) lastFocusedRow.current = row.dataset.sidebarRow ?? null;
      }}
    >
      <span className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
      <span className="visually-hidden" id="sidebar-reorder-help">
        {[
          hint("row-next") && `${hint("row-next")} moves to the next row.`,
          hint("row-previous") &&
            `${hint("row-previous")} moves to the previous row.`,
          hint("row-expand") && `${hint("row-expand")} expands a project.`,
          hint("row-collapse") &&
            `${hint("row-collapse")} goes to the parent or collapses a project.`,
          hint("reorder-up") && `${hint("reorder-up")} moves an item up.`,
          hint("reorder-down") && `${hint("reorder-down")} moves an item down.`,
          hint("context-menu") && `${hint("context-menu")} opens actions.`,
        ]
          .filter(Boolean)
          .join(" ")}
      </span>
      <div className="sidebar-toolbar">
        <button
          className="brand"
          onClick={() => nav("home")}
          aria-label="Nerilo home"
        >
          <NeriloWordmark />
        </button>
        <div className="sidebar-tools">
          <Tooltip
            content={["Search tasks", hint("search")]
              .filter(Boolean)
              .join(" · ")}
          >
            <Button
              label="Search tasks"
              isIconOnly
              size="sm"
              variant="ghost"
              icon={<Search size={15} />}
              onClick={() => {
                if (searching) closeSearch();
                else setSearchState({ open: true, request: searchRequest });
              }}
            />
          </Tooltip>
          <DropdownMenu
            hasChevron={false}
            alignment="end"
            button={{
              label: "Filter tasks",
              isIconOnly: true,
              size: "sm",
              variant: "ghost",
              icon: <ListFilter size={15} />,
              className: filter !== "all" ? "filter-active" : undefined,
            }}
            items={filters.map((item) => ({
              label: item.label,
              icon: filter === item.value ? <Check size={14} /> : undefined,
              onClick: () => setFilter(item.value),
            }))}
          />
          <Tooltip
            content={["New task", hint("new-task")].filter(Boolean).join(" · ")}
          >
            <Button
              label="New task"
              isIconOnly
              size="sm"
              variant="primary"
              className="sidebar-new-task"
              icon={<Plus size={17} />}
              onClick={() => start()}
            />
          </Tooltip>
        </div>
      </div>
      <div className="sidebar-machine">
        <MachinePicker />
      </div>
      {searching && (
        <div
          className="sidebar-search"
          ref={searchRef}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeSearch();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              const first = rows.find((row) => row.kind === "task") ?? rows[0];
              if (first) rowRefs.current.get(first.key)?.focus();
            }
          }}
        >
          <TextInput
            label="Search tasks"
            isLabelHidden
            placeholder="Find a task…"
            value={query}
            onChange={updateQuery}
            hasClear
          />
          <Button
            label="Close search"
            isIconOnly
            variant="ghost"
            size="sm"
            icon={<X size={14} />}
            onClick={closeSearch}
          />
        </div>
      )}
      {filter !== "all" && (
        <button
          className="sidebar-filter-note"
          onClick={() => setFilter("all")}
        >
          {filters.find((item) => item.value === filter)?.label}
          <X size={12} />
        </button>
      )}
      {orderError && (
        <p className="sidebar-empty" role="alert">
          {orderError}
        </p>
      )}
      <nav className="workspace-tree" aria-label="Projects and tasks">
        {projects.map((project) => {
          const tasks = projectTasks(project.id).filter(matches);
          const item: DragItem = { kind: "project", id: project.id };
          const isOpen = isProjectOpen(project.id);
          if ((query || filter !== "all") && !tasks.length) return null;
          return (
            <section
              className={`workspace-group ${dragging?.id === project.id ? "is-dragging" : ""}`}
              key={project.id}
              data-drop={drop?.id === project.id ? drop.edge : undefined}
              onDragOver={(event) => dragOver(event, item)}
              onDrop={(event) => dragDrop(event, item)}
            >
              <div className="workspace-heading">
                <button
                  className="workspace-toggle"
                  aria-expanded={isOpen}
                  data-sidebar-row={`project:${project.id}`}
                  ref={(element) => {
                    if (element)
                      rowRefs.current.set(`project:${project.id}`, element);
                    else rowRefs.current.delete(`project:${project.id}`);
                  }}
                  draggable
                  aria-describedby="sidebar-reorder-help"
                  aria-keyshortcuts={aria(
                    "reorder-up",
                    "reorder-down",
                    "context-menu",
                    "row-next",
                    "row-previous",
                    "row-first",
                    "row-last",
                    "row-expand",
                    "row-collapse",
                  )}
                  onDragStart={(event) => dragStart(event, item)}
                  onDragEnd={dragEnd}
                  onKeyDown={(event) => rowKeyDown(event, item)}
                  onClick={() => toggle(project.id)}
                >
                  <span className="folder-glyph">
                    <Folder size={15} />
                    {isOpen ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                  <span>{project.name}</span>
                </button>
                <div className="workspace-actions">
                  <DropdownMenu
                    hasChevron={false}
                    alignment="start"
                    button={{
                      label: `Options for ${project.name}`,
                      isIconOnly: true,
                      variant: "ghost",
                      size: "sm",
                      icon: <MoreHorizontal size={14} />,
                    }}
                    items={[
                      {
                        label: "Pull requests",
                        icon: <GitPullRequest size={15} />,
                        onClick: () => nav(`project/${project.id}/prs`),
                      },
                      {
                        label: "Project tasks",
                        icon: <Folder size={15} />,
                        onClick: () => nav(`project/${project.id}`),
                      },
                      {
                        label: "Project settings",
                        icon: <Settings2 size={15} />,
                        onClick: () =>
                          edit({ kind: "project", value: project }),
                      },
                      { type: "divider" },
                      {
                        label: "Archive project",
                        icon: <Archive size={15} />,
                        onClick: () =>
                          onProjectAction({ project, action: "archive" }),
                      },
                      {
                        label: "Delete project…",
                        icon: <Trash2 size={15} />,
                        onClick: () =>
                          onProjectAction({ project, action: "delete" }),
                      },
                    ]}
                  />
                  <Tooltip content="New task">
                    <Button
                      label={`New task in ${project.name}`}
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      icon={<Plus size={15} />}
                      onClick={() => start(project.id)}
                    />
                  </Tooltip>
                </div>
              </div>
              {isOpen && (
                <div className="workspace-tasks">
                  {tasks.map((task) => (
                    <TaskContextMenu
                      key={task.id}
                      task={task}
                      onRemoved={() => {
                        pendingFocus.current = {
                          removed: `task:${task.id}`,
                          candidates: sidebarFocusAfterRemoval(
                            rows,
                            `task:${task.id}`,
                          ),
                        };
                      }}
                      onDeleted={() => {
                        if (route === `task/${task.id}`) nav("home");
                      }}
                    >
                      <div
                        className={`workspace-task ${route === `task/${task.id}` ? "selected" : ""} ${dragging?.id === task.id ? "is-dragging" : ""}`}
                        key={task.id}
                        data-drop={drop?.id === task.id ? drop.edge : undefined}
                        onDragOver={(event) =>
                          dragOver(event, {
                            kind: "task",
                            id: task.id,
                            projectId: project.id,
                          })
                        }
                        onDrop={(event) =>
                          dragDrop(event, {
                            kind: "task",
                            id: task.id,
                            projectId: project.id,
                          })
                        }
                      >
                        <a
                          href={`#task/${task.id}`}
                          title={taskLabels.get(task.id) ?? task.title}
                          draggable
                          aria-describedby="sidebar-reorder-help"
                          aria-keyshortcuts={aria(
                            "reorder-up",
                            "reorder-down",
                            "context-menu",
                            "row-next",
                            "row-previous",
                            "row-first",
                            "row-last",
                            "row-expand",
                            "row-collapse",
                          )}
                          data-sidebar-row={`task:${task.id}`}
                          ref={(element) => {
                            if (element)
                              rowRefs.current.set(`task:${task.id}`, element);
                            else rowRefs.current.delete(`task:${task.id}`);
                          }}
                          onDragStart={(event) =>
                            dragStart(event, {
                              kind: "task",
                              id: task.id,
                              projectId: project.id,
                            })
                          }
                          onDragEnd={dragEnd}
                          onKeyDown={(event) =>
                            rowKeyDown(event, {
                              kind: "task",
                              id: task.id,
                              projectId: project.id,
                            })
                          }
                          aria-current={
                            route === `task/${task.id}` ? "page" : undefined
                          }
                          onClick={(event) => {
                            if (
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              event.altKey ||
                              event.button !== 0
                            )
                              return;
                            event.preventDefault();
                            nav(`task/${task.id}`);
                          }}
                        >
                          <span
                            className={`task-glyph ${task.status}`}
                            aria-label={labels[task.status]}
                          >
                            {activeStatuses.includes(task.status) ? (
                              <span className="task-spinner" />
                            ) : task.status === "complete" ? (
                              <Check size={13} />
                            ) : task.status === "ready" ? (
                              <MessageSquareText size={15} />
                            ) : task.status === "paused" ? (
                              <CirclePause size={15} />
                            ) : ["failed", "check_failed"].includes(
                                task.status,
                              ) ? (
                              <CircleAlert size={15} />
                            ) : (
                              <Circle size={13} />
                            )}
                          </span>
                          <span className="workspace-task-name">
                            {taskLabels.get(task.id) ?? task.title}
                          </span>
                        </a>
                        <PullRequests task={task} />
                      </div>
                    </TaskContextMenu>
                  ))}
                  {!tasks.length && (
                    <button
                      className="empty-project-action"
                      onClick={() => start(project.id)}
                    >
                      New task
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {data && (query || filter !== "all") && !data.tasks.some(matches) && (
          <p className="sidebar-empty">No matching tasks</p>
        )}
        {data && !projects.length && (
          <Button
            label="Add project"
            variant="ghost"
            icon={<FolderPlus size={15} />}
            onClick={() => edit({ kind: "project" })}
          />
        )}
      </nav>
      <div className="workspace-footer">
        <DropdownMenu
          hasChevron={false}
          placement="above"
          menuWidth={220}
          button={{
            label: "Workspace",
            variant: "ghost",
            icon: (
              <span
                className={`connection-dot ${offline || !data?.runtime.docker ? "unavailable" : ""}`}
              />
            ),
            size: "sm",
          }}
          items={[
            {
              label: "Projects",
              icon: <Folder size={15} />,
              onClick: () => nav("projects"),
            },
            {
              label: "Add project",
              icon: <FolderPlus size={15} />,
              onClick: () => edit({ kind: "project" }),
            },
            {
              label: "Agents",
              icon: <SlidersHorizontal size={15} />,
              onClick: () => nav("agents"),
            },
            {
              label: "Library",
              icon: <BookOpen size={15} />,
              onClick: () => nav("library"),
            },
            { type: "divider" },
            {
              label: "Archive",
              icon: <Archive size={15} />,
              onClick: () => nav("archive"),
            },
            {
              label: "Settings",
              icon: <Settings2 size={15} />,
              onClick: () => nav("settings"),
            },
            ...(onShowShortcuts
              ? [
                  {
                    label: "Keyboard shortcuts",
                    icon: <Keyboard size={15} />,
                    onClick: onShowShortcuts,
                  },
                ]
              : []),
          ]}
        />
        <Tooltip
          content={
            mobile
              ? "Close sidebar"
              : ["Collapse sidebar", hint("sidebar")]
                  .filter(Boolean)
                  .join(" · ")
          }
        >
          <Button
            label={mobile ? "Close navigation" : "Collapse sidebar"}
            isIconOnly
            size="sm"
            variant="ghost"
            icon={<PanelLeftClose size={15} />}
            onClick={mobile ? onClose : onCollapse}
          />
        </Tooltip>
      </div>
    </aside>
  );
}
