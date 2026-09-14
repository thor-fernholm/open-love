interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** Shown when "Export website" is clicked - explains what the download
 *  actually is (a plain static site, no server needed) before handing the
 *  zip over, since that's the whole reason it's easy to host anywhere. */
export function ExportModal({ open, onClose, onConfirm }: ExportModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-hairline bg-canvas p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl tracking-tight text-ink">
          Export website
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          Downloads a zip of the site's own files - plain HTML/CSS/JS, no
          server or build step required. Unzip it and host it free on
          Netlify, Cloudflare Pages, GitHub Pages, Vercel, or Surge.sh - or
          anywhere else that serves static files.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline px-4 py-2 text-sm text-ink transition hover:bg-surface-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary shadow-sm transition hover:bg-primary-active"
          >
            Download zip
          </button>
        </div>
      </div>
    </div>
  );
}
