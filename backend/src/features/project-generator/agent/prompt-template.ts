import { readDesignGuide } from './design-guide';
import { readActiveStackGuide } from './stack-guide';
import type { HistoryTurn } from './agent-service.interface';
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
 * Both share the design-language, conversation-history, and attachments
 * sections. These conventions are shared by every agent strategy
 * (ClaudeCliService, SdkAgentService) - only how each strategy actually
 * gets the model to act on them differs (a CLI prompt argument vs. a
 * system prompt for a tool-use loop). Ollama only ever sees 'static' - see
 * ProjectGeneratorService.resolveSelection's provider/siteType guard.
 */
const STATIC_INSTRUCTIONS_HEAD = `You are building a small website in this directory, based on the request below. Build whatever the request actually calls for - a landing page, a tool, a game, a blog, a business site, an invite page, anything - don't assume it's a portfolio or any other fixed shape.

Tech constraint (always applies): plain static HTML/CSS/JS only - no build step, no bundler, no framework, no server-side code. The site must work by opening index.html directly, and must also work when served from a nested URL path, so use only relative asset/link paths (e.g. "styles.css", not "/styles.css").

${imagesRule({ mentionContentEditor: true })}`;

const DYNAMIC_INSTRUCTIONS_HEAD = `You are building a small full-stack app in this directory, based on the request below. This directory already contains a working Next.js + Prisma + SQLite starter - call list_files (and read_file the key files: app/page.tsx, prisma/schema.prisma, app/api/items/route.ts, lib/prisma.ts) before you start, so you extend what's there rather than rebuilding it or guessing at its shape.

Follow the stack guide below for conventions (where pages/routes/data access go, the Prisma workflow, what NOT to add). Build whatever the request actually calls for - don't assume it's the starter's own example "Item" list unless the request is actually that.

${imagesRule({ mentionContentEditor: false })}`;

/** Shared by both site types - this is what makes the chat feel like a
 *  conversation instead of a one-shot generator: permission to just
 *  answer (or ask back) instead of always editing files. A turn that ends
 *  up not touching any files is detected on the OpenLove side by comparing
 *  file mtimes before/after (see project-generator.service.ts), not by
 *  anything the agent reports - this instruction is what makes that
 *  detection actually mean something instead of the agent editing files
 *  out of habit on a request that didn't call for it. */
const CONVERSATION_RULE = `Conversation: the message below isn't always a build request. If it's a question, feedback, or anything else that doesn't call for a project change, just answer it directly in your final reply - don't edit any files. If the request is genuinely ambiguous enough that guessing wrong would waste a full build (not just a minor style/wording choice - use your judgment), ask a short, specific clarifying question in your final reply instead of guessing, and stop there without editing anything; the user's next message will answer it. Otherwise, build what was asked and close with a short summary of what you actually did - this is the only part of your reply the user sees by default, so make it count.

Tone and length for your final reply, always (the summary, an answer, or a clarifying question alike): talk like you're describing the result to someone who will never look at the code - what changed, what it looks like, what it does now. Plain, everyday language only, e.g. "Moved the contact details into the footer and made the header image bigger." or "Added a pricing section with three tiers under the hero, and linked it from the menu." Never mention code, files, CSS/HTML, frameworks, libraries, or any other technical/implementation detail - not even the name of a section's underlying element or class. If you need to ask something, ask about how it should look, read, or behave for a visitor (e.g. "Should the gallery open each photo full-size when clicked, or just link out to it?"), never about how to build or structure it.

Be brief - this is a chat reply, not documentation. One short sentence (99% of cases), hard limit three. Never use a bulleted or numbered list, never a heading, never multiple paragraphs, no matter how much changed or how much there is to describe - pick the couple of things that actually matter and say those plainly, drop the rest. "Reorganized the page and added a menu section." beats a walkthrough of every section in order.`;

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

function imagesRule({ mentionContentEditor }: { mentionContentEditor: boolean }): string {
  const replacementHint = mentionContentEditor
    ? 'suggest the user attach real photos in a follow-up message, or use the content editor to replace them if this project has one (i.e. if you set up content/manifest.json)'
    : 'suggest the user attach real photos in a follow-up message';
  return `Images: never generate real image bytes, invent a specific photo, or link to a stock-photo site (including Unsplash) - those links are frequently dead/invalid and there's no way to verify one actually loads. Instead, for every image the site needs - decorative or content-backed - use a real photo from Lorem Picsum's seeded URL form, which always returns the same photo for a given seed (deterministic, no API key, no network fragility, and free to construct - no search or extra tool calls needed):
  https://picsum.photos/seed/<slug>/<width>/<height>
Pick a distinct <slug> per image (e.g. "hero", "team-1", "product-3") and size it to the space it fills. Use this directly as a real <img src="..."> (or CSS background-image) - not a gradient placeholder standing in for one. If you used any of these placeholder photos, say so plainly in your final reply and ${replacementHint}.`;
}

/** `designFile` is resolved per-project (see design-guide.ts's
 *  pickDesignForPrompt, called once at project creation and persisted) -
 *  null for a project predating this feature that hasn't self-healed one
 *  yet, or when designs/ has no files at all. */
function buildDesignSection(designFile: string | null): string {
  const guide = designFile ? readDesignGuide(designFile) : null;
  if (!guide) {
    return 'Design language: no specific reference is available - use clean, sensible defaults.';
  }
  return `Design language - follow this reference for colors, type, spacing, and component styling (define its colors/fonts as CSS variables in a :root block at the top of your stylesheet so they're easy to override later; if it names a custom or proprietary typeface, load a real available substitute - it should document its own fallback - rather than just naming a font that never loads). Apply these tokens to whatever sections this specific request actually needs - don't default to a generic hero/cards/stats layout regardless of topic:

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

// Tuned for "a handful of short exchanges stay fully readable, a long
// conversation degrades gracefully" rather than any precise token math -
// see buildHistorySection.
const HISTORY_RECENT_TURNS = 6;
const HISTORY_CHAR_BUDGET = 4000;
const HISTORY_BULLET_FIELD_LIMIT = 80;
// Caps an individual *reply* shown in history, even in the verbatim
// (uncompacted) path - independent of HISTORY_CHAR_BUDGET, which only
// caps the section's total size. Live testing showed a real failure mode
// without this: a long-winded reply from before the conciseness rule was
// added kept reappearing verbatim in later prompts, and the model treated
// that concrete precedent as the style to match, overriding the (more
// abstract) instruction to be brief. The user's own prompts aren't capped
// here - only what the agent itself said back.
const HISTORY_REPLY_LIMIT = 200;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function verbatimTurn(turn: HistoryTurn): string {
  const summary = turn.summary ? truncate(turn.summary, HISTORY_REPLY_LIMIT) : null;
  return `You: ${turn.prompt}${summary ? `\nYou replied: ${summary}` : ''}`;
}

function bulletTurn(turn: HistoryTurn): string {
  const prompt = truncate(turn.prompt, HISTORY_BULLET_FIELD_LIMIT);
  const summary = turn.summary ? truncate(turn.summary, HISTORY_BULLET_FIELD_LIMIT) : null;
  return `- You: ${prompt}${summary ? ` — You replied: ${summary}` : ''}`;
}

function wrapHistory(body: string): string {
  return `--- Conversation so far (for context only - what was asked and decided, not a style or length to copy) ---\n${body}\n--- End of conversation so far ---`;
}

/**
 * Feeds prior turns on this project back to the agent as real conversation
 * memory - without this, every turn starts fresh with no idea what was
 * already asked/answered, which is exactly why (per the user's own report)
 * a follow-up couldn't build on a clarifying question asked a turn earlier.
 *
 * No extra LLM call and no persisted state: this is pure text formatting
 * over `readAllTurns()`'s output, recomputed on every request. The common
 * case (a short conversation) includes everything verbatim; once that
 * would exceed a fixed character budget, older turns collapse to one-line
 * bullets while the most recent few stay in full - a cheap approximation
 * of Claude Code's own auto-compact, not a true summarization pass.
 */
export function buildHistorySection(history: HistoryTurn[]): string | null {
  if (history.length === 0) return null;

  const allVerbatim = history.map(verbatimTurn).join('\n\n');
  if (allVerbatim.length <= HISTORY_CHAR_BUDGET) {
    return wrapHistory(allVerbatim);
  }

  const recentCount = Math.min(HISTORY_RECENT_TURNS, history.length);
  const older = history.slice(0, history.length - recentCount);
  const recent = history.slice(history.length - recentCount);
  const compacted = [
    older.length > 0 ? older.map(bulletTurn).join('\n') : null,
    recent.map(verbatimTurn).join('\n\n'),
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');

  return wrapHistory(
    compacted.length > HISTORY_CHAR_BUDGET ? truncate(compacted, HISTORY_CHAR_BUDGET) : compacted,
  );
}

/** The shared rules every agent strategy builds its own final prompt
 *  around - tech constraint (static or dynamic), design language,
 *  conversation history/rules, and any attached reference files.
 *  Provider-specific instructions (how to actually make edits) are layered
 *  on top of this by each strategy. */
export function buildConventions(
  attachments: TurnAttachment[] = [],
  siteType: SiteType = 'static',
  history: HistoryTurn[] = [],
  designFile: string | null = null,
): string {
  const sections =
    siteType === 'dynamic'
      ? [DYNAMIC_INSTRUCTIONS_HEAD, buildStackSection(), buildDesignSection(designFile)]
      : [STATIC_INSTRUCTIONS_HEAD, buildDesignSection(designFile), CONTENT_CONVENTION];
  return [
    ...sections,
    CONVERSATION_RULE,
    buildHistorySection(history),
    buildAttachmentsSection(attachments),
  ]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
}

/** A last, blunt reinforcement of the length/tone rule already stated in
 *  CONVERSATION_RULE - placed after the user's own request (the very end
 *  of the prompt) rather than relying on CONVERSATION_RULE alone, because
 *  live testing showed a real failure mode: once buildHistorySection has
 *  included an earlier turn's own (long, listy) reply, the model tends to
 *  pattern-match that concrete precedent over the abstract instruction
 *  stated earlier in the same prompt - so this calls that out by name. */
export const FINAL_REMINDER = `One more thing: keep your final reply to 1-2 short sentences, plain language, no lists - regardless of how much you did, or how long your own earlier replies in this conversation were. Match the target length below, not your own precedent.
"Moved the contact info under the hero and added a menu section."`;

/** ClaudeCliService's prompt: the CLI is its own coding agent, so this is
 *  just the shared conventions plus the user's request - no tool-use
 *  instructions needed, the CLI already knows how to edit files. */
export function buildClaudePrompt(
  userPrompt: string,
  attachments: TurnAttachment[] = [],
  siteType: SiteType = 'static',
  history: HistoryTurn[] = [],
  designFile: string | null = null,
): string {
  return `${buildConventions(attachments, siteType, history, designFile)}\n\nUser's request:\n${userPrompt}\n\n${FINAL_REMINDER}`;
}
