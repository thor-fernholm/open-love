import { marked } from 'marked';
import { useRef, useState } from 'react';

interface EditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Wraps the current selection in `before`/`after` (e.g. "**"/"**" for
 *  bold) - an empty selection wraps a placeholder instead, and the wrapped
 *  text stays selected afterward so typing immediately replaces it. */
function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): EditResult {
  const selected = value.slice(start, end) || placeholder;
  const newValue = value.slice(0, start) + before + selected + after + value.slice(end);
  const selectionStart = start + before.length;
  return { value: newValue, selectionStart, selectionEnd: selectionStart + selected.length };
}

/** Prefixes every line the selection touches with `prefix` (e.g. "## " for
 *  a heading, "- " for a bullet) - used instead of wrapSelection for
 *  line-level formatting rather than inline formatting. */
function prefixLines(value: string, start: number, end: number, prefix: string): EditResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndSearch = value.indexOf('\n', end);
  const lineEnd = lineEndSearch === -1 ? value.length : lineEndSearch;
  const block = value.slice(lineStart, lineEnd);
  const prefixed = block
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
  const newValue = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
  const added = prefixed.length - block.length;
  return { value: newValue, selectionStart: start + prefix.length, selectionEnd: end + added };
}

/** Inserts `[selected text](url)`, leaving the "https://" placeholder
 *  selected so typing a real URL immediately overwrites it - selecting text
 *  first and pressing this button links that text instead. */
function insertLink(value: string, start: number, end: number): EditResult {
  const selected = value.slice(start, end) || 'link text';
  const urlPlaceholder = 'https://';
  const newValue = `${value.slice(0, start)}[${selected}](${urlPlaceholder})${value.slice(end)}`;
  const urlStart = start + 1 + selected.length + 2;
  return { value: newValue, selectionStart: urlStart, selectionEnd: urlStart + urlPlaceholder.length };
}

interface ToolbarButton {
  label: string;
  title: string;
  apply: (value: string, start: number, end: number) => EditResult;
}

const TOOLBAR_BUTTONS: ToolbarButton[] = [
  {
    label: 'B',
    title: 'Bold',
    apply: (v, s, e) => wrapSelection(v, s, e, '**', '**', 'bold text'),
  },
  {
    label: 'I',
    title: 'Italic',
    apply: (v, s, e) => wrapSelection(v, s, e, '*', '*', 'italic text'),
  },
  { label: 'H2', title: 'Heading', apply: (v, s, e) => prefixLines(v, s, e, '## ') },
  { label: 'H3', title: 'Subheading', apply: (v, s, e) => prefixLines(v, s, e, '### ') },
  { label: '🔗', title: 'Link', apply: insertLink },
  { label: '•', title: 'Bullet list', apply: (v, s, e) => prefixLines(v, s, e, '- ') },
];

interface MarkdownFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/** A markdown editor for a 'markdown' content field: a small formatting
 *  toolbar over a plain textarea (each button wraps/prefixes the current
 *  selection with the relevant markdown syntax - no rich-text/
 *  contentEditable state to fight), plus a toggle to preview the rendered
 *  result via `marked`. The stored value is always raw markdown text - the
 *  same value a generated site's own JS renders at runtime (see
 *  prompt-template.ts's CONTENT_CONVENTION). */
export function MarkdownField({ value, onChange }: MarkdownFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewing, setPreviewing] = useState(false);

  function applyButton(button: ToolbarButton) {
    const ta = textareaRef.current;
    if (!ta) return;
    const result = button.apply(ta.value, ta.selectionStart, ta.selectionEnd);
    // Set the DOM value/selection imperatively (synchronously, before the
    // controlled re-render below lands) so the browser doesn't reset the
    // cursor to the end - it won't, since by the time React commits the
    // same string back onto the node, it's already there.
    ta.value = result.value;
    ta.focus();
    ta.setSelectionRange(result.selectionStart, result.selectionEnd);
    onChange(result.value);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {TOOLBAR_BUTTONS.map((button) => (
          <button
            key={button.title}
            type="button"
            title={button.title}
            disabled={previewing}
            onClick={() => applyButton(button)}
            className="min-w-[1.75rem] rounded-sm border border-hairline bg-canvas px-2 py-1 text-xs font-medium text-ink transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {button.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreviewing((p) => !p)}
          className={`ml-auto rounded-sm border px-2.5 py-1 text-xs font-medium transition ${
            previewing
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-hairline text-muted hover:bg-ink/5'
          }`}
        >
          {previewing ? 'Edit' : 'Preview'}
        </button>
      </div>

      {previewing ? (
        <div
          className="rounded-sm border border-hairline bg-canvas px-3 py-2 text-sm leading-relaxed text-ink [&_a]:text-primary [&_a]:underline [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
          // Safe here: this is the project owner's own content, rendered
          // for their own eyes in their own local admin tool - same trust
          // level as everything else this single-user tool edits.
          dangerouslySetInnerHTML={{ __html: value ? marked.parse(value, { async: false }) : '' }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          className="w-full rounded-sm border border-hairline bg-canvas px-3 py-2 font-mono text-sm text-ink shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/50"
        />
      )}
    </div>
  );
}
