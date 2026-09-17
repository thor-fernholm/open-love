import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

async function addItem(formData: FormData) {
  "use server";
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await prisma.item.create({ data: { title } });
  revalidatePath("/");
}

// Server Components can query the database directly - no separate API
// round-trip needed for a page's own data. See app/api/items/route.ts for
// the pattern to follow when something *external* (a client fetch, a
// webhook) needs a JSON endpoint instead.
export default async function Home() {
  const items = await prisma.item.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Advanced starter</h1>
      <p className="text-sm text-neutral-600">
        A minimal Next.js + Prisma + SQLite app. Edit <code>app/page.tsx</code>{" "}
        and <code>prisma/schema.prisma</code> to build on this.
      </p>

      <form action={addItem} className="flex gap-2">
        <input
          type="text"
          name="title"
          placeholder="Add an item…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Add
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm"
          >
            {item.title}
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-sm italic text-neutral-500">No items yet.</li>
        )}
      </ul>
    </main>
  );
}
