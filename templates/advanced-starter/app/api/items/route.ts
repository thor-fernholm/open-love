import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Example JSON endpoint, for when something external needs to read/write
// data (a client-side fetch, a webhook, another app) rather than a page
// querying Prisma directly (see app/page.tsx for that simpler pattern).
export async function GET() {
  const items = await prisma.item.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const item = await prisma.item.create({ data: { title } });
  return NextResponse.json(item, { status: 201 });
}
