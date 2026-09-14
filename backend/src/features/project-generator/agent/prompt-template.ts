/**
 * Every new project starts from a blank folder (see
 * ProjectGeneratorService.createProject) - there is no template to copy
 * and edit anymore, since a fixed portfolio shape doesn't fit arbitrary
 * requests. Everything that used to live in the template is encoded here
 * as instructions instead: the static-site tech constraint, a default
 * design language, and an optional content-manifest convention that lets
 * a project declare editable content (see features/project-content) only
 * when it actually has content worth editing later.
 */
const AGENT_INSTRUCTIONS = `You are building a small website in this directory, based on the request below. Build whatever the request actually calls for - a landing page, a tool, a game, a blog, a business site, an invite page, anything - don't assume it's a portfolio or any other fixed shape.

Tech constraint (always applies): plain static HTML/CSS/JS only - no build step, no bundler, no framework, no server-side code. The site must work by opening index.html directly, and must also work when served from a nested URL path, so use only relative asset/link paths (e.g. "styles.css", not "/styles.css").

Default design language (use unless the request clearly wants a different look): a warm cream canvas (#faf9f5) with dark ink text (#141413), a coral accent (#cc785c) used sparingly for primary actions/CTAs, serif display headings ("Cormorant Garamond", Georgia, serif) paired with a humanist sans body ("Inter", sans-serif). Define these as CSS variables in a :root block at the top of your stylesheet so they're easy to override later. Actually load Cormorant Garamond and Inter via Google Fonts <link> tags in index.html's <head> (with the usual preconnect links) - don't just name them and fall back to system fonts.

Editable content - optional, set this up ONLY if the site actually has content that benefits from being editable later without regenerating (e.g. a list of products/projects/posts/testimonials/team members/FAQ/schedule items, or site-wide text like a title/bio). Skip this entirely for a page that doesn't need it (e.g. a single tool or game) - just build static HTML with the content baked in.

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
- Your site's own JS must fetch() these files at runtime (relative paths, e.g. fetch('content/products.json')) and render them into the page - don't also hardcode the same content directly into the HTML.

User's request:
`;

export function buildAgentPrompt(userPrompt: string): string {
  return `${AGENT_INSTRUCTIONS}${userPrompt}`;
}
