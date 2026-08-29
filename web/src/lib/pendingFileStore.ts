/**
 * Files an author has attached to a brief that does not exist yet.
 *
 * A brief is only written to the database when the author saves or publishes
 * it, so the bytes of anything they attach before that have nowhere to live on
 * the server. They live here instead — in IndexedDB, because a `Blob` cannot be
 * put in `sessionStorage` — and are uploaded to R2 as part of the save.
 *
 * This is the repo's only IndexedDB use. It stays deliberately small: no schema
 * migrations, no indexes, one object store keyed by a generated id. Every call
 * resolves rather than rejects when storage is unavailable (private browsing,
 * a blocked upgrade, a quota refusal); the cost of that is "your attachments do
 * not survive a refresh", which is a far better outcome than an editor that
 * throws when you pick a file.
 */

const DB_NAME = "proyekto";
const DB_VERSION = 1;
const STORE = "pending_brief_files";

/** A week is long past the point where an abandoned draft is coming back. */
export const PENDING_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** What is written to IndexedDB. */
interface StoredPendingFile {
	id: string;
	name: string;
	type: string;
	size: number;
	blob: Blob;
	createdAt: string;
}

/**
 * What callers get back. `file` is reconstructed from the blob rather than
 * stored as one: a `File` round-tripped through IndexedDB comes back as a bare
 * `Blob` in some engines and loses its name, and the uploader needs the name.
 */
export interface PendingFile {
	id: string;
	name: string;
	type: string;
	size: number;
	file: File;
	createdAt: string;
}

function toPendingFile(stored: StoredPendingFile): PendingFile {
	return {
		id: stored.id,
		name: stored.name,
		type: stored.type,
		size: stored.size,
		file: new File([stored.blob], stored.name, { type: stored.type }),
		createdAt: stored.createdAt,
	};
}

function openDb(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		if (typeof indexedDB === "undefined") {
			resolve(null);
			return;
		}
		let request: IDBOpenDBRequest;
		try {
			request = indexedDB.open(DB_NAME, DB_VERSION);
		} catch {
			resolve(null);
			return;
		}
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: "id" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		// Another tab holding an old version open blocks the upgrade forever;
		// giving up is better than hanging the picker.
		request.onblocked = () => resolve(null);
	});
}

async function withStore<T>(
	mode: IDBTransactionMode,
	fallback: T,
	run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
	const db = await openDb();
	if (!db) return fallback;
	try {
		return await new Promise<T>((resolve) => {
			const tx = db.transaction(STORE, mode);
			const request = run(tx.objectStore(STORE));
			request.onsuccess = () => resolve(request.result as T);
			request.onerror = () => resolve(fallback);
			tx.onabort = () => resolve(fallback);
		});
	} catch {
		return fallback;
	} finally {
		db.close();
	}
}

export async function putPendingFile(file: File): Promise<PendingFile> {
	const record: StoredPendingFile = {
		id: crypto.randomUUID(),
		name: file.name,
		type: file.type,
		size: file.size,
		blob: file,
		createdAt: new Date().toISOString(),
	};
	await withStore<unknown>("readwrite", null, (store) => store.put(record));
	return toPendingFile(record);
}

/**
 * Read back the files a stored draft still claims, in the order it claims them.
 * Ids with no record — cleared storage, a pruned entry — are simply dropped, so
 * the caller can trust the result and rewrite its id list from it.
 */
export async function listPendingFiles(ids: string[]): Promise<PendingFile[]> {
	if (ids.length === 0) return [];
	const all = await withStore<StoredPendingFile[]>("readonly", [], (store) =>
		store.getAll(),
	);
	const byId = new Map(all.map((entry) => [entry.id, entry]));
	return ids
		.map((id) => byId.get(id))
		.filter((entry): entry is StoredPendingFile => entry !== undefined)
		.map(toPendingFile);
}

export async function deletePendingFile(id: string): Promise<void> {
	await withStore<unknown>("readwrite", null, (store) => store.delete(id));
}

/** Drop anything older than `maxAge`, left behind by a draft nobody saved. */
export async function prunePendingFiles(
	maxAge = PENDING_FILE_MAX_AGE_MS,
): Promise<void> {
	const all = await withStore<StoredPendingFile[]>("readonly", [], (store) =>
		store.getAll(),
	);
	const cutoff = Date.now() - maxAge;
	for (const entry of all) {
		if (Date.parse(entry.createdAt) < cutoff) {
			await deletePendingFile(entry.id);
		}
	}
}
