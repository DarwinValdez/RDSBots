"use client";
/**
 * Charts follow the dataviz rules: one axis, thin marks, recessive grid,
 * text in text tokens, hover tooltips. Palette validated for the dark surface
 * (#3987e5 / #199e70; negatives #e66767 as the diverging pole).
 */
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";

const AXIS = { stroke: "#7d848d", fontSize: 11, tickLine: false, axisLine: { stroke: "#262a30" } } as const;
const GRID = { stroke: "#262a30", strokeDasharray: "2 4", vertical: false } as const;
const TOOLTIP = {
  contentStyle: { background: "#17191c", border: "1px solid #262a30", borderRadius: 8, fontSize: 12, color: "#e8eaed" },
  labelStyle: { color: "#b4bac2" },
  itemStyle: { color: "#e8eaed" },
  cursor: { stroke: "#7d848d", strokeWidth: 1 },
} as const;

export function ProfitChart({ data }: { data: { date: string; profit: number; bets: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} minTickGap={32} />
        <YAxis {...AXIS} tickFormatter={(v: number) => `${v.toFixed(0)}u`} />
        <ReferenceLine y={0} stroke="#7d848d" strokeWidth={1} />
        <Tooltip {...TOOLTIP} formatter={(v) => [`${Number(v).toFixed(2)} u`, "Beneficio acumulado"]} labelFormatter={(l) => `Fecha ${l}`} />
        <Line type="monotone" dataKey="profit" stroke="#3987e5" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#111214", strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Reliability diagram: observed frequency vs predicted probability per bin. */
export function CalibrationChart({ bins }: { bins: { meanPred: number; observed: number; n: number }[] }) {
  const pts = bins.filter((b) => b.n > 0).map((b) => ({ x: b.meanPred * 100, y: b.observed * 100, n: b.n }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid {...GRID} vertical />
        <XAxis type="number" dataKey="x" domain={[0, 100]} {...AXIS} tickFormatter={(v: number) => `${v}%`} name="Predicha" />
        <YAxis type="number" dataKey="y" domain={[0, 100]} {...AXIS} tickFormatter={(v: number) => `${v}%`} name="Observada" />
        <ZAxis type="number" dataKey="n" range={[60, 260]} name="Predicciones" />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="#7d848d" strokeDasharray="4 4" />
        <Tooltip
          {...TOOLTIP}
          formatter={(v, name) => [name === "Predicciones" ? String(v) : `${Number(v).toFixed(1)}%`, String(name)]}
        />
        <Scatter data={pts} fill="#199e70" stroke="#111214" strokeWidth={2} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function YieldBars({ data }: { data: { label: string; yield: number | null; bets: number }[] }) {
  const rows = data.map((d) => ({ ...d, value: (d.yield ?? 0) * 100 }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barCategoryGap="30%">
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
        <ReferenceLine y={0} stroke="#7d848d" />
        <Tooltip {...TOOLTIP} cursor={{ fill: "#1e2125" }} formatter={(v, _n, p) => [`${Number(v).toFixed(1)}% (${(p.payload as { bets: number }).bets} apuestas)`, "Yield"]} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {rows.map((r, i) => <Cell key={i} fill={r.value >= 0 ? "#3987e5" : "#e66767"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OddsMovementChart({ series }: { series: { t: string; price: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <XAxis dataKey="t" hide />
        <YAxis {...AXIS} domain={["auto", "auto"]} width={40} />
        <Tooltip {...TOOLTIP} formatter={(v) => [Number(v).toFixed(2), "Mejor cuota"]} />
        <Line type="stepAfter" dataKey="price" stroke="#3987e5" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
