"use client";
import { providerSchema, providerNames } from "@nerilo/protocol";

import { useState } from "react";
import { Check } from "lucide-react";
import type { Snapshot } from "@nerilo/protocol";
import { useApiMutation } from "@/lib/use-api-mutation";
import { Button } from "@/components/ui/ui";

import "@/features/home/setup-checklist.css";

export function SetupChecklist({
  data,
  addProject,
  openSettings,
}: {
  data: Snapshot;
  addProject: () => void;
  openSettings: (section: "connections" | "environment") => void;
}) {
  const { mutateAsync: send } = useApiMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (path: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await send({ path });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "This step could not finish. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const { runtime } = data;
  const connected = providerSchema.options.some(
    (provider) => runtime.connections[provider].ready,
  );
  const steps = [
    {
      title: "Open Docker Desktop",
      detail: runtime.docker
        ? "Running on this machine"
        : "Docker gives each task its own workspace.",
      done: runtime.docker,
      action: (
        <Button
          label="Open Docker"
          size="sm"
          isDisabled={busy}
          onClick={() => void run("runtime/open-docker")}
        />
      ),
    },
    {
      title: "Prepare the agents",
      detail: runtime.building
        ? "Downloading and preparing. You can continue the other steps."
        : runtime.image
          ? "Codex, Claude Code, OpenCode and Pi are installed"
          : "A one-time download for this machine.",
      done: runtime.image,
      action: (
        <Button
          label={runtime.building ? "Preparing…" : "Prepare"}
          size="sm"
          isLoading={runtime.building}
          isDisabled={busy || !runtime.docker}
          onClick={() => void run("runtime/build")}
        />
      ),
    },
    {
      title: "Connect an agent",
      detail: connected
        ? providerSchema.options
            .filter((provider) => runtime.connections[provider].ready)
            .map((provider) => providerNames[provider])
            .join(", ") + " configured"
        : "Use a subscription or your company’s AI gateway.",
      done: connected,
      action: (
        <Button
          label="Connect"
          size="sm"
          onClick={() => openSettings("connections")}
        />
      ),
    },
    {
      title: "Choose a project",
      detail: data.projects.some((project) => !project.archived)
        ? "Your project is ready"
        : "Add a local folder or a public or private GitHub repository.",
      done: data.projects.some((project) => !project.archived),
      action: <Button label="Add project" size="sm" onClick={addProject} />,
    },
  ];
  return (
    <section className="setup-checklist" aria-label="First-time setup">
      <header>
        <h2>Let’s get you ready.</h2>
        <p>Set up once. Your tasks will run in their own workspaces.</p>
      </header>
      <ol>
        {steps.map((step, index) => (
          <li key={step.title}>
            <span
              className={`setup-step-number ${step.done ? "is-complete" : ""}`}
              aria-label={step.done ? "Complete" : `Step ${index + 1}`}
            >
              {step.done ? <Check size={15} /> : index + 1}
            </span>
            <div className="setup-step-copy">
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </div>
            {!step.done && step.action}
          </li>
        ))}
      </ol>
      {runtime.buildLog && !runtime.building && !runtime.image && (
        <div className="setup-build-recovery">
          <p>Preparation has not completed.</p>
          <Button
            label="View details"
            size="sm"
            variant="ghost"
            onClick={() => openSettings("environment")}
          />
        </div>
      )}
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
