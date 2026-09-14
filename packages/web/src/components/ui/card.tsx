import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-card border-border rounded-lg border",
        "shadow-[0_1px_0_rgba(23,32,28,0.03)]",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "border-border flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, children, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3 className={cn("text-base leading-tight", className)} {...props}>
      {children}
    </h3>
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-muted-foreground text-[13px]", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("border-border flex items-center gap-3 border-t px-5 py-3", className)}
      {...props}
    />
  );
}

/** Rótulo de seção: caixa alta, pequeno, discreto. */
function SectionLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, SectionLabel };
