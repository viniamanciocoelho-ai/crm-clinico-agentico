import { cn } from "@/lib/utils";

interface KpiCardProps {
  rotulo: string;
  valor: string;
  apoio?: string;
  icone?: React.ElementType;
  tom?: "neutro" | "primary" | "accent" | "success" | "warning" | "destructive";
  className?: string;
}

const FAIXA: Record<NonNullable<KpiCardProps["tom"]>, string> = {
  neutro: "bg-border-strong",
  primary: "bg-primary",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/** Número grande em fonte display, rótulo em caixa alta, faixa lateral de tom. */
export function KpiCard({ rotulo, valor, apoio, icone: Icone, tom = "neutro", className }: KpiCardProps) {
  return (
    <div
      className={cn(
        "bg-card border-border relative overflow-hidden rounded-lg border px-5 py-4",
        className,
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", FAIXA[tom])} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
          {rotulo}
        </p>
        {Icone && <Icone className="text-muted-foreground/70 size-4 shrink-0" aria-hidden />}
      </div>
      <p className="font-display mt-2.5 text-[27px] leading-none tracking-[-0.01em]">{valor}</p>
      {apoio && <p className="text-muted-foreground mt-2 text-[12px]">{apoio}</p>}
    </div>
  );
}
