// web/src/components/time/forms/loggingScope.tsx
//
// The workspace the logging kit offers projects and For options from. The
// Time page provides it (the sidebar's workspace); elsewhere (a task's timer
// on a roadmap) nothing is provided and nothing is scoped. The rule itself
// is page/workspaceGroups.ts.

import { createContext, type ReactNode, useContext } from "react";
import type { WorkspaceScope } from "../page/workspaceGroups";

const LoggingScopeContext = createContext<WorkspaceScope | null>(null);

export function LoggingScopeProvider({
	scope,
	children,
}: {
	scope: WorkspaceScope | null;
	children: ReactNode;
}) {
	return (
		<LoggingScopeContext.Provider value={scope}>
			{children}
		</LoggingScopeContext.Provider>
	);
}

/** The provided scope, or null (unscoped). */
export function useLoggingScope(): WorkspaceScope | null {
	return useContext(LoggingScopeContext);
}
