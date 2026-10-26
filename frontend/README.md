# SupportPilot

SupportPilot is a service desk workspace prototype for reviewing tickets, tracking service levels, and submitting support requests. It currently uses sample data stored in the browser; it does not connect to a ticketing, identity, email, or analytics service.

## Requirements

- Node.js 20.19+ or 22.12+

## Run locally

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. To create a production build, run `npm run build`; to check code style, run `npm run lint`.

## Project structure

- `src/routes` contains file-based pages.
- `src/components` contains shared interface components.
- `src/lib/data.ts` contains the sample ticket and knowledge base records.
- `src/lib/store.tsx` contains the browser-side prototype state.

New tickets are submitted to the SupportPilot FastAPI backend (`VITE_API_URL`, default `http://localhost:8000`; copy `.env.example` to `.env` to change it) and are stored in SQLite. Seeded demo tickets and other in-app edits (status, assignee, messages) remain local to the current browser session and are not sent to the backend. Start the backend first; see `backend/README.md`.
