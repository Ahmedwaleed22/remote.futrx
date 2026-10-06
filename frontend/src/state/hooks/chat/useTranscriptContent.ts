import { useEffect, useRef, useState } from "preact/hooks";
import { fetchFullTranscriptContent } from "../../../api/chat/chatTranscriptApi";
import { fullResponseErrorMessage, fullResponseLabel } from "./transcriptContentPresentation";

/** Expansion belongs to the mounted detail view, including across prop updates. */
export function useTranscriptContent({
  chatId,
  content,
  contentRef,
  contentBytes,
  inlinePreviewLimit,
}: {
  chatId?: string;
  content?: string;
  contentRef?: string;
  contentBytes?: number;
  inlinePreviewLimit?: number | null;
}) {
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setFullContent(null);
    setLoading(false);
    setError(null);
    return () => request.current?.abort();
  }, [chatId, contentRef]);
  const canExpandInline = !contentRef
    && !!content
    && inlinePreviewLimit != null
    && content.length > inlinePreviewLimit;

  async function load() {
    if (loading) return;
    if (!contentRef) {
      if (content) setFullContent(content);
      return;
    }
    if (!chatId) return;
    const abort = new AbortController();
    request.current = abort;
    setLoading(true);
    setError(null);
    try {
      const content = await fetchFullTranscriptContent(chatId, contentRef, abort.signal);
      if (!abort.signal.aborted) setFullContent(content);
    } catch (cause) {
      if (!abort.signal.aborted) setError(fullResponseErrorMessage(cause));
    } finally {
      if (request.current === abort && !abort.signal.aborted) setLoading(false);
    }
  }

  return {
    content: fullContent ?? content,
    expanded: fullContent !== null,
    canExpand: (!!contentRef || canExpandInline) && fullContent === null,
    disabled: (!!contentRef && !chatId) || loading,
    loading,
    label: fullResponseLabel(loading, contentBytes),
    error,
    load,
  };
}
