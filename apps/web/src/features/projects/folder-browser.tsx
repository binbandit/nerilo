"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Folder, House } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { Modal } from "@/components/editors/editors";
import { useQuery } from "@tanstack/react-query";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import "@/features/projects/folder-browser.css";

export function FolderBrowser({
  onChoose,
  onClose,
}: {
  onChoose: (path: string) => void;
  onClose: () => void;
}) {
  const { machineId, ready } = useSession();
  const [path, setPath] = useState<string | undefined>();
  const {
    data: listing,
    isFetching,
    isPending,
    error: queryError,
    refetch,
  } = useQuery({ ...queries.folders(machineId, path), enabled: ready });
  const busy = isPending || isFetching;
  const error = queryError?.message ?? "";
  const location = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!busy) location.current?.focus();
  }, [busy]);

  const navigate = (next?: string) => {
    if (next === path) void refetch();
    else setPath(next);
  };

  return (
    <Modal
      title="Choose repository folder"
      width={600}
      onClose={onClose}
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="sm" onClick={onClose} />
          <Button
            label="Choose folder"
            variant="primary"
            size="sm"
            isDisabled={busy || !!error || !listing?.selectable}
            onClick={() => {
              if (!busy && !error && listing?.selectable)
                onChoose(listing.path);
            }}
          />
        </>
      }
    >
      <p>Browse folders on this project’s machine.</p>
      <div className="folder-browser-navigation">
        <Button
          label="Home"
          icon={<House size={16} />}
          variant="ghost"
          size="sm"
          isDisabled={busy}
          onClick={() => navigate()}
        />
        <Button
          label="Parent folder"
          icon={<ArrowUp size={16} />}
          variant="ghost"
          size="sm"
          isDisabled={busy || !listing?.parent}
          onClick={() => {
            if (listing?.parent) navigate(listing.parent);
          }}
        />
      </div>
      <p
        ref={location}
        tabIndex={-1}
        className="folder-browser-location"
        aria-label="Current folder"
      >
        {listing?.path ?? "Home directory"}
      </p>
      {error && (
        <div role="alert" className="error-note">
          <p>{error}</p>
          <Button
            label="Retry"
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onClick={() => navigate(path)}
          />
        </div>
      )}
      <div role="status">
        {busy
          ? "Loading folders…"
          : !error &&
            (listing?.reason ??
              "Git repository with commits. Ready to choose.")}
      </div>
      <ul
        className="folder-browser-list"
        aria-label="Child directories"
        aria-busy={busy}
      >
        {listing?.directories.map((folder) => (
          <li key={folder.name}>
            <Button
              label={folder.name}
              icon={<Folder size={16} />}
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onClick={() => navigate(folder.path)}
            />
          </li>
        ))}
      </ul>
      {!busy && !error && listing?.directories.length === 0 && (
        <p>No visible child folders.</p>
      )}
    </Modal>
  );
}
