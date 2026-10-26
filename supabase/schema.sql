-- SupportPilot shared database schema for Supabase PostgreSQL.
-- Run this once in Supabase SQL Editor, or let the FastAPI startup create the
-- same tables when using the database connection string.

create table if not exists public.users (
  user_id bigserial primary key,
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null check (role in ('requester', 'support_agent', 'admin')),
  workspace_scope text,
  is_active smallint not null default 1,
  created_at text not null
);

create table if not exists public.tickets (
  ticket_id text primary key,
  requester_user_id bigint references public.users(user_id),
  subject text not null,
  body text not null,
  requester_email text,
  workspace text not null default 'IT Service Desk',
  category text not null,
  ticket_type text not null default 'Incident',
  ticket_type_confidence double precision not null default 0,
  ticket_type_probabilities text not null default '{}',
  assigned_team text not null default 'Service Desk L1',
  category_source text not null default 'ml_model',
  priority text not null,
  severity text not null check (severity in ('Critical', 'High', 'Medium', 'Low')),
  priority_raw_prediction text not null default '',
  priority_confidence double precision not null default 0,
  priority_source text not null default '',
  priority_probabilities text not null default '{}',
  severity_score integer not null default 0,
  severity_confidence double precision not null default 0,
  severity_reasoning text not null default '',
  sla text not null default '{}',
  alignment_notes text not null default '',
  business_impact text not null,
  affected_users integer not null check (affected_users >= 1),
  service_criticality text not null,
  created_at text not null,
  review_status text not null default 'accepted',
  review_reason text not null default ''
);

create table if not exists public.auth_sessions (
  token_hash text primary key,
  user_id bigint not null references public.users(user_id) on delete cascade,
  expires_at text not null,
  created_at text not null
);

create table if not exists public.knowledge_articles (
  article_id text primary key,
  title text not null,
  summary text not null,
  content text not null,
  category text not null,
  workspace text not null,
  keywords text not null default '[]',
  is_published smallint not null default 0,
  owner text not null,
  created_at text not null,
  updated_at text not null
);

alter table public.tickets add column if not exists review_status text not null default 'accepted';
alter table public.tickets add column if not exists review_reason text not null default '';

-- The application connects through FastAPI and enforces account/workspace
-- permissions there. Do not expose these tables through the Supabase Data API.
alter table public.users enable row level security;
alter table public.tickets enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.knowledge_articles enable row level security;
revoke all on public.users, public.tickets, public.auth_sessions, public.knowledge_articles from anon, authenticated;
