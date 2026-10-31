export const pct = (x: number | null | undefined, digits = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`);
export const signedPct = (x: number | null | undefined, digits = 1) =>
  x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
export const odds = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(2));
export const units = (x: number | null | undefined) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)} u`);

const dtf = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const df = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });
export const dateTime = (iso: string) => dtf.format(new Date(iso));
export const date = (iso: string) => df.format(new Date(iso));

export const CONFIDENCE_LABEL: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta" };
export const RESULT_LABEL: Record<string, string> = {
  pending: "Pendiente", won: "Ganada", lost: "Perdida", void: "Anulada", half_won: "Medio ganada", half_lost: "Medio perdida",
};
