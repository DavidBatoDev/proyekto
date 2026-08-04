export type TransactionType =
	| "deposit"
	| "withdrawal"
	| "escrow_lock"
	| "escrow_release"
	| "escrow_refund"
	| "platform_fee"
	| "consultant_fee"
	| "freelancer_payout";

export type PaymentStatus =
	| "pending"
	| "funded"
	| "in_escrow"
	| "released"
	| "refunded"
	| "disputed"
	| "completed";

export interface Wallet {
	id: string;
	user_id: string;
	available_balance: number;
	escrow_balance: number;
	currency: string;
	created_at: string;
	updated_at: string;
}

export interface Transaction {
	id: string;
	wallet_id: string;
	project_id: string | null;
	checkpoint_id: string | null;
	amount: number;
	type: TransactionType;
	description: string | null;
	metadata: Record<string, any>;
	created_at: string;
	// Expanded fields from relations
	project?: {
		id: string;
		title: string;
	};
	checkpoint?: {
		id: string;
		description: string | null;
	};
}

export interface WalletBalance {
	available: number;
	escrow: number;
	total: number;
	currency: string;
}

export interface FundEscrowResult {
	success: boolean;
	checkpoint_id: string;
	amount_locked: number;
	new_available_balance: number;
	new_escrow_balance: number;
}

export interface RefundEscrowResult {
	success: boolean;
	checkpoint_id: string;
	refunded_amount: number;
	new_available_balance: number;
	new_escrow_balance: number;
}

export interface TransactionFilters {
	type?: TransactionType;
	projectId?: string;
	limit?: number;
	offset?: number;
}
