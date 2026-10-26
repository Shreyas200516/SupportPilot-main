# SupportPilot API

FastAPI handles account sign-in, ticket intake, model predictions, workspace routing, and local SQLite or shared Supabase PostgreSQL storage. Ticket and account permissions are checked by the backend.

## Local setup

From the repository root in PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements-models.txt
Copy-Item backend\.env.example backend\.env
```

Create the first administrator. The command prompts for a password; it is not placed in shell history:

```powershell
python backend\create_admin.py --email test@gmail.com --name "Shreyas"
```

Start the API:

```powershell
python -m uvicorn app.main:app --app-dir backend --reload --host localhost --port 8000
```

In a second terminal, start the frontend:

```powershell
cd frontend
npm ci
npm run dev -- --port 3000
```

Open `http://localhost:3000/login`. Requesters can create accounts from the sign-in page. The first administrator signs in, then can create staff accounts through `POST /api/admin/users` in `http://localhost:8000/docs`. Staff accounts have role `support_agent` and a workspace scope of `IT Service Desk`, `Facilities Helpdesk`, or `all`. The same admin API can list accounts and deactivate accounts. Public registration always creates a requester; it cannot create staff or admin accounts.

Use the same host name (`localhost`) for the frontend and backend in local development so the browser sends the session cookie consistently. Set `VITE_API_URL` in `frontend/.env` only if the API uses a different origin, and add that exact frontend origin to `CORS_ORIGINS` in `backend/.env`.

## Authentication and access

- `POST /api/auth/register` creates a requester account and signs it in.
- `POST /api/auth/login` signs in an existing account.
- `GET /api/auth/me` returns the signed-in account.
- `POST /api/auth/logout` revokes the server-side session and clears the cookie.
- The browser session cookie is HttpOnly and SameSite Lax. Passwords are stored as scrypt hashes; session tokens are stored as hashes in the configured database.
- Requesters can create tickets and list or retrieve only tickets tied to their account. The backend replaces a requester-submitted email with their signed-in account email.
- Support accounts are limited to their configured workspace. Admins can access both workspaces and manage accounts.
- Set `APP_ENV=production` behind HTTPS to enable the Secure cookie flag. Configure `CORS_ORIGINS` to the exact trusted frontend origins before deployment.

## Ticket API

- `GET /health` reports whether both supplied models loaded.
- `POST /api/tickets` validates, classifies, scores, routes, assigns an ID, and stores a ticket. A signed-in requester or support user can submit a ticket in a workspace they are allowed to use.
- `GET /api/tickets` returns only the signed-in requester's tickets, or the tickets visible to the staff user's workspace scope. Supports `limit`, `offset`, and an optional `workspace` filter.
- `GET /api/tickets/{ticket_id}` applies the same ownership/workspace check and returns 404 when a requester asks for another user's ticket.
- `GET /api/support/agents` returns active support-agent names visible within the signed-in staff user's workspace scope. Requesters cannot access this list.
- `GET /api/knowledge/articles` searches articles by `q`, `category`, and `workspace`. Requesters only see published guides; staff see guides within their workspace scope.
- `GET /api/knowledge/articles/{article_id}` returns a guide visible to the current user.
- `POST /api/knowledge/articles` creates a draft or published guide; `PATCH /api/knowledge/articles/{article_id}` edits or publishes/unpublishes it. Both write operations are limited to support staff in scope and administrators.
- `GET /docs` provides the interactive API page.

Set `SUPABASE_DB_URL` in `backend/.env` to the Supabase PostgreSQL connection string to share tickets, accounts, sessions, and knowledge articles across the team. Run `supabase/schema.sql` once in Supabase SQL Editor or let the backend startup create the tables. Keep each teammate's connection string in their local `backend/.env`; never commit it or expose it to the frontend. Each teammate should use their own SupportPilot login. Blank setting uses local SQLite for offline development.

`POST /api/assistant/diagnose` returns model probabilities and impact scores before saving. `POST /api/assistant/ask` retrieves published knowledge guides and returns the matching sources; it does not call a generative model. Staff can import CSV using `POST /api/tickets/import-csv` (up to 5,000 rows, 10 MB; required columns `subject`, `body`, `category`, `workspace`). Configure `EMAIL_INBOUND_TOKEN` to enable the normalized email webhook at `POST /api/integrations/email/inbound`; the email provider must be configured to call it. Suspected promotional messages are flagged for human review rather than silently deleted; `PATCH /api/tickets/{ticket_id}/review` records a decision and explanation.

The ticket-type model predicts **Change, Incident, Problem, or Request** from the supplied `type` labels. The service area (such as VPN, Plumbing, or HVAC) is selected separately and used for routing. Facilities categories use explicit routing rules; matching safety reports are raised to Critical with a 15-minute response target.

Tickets shown in the application come from the configured database. The CSV datasets in `dataset/` and `severityANDpriority/` remain training/evaluation data and are not automatically inserted as live tickets. See `severityANDpriority/README.md` for the priority model report and severity/SLA matrix, and `severityANDpriority/severity_engine.py` for the scoring rules.

Knowledge articles are stored in the configured database. Add and maintain approved guides from the Knowledge Base page while signed in as a support agent or administrator. Drafts are visible to scoped staff; publish a guide when it is ready for requesters. Search uses title, summary, content, and keywords, and the intake form suggests published guides based on the selected category and ticket text.

The intake assistant retrieves matching published guides and cites their titles. To enable a generated answer grounded in those sources, configure `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL` for an OpenAI-compatible Chat Completions service. Without these values, the assistant stays in retrieval-only mode. The language selector offers English, Hindi, and Kannada; set `TRANSLATION_URL` (and optionally `TRANSLATION_API_KEY`) to a trusted LibreTranslate-compatible `/translate` endpoint to translate non-English queries and retrieved guides. Text is sent to these services only when the operator configures them. Review provider data handling before enabling.

Staff CSV import supports a no-write preview with `POST /api/tickets/import-csv?dry_run=true`, followed by the regular import endpoint after confirmation. Email intake is a signed provider webhook, not a mailbox polling service. Suspected spam is flagged for human review; it is not deleted automatically.

To copy a local database into Supabase, back it up, set both `SUPPORTPILOT_DB` and `SUPABASE_DB_URL`, then run `python backend/migrate_sqlite_to_supabase.py` from the project root. It copies accounts, tickets, and articles, skips sessions, and preserves existing destination rows. All users must sign in again afterward.

## Account administration

After signing in as an admin, create support accounts using `POST /api/admin/users` with JSON such as:

```json
{
  "email": "test@gmail.com",
  "display_name": "Srinidhi",
  "password": "REPLACE_WITH_A_LONG_UNIQUE_PASSWORD",
  "role": "support_agent",
  "workspace_scope": "IT Service Desk"
}
```

Supported roles are `requester`, `support_agent`, and `admin`. Only requesters can self-register. Admins can list accounts using `GET /api/admin/users` and activate/deactivate them using `PATCH /api/admin/users/{user_id}/active`.

## Prototype limitations

This milestone build does not include email verification, password reset, or login rate limiting. Use it for local demonstration and development; review the deployment configuration and add those account-recovery and abuse protections before opening registration to the public. Ticket assignment, comments, and status changes in the existing support interface are still demo-side interactions and are not persisted by this API.
