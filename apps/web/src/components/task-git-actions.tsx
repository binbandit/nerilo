"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  gitStatusSchema,
  gitDraftSchema,
  gitRemoteStatusSchema,
  type GitRemoteStatus,
  type GitDraft,
  type GitStatus,
  type Task,
} from "@nerilo/protocol";
import { read, mutate } from "@/lib/api";
import { Button, TextInput, TextArea } from "@/components/ui";
import { parseReviewDiff, readGitPath } from "@/lib/diff-review";
import { HighlightedDiff } from "@/components/code-text";
import { submitFromField } from "@/lib/form-keyboard";
import { gitPublication } from "@/lib/git-publication";
import { PullRequestSignal } from "@/components/pull-requests";
import { focusableControls } from "@/lib/focus";
import "./task-git-actions.css";

type Action = "commit" | "branch" | "push" | "pull-request";
const actionLabels: Record<Action, string> = {
  commit: "Committing",
  branch: "Creating branch",
  push: "Pushing",
  "pull-request": "Creating pull request",
};
const actionNotices: Record<Action, string> = {
  commit: "Changes committed.",
  branch: "Branch created.",
  push: "Branch pushed.",
  "pull-request": "Pull request created.",
};

function PatchReview({ status }: { status: GitStatus }) {
  const patches = status.patch.split(/(?=^diff --git )/m).filter(Boolean);
  const files = status.files.split("\n").filter(Boolean);
  const rows = files.length
    ? files.map((file, index) => ({ file, patch: patches[index] ?? "" }))
    : patches.map((patch) => ({ file: "", patch }));
  return (
    <section
      className="task-git-files"
      aria-label={status.dirty ? "Changes to commit" : "Committed changes"}
    >
      <div className="task-git-section-label">
        <span>
          {status.dirty ? "Uncommitted changes" : "Committed changes"}
        </span>
        <span>
          {files.length || patches.length}{" "}
          {(files.length || patches.length) === 1 ? "file" : "files"}
        </span>
      </div>
      {rows.map(({ file: rawFile, patch }, index) => {
        const file = rawFile ? rawFile.split("\t") : undefined;
        const parsed = parseReviewDiff(patch)[0];
        const path =
          (file ? readGitPath(file.at(-1) ?? "") : parsed?.path) ?? "Changes";
        const kind =
          file?.[0]?.charAt(0) ??
          (patch.includes("\nnew file mode ")
            ? "A"
            : patch.includes("\ndeleted file mode ")
              ? "D"
              : "M");
        const hunkStart = patch.indexOf("\n@@ ");
        const preview = hunkStart >= 0 ? patch.slice(hunkStart + 1) : patch;
        const additions =
          parsed?.lines.filter((line) => line.kind === "add").length ?? 0;
        const deletions =
          parsed?.lines.filter((line) => line.kind === "remove").length ?? 0;
        const slash = path.lastIndexOf("/");
        return (
          <details className="task-git-file" key={`${index}:${path}`}>
            <summary>
              <ChevronRight size={13} className="task-git-file-chevron" />
              <span className="task-git-file-name" title={path}>
                <span>{path.slice(slash + 1)}</span>
                {slash >= 0 && <small>{path.slice(0, slash)}</small>}
              </span>
              <span className="task-git-file-stats">
                {additions > 0 && (
                  <span className="task-git-added">+{additions}</span>
                )}
                {deletions > 0 && (
                  <span className="task-git-removed">−{deletions}</span>
                )}
              </span>
              <span
                className="task-git-file-kind"
                title={
                  { A: "Added", M: "Modified", D: "Deleted", R: "Renamed" }[
                    kind
                  ] ?? "Changed"
                }
              >
                {kind}
              </span>
            </summary>
            {patch ? (
              <div className="task-git-diff diff">
                <HighlightedDiff text={preview} />
              </div>
            ) : (
              <p className="task-git-muted">
                This file is outside the preview limit.
              </p>
            )}
          </details>
        );
      })}
      {!patches.length && files.length > 0 && (
        <pre className="task-git-file-fallback">{status.files}</pre>
      )}
      {status.truncated && (
        <p className="task-git-muted">
          This preview is truncated. The commit includes all listed changes.
        </p>
      )}
    </section>
  );
}

type TaskGitProps = {
  task: Task;
  turnId: string | undefined;
  onRefresh: () => void;
  triggerLabel?: string;
  onOpenChange?: (open: boolean) => void;
  onViewDiff?: () => void;
};
export function TaskGitActions(props: TaskGitProps) {
  return <TaskGitPanel key={props.task.id} {...props} />;
}
function TaskGitPanel({
  task,
  turnId,
  onRefresh,
  triggerLabel = "Commit & publish",
  onOpenChange,
  onViewDiff,
}: TaskGitProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [draft, setDraft] = useState<GitDraft | null>(null);
  const [branching, setBranching] = useState(false);
  const [prForm, setPrForm] = useState(false);
  const [base, setBase] = useState("main");
  const [remote, setRemote] = useState<GitRemoteStatus | null>(null);
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [compact, setCompact] = useState(false);
  const running = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const branchId = useId();
  const taskIsBusy = Boolean(task.activeTurnId || task.pending.length);
  const stale = Boolean(status && (status.turnId !== turnId || taskIsBusy));
  const locked = Boolean(busy || stale);
  const changedFileCount =
    status?.files.split("\n").filter(Boolean).length ?? 0;
  const branchPRs = status
    ? task.pullRequests.filter(
        (pr) =>
          pr.head === status.branch && pr.repository === status.repository,
      )
    : [];
  const linkedPR =
    branchPRs.find((pr) => ["open", "draft"].includes(pr.state)) ??
    branchPRs.find((pr) => pr.state === "merged");
  const publication = status ? gitPublication(status, remote) : null;
  const needsBranch = Boolean(
    status && [status.baseBranch, "main", "master"].includes(status.branch),
  );
  const canPublish = Boolean(
    status &&
    status.commits > 0 &&
    !status.dirty &&
    !status.publishBlocked &&
    !needsBranch,
  );

  useEffect(() => {
    setRemote(null);
    if (
      !open ||
      !status ||
      status.publishBlocked ||
      needsBranch ||
      status.commits < 1 ||
      stale
    )
      return;
    let cancelled = false;
    const { head, branch } = status;
    void read(`tasks/${task.id}/git/remote`)
      .then((response) => {
        const result = gitRemoteStatusSchema.parse(response);
        if (result.head !== head || result.branch !== branch)
          throw new Error(
            "The checkout changed. Refresh changes to compare its current branch.",
          );
        if (!cancelled) setRemote(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setRemote({
            head,
            branch,
            remoteHead: null,
            state: "unavailable",
            ahead: null,
            behind: null,
            checkedAt: new Date().toISOString(),
            error:
              reason instanceof Error
                ? reason.message
                : "Check your connection and try again.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    status?.head,
    status?.branch,
    status?.publishBlocked,
    status?.commits,
    needsBranch,
    stale,
    remoteRevision,
    task.id,
  ]);

  function close() {
    setOpen(false);
    onOpenChange?.(false);
    trigger.current?.querySelector("button")?.focus();
  }
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
  }, [open]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1179px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  async function work(label: string, callback: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await callback();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The Git action failed.",
      );
    } finally {
      running.current = false;
      setBusy("");
    }
  }
  async function load(reset = false) {
    const next = gitStatusSchema.parse(await read(`tasks/${task.id}/git`));
    setStatus(next);
    setRemote(null);
    setRemoteRevision((value) => value + 1);
    if (reset || !status) {
      setBase(next.baseBranch);
      setDraft(next.draft);
    } else setDraft((current) => current ?? next.draft);
  }
  async function prepare() {
    if (task.checkout?.turnId !== turnId) {
      await mutate(`tasks/${task.id}/checkout`, { turnId });
      onRefresh();
    }
    await load(status?.turnId !== turnId);
  }
  function refreshChanges() {
    if (running.current) return;
    setRemote(null);
    void work("Refreshing", () => (stale ? prepare() : load()));
  }
  function show() {
    if (open) {
      close();
      return;
    }
    setRemote(null);
    setOpen(true);
    onOpenChange?.(true);
    setBranching(false);
    setPrForm(false);
    void work("Opening changes", prepare);
  }
  const updateDraft = (key: keyof GitDraft, value: string) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  async function submit(action: Action) {
    if (!status || !draft || locked) return;
    if ((action === "push" || action === "pull-request") && !canPublish) return;
    if (action === "push" && !publication?.canPush) return;
    if (action === "pull-request" && !publication?.canOpenPR) return;
    if (action === "commit" && (!status.dirty || !draft.commitTitle.trim()))
      return;
    if (
      action === "branch" &&
      (!draft.branch.trim() || draft.branch === status.branch)
    )
      return;
    if (
      action === "pull-request" &&
      (!draft.prTitle.trim() || !base.trim() || base === status.branch)
    )
      return;
    await work(actionLabels[action], async () => {
      const next = gitStatusSchema.parse(
        await mutate(`tasks/${task.id}/git`, {
          action,
          turnId: status.turnId,
          reviewToken: status.reviewToken,
          ...(action === "branch"
            ? { branch: draft.branch }
            : action === "commit"
              ? { message: draft.commitTitle }
              : action === "pull-request"
                ? { title: draft.prTitle, body: draft.prBody, base }
                : {}),
        }),
      );
      setStatus(next);
      setRemote(null);
      setRemoteRevision((value) => value + 1);
      setNotice(actionNotices[action]);
      if (action === "branch") {
        setBranching(false);
      }
      if (action === "pull-request") setPrForm(false);
      onRefresh();
    });
  }
  function aiDraft(field: "commit" | "branch" | "pull-request") {
    void work("Drafting", async () => {
      const next = gitDraftSchema.parse(
        await mutate(`tasks/${task.id}/git/draft`),
      );
      setDraft((current) =>
        !current
          ? next
          : field === "commit"
            ? { ...current, commitTitle: next.commitTitle }
            : field === "branch"
              ? { ...current, branch: next.branch }
              : { ...current, prTitle: next.prTitle, prBody: next.prBody },
      );
      setNotice("AI draft ready.");
    });
  }
  const draftButton = (field: "commit" | "branch" | "pull-request") => (
    <Button
      label="Draft with AI"
      variant="ghost"
      size="sm"
      icon={<Sparkles size={13} />}
      isDisabled={locked}
      isLoading={busy === "Drafting"}
      onClick={() => aiDraft(field)}
    />
  );
  return (
    <>
      <span ref={trigger} className="task-git-trigger">
        <Button
          variant="ghost"
          size="sm"
          icon={<GitCommitHorizontal size={15} />}
          isDisabled={!open && (!turnId || taskIsBusy)}
          onClick={show}
          label={triggerLabel}
          aria-expanded={open}
          aria-controls={headingId + "-panel"}
        />
      </span>
      {open && compact && (
        <div className="task-git-backdrop" onClick={close} aria-hidden="true" />
      )}
      {open && (
        <aside
          ref={panel}
          id={headingId + "-panel"}
          className="task-git-drawer"
          role="dialog"
          aria-modal={compact}
          aria-labelledby={headingId}
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              !(event.target instanceof Node) ||
              !event.currentTarget.contains(event.target)
            )
              return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (branching) {
                setBranching(false);
                closeButton.current?.focus();
              } else if (prForm) {
                setPrForm(false);
                closeButton.current?.focus();
              } else close();
            }
            if (compact && event.key === "Tab") {
              const focusable = focusableControls(event.currentTarget);
              const first = focusable[0],
                last = focusable.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <header className="task-git-header">
            <h2 id={headingId}>Changes</h2>
            <div className="task-git-header-actions">
              {onViewDiff && (
                <button
                  className="task-git-icon-button"
                  title="View turn diff"
                  aria-label="View turn diff"
                  onClick={() => {
                    close();
                    onViewDiff();
                  }}
                >
                  <ArrowUpRight size={15} />
                </button>
              )}
              <button
                className="task-git-icon-button"
                title="Refresh changes"
                aria-label="Refresh changes"
                disabled={Boolean(busy) || taskIsBusy}
                onClick={refreshChanges}
              >
                <RefreshCw
                  size={15}
                  className={
                    busy === "Refreshing" ? "task-git-spin" : undefined
                  }
                />
              </button>
              <button
                ref={closeButton}
                className="task-git-icon-button"
                title="Close changes (Esc)"
                aria-label="Close changes"
                onClick={close}
              >
                <X size={17} />
              </button>
            </div>
          </header>
          <div className="task-git-scroll">
            {!status || !draft ? (
              <div className="task-git-loading">
                {busy ? (
                  <>
                    <LoaderCircle size={19} className="task-git-spin" />
                    <span>Opening changes…</span>
                  </>
                ) : (
                  <>
                    <p role="alert">Could not open the task changes.</p>
                    {error && (
                      <details className="task-git-error-details">
                        <summary>Error details</summary>
                        <p>{error}</p>
                      </details>
                    )}
                    <Button
                      label="Try again"
                      size="sm"
                      onClick={() => void work("Opening changes", prepare)}
                    />
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="task-git-context">
                  {status.repository && (
                    <span className="task-git-repository">
                      {status.repository}
                    </span>
                  )}
                  <div className="task-git-branch-line">
                    <button
                      className="task-git-branch-button"
                      aria-expanded={branching}
                      aria-controls={branchId}
                      disabled={locked}
                      onClick={() => setBranching(!branching)}
                      title="Create a branch"
                    >
                      <GitBranch size={15} />
                      <span>{status.branch}</span>
                      <ChevronDown size={13} />
                    </button>
                    <span
                      className="task-git-commit-count"
                      title="Commits since this task's baseline"
                    >
                      {status.commits}{" "}
                      {status.commits === 1 ? "commit" : "commits"}
                    </span>
                  </div>
                  {branching && (
                    <form
                      id={branchId}
                      className="task-git-branch-form"
                      onKeyDown={(event) =>
                        submitFromField(event, () => void submit("branch"))
                      }
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit("branch");
                      }}
                    >
                      <TextInput
                        label="New branch"
                        value={draft.branch}
                        isDisabled={Boolean(busy)}
                        onChange={(value) => updateDraft("branch", value)}
                        hasAutoFocus
                      />
                      <div className="task-git-form-actions">
                        {draftButton("branch")}
                        <Button
                          label="Create branch"
                          variant="primary"
                          size="sm"
                          isDisabled={
                            locked ||
                            !draft.branch.trim() ||
                            draft.branch === status.branch
                          }
                          isLoading={busy === "Creating branch"}
                          onClick={() => void submit("branch")}
                        />
                      </div>
                    </form>
                  )}
                </div>
                {status.patch || status.files ? (
                  <PatchReview status={status} />
                ) : (
                  <div className="task-git-empty">
                    <Check size={20} />
                    <span>No changes to commit</span>
                  </div>
                )}
                {linkedPR && (
                  <a
                    className="task-git-linked-pr"
                    href={linkedPR.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={`pr-signal ${linkedPR.state}`}>
                      <PullRequestSignal pr={linkedPR} />
                    </span>
                    <span>
                      <strong>
                        #{linkedPR.number} {linkedPR.title}
                      </strong>
                      <small>
                        {linkedPR.state === "merged"
                          ? "Merged"
                          : linkedPR.checks === "pending"
                            ? "Checks running"
                            : linkedPR.checks === "passing"
                              ? "Checks passing"
                              : linkedPR.checks === "failing"
                                ? "Checks failing"
                                : "Open pull request"}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </a>
                )}
                {stale && (
                  <p className="task-git-message" role="status">
                    {taskIsBusy
                      ? "The agent is working. Git actions will be available when it finishes."
                      : "A newer task result is available. Refresh changes to continue."}
                  </p>
                )}
                {error && (
                  <p role="alert" className="task-git-message task-git-error">
                    {error}
                  </p>
                )}
                {notice && (
                  <p role="status" className="task-git-notice">
                    <Check size={13} />
                    {notice}
                  </p>
                )}
              </>
            )}
          </div>
          {status && draft && (
            <footer className="task-git-footer">
              {status.dirty ? (
                <form
                  className="task-git-compose"
                  onKeyDown={(event) =>
                    submitFromField(event, () => void submit("commit"))
                  }
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit("commit");
                  }}
                >
                  <div className="task-git-compose-heading">
                    <label htmlFor={headingId + "-commit"}>
                      Commit message
                    </label>
                    {draftButton("commit")}
                  </div>
                  <TextArea
                    id={headingId + "-commit"}
                    label="Commit message"
                    isLabelHidden
                    aria-label="Commit message"
                    value={draft.commitTitle}
                    onChange={(value) => updateDraft("commitTitle", value)}
                    rows={3}
                    isDisabled={Boolean(busy)}
                  />
                  <div className="task-git-compose-bottom">
                    <span>
                      {changedFileCount === 1
                        ? "1 changed file"
                        : `All ${changedFileCount} changed files`}
                    </span>
                    <Button
                      label="Commit changes"
                      variant="primary"
                      size="sm"
                      icon={<GitCommitHorizontal size={14} />}
                      isDisabled={locked || !draft.commitTitle.trim()}
                      isLoading={busy === "Committing"}
                      onClick={() => void submit("commit")}
                    />
                  </div>
                </form>
              ) : status.commits < 1 ? (
                <p className="task-git-muted">
                  New changes will appear here when the task edits files.
                </p>
              ) : status.publishBlocked ? (
                <p className="task-git-muted">{status.publishBlocked}</p>
              ) : needsBranch ? (
                <div className="task-git-next">
                  <p className="task-git-muted">
                    Create a task branch to publish these commits.
                  </p>
                  <Button
                    label="Create branch"
                    variant="primary"
                    size="sm"
                    icon={<GitBranch size={14} />}
                    onClick={() => setBranching(true)}
                    isDisabled={locked}
                  />
                </div>
              ) : prForm ? (
                <form
                  className="task-git-compose task-git-pr-form"
                  onKeyDown={(event) =>
                    submitFromField(event, () => void submit("pull-request"))
                  }
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit("pull-request");
                  }}
                >
                  <div className="task-git-compose-heading">
                    <strong>Pull request</strong>
                    {draftButton("pull-request")}
                  </div>
                  {!publication?.canOpenPR && (
                    <div className="task-git-muted" role="status">
                      <p>{publication?.title}</p>
                      {publication?.detail && <p>{publication.detail}</p>}
                      {publication?.state === "unavailable" && (
                        <Button
                          label="Check again"
                          size="sm"
                          variant="ghost"
                          isDisabled={locked}
                          onClick={refreshChanges}
                        />
                      )}
                    </div>
                  )}
                  <TextInput
                    label="Into branch"
                    value={base}
                    isDisabled={Boolean(busy)}
                    onChange={setBase}
                  />
                  <TextInput
                    label="Title"
                    value={draft.prTitle}
                    isDisabled={Boolean(busy)}
                    onChange={(value) => updateDraft("prTitle", value)}
                  />
                  <TextArea
                    label="Description"
                    value={draft.prBody}
                    onChange={(value) => updateDraft("prBody", value)}
                    rows={5}
                    isDisabled={Boolean(busy)}
                  />
                  <div className="task-git-form-actions">
                    <Button
                      label="Back"
                      size="sm"
                      variant="ghost"
                      onClick={() => setPrForm(false)}
                      isDisabled={Boolean(busy)}
                    />
                    <Button
                      label="Create pull request"
                      variant="primary"
                      size="sm"
                      icon={<GitPullRequest size={14} />}
                      isDisabled={
                        locked ||
                        !canPublish ||
                        !publication?.canOpenPR ||
                        !draft.prTitle.trim() ||
                        !base.trim() ||
                        base === status.branch
                      }
                      isLoading={busy === "Creating pull request"}
                      onClick={() => void submit("pull-request")}
                    />
                  </div>
                </form>
              ) : (
                <div className="task-git-next">
                  <div>
                    <strong role="status">{publication?.title}</strong>
                    {publication?.detail && (
                      <p className="task-git-muted">{publication.detail}</p>
                    )}
                  </div>
                  <div className="task-git-publish-actions">
                    {publication?.canPush && (
                      <Button
                        label={
                          publication.state === "unpublished"
                            ? "Publish branch"
                            : "Push changes"
                        }
                        variant="primary"
                        size="sm"
                        icon={<Upload size={14} />}
                        isDisabled={locked || !canPublish}
                        isLoading={busy === "Pushing"}
                        onClick={() => void submit("push")}
                      />
                    )}
                    {!linkedPR && publication?.canOpenPR && (
                      <Button
                        label="Create pull request"
                        size="sm"
                        variant="primary"
                        icon={<GitPullRequest size={14} />}
                        isDisabled={locked || !canPublish}
                        onClick={() => setPrForm(true)}
                      />
                    )}
                    {linkedPR?.state === "merged" && publication?.canOpenPR && (
                      <Button
                        label="New branch"
                        size="sm"
                        variant="ghost"
                        icon={<GitBranch size={14} />}
                        isDisabled={locked}
                        onClick={() => setBranching(true)}
                      />
                    )}
                    {publication?.state === "unavailable" && (
                      <Button
                        label="Check again"
                        size="sm"
                        variant="ghost"
                        icon={<RefreshCw size={14} />}
                        isDisabled={locked}
                        onClick={refreshChanges}
                      />
                    )}
                    {(publication?.state === "behind" ||
                      publication?.state === "diverged") &&
                      publication.remoteHead && (
                        <Button
                          label="View remote commit"
                          size="sm"
                          variant="ghost"
                          icon={<ArrowUpRight size={14} />}
                          href={`https://github.com/${status.repository}/commit/${publication.remoteHead}`}
                          target="_blank"
                          rel="noreferrer"
                        />
                      )}
                  </div>
                </div>
              )}
            </footer>
          )}
        </aside>
      )}
    </>
  );
}
