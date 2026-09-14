# OpenLove

Describe the site you want in plain English, and watch it get built — with a running history you can keep steering, a live preview, and a simple content manager for anything that should stay editable afterward. Open source, MIT-licensed, and yours to run yourself. Built in the spirit of tools like Lovable, but self-hosted from top to bottom.

## Features

- **Chat-style iteration** — every project keeps a history of what you asked for and what happened, so you can refine a site over several messages instead of starting from scratch each time.
- **Live preview** — open any generated site in a new tab as soon as it's ready. There's no deploy step while you're iterating.
- **A simple content manager** — projects that need ongoing content (products, posts, testimonials, team members, whatever the site calls for) get a lightweight editor built for exactly that content: add, edit, and remove items, drop in images, paste a YouTube link. No JSON, no code.
- **Bring your own reference material** — attach an image, a text file, or a PDF to a message so a build can actually use it: a logo, brand notes, existing copy.
- **A swappable design language** — generated sites follow a design reference from the `designs/` folder rather than defaulting to one generic template; drop in another file and point `ACTIVE_DESIGN_FILE` at it.
- **Plain files, no lock-in** — every project lives as a normal folder under `generated-projects/`. Nothing is trapped in a database or a proprietary format.
- **Project sidebar** — every project you've started is listed, renameable, and deletable, right from the UI.

## Quick start

**Prerequisites:**
- [Node.js](https://nodejs.org/) 20 or newer, and npm
- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed and signed in (`claude` needs to be on your `PATH`) — this is what turns a prompt into a running project.

**1. Clone the repo**

```bash
git clone https://github.com/<your-username>/openlove.git
cd openlove
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

Visit `http://localhost:5173`, type a prompt, and give it a project name.

### Configuration

The backend reads a few optional environment variables — none are required to get started:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Backend port |
| `GENERATED_PROJECTS_DIR` | `../generated-projects` | Where generated sites are written |
| `DESIGNS_DIR` | `../designs` | Where design reference files live |
| `ACTIVE_DESIGN_FILE` | `DESIGN.md` | Which file in `DESIGNS_DIR` new projects follow |

## Prompt examples

A generated site can be a plain static page or come with its own little content manager, depending on what you ask for — OpenLove figures out which one fits:

- *"A single-page countdown timer for New Year's Eve. Nothing fancy."*
- *"A small bakery website with a product list (name, description, photo, price) and a customer testimonials section."*
- *"A personal portfolio for a photographer named Jane Doe, with two example projects: one about landscape photography, one about portraits."*
- *"A landing page for a two-person coffee roastery — use the attached brand notes for the name and tone."*
- *"A simple event page for a Saturday pop-up market, with a schedule and a list of vendors."*

Once it's built, follow up in the same conversation — *"swap the color scheme for something darker,"* *"add a fourth product,"* *"make the hero section bigger"* — and it keeps working on the same project.

## Project layout

```
backend/     NestJS API — orchestrates each build and serves live previews
frontend/    React UI — chat history, content manager, project sidebar
designs/     Design reference files new projects can follow
generated-projects/   Every project you've built, as plain folders
```

## License

MIT.
