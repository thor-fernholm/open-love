# Open-Love

Describe the site you want, watch it get built. Keep talking to it and it keeps iterating — full history, live preview, and a real content manager for anything that should stay editable after the fact. Open source, MIT, self-hosted top to bottom. Inspired by tools like Lovable, minus the "send it to our servers" part.

## Features

- **Chat-style iteration** — every project keeps a history of what you asked for and what happened, so you refine a site over several messages instead of starting over each time.
- **Live preview** — open any generated site in a new tab the moment it's ready. No deploy step while you're iterating.
- **A real content manager** — projects that need ongoing content (products, posts, testimonials, team, whatever) get a lightweight editor built for exactly that: add, edit, remove, drop in images, paste a YouTube link. No JSON-wrangling.
- **Bring your own reference material** — attach an image, a text file, or a PDF to a message so a build can actually use it: a logo, brand notes, existing copy.
- **A swappable design language** — generated sites follow a design reference from the `designs/` folder instead of defaulting to one generic template. Drop in another file, point `ACTIVE_DESIGN_FILE` at it, done.
- **Plain files, no lock-in** — every project lives as a normal folder under `generated-projects/`. Nothing trapped in a database or a proprietary format.
- **Project sidebar** — everything you've started, listed, renameable, deletable.

## Quick start

**Prerequisites:**
- [Node.js](https://nodejs.org/) 20+ and npm
- At least one way to actually build things — see [Choosing a builder](#choosing-a-builder) below

**1. Clone the repo**

```bash
git clone https://github.com/<your-username>/open-love.git
cd open-love
```

**2. Install and start the backend**

```bash
cd backend
npm install
npm run start:dev
```

The API listens on `http://localhost:3000` by default.

**3. Install and start the frontend** (in a second terminal)

```bash
cd frontend
npm install
npm run dev
```

**4. Open the app**

Visit `http://localhost:5173`, type a prompt, give it a project name, go.

### Choosing a builder

Open-Love doesn't build sites itself — it drives an agent that does. Two options, pick per-project or set a default in the app's settings (gear icon in the sidebar):

- **Claude Code** — the default. Requires the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed and signed in (`claude` on your `PATH`). Reliable, well-behaved, costs API usage.
- **Ollama** — fully local, free, runs against whatever models you've already pulled. **Experimental**: tool-calling reliability varies a lot by model and hardware — small/quantized models especially can hallucinate tool names or wander off into plain text instead of acting. Point it at [Ollama](https://ollama.com/) running locally and pick a model from the dropdown; the app detects what you've got installed. Worth trying, don't be surprised if it needs a stronger model or a retry.

### Configuration

The backend reads a few optional environment variables — none required to get started:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Backend port |
| `GENERATED_PROJECTS_DIR` | `../generated-projects` | Where generated sites are written |
| `DESIGNS_DIR` | `../designs` | Where design reference files live |
| `ACTIVE_DESIGN_FILE` | `DESIGN.md` | Which file in `DESIGNS_DIR` new projects follow |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where to find a local Ollama instance |

## Prompt examples

A generated site can be a plain static page or come with its own content manager, depending on what you ask for — it figures out which one fits:

- *"A single-page countdown timer for New Year's Eve. Nothing fancy."*
- *"A small bakery website with a product list (name, description, photo, price) and a customer testimonials section."*
- *"A personal portfolio for a photographer named Jane Doe, with two example projects: one about landscape photography, one about portraits."*
- *"A landing page for a two-person coffee roastery — use the attached brand notes for the name and tone."*
- *"A simple event page for a Saturday pop-up market, with a schedule and a list of vendors."*

Then just keep talking — *"swap the color scheme for something darker,"* *"add a fourth product,"* *"make the hero section bigger"* — same project, same thread.

## Project layout

```
backend/     NestJS API — orchestrates each build and serves live previews
frontend/    React UI — chat history, content manager, project sidebar
designs/     Design reference files new projects can follow
generated-projects/   Every project you've built, as plain folders
```

## License

MIT.
