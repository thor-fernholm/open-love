# Advanced starter

A full-stack app built with [Next.js](https://nextjs.org) (App Router), [Prisma](https://www.prisma.io), and SQLite.

## Develop

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Visit http://localhost:3000.

## Build & run in production

```bash
npm install
npm run build
npm start
```

## Data

Prisma models live in `prisma/schema.prisma`. After changing them, run `npx prisma db push` to sync the SQLite database file (`prisma/dev.db`) - no separate database server needed, it travels with the project.

## Deploy

This is a standard Next.js app - it runs anywhere Node.js runs (a VPS, Railway, Render, Fly.io, etc.) via `npm run build && npm start`, or deploys to [Vercel](https://vercel.com) with zero configuration.
