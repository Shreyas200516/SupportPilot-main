# SupportPilot

SupportPilot is a customer support ticketing prototype. Requesters submit IT or Facilities issues; the backend validates and records tickets, predicts ticket type and priority, scores severity, and routes the ticket to a service team. Support staff can review tickets and manage workspace knowledge articles.

## Contents

- `frontend/` — React and TypeScript web application.
- `backend/` — FastAPI API, authentication, local SQLite or shared Supabase PostgreSQL storage, and model/routing integration.
- `classification/`, `models/`, `dataset/`, `preprocessing/` — ticket classification code, supplied model assets, and training/evaluation data.
- `severityANDpriority/` — priority model, severity engine, report, and related data.
- `supabase/schema.sql` — shared Supabase PostgreSQL schema.
- `AI-Powered Customer Support Platform with Ticket Resolution Agent. (1).md` — project requirements/SRS document.

## Features

### Ticket submission and processing

1. A signed-in user submits a ticket from the web form and chooses a workspace and service area.
2. FastAPI validates the fields, generates a unique ticket ID, and combines the ticket subject and description for classification.
3. The supplied ticket-type model predicts Change, Incident, Problem, or Request. The service area remains a separate value used for routing.
4. The priority model predicts priority. The severity engine considers business impact, affected users, and service criticality, and returns a severity level and related service targets.
5. Workspace and service routing rules select a destination team. Facilities safety rules can raise matching safety reports to Critical.
6. Ticket details and model outputs are saved in the configured database (local SQLite or shared Supabase PostgreSQL) and displayed in the application.

The CSV files under `dataset/` are training/evaluation data; they are not inserted into the live ticket queue. Staff can separately import a prepared ticket CSV from the Tickets page.

### Model confidence, diagnosis, and review

- The intake form's **Analyze ticket** action calls the trained classifiers before submission and displays ticket type, confidence, priority confidence, and severity reasoning.
- Ticket details also show the saved model confidence. Confidence is a probability estimate, not a guarantee; low scores should be reviewed by a person.
- `POST /api/assistant/diagnose` returns live model probabilities, priority, and severity before saving a ticket.
- Suspicious promotional phrases or a message with many links are marked `needs_review`; the app does not silently delete tickets. Support staff can approve or mark a ticket unwanted with an explanation. The record remains stored for audit.
- These models provide classification and scoring, not open-ended generative diagnosis. Human review is recommended for low-confidence results.

### Knowledge assistant (retrieval)

The ticket form includes a knowledge assistant that searches published articles in the selected workspace and shows matching sources. By default, it is retrieval-only and does not invent troubleshooting steps. To enable generated RAG answers grounded in the retrieved articles, configure an OpenAI-compatible Chat Completions endpoint with `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL`. When this is not configured, the assistant clearly labels its output as article search results.

The language selector supports English, Hindi, and Kannada. Hindi and Kannada query translation and translated article sources require a trusted LibreTranslate-compatible service configured with `TRANSLATION_URL` and, if needed, `TRANSLATION_API_KEY`. The optional LLM endpoint is asked to write in the selected language, but query/article translation still needs the translation service. Without translation configured, the assistant explains that translation is unavailable and gives English results. Review translated safety procedures before use. If enabled, question/article text is sent only to the endpoints explicitly configured by the team; consider the provider's data handling before enabling.

### CSV ticket import

Support staff can preview and validate up to 5,000 rows (10 MB) from the Tickets page before confirming import. Required headers: `subject`, `body`, `category`, `workspace`. Optional headers: `requester_email`, `business_impact`, `affected_users`, and `service_criticality`. Invalid rows and duplicates within the uploaded file are reported by row; valid rows are classified and saved through the same ticket pipeline. Workspace permissions are checked per row. API: `POST /api/tickets/import-csv?dry_run=true` for preview and `POST /api/tickets/import-csv` to import.

### Email intake

`POST /api/integrations/email/inbound` accepts a normalized email payload using ticket fields, including sender email, subject, and body. Configure an email provider to forward messages to this webhook and set `EMAIL_INBOUND_TOKEN` in the backend environment. Send it as `X-SupportPilot-Email-Token`. SupportPilot does not poll an inbox; the provider webhook must be configured. Use HTTPS outside local development.

### Shared database with Supabase

Create one Supabase project for the team. Each teammate sets `SUPABASE_DB_URL` in their own **backend `.env`** to the same Supabase PostgreSQL connection string (prefer the session pooler URL if direct connections are unavailable). Run `supabase/schema.sql` in Supabase SQL Editor, or let FastAPI create/update the tables on startup. When blank, local development uses SQLite. `/health` reports the active database type without revealing credentials.

The connection string is a backend secret. Never put it in frontend variables, source code, GitHub, or chat. Existing local SQLite records are not copied automatically. To migrate local users, tickets, and knowledge articles, set both `SUPPORTPILOT_DB` and `SUPABASE_DB_URL` in `backend/.env`, back up the local database, then run `python backend/migrate_sqlite_to_supabase.py`. Sessions are intentionally not migrated, so everyone must sign in again. Each teammate should use an individual SupportPilot account; sharing the database does not require sharing login passwords. Workspace permissions are enforced by the backend. Keep privileged database credentials out of browsers.

### Accounts and workspace access

- Requesters can register and can see only their own tickets.
- An administrator creates support-agent accounts and selects their workspace scope: `IT Service Desk`, `Facilities Helpdesk`, or `all`.
- Support agents can access tickets and knowledge articles within their configured workspace scope. Admins can access both workspaces and manage accounts.
- The browser session uses a server-managed HttpOnly cookie.

### Knowledge base

- Knowledge articles are stored in the configured database and scoped to a workspace and service category.
- Support staff can add articles, save drafts, publish or unpublish them, and edit existing content.
- Signed-in users can search published articles by title, summary, instructions, and keywords.
- The ticket form suggests published articles matching the workspace, selected category, or ticket keywords.
- Only publish procedures reviewed and approved by the team.

### Assignees and why the list may be empty

The assignee menu is populated from **active accounts with the `support_agent` role** in the selected workspace. A fresh database has no support-agent accounts, so the menu can show “No support agents configured.” The first administrator is not automatically an assignee.

To add your teammates:

1. Sign in with an admin account and open `http://localhost:8000/docs`.
2. Expand `POST /api/admin/users`, select **Try it out**, and enter a unique email, a name, a password of at least 12 characters, role `support_agent`, and a workspace scope.
3. Choose **Execute**. Repeat for each active teammate; use the team names Shreyas, Srinidhi, Priyanka, and Sakshi as appropriate.
4. Refresh the frontend and select the workspace matching each agent’s scope.

Example request for one demo support account (emails must be unique, so do not reuse this address for multiple accounts):

```json
{
  "email": "test@gmail.com",
  "display_name": "Srinidhi",
  "password": "REPLACE_WITH_A_UNIQUE_PASSWORD_OF_AT_LEAST_12_CHARACTERS",
  "role": "support_agent",
  "workspace_scope": "IT Service Desk"
}
```

For actual teammates, use their real, distinct email addresses. `test@gmail.com` is only an example. The current ticket assignment, comments, and status controls are frontend-side interactions and are not persisted by the backend yet.

## Requirements

- Windows PowerShell (commands below use PowerShell syntax).
- Python 3.13 and the Python launcher (`py`).
- Node.js and npm.
- Git for source control.

## Run locally

Run commands from the project root (the folder containing `backend/` and `frontend/`).

### 1. Configure and start the backend

In PowerShell terminal 1:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements-models.txt
Copy-Item backend\.env.example backend\.env
python backend\create_admin.py --email test@gmail.com --name "Shreyas"
python -m uvicorn app.main:app --app-dir backend --reload --host localhost --port 8000
```

The admin setup command asks for a password and confirmation. Choose a password with at least 12 characters. Local SQLite is created at `backend/data/supportpilot.db` on first start when `SUPABASE_DB_URL` is blank. Set it to use the team-shared Supabase database. The supplied model paths are set in `backend/app/config.py`; optional environment overrides are documented in `backend/.env.example`.

### 2. Install and start the frontend

In PowerShell terminal 2, from the project root:

```powershell
cd frontend
npm ci
npm run dev -- --port 3000
```

Open `http://localhost:3000/login`. Keep both terminals running. API documentation is at `http://localhost:8000/docs`; health/model status is at `http://localhost:8000/health`.

If PowerShell blocks virtual-environment activation, open a new PowerShell window or call the venv executable directly, for example `\.venv\Scripts\python.exe -m pip install -r backend\requirements-models.txt` and `\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host localhost --port 8000`.

## Typical first-use workflow

1. Create the first administrator using the setup command above.
2. Sign in at `/login` and create active support-agent accounts in `/docs` as described under **Assignees**.
3. Open **Knowledge Base**, select the appropriate workspace, and add approved guides. Save as draft for staff review or publish to make a guide visible to requesters.
4. Submit a test ticket in each workspace and confirm the ticket ID, classification, priority, severity, routing, and database record.
5. Open the ticket list as a support agent and check that the assignee list matches the agent accounts for that workspace.

## API overview

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | API/model status |
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Requester registration and session management |
| `POST /api/tickets` | Validate, classify, score, route, and store a ticket |
| `POST /api/assistant/diagnose` | Return model probabilities and impact scores before submission |
| `POST /api/assistant/ask` | Retrieve published knowledge articles for the assistant |
| `POST /api/tickets/import-csv` | Validate and process a staff CSV import |
| `POST /api/integrations/email/inbound` | Accept an authenticated email-provider webhook |
| `PATCH /api/tickets/{ticket_id}/review` | Record staff approval or unwanted-ticket review |
| `GET /api/tickets`, `GET /api/tickets/{ticket_id}` | List or retrieve tickets subject to ownership/workspace rules |
| `GET /api/support/agents` | Return active, visible support agents for assignment menus |
| `/api/admin/users` | Admin account management; see `backend/README.md` for methods |
| `/api/knowledge/articles` | Search, create, edit, publish, and unpublish knowledge articles |
| `GET /docs` | Interactive FastAPI documentation |

## Data and severity references

Ticket and account records, sessions, and knowledge articles live in SQLite locally or shared Supabase PostgreSQL when configured. Training/evaluation CSV files stay in the repository and are not loaded as live tickets. Priority and severity definitions are documented in `severityANDpriority/README.md`; `severityANDpriority/severity_engine.py` implements the scoring rules, and `severityANDpriority/priority_severity_service.py` connects the priority model to severity output.

## Troubleshooting

- **Frontend says it cannot reach the backend:** check that Uvicorn is still running on port 8000 and open `http://localhost:8000/health`.
- **Browser reports a CORS error:** use `localhost` consistently for frontend and backend, and check `CORS_ORIGINS` in `backend/.env`.
- **Assignee list is empty:** add active `support_agent` accounts through the admin API. Accounts must match the selected workspace scope; an admin account alone is not listed as an assignee.
- **A guide is missing for requesters:** check that it is published and belongs to the selected workspace. Drafts are visible to staff only.
- **Model warnings on startup:** install dependencies from `backend/requirements-models.txt` in the project's virtual environment so they match the serialized model artifacts.
- **Database reset for a local demo:** stop the backend and back up/remove `backend/data/supportpilot.db`; the next backend start creates a new empty database. This deletes local account, ticket, session, and article records.

## Development checks

From `frontend/`:

```powershell
npm run lint
npx tsc --noEmit
npm test -- --run
npm run build
```

For backend tests, activate the project virtual environment from the project root and run:

```powershell
python -m pytest backend\tests -q
```

## Prototype limitations

Email verification, password recovery, and login rate limiting are not implemented. Ticket assignments, comments, and status changes in the support UI are not yet saved through the backend API. This project is configured for local demonstration/development; production use needs deployment security review, HTTPS, backups, monitoring, and the missing account-recovery protections.
