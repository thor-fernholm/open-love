const API_BASE = 'http://localhost:3000';

export type ContentFieldType =
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'image'
  | 'video'
  | 'link'
  | 'date';

export type CollectionType = 'list' | 'singleton';

export interface ContentFieldSchema {
  key: string;
  label?: string;
  type: ContentFieldType;
}

export interface ContentCollectionSchema {
  name: string;
  label?: string;
  type: CollectionType;
  fields: ContentFieldSchema[];
}

export interface ProjectContent {
  /** Empty when the project has no editable content (a plain static site). */
  collections: ContentCollectionSchema[];
  data: Record<string, unknown>;
}

async function parseOrThrow<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    let message = `${action} failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.message === 'string') message = body.message;
    } catch {
      // no JSON body - keep the generic message
    }
    throw new Error(message);
  }
  return res.json();
}

export async function getContent(projectId: string): Promise<ProjectContent> {
  const res = await fetch(`${API_BASE}/project-content/${projectId}`);
  return parseOrThrow(res, 'Loading content');
}

export async function updateCollection(
  projectId: string,
  name: string,
  data: unknown,
): Promise<void> {
  const res = await fetch(`${API_BASE}/project-content/${projectId}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  await parseOrThrow(res, 'Saving content');
}

export async function uploadImage(
  projectId: string,
  file: File,
): Promise<{ path: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/project-content/${projectId}/upload`, {
    method: 'POST',
    body: form,
  });
  return parseOrThrow(res, 'Uploading image');
}

/** Resolves a value stored in an "image" field to something an <img> tag
 *  can load: an already-absolute URL is used as-is, a relative path (what
 *  uploadImage() returns) is resolved against the project's preview URL. */
export function resolveContentAssetUrl(
  projectId: string,
  value: string,
): string {
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) {
    return value;
  }
  return `${API_BASE}/project-generator/projects/${projectId}/preview/${value}`;
}

/** Converts a YouTube watch/share URL into an embeddable URL, or null if
 *  the value doesn't look like a YouTube link. */
export function youtubeEmbedUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (url.pathname.startsWith('/embed/')) {
        return url.toString();
      }
    }
    return null;
  } catch {
    return null;
  }
}
