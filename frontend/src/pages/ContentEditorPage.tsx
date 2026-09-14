import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileButton } from '../components/FileButton';
import {
  getContent,
  resolveContentAssetUrl,
  updateCollection,
  uploadImage,
  youtubeEmbedUrl,
  type ContentCollectionSchema,
  type ContentFieldSchema,
  type ProjectContent,
} from '../lib/content';
import { getProject } from '../lib/projects';

type RecordValue = Record<string, string>;

const inputClass =
  'w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-disabled';

interface FieldInputProps {
  field: ContentFieldSchema;
  value: string;
  onChange: (value: string) => void;
  projectId: string;
}

/** Renders one field's editor, driven entirely by its declared type -
 *  this is what lets the same editor handle whatever collections a
 *  project's manifest declares, without any per-project custom code. */
function FieldInput({ field, value, onChange, projectId }: FieldInputProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { path } = await uploadImage(projectId, file);
      onChange(path);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={inputClass}
      />
    );
  }

  if (field.type === 'date') {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    );
  }

  if (field.type === 'image') {
    return (
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Image URL"
          className={inputClass}
        />
        <div className="flex items-center gap-2">
          <FileButton accept="image/*" disabled={uploading} onFiles={handleFiles}>
            <UploadIcon /> {uploading ? 'Uploading…' : 'Upload image'}
          </FileButton>
        </div>
        {uploadError && <span className="text-xs text-error">{uploadError}</span>}
        {value && (
          <img
            src={resolveContentAssetUrl(projectId, value)}
            alt=""
            className="h-24 w-auto rounded-md border border-hairline object-cover"
          />
        )}
      </div>
    );
  }

  if (field.type === 'video') {
    const embedUrl = youtubeEmbedUrl(value);
    return (
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="YouTube URL"
          className={inputClass}
        />
        {embedUrl && (
          <iframe
            src={embedUrl}
            title={field.label ?? field.key}
            className="aspect-video w-full max-w-sm rounded-md border border-hairline"
            allowFullScreen
          />
        )}
      </div>
    );
  }

  // text / link
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

interface CollectionEditorProps {
  projectId: string;
  schema: ContentCollectionSchema;
  initialData: unknown;
}

/** One collection's editor: a single form for a "singleton", or a list of
 *  add/remove-able item cards for a "list" - saved as one PUT per
 *  collection to keep this simple rather than saving per-item. */
function CollectionEditor({ projectId, schema, initialData }: CollectionEditorProps) {
  const isList = schema.type === 'list';
  const [items, setItems] = useState<RecordValue[]>(() =>
    isList
      ? ((initialData as RecordValue[]) ?? [])
      : [(initialData as RecordValue) ?? {}],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateField(index: number, key: string, value: string) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
    setSaved(false);
  }

  function addItem() {
    const blank: RecordValue = {};
    for (const field of schema.fields) blank[field.key] = '';
    setItems((prev) => [...prev, blank]);
    setSaved(false);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateCollection(projectId, schema.name, isList ? items : items[0] ?? {});
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-hairline bg-canvas p-4 shadow-sm">
      <h2 className="font-display text-xl tracking-tight text-ink">
        {schema.label ?? schema.name}
      </h2>

      <div className="flex flex-col gap-4">
        {items.map((item, index) => (
          <div
            key={index}
            className={
              isList
                ? 'flex flex-col gap-3 rounded-md border border-hairline p-3'
                : 'flex flex-col gap-3'
            }
          >
            {isList && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="text-xs text-error hover:underline"
                >
                  Remove
                </button>
              </div>
            )}
            {schema.fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted">
                  {field.label ?? field.key}
                </label>
                <FieldInput
                  field={field}
                  value={item[field.key] ?? ''}
                  onChange={(value) => updateField(index, field.key, value)}
                  projectId={projectId}
                />
              </div>
            ))}
          </div>
        ))}
        {isList && items.length === 0 && (
          <p className="text-sm text-muted italic">No items yet.</p>
        )}
      </div>

      {isList && (
        <button
          type="button"
          onClick={addItem}
          className="self-start rounded-md border border-hairline px-3 py-1.5 text-sm text-ink transition hover:bg-surface-soft"
        >
          + Add item
        </button>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="self-start rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-on-primary shadow-sm transition hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-muted"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {error && <span className="text-xs text-error">{error}</span>}
        {saved && !error && <span className="text-xs text-success">Saved</span>}
      </div>
    </div>
  );
}

/** Renders whatever content collections a project declared for itself
 *  (see content/manifest.json in the generated project) - a project that
 *  never declared any is a plain static site with nothing to edit here. */
export function ContentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [projectName, setProjectName] = useState<string | null>(null);
  const [content, setContent] = useState<ProjectContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    Promise.all([getProject(id), getContent(id)])
      .then(([project, projectContent]) => {
        if (cancelled) return;
        setProjectName(project.name);
        setContent(projectContent);
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate font-display text-2xl tracking-tight text-ink">
            Edit content — {projectName ?? 'Loading…'}
          </h1>
          <Link
            to={`/projects/${id}`}
            className="text-xs text-primary hover:underline"
          >
            ← Back to project
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        {loadError && (
          <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
            {loadError}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-muted">Loading content…</p>
        ) : content && content.collections.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {content.collections.map((schema) => (
              <CollectionEditor
                key={schema.name}
                projectId={id}
                schema={schema}
                initialData={content.data[schema.name]}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            This project doesn't have editable content - it's a static site
            with its content built directly into the page.
          </p>
        )}
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="h-4 w-4"
    >
      <path
        d="M10 12.5V4M6.5 7.5 10 4l3.5 3.5M4.5 14.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
