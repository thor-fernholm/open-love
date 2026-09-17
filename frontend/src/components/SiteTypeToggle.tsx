import type { SiteType } from '../lib/projects';

interface SiteTypeToggleProps {
  value: SiteType;
  onChange: (value: SiteType) => void;
  disabled?: boolean;
}

const OPTIONS: { value: SiteType; label: string; description: string; footnote: string }[] = [
  {
    value: 'static',
    label: 'Simple site',
    description: 'Plain HTML, CSS, and JavaScript with no build step or database.',
    footnote: 'Fastest to generate · runs anywhere, even a plain file server',
  },
  {
    value: 'dynamic',
    label: 'Advanced app',
    description: 'A full Next.js application with a real database, accounts, and custom logic.',
    footnote: 'Needs a Node host to run · Claude Code only for now',
  },
];

/** Only meaningful when creating a brand-new project - an existing
 *  project's site type is fixed for good (the underlying tech stack can't
 *  change mid-project), so this doesn't appear once one is picked. */
export function SiteTypeToggle({ value, onChange, disabled }: SiteTypeToggleProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">Project type</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-hairline-strong bg-canvas hover:bg-ink/5'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${
                    selected ? 'bg-primary' : 'bg-hairline-strong'
                  }`}
                  aria-hidden
                />
                {option.label}
              </span>
              <span className="text-xs leading-snug text-muted">{option.description}</span>
              <span className="text-[11px] leading-snug text-muted-soft">{option.footnote}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
