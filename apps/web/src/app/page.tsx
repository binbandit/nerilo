"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Theme } from "@astryxdesign/core";
import { neriloTheme } from "@nerilo/theme";
import { Menu, RefreshCw, PanelLeftOpen } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import type { Snapshot, TaskDetail } from "@nerilo/protocol";
import { Button, Text, Heading } from "@/components/ui";
import { ProjectPullRequests } from "@/components/project-pull-requests";
import { Home } from "@/components/home";
import { TaskView } from "@/components/task-view";
import { Manage } from "@/components/manage";
import { EditorModal, type Editor } from "@/components/editors";
import { coalesceRefresh } from "@/lib/refresh";
import { apiUrl, loadSnapshot, loadTask } from "@/lib/api";
import { MachineProvider } from "@/lib/machines";
import { MachinePicker } from "@/components/machine-controls";
import {
  ProjectActionDialog,
  type ProjectAction,
} from "@/components/project-action-dialog";
import { KeyboardHelp } from "@/components/keyboard-help";
import {
  appShortcut,
  cycleRegion,
  focusComposer,
  focusRegion,
  isEditing,
  openKeyboardLayer,
} from "@/lib/keyboard";
import { KeyboardPreferencesProvider } from "@/lib/shortcut-preferences";
import { focusableControls } from "@/lib/focus";
import "./keyboard.css";

export default function Nerilo() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [route, setRoute] = useState("home");
  const [offline, setOffline] = useState("");
  const [taskError, setTaskError] = useState("");
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(
    null,
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const [mobile, setMobile] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const [shortcuts, setShortcuts] = useState(false);
  const [mac, setMac] = useState(true);
  const [focusRequest, setFocusRequest] = useState<{
    route: string;
    target: "content" | "composer";
  } | null>(null);
  const loaded = useRef(false);
  const lifecycle = useRef(0);
  const previousSidebarHidden = useRef(sidebarHidden);
  const selected = useRef(route);
  selected.current = route;
  const refresh = useMemo(
    () =>
      coalesceRefresh(async () => {
        const generation = lifecycle.current;
        try {
          const next = await loadSnapshot(!loaded.current);
          if (generation !== lifecycle.current) return;
          loaded.current = true;
          setData(next);
          setOffline("");
          const current = selected.current;
          if (current.startsWith("task/")) {
            try {
              const task = await loadTask(current.slice(5));
              if (
                generation === lifecycle.current &&
                selected.current === current
              ) {
                setDetail(task);
                setTaskError("");
              }
            } catch (e) {
              if (
                generation === lifecycle.current &&
                selected.current === current
              )
                setTaskError(e instanceof Error ? e.message : String(e));
            }
          }
        } catch (e) {
          if (generation === lifecycle.current)
            setOffline(e instanceof Error ? e.message : String(e));
        }
      }),
    [],
  );
  const nav = useCallback(
    (value: string, target: "content" | "composer" = "content") => {
      setFocusRequest({ route: value, target });
      selected.current = value;
      setRoute(value);
      setTaskError("");
      window.location.hash = value;
      setMobile(false);
      void refresh();
    },
    [refresh],
  );
  useEffect(() => {
    const update = () => {
      const next = window.location.hash.slice(1) || "home";
      if (selected.current !== next)
        setFocusRequest((request) =>
          request?.route === next
            ? request
            : { route: next, target: "content" },
        );
      setRoute(next);
      selected.current = next;
      setTaskError("");
      void refresh();
    };
    update();
    window.addEventListener("hashchange", update);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      lifecycle.current++;
      window.removeEventListener("hashchange", update);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    const source = new EventSource(apiUrl(`events?after=${data.sequence}`));
    source.addEventListener("change", () => void refresh());
    return () => source.close();
  }, [Boolean(data), refresh]);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  useEffect(() => {
    if (
      !focusRequest ||
      focusRequest.route !== route ||
      !data ||
      (route.startsWith("task/") &&
        detail?.task.id !== route.slice(5) &&
        !taskError)
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (focusRequest.target !== "composer" || !focusComposer())
        document.getElementById("main")?.focus();
      setFocusRequest(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, route, Boolean(data), detail?.task.id, taskError]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = appShortcut(
        event,
        {
          editing: isEditing(event.target),
          overlay: openKeyboardLayer(),
          mac,
        },
        data?.settings.keybindings,
      );
      if (!action) return;
      if (
        action === "composer" &&
        !document.querySelector(
          'main [data-keyboard-region="composer"] :is(textarea, [contenteditable="true"])',
        )
      )
        return;
      event.preventDefault();
      if (action === "search") {
        setSidebarHidden(false);
        if (window.matchMedia("(max-width:760px)").matches) setMobile(true);
        setSearchRequest((value) => value + 1);
      } else if (action === "new-task") nav("home", "composer");
      else if (action === "settings") nav("settings");
      else if (action === "help") setShortcuts(true);
      else if (action === "composer") focusComposer();
      else if (action === "sidebar") {
        if (window.matchMedia("(max-width:760px)").matches)
          setMobile((value) => !value);
        else setSidebarHidden((value) => !value);
      } else cycleRegion(action === "previous-region");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mac, nav, data?.settings.keybindings]);
  useEffect(() => {
    if (!mobile) return;
    const navigation = document.querySelector<HTMLElement>(
      '[data-keyboard-region="navigation"]',
    );
    if (!navigation) return;
    const frame = requestAnimationFrame(() => {
      if (!navigation.contains(document.activeElement)) focusRegion(navigation);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || openKeyboardLayer()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMobile(false);
      }
      if (event.key === "Tab") {
        const controls = focusableControls(navigation);
        const edge = event.shiftKey ? controls[0] : controls.at(-1);
        if (document.activeElement === edge) {
          event.preventDefault();
          (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      requestAnimationFrame(() => {
        if (
          !document.activeElement ||
          navigation.contains(document.activeElement) ||
          document.activeElement === document.body
        )
          document
            .querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')
            ?.focus();
      });
    };
  }, [mobile]);
  useEffect(() => {
    if (previousSidebarHidden.current === sidebarHidden) return;
    previousSidebarHidden.current = sidebarHidden;
    const navigation = document.querySelector<HTMLElement>(
      '[data-keyboard-region="navigation"]',
    );
    const active = document.activeElement;
    const shouldMove = sidebarHidden
      ? navigation?.contains(active)
      : active === document.body;
    if (!shouldMove) return;
    const frame = requestAnimationFrame(() => {
      if (sidebarHidden)
        document
          .querySelector<HTMLButtonElement>('[aria-label="Expand sidebar"]')
          ?.focus();
      else if (navigation && !window.matchMedia("(max-width:760px)").matches)
        focusRegion(navigation);
    });
    return () => cancelAnimationFrame(frame);
  }, [sidebarHidden]);
  useEffect(() => {
    const title = route.startsWith("task/")
      ? detail?.task.id === route.slice(5)
        ? detail.task.title
        : "Task"
      : route === "home"
        ? "Room to make"
        : route.startsWith("project/")
          ? (data?.projects.find((p) => route.includes(p.id))?.name ??
            "Project")
          : route[0].toUpperCase() + route.slice(1);
    document.title = `${title} · Nerilo`;
  }, [route, detail?.task.title, data?.projects]);
  const prProject = route.endsWith("/prs")
    ? data?.projects.find((project) => route === `project/${project.id}/prs`)
    : undefined;
  const view =
    route === "projects" ||
    route === "agents" ||
    route === "library" ||
    route === "settings"
      ? route
      : null;
  return (
    <KeyboardPreferencesProvider bindings={data?.settings.keybindings ?? {}}>
      <Theme theme={neriloTheme} mode={data?.settings.appearance ?? "light"}>
        <MachineProvider>
          <div
            className={`nerilo-app ${sidebarHidden ? "sidebar-hidden" : ""}`}
          >
            <a
              className="skip-link"
              href="#main"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById("main")?.focus();
              }}
            >
              Skip to content
            </a>
            <Sidebar
              data={data}
              searchRequest={searchRequest}
              onShowShortcuts={() => setShortcuts(true)}
              onStartTask={(project) =>
                nav(project ? `project/${project}` : "home", "composer")
              }
              route={route}
              offline={offline}
              mobile={mobile}
              onClose={() => setMobile(false)}
              onCollapse={() => setSidebarHidden(true)}
              nav={nav}
              onProjectAction={setProjectAction}
              edit={setEditor}
              refresh={() => void refresh()}
            />
            {mobile && (
              <button
                className="nav-scrim"
                aria-label="Close navigation"
                onClick={() => setMobile(false)}
              />
            )}
            <div className="main-shell" inert={mobile}>
              {sidebarHidden && (
                <div className="sidebar-reopen">
                  <Button
                    label="Expand sidebar"
                    isIconOnly
                    variant="ghost"
                    icon={<PanelLeftOpen size={17} />}
                    onClick={() => setSidebarHidden(false)}
                  />
                </div>
              )}
              <header className="topbar">
                <Button
                  label="Open navigation"
                  isIconOnly
                  variant="ghost"
                  icon={<Menu size={19} />}
                  onClick={() => {
                    setSidebarHidden(false);
                    setMobile(true);
                  }}
                />
                <span className="brand">nerilo.</span>
              </header>
              {offline && (
                <div className="connection-banner" role="status">
                  <div>
                    <Text>{offline}</Text>
                  </div>
                  <Button
                    label="Reconnect"
                    icon={<RefreshCw size={15} />}
                    onClick={() => {
                      loaded.current = false;
                      void refresh();
                    }}
                  />
                </div>
              )}
              <main
                id="main"
                tabIndex={-1}
                data-keyboard-region="content"
                aria-label="Main content"
              >
                {!data ? (
                  <div className="initial-state">
                    <div className="brand">nerilo.</div>
                    <Heading level={1}>
                      {offline ? "Machine unavailable" : "Loading…"}
                    </Heading>
                    <Text color="secondary">
                      {offline
                        ? "Reconnect to this machine or choose another workspace."
                        : ""}
                    </Text>
                    {offline && <MachinePicker />}
                  </div>
                ) : route.startsWith("task/") ? (
                  taskError ? (
                    <div className="initial-state">
                      <Heading level={1}>This task is unavailable.</Heading>
                      <Text>{taskError}</Text>
                      <Button
                        label="Back to my work"
                        onClick={() => nav("home")}
                      />
                    </div>
                  ) : detail?.task.id === route.slice(5) ? (
                    <TaskView
                      key={detail.task.id}
                      onRestoreProject={() => {
                        const project = data.projects.find(
                          (p) => p.id === detail.task.projectId,
                        );
                        if (project)
                          setProjectAction({ project, action: "restore" });
                      }}
                      detail={detail}
                      data={data}
                      refresh={() => void refresh()}
                    />
                  ) : (
                    <div className="initial-state">
                      <Text>Opening your task…</Text>
                    </div>
                  )
                ) : prProject ? (
                  <ProjectPullRequests
                    key={prProject.id}
                    project={prProject}
                    data={data}
                    nav={nav}
                    refresh={() => void refresh()}
                  />
                ) : view ? (
                  <Manage
                    view={view}
                    data={data}
                    onProjectAction={setProjectAction}
                    edit={setEditor}
                    refresh={() => void refresh()}
                    onProject={(id) => nav(`project/${id}`)}
                  />
                ) : (
                  <Home
                    key={route}
                    data={data}
                    onTask={(id) => nav(`task/${id}`)}
                    projectFilter={
                      route.startsWith("project/") ? route.slice(8) : undefined
                    }
                    onRestoreProject={(project) =>
                      setProjectAction({ project, action: "restore" })
                    }
                    archive={route === "archive"}
                    refresh={() => void refresh()}
                  />
                )}
              </main>
            </div>
            {projectAction && data && (
              <ProjectActionDialog
                value={projectAction}
                data={data}
                refresh={() => void refresh()}
                onClose={() => setProjectAction(null)}
                onSaved={() => {
                  const { project, action } = projectAction;
                  setProjectAction(null);
                  void refresh();
                  const insideProject =
                    route.startsWith(`project/${project.id}`) ||
                    data.tasks.some(
                      (task) =>
                        task.projectId === project.id &&
                        route === `task/${task.id}`,
                    );
                  nav(action !== "restore" && insideProject ? "home" : route);
                }}
              />
            )}
            {shortcuts && (
              <KeyboardHelp mac={mac} onClose={() => setShortcuts(false)} />
            )}
            {editor && data && (
              <EditorModal
                editor={editor}
                snapshot={data}
                onClose={() => setEditor(null)}
                onSaved={() => void refresh()}
              />
            )}
          </div>
        </MachineProvider>
      </Theme>
    </KeyboardPreferencesProvider>
  );
}
