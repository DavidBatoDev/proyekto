import { createContext, useContext, useLayoutEffect, useRef } from "react";
import type { HandlePosition, HandleRegistration, HandleType } from "./types";

/**
 * Per-node context, provided by `Flow` around every rendered node.
 *
 * Its presence is also the signal a node widget uses to tell which engine it is
 * running under: `useFlowNode()` returns null under any other renderer, which is
 * how the app's shared `Handle` port dispatches without the widgets knowing.
 */
export interface FlowNodeContextValue {
	nodeId: string;
	registerHandle: (registration: HandleRegistration) => () => void;
	/** Next registration index for this node. Monotonic, never reused. */
	nextHandleOrder: () => number;
}

export const FlowNodeContext = createContext<FlowNodeContextValue | null>(null);

export function useFlowNode(): FlowNodeContextValue | null {
	return useContext(FlowNodeContext);
}

export interface FlowHandleProps {
	type: HandleType;
	position: HandlePosition;
	id?: string;
	className?: string;
}

/**
 * An edge anchor point.
 *
 * Renders a marker element for parity with React Flow's DOM (the widgets style
 * these as `w-3 h-3 opacity-0`, so they are invisible either way) and registers
 * itself so edges can resolve which side to attach to.
 *
 * Registration happens in a LAYOUT effect: those run in DOM order within a
 * commit, which is what makes the registration index — and therefore the
 * "first registered handle of matching type" fallback — deterministic.
 *
 * Note that the marker's own position is irrelevant to geometry. Edge endpoints
 * are computed analytically from the node box, so nothing here is measured.
 */
export function FlowHandle({ type, position, id, className }: FlowHandleProps) {
	const node = useFlowNode();
	const orderRef = useRef<number | null>(null);

	if (orderRef.current === null && node) {
		orderRef.current = node.nextHandleOrder();
	}

	const registerHandle = node?.registerHandle;
	const order = orderRef.current;

	useLayoutEffect(() => {
		if (!registerHandle || order === null) return;
		return registerHandle({ id, type, position, order });
	}, [registerHandle, order, id, type, position]);

	return (
		<div
			className={className ? `flow__handle ${className}` : "flow__handle"}
			data-handle-id={id}
			data-handle-type={type}
			data-handle-position={position}
		/>
	);
}
