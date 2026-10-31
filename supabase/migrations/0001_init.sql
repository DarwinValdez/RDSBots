-- =====================================================================
-- AI Betting Analyst — initial schema
-- Reads: authenticated users via RLS. Writes to sports data: service role
-- only (cron jobs / admin API routes). Predictions are append-only and
-- settlement fields can be written exactly once (enforced by triggers).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Users & roles
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  is_active boolean not null default true,
  age_confirmed_at timestamptz,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, age_confirmed_at, terms_accepted_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    case when (new.raw_user_meta_data ->> 'age_confirmed') = 'true' then now() end,
    case when (new.raw_user_meta_data ->> 'terms_accepted') = 'true' then now() end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may edit their display name, never their role / status.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception 'Not allowed to change role, status or email';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------
-- Sports catalogue
-- ---------------------------------------------------------------------
create table public.sports (
  key text primary key,
  name text not null,
  enabled boolean not null default true,
  sort_order int not null default 0
);

create table public.leagues (
  id bigserial primary key,
  sport_key text not null references public.sports (key),
  name text not null,
  country text,
  provider_league_id int,          -- API-Sports league id (null when odds-only)
  odds_sport_key text unique,      -- The Odds API sport key
  current_season text,             -- API-Sports season param ("2026" or "2025-2026")
  history_seasons text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sport_key, provider_league_id)
);

create table public.teams (
  id bigserial primary key,
  sport_key text not null references public.sports (key),
  name text not null,
  normalized_name text not null,
  provider_team_id int,
  logo_url text,
  created_at timestamptz not null default now(),
  unique (sport_key, provider_team_id),
  unique (sport_key, normalized_name)
);

create table public.team_aliases (
  id bigserial primary key,
  team_id bigint not null references public.teams (id) on delete cascade,
  sport_key text not null,
  alias_normalized text not null,
  unique (sport_key, alias_normalized)
);

create table public.matches (
  id bigserial primary key,
  sport_key text not null references public.sports (key),
  league_id bigint references public.leagues (id),
  home_team_id bigint not null references public.teams (id),
  away_team_id bigint not null references public.teams (id),
  commence_time timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  home_score int,
  away_score int,
  provider_fixture_id text,
  odds_event_id text unique,
  season text,
  round text,
  venue text,
  is_neutral boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (sport_key, provider_fixture_id)
);
create index matches_commence_idx on public.matches (commence_time);
create index matches_sport_status_idx on public.matches (sport_key, status, commence_time);
create index matches_home_idx on public.matches (home_team_id, commence_time);
create index matches_away_idx on public.matches (away_team_id, commence_time);

-- Every odds pull is stored, which gives line movement and closing lines.
create table public.odds_snapshots (
  id bigserial primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  bookmaker text not null,
  market text not null check (market in ('h2h', 'totals', 'spreads', 'btts')),
  selection text not null check (selection in ('home', 'draw', 'away', 'over', 'under', 'yes', 'no')),
  line numeric,
  price numeric not null check (price > 1),
  captured_at timestamptz not null default now()
);
create index odds_match_market_idx on public.odds_snapshots (match_id, market, captured_at desc);

-- ---------------------------------------------------------------------
-- Model
-- ---------------------------------------------------------------------
create table public.model_runs (
  id bigserial primary key,
  sport_key text not null references public.sports (key),
  league_id bigint references public.leagues (id),
  model_version text not null,
  params jsonb not null,
  ratings jsonb not null,
  n_matches int not null,
  metrics jsonb,
  fitted_at timestamptz not null default now()
);
create index model_runs_lookup_idx on public.model_runs (sport_key, league_id, fitted_at desc);

create table public.predictions (
  id bigserial primary key,
  match_id bigint not null references public.matches (id),
  sport_key text not null,
  market text not null,
  selection text not null,
  line numeric,
  model_prob numeric not null check (model_prob between 0 and 1),
  market_prob numeric check (market_prob between 0 and 1),
  final_prob numeric not null check (final_prob between 0 and 1),
  best_price numeric not null check (best_price > 1),
  bookmaker text not null,
  implied_prob numeric not null,
  bookmaker_margin numeric,
  ev numeric not null,
  edge numeric not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  is_value boolean not null default false,
  factors jsonb not null default '{}',
  model_version text not null,
  model_run_id bigint references public.model_runs (id),
  kickoff_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- settlement (written once)
  result text not null default 'pending'
    check (result in ('pending', 'won', 'lost', 'void', 'half_won', 'half_lost')),
  closing_price numeric,
  clv numeric,
  profit numeric,
  settled_at timestamptz
);
create unique index predictions_unique_selection
  on public.predictions (match_id, market, selection, coalesce(line, -9999));
create index predictions_kickoff_idx on public.predictions (kickoff_at desc);
create index predictions_value_idx on public.predictions (is_value, result);

-- Integrity: predictions must be recorded before kickoff, original fields are
-- immutable, settlement can be written only once, and rows cannot be deleted.
create or replace function public.guard_predictions()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.kickoff_at <= now() then
      raise exception 'Predictions must be recorded before the event starts';
    end if;
    new.created_at := now();
    new.result := 'pending';
    new.closing_price := null; new.clv := null; new.profit := null; new.settled_at := null;
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.match_id, new.market, new.selection, new.line, new.model_prob, new.market_prob,
        new.final_prob, new.best_price, new.bookmaker, new.implied_prob, new.bookmaker_margin,
        new.ev, new.edge, new.confidence, new.is_value, new.factors, new.model_version,
        new.model_run_id, new.kickoff_at, new.created_at, new.sport_key)
       is distinct from
       (old.match_id, old.market, old.selection, old.line, old.model_prob, old.market_prob,
        old.final_prob, old.best_price, old.bookmaker, old.implied_prob, old.bookmaker_margin,
        old.ev, old.edge, old.confidence, old.is_value, old.factors, old.model_version,
        old.model_run_id, old.kickoff_at, old.created_at, old.sport_key) then
      raise exception 'Historical predictions are immutable';
    end if;
    if old.result <> 'pending' then
      raise exception 'Prediction already settled';
    end if;
    -- closing line may be recorded while pending; result only once
    return new;
  elsif tg_op = 'DELETE' then
    raise exception 'Predictions cannot be deleted';
  end if;
  return null;
end;
$$;

create trigger predictions_guard_ins before insert on public.predictions
  for each row execute function public.guard_predictions();
create trigger predictions_guard_upd before update on public.predictions
  for each row execute function public.guard_predictions();
create trigger predictions_guard_del before delete on public.predictions
  for each row execute function public.guard_predictions();

create table public.ai_analyses (
  id bigserial primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  input_hash text not null,
  model text not null,
  content text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (match_id, input_hash)
);

-- ---------------------------------------------------------------------
-- Platform operations
-- ---------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table public.api_usage (
  id bigserial primary key,
  provider text not null,
  endpoint text not null,
  status int,
  latency_ms int,
  quota_remaining int,
  created_at timestamptz not null default now()
);
create index api_usage_created_idx on public.api_usage (created_at desc);

create table public.error_logs (
  id bigserial primary key,
  source text not null,
  message text not null,
  context jsonb,
  created_at timestamptz not null default now()
);
create index error_logs_created_idx on public.error_logs (created_at desc);

create table public.activity_logs (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  details jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs (created_at desc);

create table public.job_runs (
  id bigserial primary key,
  job text not null,
  status text not null check (status in ('running', 'success', 'error', 'skipped')),
  details jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_runs_job_idx on public.job_runs (job, started_at desc);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

-- Fixed-window rate limiter, atomic under concurrency.
create or replace function public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                     then 1 else r.count + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                            then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.sports enable row level security;
alter table public.leagues enable row level security;
alter table public.teams enable row level security;
alter table public.team_aliases enable row level security;
alter table public.matches enable row level security;
alter table public.odds_snapshots enable row level security;
alter table public.model_runs enable row level security;
alter table public.predictions enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.app_settings enable row level security;
alter table public.api_usage enable row level security;
alter table public.error_logs enable row level security;
alter table public.activity_logs enable row level security;
alter table public.job_runs enable row level security;
alter table public.rate_limits enable row level security;

create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Sports data: readable by any signed-in user, written only by service role.
create policy "sports: read" on public.sports for select to authenticated using (true);
create policy "leagues: read" on public.leagues for select to authenticated using (true);
create policy "teams: read" on public.teams for select to authenticated using (true);
create policy "matches: read" on public.matches for select to authenticated using (true);
create policy "odds: read" on public.odds_snapshots for select to authenticated using (true);
create policy "model_runs: read" on public.model_runs for select to authenticated using (true);
create policy "predictions: read" on public.predictions for select to authenticated using (true);
create policy "analyses: read" on public.ai_analyses for select to authenticated using (true);
create policy "settings: read" on public.app_settings for select to authenticated using (true);

create policy "api_usage: admin" on public.api_usage for select to authenticated using (public.is_admin());
create policy "errors: admin" on public.error_logs for select to authenticated using (public.is_admin());
create policy "jobs: admin" on public.job_runs for select to authenticated using (public.is_admin());
create policy "activity: own or admin" on public.activity_logs
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- Seed: sports, default leagues and settings (no match/odds data seeded)
-- ---------------------------------------------------------------------
insert into public.sports (key, name, sort_order) values
  ('soccer', 'Fútbol', 1), ('nba', 'NBA', 2), ('mlb', 'MLB', 3),
  ('nfl', 'NFL', 4), ('nhl', 'NHL', 5), ('tennis', 'Tenis', 6);

insert into public.leagues (sport_key, name, country, provider_league_id, odds_sport_key, current_season) values
  ('soccer', 'Premier League', 'England', 39, 'soccer_epl', '2026'),
  ('soccer', 'La Liga', 'Spain', 140, 'soccer_spain_la_liga', '2026'),
  ('soccer', 'Serie A', 'Italy', 135, 'soccer_italy_serie_a', '2026'),
  ('soccer', 'Bundesliga', 'Germany', 78, 'soccer_germany_bundesliga', '2026'),
  ('soccer', 'Ligue 1', 'France', 61, 'soccer_france_ligue_one', '2026'),
  ('soccer', 'UEFA Champions League', 'Europe', 2, 'soccer_uefa_champs_league', '2026'),
  ('soccer', 'Liga MX', 'Mexico', 262, 'soccer_mexico_ligamx', '2026'),
  ('soccer', 'MLS', 'USA', 253, 'soccer_usa_mls', '2026'),
  ('nba', 'NBA', 'USA', 12, 'basketball_nba', '2026-2027'),
  ('mlb', 'MLB', 'USA', 1, 'baseball_mlb', '2026'),
  ('nfl', 'NFL', 'USA', 1, 'americanfootball_nfl', '2026'),
  ('nhl', 'NHL', 'USA', 57, 'icehockey_nhl', '2026');
-- Tennis tournaments are discovered dynamically from The Odds API (tennis_*).

insert into public.app_settings (key, value) values
  ('modules', '{"dashboard":true,"value_bets":true,"parlays":true,"history":true,"chat":true,"ai_analysis":true}'),
  ('model', '{"time_decay_half_life_days":180,"market_blend_weight":0.5,"min_ev":0.02,"min_edge":0.01,"min_matches_per_team":6,"prediction_window_hours":48,"max_odds":10,"bankroll_units":100}'),
  ('refresh', '{"sync_fixtures_minutes":360,"sync_odds_minutes":30,"predict_minutes":60,"settle_minutes":60}'),
  ('providers', '{"odds_regions":"eu,uk,us","odds_markets":"h2h,totals,spreads"}');

-- Latest price per bookmaker/selection/line (line movement keeps full history).
create view public.latest_odds with (security_invoker = true) as
  select distinct on (match_id, bookmaker, market, selection, coalesce(line, -9999))
    id, match_id, bookmaker, market, selection, line, price, captured_at
  from public.odds_snapshots
  order by match_id, bookmaker, market, selection, coalesce(line, -9999), captured_at desc;
