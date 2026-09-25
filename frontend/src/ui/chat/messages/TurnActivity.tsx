import { useEffect, useState } from "preact/hooks";
import { Loader } from "../../primitives/icons";

const labels = ["Thinking...", "Creating...", "Writing...", "Working on it..."];

export function TurnActivity() {
  const [label, setLabel] = useState(() => labels[Math.floor(Math.random() * labels.length)]);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    let changeTimer: number | undefined;
    const rotation = window.setInterval(() => {
      setChanging(true);
      changeTimer = window.setTimeout(() => {
        setLabel((current) => {
          const index = labels.indexOf(current);
          const next = (index + 1 + Math.floor(Math.random() * (labels.length - 1))) % labels.length;
          return labels[next];
        });
        setChanging(false);
      }, 180);
    }, 5_000);
    return () => {
      window.clearInterval(rotation);
      if (changeTimer !== undefined) window.clearTimeout(changeTimer);
    };
  }, []);

  return (
    <div class="turn-activity" role="status">
      <Loader class="turn-activity-icon" aria-hidden="true" />
      <span class={`turn-activity-label ${changing ? "turn-activity-label-changing" : ""}`}>{label}</span>
    </div>
  );
}
