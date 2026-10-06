import type { ReleaseNotesController } from "../../../state/hooks/server/useReleaseNotes";
import { Markdown } from "../../chat/markdown/Markdown";
import { Loader } from "../../primitives/icons";

export function ReleaseNotes({ tag, controller }: {
  tag: string;
  controller: ReleaseNotesController;
}) {
  const { notes, loading, error, retry } = controller;
  const publishedAt = notes?.publishedAt ? new Date(notes.publishedAt) : null;
  return (
    <section class="rounded-card border border-line bg-surface p-4" aria-label={`Release notes for ${tag}`}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-[13.5px] font-semibold text-ink-50">Release notes · {tag}</h3>
        {notes?.url && (
          <a href={notes.url} target="_blank" rel="noopener noreferrer" class="text-[12px] text-accent-blue hover:underline">
            View on GitHub
          </a>
        )}
      </div>
      {notes?.title && notes.title !== tag && (
        <p class="mt-2 text-[13px] font-medium text-ink-100">{notes.title}</p>
      )}
      {publishedAt && !Number.isNaN(publishedAt.getTime()) && (
        <p class="mt-1 text-[12px] text-ink-300">
          Published <time dateTime={notes?.publishedAt}>{publishedAt.toLocaleDateString()}</time>
        </p>
      )}
      {loading ? (
        <p role="status" class="mt-3 flex items-center gap-2 text-[12.5px] text-ink-300">
          <Loader class="h-3.5 w-3.5 animate-spin" /> Loading release notes…
        </p>
      ) : error ? (
        <div class="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-300">
          <span role="status">{error}</span>
          <button type="button" onClick={retry} class="text-accent-blue hover:underline">Retry release notes</button>
        </div>
      ) : notes?.body ? (
        <div tabIndex={0} aria-label="Release notes content" class="mt-3 max-h-80 overflow-y-auto touch-scroll text-[13px] leading-relaxed text-ink-200 break-words">
          <Markdown>{notes.body}</Markdown>
        </div>
      ) : (
        <div class="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-300">
          <span>No release notes are available for this version yet.</span>
          <button type="button" onClick={retry} class="text-accent-blue hover:underline">Retry release notes</button>
        </div>
      )}
    </section>
  );
}
