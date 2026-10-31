import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SportKey } from "@/lib/sports";

const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "as", "cd", "club", "de", "the", "calcio", "sk", "fk", "bc", "ssc", "us", "rc", "real"]);

/** Lower-cases, strips accents/punctuation and common club suffixes. */
export function normalizeName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = base.filter((t) => !STOP.has(t));
  return (kept.length ? kept : base).join(" ");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity on character bigrams (0..1). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [g, c] of A) {
    inter += Math.min(c, B.get(g) ?? 0);
    total += c;
  }
  for (const c of B.values()) total += c;
  const dice = total ? (2 * inter) / total : 0;
  // containment bonus: "manchester united" vs "man united" style names
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return Math.max(dice, 0.85);
  return dice;
}

export type TeamRow = { id: number; name: string; normalized_name: string; provider_team_id: number | null };

/** In-memory resolver for one sport, backed by teams + team_aliases. */
export class TeamDirectory {
  private byProvider = new Map<number, TeamRow>();
  private byNorm = new Map<string, TeamRow>();
  private all: TeamRow[] = [];

  private constructor(private db: SupabaseClient, private sport: SportKey) {}

  static async load(db: SupabaseClient, sport: SportKey) {
    const dir = new TeamDirectory(db, sport);
    const [{ data: teams }, { data: aliases }] = await Promise.all([
      db.from("teams").select("id, name, normalized_name, provider_team_id").eq("sport_key", sport),
      db.from("team_aliases").select("team_id, alias_normalized").eq("sport_key", sport),
    ]);
    for (const t of (teams ?? []) as TeamRow[]) dir.index(t);
    const byId = new Map(dir.all.map((t) => [t.id, t]));
    for (const a of aliases ?? []) {
      const t = byId.get(a.team_id);
      if (t) dir.byNorm.set(a.alias_normalized, t);
    }
    return dir;
  }

  private index(t: TeamRow) {
    this.all.push(t);
    if (t.provider_team_id != null) this.byProvider.set(t.provider_team_id, t);
    this.byNorm.set(t.normalized_name, t);
  }

  get(id: number) {
    return this.all.find((t) => t.id === id);
  }

  /** Team from a stats provider (has stable provider id). */
  async upsertProvider(providerId: number, name: string, logo: string | null): Promise<TeamRow> {
    const existing = this.byProvider.get(providerId);
    if (existing) return existing;
    const norm = normalizeName(name);
    const byName = this.byNorm.get(norm);
    if (byName && byName.provider_team_id == null) {
      await this.db.from("teams").update({ provider_team_id: providerId, logo_url: logo }).eq("id", byName.id);
      byName.provider_team_id = providerId;
      this.byProvider.set(providerId, byName);
      return byName;
    }
    const { data, error } = await this.db
      .from("teams")
      .upsert(
        { sport_key: this.sport, name, normalized_name: byName ? `${norm} #${providerId}` : norm, provider_team_id: providerId, logo_url: logo },
        { onConflict: "sport_key,provider_team_id" },
      )
      .select("id, name, normalized_name, provider_team_id")
      .single();
    if (error) throw error;
    this.index(data as TeamRow);
    return data as TeamRow;
  }

  /** Best fuzzy match for a free-text name (odds feed), or null. */
  match(name: string, candidates?: TeamRow[], threshold = 0.72): TeamRow | null {
    const norm = normalizeName(name);
    const exact = this.byNorm.get(norm);
    if (exact && (!candidates || candidates.some((c) => c.id === exact.id))) return exact;
    let best: TeamRow | null = null, bestScore = 0;
    for (const t of candidates ?? this.all) {
      const s = similarity(norm, t.normalized_name);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return bestScore >= threshold ? best : null;
  }

  async addAlias(team: TeamRow, name: string) {
    const norm = normalizeName(name);
    if (this.byNorm.get(norm)?.id === team.id) return;
    this.byNorm.set(norm, team);
    await this.db
      .from("team_aliases")
      .upsert({ team_id: team.id, sport_key: this.sport, alias_normalized: norm }, { onConflict: "sport_key,alias_normalized", ignoreDuplicates: true });
  }

  /** Team/player known only by name (odds-only sports such as tennis). */
  async upsertByName(name: string): Promise<TeamRow> {
    const found = this.match(name, undefined, 0.95);
    if (found) return found;
    const norm = normalizeName(name);
    const { data, error } = await this.db
      .from("teams")
      .upsert({ sport_key: this.sport, name, normalized_name: norm }, { onConflict: "sport_key,normalized_name" })
      .select("id, name, normalized_name, provider_team_id")
      .single();
    if (error) throw error;
    this.index(data as TeamRow);
    return data as TeamRow;
  }
}
