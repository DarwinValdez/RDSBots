"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const input = "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-info";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "session" ? null : params.get("error") ? "No se pudo completar la autenticación." : null,
  );
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === "signup" && (!age || !terms)) return setError("Debes confirmar la mayoría de edad y aceptar las condiciones.");
    if (password.length < 10 && mode === "signup") return setError("La contraseña debe tener al menos 10 caracteres.");
    setLoading(true);
    const supabase = createClient();
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const next = params.get("next");
        router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: { age_confirmed: "true", terms_accepted: "true" },
          },
        });
        if (error) throw error;
        setInfo("Revisa tu email para confirmar la cuenta.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de autenticación");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">{mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</h1>
      <label className="block space-y-1 text-sm">
        <span className="text-ink-2">Email</span>
        <input className={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-ink-2">Contraseña</span>
        <input
          className={input}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {mode === "signup" && (
        <div className="space-y-2 text-sm text-ink-2">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} className="mt-1" />
            Confirmo que soy mayor de 18 años (o de la edad legal en mi jurisdicción).
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1" />
            <span>
              Acepto el <Link href="/legal" className="text-info underline">aviso legal y la política de juego responsable</Link>.
            </span>
          </label>
        </div>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
      {info && <p className="text-sm text-brand">{info}</p>}
      <button disabled={loading} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-black hover:bg-brand-2 disabled:opacity-60">
        {loading ? "…" : mode === "login" ? "Entrar" : "Registrarme"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>¿Sin cuenta? <Link href="/signup" className="text-info">Regístrate</Link></>
        ) : (
          <>¿Ya tienes cuenta? <Link href="/login" className="text-info">Inicia sesión</Link></>
        )}
      </p>
    </form>
  );
}
