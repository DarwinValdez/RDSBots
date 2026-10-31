import { Chat } from "@/components/Chat";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { DataUnavailable, PageHeader } from "@/components/ui";
import { providerStatus } from "@/lib/env";
import { getSettings } from "@/lib/services/settings";

export const metadata = { title: "Asistente IA" };

export default async function ChatPage() {
  const settings = await getSettings();
  if (!settings.modules.chat) return <ModuleDisabled name="Chat" />;
  return (
    <>
      <PageHeader title="Asistente deportivo" subtitle="Claude consulta las herramientas de la plataforma (partidos, cuotas, modelo, rendimiento) y reconoce cuando no hay datos." />
      {providerStatus().anthropic ? <Chat /> : <DataUnavailable title="Claude API no configurada">Define ANTHROPIC_API_KEY en las variables de entorno del servidor.</DataUnavailable>}
    </>
  );
}
