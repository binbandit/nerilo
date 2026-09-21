import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { taskMetadataSchema } from "@nerilo/protocol";
import { useApiMutation } from "@/lib/use-api-mutation";
import { Modal } from "@/components/editors/editors";
import { Button, Text, TextInput } from "@/components/ui/ui";

export function TaskRenameDialog({
  taskId,
  currentTitle,
  suggestedTitle,
  canSuggest,
  busy,
  error,
  onSave,
  onClose,
}: {
  taskId: string;
  currentTitle: string;
  suggestedTitle?: string;
  canSuggest: boolean;
  busy: boolean;
  error: string;
  onSave: (title: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { mutateAsync: send } = useApiMutation();
  const [title, setTitle] = useState(currentTitle);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const suggest = async () => {
    if (request.current || busy || !canSuggest) return;
    setSuggestionError("");
    if (suggestedTitle) {
      setTitle(suggestedTitle);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setSuggesting(true);
    try {
      const metadata = taskMetadataSchema.parse(
        await send({
          path: `tasks/${taskId}/metadata/preview`,
          body: {},
          signal: controller.signal,
        }),
      );
      if (!controller.signal.aborted) setTitle(metadata.title);
    } catch (reason) {
      if (!controller.signal.aborted)
        setSuggestionError(
          reason instanceof Error
            ? reason.message
            : "Could not suggest a name.",
        );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setSuggesting(false);
      }
    }
  };
  const save = async () => {
    if (busy || request.current || !title.trim()) return;
    if (await onSave(title.trim())) onClose();
  };

  return (
    <Modal
      title="Rename task"
      width={460}
      onClose={() => {
        if (!busy) onClose();
      }}
      onSubmit={() => void save()}
      footer={
        <>
          <Button label="Cancel" isDisabled={busy} onClick={onClose} />
          <Button
            label="Save name"
            variant="primary"
            isLoading={busy}
            isDisabled={busy || suggesting || !title.trim()}
            onClick={() => void save()}
          />
        </>
      }
    >
      {(suggestionError || error) && (
        <div role="alert" className="error-note">
          {suggestionError || error}
        </div>
      )}
      <TextInput
        label="Task name"
        value={title}
        onChange={setTitle}
        isDisabled={busy || suggesting}
        hasAutoFocus
      />
      <div className="task-rename-suggestion">
        <Button
          label="Suggest with AI"
          icon={<Sparkles size={15} />}
          variant="secondary"
          className="task-rename-suggest-button"
          isLoading={suggesting}
          isDisabled={busy || suggesting || !canSuggest}
          onClick={() => void suggest()}
        />
        <Text type="supporting" color="secondary">
          {canSuggest
            ? "Review or edit the suggestion before saving."
            : "Available after the agent finishes a response."}
        </Text>
      </div>
    </Modal>
  );
}
