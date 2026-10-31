import { DataUnavailable } from "@/components/ui";

export function ModuleDisabled({ name }: { name: string }) {
  return <DataUnavailable title={`El módulo "${name}" está desactivado`}>Un administrador puede activarlo en el panel de administración.</DataUnavailable>;
}
