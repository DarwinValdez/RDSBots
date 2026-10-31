import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { handler } from "@/lib/api";
import { JOBS, runJob } from "@/lib/services/jobs";
import { logActivity } from "@/lib/services/logging";
import { clientIp, enforceRateLimit } from "@/lib/services/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 300;

const body = z.object({ job: z.enum(JOBS), backfill: z.boolean().optional() });

/** Manual job trigger from the admin panel (bypasses the frequency gate). */
export const POST = handler("api:admin:jobs", async (req: Request) => {
  const admin = await assertAdmin();
  await enforceRateLimit(`jobs:${admin.id}`, 30, 3600);
  const { job, backfill } = body.parse(await req.json());
  await logActivity(admin.id, "admin:run_job", { job, backfill }, clientIp(req));
  const result = await runJob(job, { force: true, backfill });
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
});
