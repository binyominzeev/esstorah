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
          const markers = [...row.huHtml.matchAll(/<strong class="vrs-num vrs-ch(\d+)-vrs(\d+)"[^>]*>.*?<\/strong>/g)];
          let html = row.huHtml.replace(/<span class="verse-text vrs-ch(\d+)-vrs(\d+)">([\s\S]*?)<\/span>/g,
            (match, chapter: string, verse: string, content: string) => {
              const markdown = edits[`${chapter}:${verse}`];
              if (markdown === undefined) return match;
              const closing = content.match(/<\/p>\s*$/)?.[0] ?? "";
              return `<span class="verse-text vrs-ch${chapter}-vrs${verse}"> ${safeVerseMarkdownToHtml(markdown)} ${closing}</span>`;
            });
          if (isAdmin) {
            html = html.replace(/(<strong class="vrs-num vrs-ch(\d+)-vrs(\d+)"[^>]*>.*?<\/strong>)/g,
              '$1<button type="button" class="verse-edit-trigger" data-edit-verse="$2:$3" aria-label="$2:$3 fordítás szerkesztése">✎</button>');
          }
          const rowEditing = editing && markers.some((marker) => `${marker[1]}:${marker[2]}` === editing);
          return (
          <tr key={index} className="verse-row">
            <td className="he" dangerouslySetInnerHTML={{ __html: row.heHtml }} />
            <td className="hu chapter-heading">
              <div dangerouslySetInnerHTML={{ __html: html }} onClick={(event) => {
                const target = event.target as HTMLElement;
                const item = target.closest<HTMLElement>("[data-edit-verse]")?.dataset.editVerse;
                if (item) { event.stopPropagation(); onEdit(item); }
              }} />
              {isAdmin && rowEditing && <InlineEditor slug={slug} kind="verse" item={editing} onClose={onClose} onSaved={onSaved} />}
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

