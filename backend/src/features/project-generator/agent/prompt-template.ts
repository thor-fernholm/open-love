import { readActiveDesignGuide } from './design-guide';

/**
 * Every new project starts from a blank folder (see
 * ProjectGeneratorService.createProject) - there is no template to copy
 * and edit anymore, since a fixed portfolio shape doesn't fit arbitrary
 * requests. Everything that used to live in a template is encoded here as
 * instructions instead: the static-site tech constraint, a design
 * reference read live from designs/ (see design-guide.ts), a placeholder-
 * image rule, and an optional content-manifest convention that lets a
 * project declare editable content (see features/project-content) only
 * when it actually has content worth editing later.
 */
const INSTRUCTIONS_HEAD = `You are building a small website in this directory, based on the request below. Build whatever the request actually calls for - a landing page, a tool, a game, a blog, a business site, an invite page, anything - don't assume it's a portfolio or any other fixed shape.

Tech constraint (always applies): plain static HTML/CSS/JS only - no build step, no bundler, no framework, no server-side code. The site must work by opening index.html directly, and must also work when served from a nested URL path, so use only relative asset/link paths (e.g. "styles.css", not "/styles.css").

Images: never generate real image bytes, invent a specific photo, or link to an external image URL (including stock-photo sites like Unsplash) - those links are frequently dead/invalid and there's no way to verify one actually loads. Wherever the site would show an image (including an "image" content field below), render a placeholder <div> instead: a fixed-aspect-ratio box with a CSS gradient background (e.g. linear-gradient(135deg, colorA, colorB), picking two tones from the design language below if one is available) - no <img> tag, no network request, always renders. Leave that field's stored value empty until a real image exists. The user later adds a real photo through the content editor's upload feature, which fills in that same value - write your rendering code to show the gradient placeholder when the value is empty and a real <img src="..."> when it's set, so the swap happens automatically with no regeneration needed.`;

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
  - Field "type" is one of: text, textarea, image, video, link, date. "image" and "video" values are always URLs (an image URL, or a YouTube link) - never the media itself.
- Create one content/<name>.json per manifest entry: an array of records for a "list" collection, or a single object for a "singleton" collection, matching that entry's fields, filled in with real content per the request below.
- Your site's own JS must fetch() these files at runtime (relative paths, e.g. fetch('content/products.json')) and render them into the page - don't also hardcode the same content directly into the HTML.`;

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

export function buildAgentPrompt(userPrompt: string): string {
  return [
    INSTRUCTIONS_HEAD,
    buildDesignSection(),
    CONTENT_CONVENTION,
    `User's request:\n${userPrompt}`,
  ].join('\n\n');
}
