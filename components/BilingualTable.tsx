import type { RowData } from "@/lib/types";
import { safeVerseMarkdownToHtml } from "@/lib/safeMarkdown";
import InlineEditor from "./InlineEditor";

export default function BilingualTable({ rows, slug, isAdmin, edits, editing, onEdit, onClose, onSaved }: {
  rows: RowData[];
  slug: string;
  isAdmin: boolean;
  edits: Record<string, string>;
  editing?: string;
  onEdit: (item: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <table className="bilingual-table">
      <tbody>
        {rows.map((row, index) => {
          let html = row.huHtml.replace(/<span class="verse-text vrs-ch(\d+)-vrs(\d+)">([\s\S]*?)<\/span>/g,
            (match, chapter: string, verse: string, content: string) => {
              const markdown = edits[`${chapter}:${verse}`];
              if (markdown === undefined) return match;
              const closing = content.match(/<\/p>\s*$/)?.[0] ?? "";
              return `<span class="verse-text vrs-ch${chapter}-vrs${verse}"> ${safeVerseMarkdownToHtml(markdown)} ${closing}</span>`;
            });
          if (isAdmin) {
            html = html.replace(/<span class="verse-text vrs-ch(\d+)-vrs(\d+)">/g,
              '<button type="button" class="screen-reader-only" data-edit-trigger="$1:$2">$1:$2 fordítás szerkesztése</button><span class="verse-text vrs-ch$1-vrs$2 editable-verse" data-edit-verse="$1:$2" title="Kattints a fordítás szerkesztéséhez">');
          }
          const segments = isAdmin && editing
            ? [...html.matchAll(/<span class="verse-text vrs-ch(\d+)-vrs(\d+) editable-verse"[^>]*>[\s\S]*?<\/span>/g)]
                .find((match) => `${match[1]}:${match[2]}` === editing)
            : undefined;
          function editTarget(target: HTMLElement) {
            if (!isAdmin || editing) return;
            const trigger = target.closest<HTMLElement>("[data-edit-trigger]");
            if (trigger?.dataset.editTrigger) { onEdit(trigger.dataset.editTrigger); return; }
            if (target.closest("a, button, input, textarea")) return;
            if (window.getSelection() && !window.getSelection()?.isCollapsed) return;
            const item = target.closest<HTMLElement>("[data-edit-verse]")?.dataset.editVerse;
            if (item) onEdit(item);
          }
          return (
          <tr key={index} className="verse-row">
            <td className="he" dangerouslySetInnerHTML={{ __html: row.heHtml }} />
            <td className="hu chapter-heading" onClick={(event) => editTarget(event.target as HTMLElement)}>
              {segments && editing ? (
                <>
                  <div dangerouslySetInnerHTML={{ __html: html.slice(0, segments.index) }} />
                  <InlineEditor slug={slug} kind="verse" item={editing} onClose={onClose} onSaved={onSaved} />
                  <div dangerouslySetInnerHTML={{ __html: html.slice(segments.index + segments[0].length) }} />
                </>
              ) : <div dangerouslySetInnerHTML={{ __html: html }} />}
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

