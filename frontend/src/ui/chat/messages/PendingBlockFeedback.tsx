import { useEffect, useState } from "preact/hooks";

const waitingLabels = ["Creating...", "Writing...", "Working on it..."];

export function PendingBlockFeedback({ pending, progressKey }: { pending: boolean; progressKey: string }) {
  const [feedback, setFeedback] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => {
    if (!pending) {
      setFeedback(null);
      return;
    }
    let rotation: number | undefined;
    const timer = window.setTimeout(() => {
      setFeedback({ key: progressKey, label: waitingLabels[Math.floor(Math.random() * waitingLabels.length)] });
      rotation = window.setInterval(() => {
        setFeedback((current) => {
          if (!current || current.key !== progressKey) return current;
          const index = waitingLabels.indexOf(current.label);
          const next = (index + 1 + Math.floor(Math.random() * (waitingLabels.length - 1))) % waitingLabels.length;
          return { key: progressKey, label: waitingLabels[next] };
        });
      }, 5_000);
    }, 700);
    return () => {
      window.clearTimeout(timer);
      if (rotation !== undefined) window.clearInterval(rotation);
    };
  }, [pending, progressKey]);

  const visible = pending && feedback?.key === progressKey;
  return <div class={`streaming-feedback${visible ? " streaming-feedback-visible" : ""}`} role="status" aria-hidden={!visible}>
    {feedback?.label}
  </div>;
}
