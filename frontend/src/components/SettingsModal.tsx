import { useEffect, useState } from 'react';
import { getSettings, updateSettings, type AgentSelection } from '../lib/settings';
import { ModelSelect } from './ModelSelect';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/** The "options popup" - sets the app-wide default agent/model new
 *  projects use. The chat's per-message dropdown (see PromptForm) can
 *  still override this for a single message. */
export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [selection, setSelection] = useState<AgentSelection>({ provider: 'claude' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getSettings()
      .then((s) => {
        setSelection(s);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(selection);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
          Build options
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          Choose the default agent new projects use. You can still override
          it per message.
        </p>

        <ModelSelect
          value={selection}
          onChange={setSelection}
          className="w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary"
        />

        {error && <p className="mt-3 text-sm text-error">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline px-4 py-2 text-sm text-ink transition hover:bg-surface-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary shadow-sm transition hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
