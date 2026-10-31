import Link from "next/link";

export const metadata = { title: "Aviso legal y juego responsable" };

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12 text-sm leading-relaxed text-ink-2">
      <h1 className="text-2xl font-semibold text-ink">Aviso legal y juego responsable</h1>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-ink">Naturaleza del servicio</h2>
        <p>
          AI Betting Analyst es una herramienta de análisis estadístico e información deportiva. No es un operador de apuestas, no acepta
          apuestas ni gestiona fondos, y no recomienda apostar. Las probabilidades son estimaciones de modelos estadísticos con error; ningún
          resultado está garantizado y el rendimiento pasado no garantiza resultados futuros.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-ink">Requisitos de uso</h2>
        <p>
          Solo para mayores de 18 años (o la edad legal en tu jurisdicción). Eres responsable de cumplir la normativa local sobre apuestas;
          en algunas jurisdicciones las apuestas deportivas están restringidas o prohibidas.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-ink">Juego responsable</h2>
        <p>
          Apuesta solo lo que puedas permitirte perder, fija límites y no intentes recuperar pérdidas. Si el juego te genera problemas, busca
          ayuda: en España <a className="text-info underline" href="https://www.jugarbien.es" rel="noreferrer" target="_blank">jugarbien.es</a>,
          en EE. UU. 1-800-GAMBLER, o el servicio de ayuda de tu país.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-ink">Datos</h2>
        <p>
          Los datos deportivos y de cuotas provienen de API-Sports y The Odds API. Los análisis en lenguaje natural son generados por Claude
          (Anthropic) a partir de esos datos. Tratamos tu email y actividad únicamente para prestar el servicio y por seguridad.
        </p>
      </section>
      <Link href="/dashboard" className="text-info underline">Volver</Link>
    </main>
  );
}
