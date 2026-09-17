import type { SiteType } from '../lib/projects';

interface ExportModalProps {
  open: boolean;
  siteType: SiteType;
  onClose: () => void;
  onConfirm: () => void;
}

const COPY: Record<SiteType, string> = {
  static:
    "Downloads a zip of the site's own files - plain HTML/CSS/JS, no server or build step required. Unzip it and host it free on Netlify, Cloudflare Pages, GitHub Pages, Vercel, or Surge.sh - or anywhere else that serves static files.",
  dynamic:
    "Downloads a zip of the app's own files (Next.js + Prisma + SQLite) - node_modules and build output are left out, so run npm install once you've unzipped it. It's a standard Next.js app: npm run build && npm start runs it anywhere Node.js runs (a VPS, Railway, Render, Fly.io), or deploy it to Vercel with zero configuration.",
};

/** Shown when "Export website" is clicked - explains what the download
 *  actually is before handing the zip over, since what makes it easy to
 *  host differs by site type (drag-and-drop static hosting vs. a real
 *  Node deploy). */
export function ExportModal({ open, siteType, onClose, onConfirm }: ExportModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-hairline bg-canvas p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl tracking-tight text-ink">
          Export website
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted">{COPY[siteType]}</p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-hairline-strong px-4 py-2 text-sm text-ink transition hover:bg-ink/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-on-primary shadow-button-inset transition hover:opacity-80"
          >
            Download zip
          </button>
        </div>
      </div>
    </div>
  );
}
