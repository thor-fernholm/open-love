export type ContentFieldType =
  | 'text'
  | 'textarea'
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

/**
 * Describes one editable piece of content a generated project declared for
 * itself in its own `content/manifest.json` (written by the agent at
 * generation time - see agent/prompt-template.ts in project-generator).
 * This app never invents or edits the schema, only the data underneath it.
 */
export interface ContentCollectionSchema {
  name: string;
  label?: string;
  type: CollectionType;
  fields: ContentFieldSchema[];
}

export interface ProjectContent {
  /** Empty when the project has no content/manifest.json - a plain static
   *  site with no editable content. */
  collections: ContentCollectionSchema[];
  /** Collection name -> its data (an array for "list", an object for "singleton"). */
  data: Record<string, unknown>;
}
