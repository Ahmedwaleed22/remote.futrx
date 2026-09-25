import { useEffect, useState } from "preact/hooks";

const labels = ["Thinking...", "Creating...", "Writing...", "Working on it..."];

export function TurnActivity() {
  const [label, setLabel] = useState(() => labels[Math.floor(Math.random() * labels.length)]);

  useEffect(() => {
    const rotation = window.setInterval(() => {
      setLabel((current) => {
        const index = labels.indexOf(current);
        const next = (index + 1 + Math.floor(Math.random() * (labels.length - 1))) % labels.length;
        return labels[next];
      });
    }, 5_000);
    return () => window.clearInterval(rotation);
  }, []);

  return <div class="turn-activity" role="status">{label}</div>;
}
