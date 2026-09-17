# Advanced App Stack

For "advanced" (dynamic) projects - a real app with a database, not a static site. This directory already contains a working starter (Next.js + Prisma + SQLite) before you touch anything: run `list_files`/read a few key files first (`app/page.tsx`, `prisma/schema.prisma`, `app/api/items/route.ts`, `lib/prisma.ts`) so you're extending what's there, not rebuilding it.

## Stack

- **Next.js (App Router, TypeScript)** - one framework for pages, layouts, and API routes. No separate frontend/backend process.
- **Prisma + SQLite** - the database is a single file (`prisma/dev.db`) that lives inside the project. No external database server to install, run, or host - this is what keeps an "advanced" app as simple to deploy as the static ones.
- **Tailwind CSS** - already configured (`app/globals.css`, `postcss.config.mjs`). Use utility classes the same way the static generator's sites do.

## Data

1. Add/edit models in `prisma/schema.prisma` (see the existing `Item` model for the shape).
2. Run `npx prisma db push` to sync `prisma/dev.db` to match - this is the whole "migration" step for a single-project app like this, no migration history needed.
3. Query through the generated Prisma client via the shared singleton at `lib/prisma.ts` (`import { prisma } from "@/lib/prisma"`) - never write raw SQL, and never instantiate `new PrismaClient()` anywhere else (breaks the singleton, exhausts connections under hot reload).

## Where things go

- `app/<route>/page.tsx` - a page. Fetch its own data directly via `prisma` inside the (default, Server Component) page function - see `app/page.tsx`. Don't round-trip through your own API for data a page can just query.
- `app/<route>/actions.ts` or an inline `"use server"` function in the page (see `addItem` in `app/page.tsx`) - a Server Action, for mutations triggered from a form/button on that page. Call `revalidatePath(...)` after a mutation so the page reflects it immediately.
- `app/api/<name>/route.ts` - a JSON endpoint, only when something *external* needs one (a client-side `fetch`, a webhook, another app) - see `app/api/items/route.ts`. Not needed for a page's own reads/writes.
- `components/` - shared UI pieces, once there's more than one page using them.
- `lib/` - shared server-side helpers (the Prisma client, anything else non-UI).

## Rules

- Keep the existing config files (`next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `package.json`'s scripts) as they are unless the request genuinely needs a change - add dependencies rather than replacing the setup.
- Don't invent a requirement for an external service (a hosted database, a third-party auth provider, a paid API) unless the request explicitly asks for one - the whole point of this stack is that it's self-contained.
- Images: same rule as the static generator - use Lorem Picsum's seeded URLs (`https://picsum.photos/seed/<slug>/<width>/<height>`) rather than inventing a photo or linking to a stock-photo site.
- The static generator's `content/manifest.json` convention does **not** apply here - a dynamic app manages its own data through Prisma, not the static content-manager feature.

## Hosting

`npm install && npm run build && npm start` runs this anywhere Node.js runs - a VPS, Railway, Render, Fly.io - or deploy to Vercel with zero configuration, since it's a standard Next.js app. The SQLite file travels with the project; there's no separate database to provision.
