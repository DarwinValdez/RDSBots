"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-line bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">No se pudieron cargar los datos</h1>
      <p className="mt-2 text-sm text-muted">
        Comprueba que Supabase está accesible y que la migración está aplicada. El detalle queda en los logs del servidor.
      </p>
      <button onClick={reset} className="mt-4 rounded-lg bg-info px-3 py-2 text-sm font-medium text-white">Reintentar</button>
    </div>
  );
}
