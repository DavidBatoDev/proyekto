import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { retryUnlessAccessDenied } from "@/lib/apiErrors";

export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30 * 1000,
				refetchOnWindowFocus: false,
				refetchOnReconnect: true,
				refetchOnMount: false,
				// TanStack's default is three retries for everything. A 401/403/404 is
				// an answer, not a blip: retrying it only holds a spinner up for
				// seconds before the page can say "no access".
				retry: retryUnlessAccessDenied(3),
			},
		},
	});
	return {
		queryClient,
	};
}

export function Provider({
	children,
	queryClient,
}: {
	children: React.ReactNode;
	queryClient: QueryClient;
}) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
