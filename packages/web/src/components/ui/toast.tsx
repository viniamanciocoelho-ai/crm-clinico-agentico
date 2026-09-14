import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tipo = "sucesso" | "erro" | "info";

interface Toast {
  id: number;
  tipo: Tipo;
  titulo: string;
  detalhe?: string;
}

const ToastContext = createContext<{ mostrar: (t: Omit<Toast, "id">) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa do ToastProvider");
  return ctx;
}

const ICONE: Record<Tipo, React.ElementType> = {
  sucesso: Check,
  erro: AlertTriangle,
  info: Info,
};

const ESTILO: Record<Tipo, string> = {
  sucesso: "border-success/30 bg-success-soft text-success",
  erro: "border-destructive/30 bg-destructive-soft text-destructive",
  info: "border-info/30 bg-info-soft text-info",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [itens, setItens] = useState<Toast[]>([]);

  const mostrar = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItens((atual) => [...atual, { ...t, id }]);
    setTimeout(() => setItens((atual) => atual.filter((i) => i.id !== id)), 4500);
  }, []);

  const valor = useMemo(() => ({ mostrar }), [mostrar]);

  return (
    <ToastContext.Provider value={valor}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 sm:bottom-20 sm:left-auto sm:right-6 sm:translate-x-0"
      >
        {itens.map((t) => {
          const Icone = ICONE[t.tipo];
          return (
            <div
              key={t.id}
              className={cn(
                "rise bg-card pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-[0_14px_36px_-16px_rgba(18,48,42,0.4)]",
                ESTILO[t.tipo],
              )}
            >
              <Icone className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-[13px] font-semibold">{t.titulo}</p>
                {t.detalhe && (
                  <p className="text-muted-foreground mt-0.5 text-[12px]">{t.detalhe}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Dispensar"
                className="text-muted-foreground hover:text-foreground rounded"
                onClick={() => setItens((atual) => atual.filter((i) => i.id !== t.id))}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
