import { cn } from "@/lib/utils";

interface Aba<T extends string> {
  id: T;
  rotulo: string;
  contagem?: number;
}

interface TabsProps<T extends string> {
  abas: Aba<T>[];
  atual: T;
  onMudar: (id: T) => void;
  className?: string;
}

/** Abas com estado ativo por sublinhado — sem pílulas genéricas. */
function Tabs<T extends string>({ abas, atual, onMudar, className }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={cn("border-border flex items-end gap-1 overflow-x-auto border-b", className)}
    >
      {abas.map((aba) => {
        const ativo = aba.id === atual;
        return (
          <button
            key={aba.id}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => onMudar(aba.id)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              ativo
                ? "border-primary text-primary"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {aba.rotulo}
            {typeof aba.contagem === "number" && (
              <span
                className={cn(
                  "tabular rounded-sm px-1.5 py-0.5 text-[11px]",
                  ativo ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {aba.contagem}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export { Tabs };
