import { Activity } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <Activity className="size-6 text-brand" aria-hidden />
          <span className="text-lg font-semibold">AI Betting Analyst</span>
        </div>
        {children}
      </div>
    </main>
  );
}
