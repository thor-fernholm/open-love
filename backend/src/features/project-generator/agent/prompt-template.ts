import { readActiveDesignGuide } from './design-guide';
import { readActiveStackGuide } from './stack-guide';
import type { SiteType, TurnAttachment } from '../project.types';

/**
 * Two generation modes, each with its own conventions:
 *
 * 'static' - every new project starts from a blank folder (see
 * ProjectGeneratorService.createProject) - there is no template to copy
 * and edit, since a fixed portfolio shape doesn't fit arbitrary requests.
 * Everything that used to live in a template is encoded here as
 * instructions instead: the static-site tech constraint, a design
 * reference read live from designs/ (see design-guide.ts), a placeholder-
 * image rule, and an optional content-manifest convention that lets a
 * project declare editable content (see features/project-content) only
 * when it actually has content worth editing later.
 *
 * 'dynamic' - a project starts from a real, working Next.js + Prisma +
 * SQLite scaffold (templates/advanced-starter/, copied in by
 * ProjectGeneratorService.createProject) - the agent extends that scaffold
 * per the stack guide (stacks/, see stack-guide.ts) rather than inventing
 * its own boilerplate. The static-only content-manifest convention doesn't
 * apply here; a dynamic app manages its own data through Prisma.
 *
 * Both share the design-language and attachments sections. These
 * conventions are shared by every agent strategy (ClaudeCliService,
 * SdkAgentService) - only how each strategy actually gets the model to act
 * on them differs (a CLI prompt argument vs. a system prompt for a
 * tool-use loop). Ollama only ever sees 'static' - see
 * ProjectGeneratorService.resolveSelection's provider/siteType guard.
 */
const STATIC_INSTRUCTIONS_HEAD = `You are building a small website in this directory, based on the request below. Build whatever the request actually calls for - a landing page, a tool, a game, a blog, a business site, an invite page, anything - don't assume it's a portfolio or any other fixed shape.

Tech constraint (always applies): plain static HTML/CSS/JS only - no build step, no bundler, no framework, no server-side code. The site must work by opening index.html directly, and must also work when served from a nested URL path, so use only relative asset/link paths (e.g. "styles.css", not "/styles.css").

${imagesRule()}`;

const DYNAMIC_INSTRUCTIONS_HEAD = `You are building a small full-stack app in this directory, based on the request below. This directory already contains a working Next.js + Prisma + SQLite starter - call list_files (and read_file the key files: app/page.tsx, prisma/schema.prisma, app/api/items/route.ts, lib/prisma.ts) before you start, so you extend what's there rather than rebuilding it or guessing at its shape.

Follow the stack guide below for conventions (where pages/routes/data access go, the Prisma workflow, what NOT to add). Build whatever the request actually calls for - don't assume it's the starter's own example "Item" list unless the request is actually that.

${imagesRule()}`;

const CONTENT_CONVENTION = `Editable content - optional, set this up ONLY if the site actually has content that benefits from being editable later without regenerating (e.g. a list of products/projects/posts/testimonials/team members/FAQ/schedule items, or site-wide text like a title/bio). Skip this entirely for a page that doesn't need it (e.g. a single tool or game) - just build static HTML with the content baked in.

When it is needed:
- Create content/manifest.json: a JSON array of collection schemas, e.g.
  [
    { "name": "products", "label": "Products", "type": "list", "fields": [
      { "key": "title", "label": "Title", "type": "text" },
      { "key": "description", "label": "Description", "type": "textarea" },
      { "key": "image", "label": "Photo", "type": "image" },
      { "key": "link", "label": "Link", "type": "link" }
    ]},
    { "name": "site", "label": "Site", "type": "singleton", "fields": [
      { "key": "title", "label": "Title", "type": "text" }
    ]}
  ]
  - Collection "type" is "list" (an array of records) or "singleton" (one object, e.g. site-wide settings).
  - Field "type" is one of: text, textarea, image, video, link, date. "image" and "video" values are always URLs (an image URL, or a YouTube link) - never the media itself. Fill an "image" field's initial value with a Picsum URL per the Images rule above, not an empty string - the upload feature overwrites it with a real photo later.
- Create one content/<name>.json per manifest entry: an array of records for a "list" collection, or a single object for a "singleton" collection, matching that entry's fields, filled in with real content per the request below.
- Your site's own JS must fetch() these files at runtime (relative paths, e.g. fetch('content/products.json')) and render them into the page - don't also hardcode the same content directly into the HTML.`;

function imagesRule(): string {
  return `Images: never generate real image bytes, invent a specific photo, or link to a stock-photo site (including Unsplash) - those links are frequently dead/invalid and there's no way to verify one actually loads. Instead, for every image the site needs - decorative or content-backed - use a real photo from Lorem Picsum's seeded URL form, which always returns the same photo for a given seed (deterministic, no API key, no network fragility, and free to construct - no search or extra tool calls needed):
  https://picsum.photos/seed/<slug>/<width>/<height>
Pick a distinct <slug> per image (e.g. "hero", "team-1", "product-3") and size it to the space it fills. Use this directly as a real <img src="..."> (or CSS background-image) - not a gradient placeholder standing in for one.`;
}

function buildDesignSection(): string {
  const guide = readActiveDesignGuide();
  if (!guide) {
    return 'Design language: no specific reference is available - use clean, sensible defaults.';
  }
  return `Design language - follow this reference for colors, type, spacing, and component styling (define its colors/fonts as CSS variables in a :root block at the top of your stylesheet so they're easy to override later; if it names a custom or proprietary typeface, load a real available substitute - it should document its own fallback - rather than just naming a font that never loads):

--- Design system to follow ---
${guide}
--- End of design system ---`;
}

function buildStackSection(): string {
  const guide = readActiveStackGuide();
  if (!guide) {
    return 'Stack guide: no specific reference is available - use the starter scaffold already in this directory as your guide.';
  }
  return `--- Stack guide to follow ---
${guide}
--- End of stack guide ---`;
}

function buildAttachmentsSection(attachments: TurnAttachment[]): string | null {
  if (attachments.length === 0) return null;
  const list = attachments
    .map((a) => `- ${a.path} (originally "${a.name}", ${a.mimeType})`)
    .join('\n');
  return `The user attached these reference files - read them from these paths (relative to this directory) if they're useful for the request below. If a format isn't something you can read (e.g. some PDFs), just skip it rather than guessing at its content:\n${list}`;
}

/** The shared rules every agent strategy builds its own final prompt
 *  around - tech constraint (static or dynamic), design language, and any
 *  attached reference files. Provider-specific instructions (how to
 *  actually make edits) are layered on top of this by each strategy. */
export function buildConventions(
  attachments: TurnAttachment[] = [],
  siteType: SiteType = 'static',
): string {
  const sections =
    siteType === 'dynamic'
      ? [DYNAMIC_INSTRUCTIONS_HEAD, buildStackSection(), buildDesignSection()]
      : [STATIC_INSTRUCTIONS_HEAD, buildDesignSection(), CONTENT_CONVENTION];
  return [...sections, buildAttachmentsSection(attachments)]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
}

/** ClaudeCliService's prompt: the CLI is its own coding agent, so this is
 *  just the shared conventions plus the user's request - no tool-use
 *  instructions needed, the CLI already knows how to edit files. */
export function buildClaudePrompt(
  userPrompt: string,
  attachments: TurnAttachment[] = [],
  siteType: SiteType = 'static',
): string {
  return `${buildConventions(attachments, siteType)}\n\nUser's request:\n${userPrompt}`;
}
