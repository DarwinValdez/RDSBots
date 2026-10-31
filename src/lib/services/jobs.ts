import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "./logging";
import { runPredictions, settlePredictions } from "./predict";
import { getSettings, type Settings } from "./settings";
import { syncFixtures, syncOdds, syncOddsOnlyScores } from "./sync";

export const JOBS = ["sync-fixtures", "sync-odds", "predict", "settle"] as const;
export type JobName = (typeof JOBS)[number];

const FREQUENCY: Record<JobName, keyof Settings["refresh"]> = {
  "sync-fixtures": "sync_fixtures_minutes",
  "sync-odds": "sync_odds_minutes",
  predict: "predict_minutes",
  settle: "settle_minutes",
};

export function isJob(s: string): s is JobName {
  return (JOBS as readonly string[]).includes(s);
}

/**
 * Runs a job, honouring the admin-configured minimum interval unless forced.
 * Every run is recorded in job_runs.
 */
export async function runJob(job: JobName, opts: { force?: boolean; backfill?: boolean } = {}) {
  const db = createAdminClient();
  const settings = await getSettings();

  if (!opts.force) {
    const { data: last } = await db
      .from("job_runs")
      .select("started_at")
      .eq("job", job)
      .in("status", ["success", "running"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const minMinutes = settings.refresh[FREQUENCY[job]];
    // small tolerance so a cron firing on schedule is not skipped by seconds
    if (last && Date.now() - new Date(last.started_at).getTime() < (minMinutes - 2) * 60_000) {
      await db.from("job_runs").insert({ job, status: "skipped", details: { reason: "frequency" }, finished_at: new Date().toISOString() });
      return { status: "skipped" as const };
    }
  }

  const { data: run } = await db.from("job_runs").insert({ job, status: "running" }).select("id").single();
  try {
    let details: Record<string, unknown>;
    switch (job) {
      case "sync-fixtures":
        details = await syncFixtures(db, { backfill: opts.backfill });
        break;
      case "sync-odds":
        details = await syncOdds(db);
        break;
      case "predict":
        details = await runPredictions(db);
        break;
      case "settle":
        details = { scores: await syncOddsOnlyScores(db), ...(await settlePredictions(db)) };
        break;
    }
    if (run) await db.from("job_runs").update({ status: "success", details, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { status: "success" as const, details };
  } catch (e) {
    await logError(`job:${job}`, e);
    if (run)
      await db
        .from("job_runs")
        .update({ status: "error", details: { error: e instanceof Error ? e.message : String(e) }, finished_at: new Date().toISOString() })
        .eq("id", run.id);
    return { status: "error" as const, error: e instanceof Error ? e.message : String(e) };
  }
}
