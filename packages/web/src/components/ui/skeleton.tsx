import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-border/70 animate-pulse rounded-md", className)}
      aria-hidden
      {...props}
    />
  );
}

/** Skeleton com a forma de uma tabela, para não colapsar o layout ao carregar. */
function SkeletonTabela({ linhas = 6, colunas = 4 }: { linhas?: number; colunas?: number }) {
  return (
    <output className="block space-y-2 p-5" aria-label="Carregando dados">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: colunas }).map((_, j) => (
            <Skeleton
              key={j}
              className="h-5 flex-1"
              style={{ opacity: 1 - i * 0.1, maxWidth: j === 0 ? "28%" : undefined }}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Carregando…</span>
    </output>
  );
}

function SkeletonCards({ quantidade = 4 }: { quantidade?: number }) {
  return (
    <output className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Carregando indicadores">
      {Array.from({ length: quantidade }).map((_, i) => (
        <div key={i} className="border-border bg-card rounded-lg border p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-8 w-32" />
          <Skeleton className="mt-3 h-3 w-20" />
        </div>
      ))}
    </output>
  );
}

export { Skeleton, SkeletonTabela, SkeletonCards };
