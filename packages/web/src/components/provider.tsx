import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessaoProvider } from "./sessao";
import { ToastProvider } from "./ui/toast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function Provider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessaoProvider>
        <ToastProvider>{children}</ToastProvider>
      </SessaoProvider>
    </QueryClientProvider>
  );
}
