import { useRef, type ChangeEvent, type ReactNode } from 'react';

interface FileButtonProps {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
}

const DEFAULT_CLASS =
  'inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-1.5 text-sm text-ink transition hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-50';

/**
 * A file picker that actually looks like a button - a raw
 * `<input type="file">` renders as a tiny native "Choose File" control that
 * doesn't read as clickable (the whole reason this exists). Hides the real
 * input and triggers it from a normally-styled button instead.
 */
export function FileButton({
  accept,
  multiple,
  disabled,
  onFiles,
  children,
  className,
}: FileButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) onFiles(files);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={className ?? DEFAULT_CLASS}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={handleChange}
        className="hidden"
      />
    </>
  );
}
