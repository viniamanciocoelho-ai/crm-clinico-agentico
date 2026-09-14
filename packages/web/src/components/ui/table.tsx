import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        "[&_th]:text-muted-foreground border-border border-b",
        "[&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:tracking-[0.1em] [&_th]:whitespace-nowrap [&_th]:uppercase",
        className,
      )}
      {...props}
    />
  );
}

function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn(
        "[&_tr]:border-border [&_tr:last-child]:border-0 [&_tr]:border-b",
        "[&_td]:px-4 [&_td]:py-3 [&_td]:align-middle",
        className,
      )}
      {...props}
    />
  );
}

function TRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-muted/60 transition-colors", className)} {...props} />;
}

export { Table, THead, TBody, TRow };
