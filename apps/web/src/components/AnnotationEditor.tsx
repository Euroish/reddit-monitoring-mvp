import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Run } from "../api";
import { Field } from "../ui";

export function AnnotationEditor({ contentId, run }: { contentId: string; run: Run }) {
  const annotation = useQuery({
    queryKey: ["annotation", contentId],
    queryFn: () =>
      api<{
        annotation: {
          favorite: boolean;
          note: string;
          revision: number;
        } | null;
      }>(`/workspace/annotations/${contentId}`),
  });
  if (annotation.isPending) return <p role="status">正在读取批注…</p>;
  if (annotation.error) return <p role="alert">{annotation.error.message}</p>;
  return <AnnotationForm contentId={contentId} initial={annotation.data?.annotation ?? null} run={run} />;
}

function AnnotationForm({
  contentId,
  initial,
  run,
}: {
  contentId: string;
  initial: { favorite: boolean; note: string; revision: number } | null;
  run: Run;
}) {
  const [note, setNote] = useState(initial?.note ?? "");
  const [favorite, setFavorite] = useState(initial?.favorite ?? false);
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void run(async () => {
          try {
            const result = await api<{ revision: number }>(
              `/workspace/annotations/${contentId}`,
              {
                method: "PUT",
                body: JSON.stringify({ note, favorite, revision }),
              },
            );
            setRevision(result.revision);
          } finally {
            setSaving(false);
          }
        });
      }}
    >
      <label className="check">
        <input
          type="checkbox"
          checked={favorite}
          onChange={(event) => setFavorite(event.target.checked)}
        />
        收藏这条证据
      </label>
      <Field label="研究批注">
        <textarea
          rows={5}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <button disabled={saving}>保存到我的研究</button>
    </form>
  );
}
