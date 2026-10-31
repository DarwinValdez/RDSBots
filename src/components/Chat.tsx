"use client";
import { Bot, Send, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "¿Qué partidos tienen mejores oportunidades hoy?",
  "Compara las cuotas del próximo partido del Real Madrid",
  "¿Qué equipo tiene mejor rendimiento reciente en la Premier League?",
  "Explícame por qué existe la mejor value bet actual",
  "¿Cuál es el rendimiento real del modelo en fútbol?",
  "Muestra los máximos goleadores de La Liga",
];


export function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user" as const, content }].slice(-20);
    setMessages(next);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setMessages([...next, { role: "assistant", content: json.answer || "Sin respuesta." }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  const ids = (t: string) => Array.from(new Set(Array.from(t.matchAll(/\[#(\d+)\]/g)).map((m) => m[1])));

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[480px] flex-col rounded-xl border border-line bg-surface">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!messages.length && (
          <div className="mx-auto max-w-xl py-8 text-center">
            <Bot className="mx-auto size-8 text-info" />
            <p className="mt-3 text-sm text-ink-2">Pregunta sobre partidos, cuotas, value bets, equipos o jugadores. El asistente solo usa datos registrados en la plataforma.</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-xs text-ink-2 hover:border-info/50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="flex gap-3">
            <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${m.role === "user" ? "bg-surface-3" : "bg-info/15"}`}>
              {m.role === "user" ? <User className="size-4 text-ink-2" /> : <Bot className="size-4 text-info" />}
            </div>
            <div className="min-w-0 flex-1">
              {m.role === "user" ? <p className="text-sm">{m.content}</p> : <Markdown text={m.content} />}
              {m.role === "assistant" && ids(m.content).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ids(m.content).map((id) => (
                    <Link key={id} href={`/matches/${id}`} className="rounded-md border border-line px-2 py-0.5 text-xs text-info hover:border-info">Abrir #{id}</Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <p className="pl-10 text-sm text-muted">Consultando datos de la plataforma…</p>}
        {error && <p className="pl-10 text-sm text-bad">{error}</p>}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-line p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={4000}
          placeholder="Escribe tu pregunta…"
          className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-info"
        />
        <button disabled={loading || !input.trim()} aria-label="Enviar" className="rounded-lg bg-info px-3 text-white disabled:opacity-50">
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
