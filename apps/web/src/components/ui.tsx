import { Badge } from "@astryxdesign/core/Badge";
import { labels, type TaskStatus } from "@nerilo/protocol";
export { Button } from "@astryxdesign/core/Button";
export { Text } from "@astryxdesign/core/Text";
export { Heading } from "@astryxdesign/core/Heading";
export { TextInput } from "@astryxdesign/core/TextInput";
export { TextArea } from "@astryxdesign/core/TextArea";
export { Selector } from "@astryxdesign/core/Selector";
export { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
export { Badge };
export function Status({ status }: { status: TaskStatus }) {
  const variant = (
    {
      queued: "neutral",
      preparing: "neutral",
      working: "info",
      checking: "info",
      ready: "success",
      paused: "warning",
      failed: "error",
      check_failed: "warning",
      complete: "neutral",
    } as const
  )[status];
  return <Badge variant={variant} label={labels[status]} />;
}
export function relativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
