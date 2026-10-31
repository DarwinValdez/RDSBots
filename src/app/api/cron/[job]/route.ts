import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { isJob, runJob } from "@/lib/services/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = serverEnv.cronSecret();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Invoked by Vercel Cron (GET with `Authorization: Bearer $CRON_SECRET`). */
export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { job } = await ctx.params;
  if (!isJob(job)) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  const result = await runJob(job);
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}
