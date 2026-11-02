// Call from the extension background so every tab uses the extension's origin.
const DATABASE_NAME = "mattermostDeck.mentionReview";
const DATABASE_VERSION = 1;
const RECORDS = "records";
const METADATA = "metadata";
let opening: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let failed = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDS)) database.createObjectStore(RECORDS);
      if (!database.objectStoreNames.contains(METADATA)) database.createObjectStore(METADATA);
    };
    request.onerror = () => {
      failed = true;
      reject(request.error ?? new Error("Could not open review database"));
    };
    request.onblocked = () => {
      failed = true;
      reject(new Error("Review database upgrade is blocked by another connection"));
    };
    request.onsuccess = () => {
      const database = request.result;
      // An open request cannot be cancelled after a blocked event. Close a
      // delayed success instead of leaking a connection from a rejected open.
      if (failed) { database.close(); return; }
      const invalidate = () => { if (opening === pending) opening = undefined; };
      database.onversionchange = () => { invalidate(); database.close(); };
      database.onclose = invalidate;
      resolve(database);
    };
  });
  opening = pending;
  void pending.catch(() => { if (opening === pending) opening = undefined; });
  return pending;
}

async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction, fail: (error: unknown) => void) => () => T,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
    let failure: unknown;
    let result: () => T;
    transaction.oncomplete = () => resolve(result());
    transaction.onerror = event => {
      failure ??= (event.target as IDBRequest | null)?.error ?? transaction.error;
    };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Review database transaction aborted"));
    const fail = (error: unknown) => {
      failure = error;
      transaction.abort();
    };
    try { result = operation(transaction, fail); }
    catch (error) { fail(error); }
  });
}

// The next lexicographic string excludes every other prefix without relying on
// a sentinel character (a stored key may itself contain \uffff).
function prefixRange(prefix: string): IDBKeyRange {
  for (let index = prefix.length - 1; index >= 0; index--) {
    const code = prefix.charCodeAt(index);
    if (code < 0xffff) {
      return IDBKeyRange.bound(prefix, prefix.slice(0, index) + String.fromCharCode(code + 1), false, true);
    }
  }
  return IDBKeyRange.lowerBound(prefix);
}

export async function readReviewRecords(prefix: string): Promise<Record<string, unknown>> {
  return transact([RECORDS], "readonly", transaction => {
    const values: Record<string, unknown> = Object.create(null);
    const request = transaction.objectStore(RECORDS).openCursor(prefixRange(prefix));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      values[cursor.key as string] = cursor.value;
      cursor.continue();
    };
    return () => values;
  });
}

export async function writeReviewRecords(sets: Record<string, unknown>, removes: string[]): Promise<void> {
  if (!Object.keys(sets).length && !removes.length) return;
  return transact([RECORDS], "readwrite", transaction => {
    const records = transaction.objectStore(RECORDS);
    for (const [key, value] of Object.entries(sets)) records.put(value, key);
    for (const key of removes) records.delete(key);
    return () => undefined;
  });
}

interface ReviewMigrationMetadata {
  version: 1;
  migrated: true;
  // Keys and fingerprints only; pending/confirmed bodies live in RECORDS.
  cleanup: Record<string, string>;
}

function migrationMetadata(value: unknown): ReviewMigrationMetadata | null {
  // Older releases wrote a boolean after completing their import. They have
  // no proven cleanup plan, so later legacy writes must be left untouched.
  if (value === true) return { version: 1, migrated: true, cleanup: {} };
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<ReviewMigrationMetadata>;
  return state.version === 1 && state.migrated === true && state.cleanup &&
    typeof state.cleanup === "object" && !Array.isArray(state.cleanup)
    ? state as ReviewMigrationMetadata : null;
}

export async function fingerprintReviewValue(value: unknown): Promise<string> {
  const serialized = JSON.stringify(value) ?? "undefined";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function isReviewMigrated(prefix: string): Promise<boolean> {
  return transact([METADATA], "readonly", transaction => {
    const request = transaction.objectStore(METADATA).get(prefix);
    return () => migrationMetadata(request.result) !== null;
  });
}

export async function readReviewMigrationCleanup(prefix: string): Promise<Record<string, string>> {
  return transact([METADATA], "readonly", transaction => {
    const request = transaction.objectStore(METADATA).get(prefix);
    return () => Object.fromEntries(Object.entries(migrationMetadata(request.result)?.cleanup ?? {})
      .filter(([key, fingerprint]) => key.startsWith(prefix) && typeof fingerprint === "string"));
  });
}

export async function completeReviewMigrationCleanup(prefix: string): Promise<void> {
  return transact([METADATA], "readwrite", transaction => {
    const metadata = transaction.objectStore(METADATA);
    const request = metadata.get(prefix);
    request.onsuccess = () => {
      const state = migrationMetadata(request.result);
      if (state && Object.keys(state.cleanup).length) metadata.put({ ...state, cleanup: {} }, prefix);
    };
    return () => undefined;
  });
}

export async function importLegacyReviewRecords(prefix: string, legacy: Record<string, unknown>): Promise<void> {
  // Hash before opening a transaction: awaiting WebCrypto inside an IndexedDB
  // transaction would let it become inactive before the imports are enqueued.
  const entries = await Promise.all(Object.entries(legacy).filter(([key]) => key.startsWith(prefix))
    .map(async ([key, value]) => ({ key, value, fingerprint: await fingerprintReviewValue(value) })));
  return transact([RECORDS, METADATA], "readwrite", (transaction, fail) => {
    const records = transaction.objectStore(RECORDS);
    const metadata = transaction.objectStore(METADATA);
    const migrated = metadata.get(prefix);
    migrated.onsuccess = () => {
      // Repeated migration must not resurrect keys removed after migration.
      if (migrationMetadata(migrated.result)) return;
      const cleanup: Record<string, string> = Object.create(null);
      let remaining = entries.length;
      const finish = () => metadata.put({ version: 1, migrated: true, cleanup } satisfies ReviewMigrationMetadata, prefix);
      if (!remaining) { finish(); return; }
      for (const entry of entries) {
        const existing = records.getKey(entry.key);
        existing.onsuccess = () => {
          try {
            // Existing decisions remain authoritative. A skipped legacy key
            // was not imported, so it is deliberately absent from cleanup.
            if (existing.result === undefined) {
              records.add(entry.value, entry.key);
              cleanup[entry.key] = entry.fingerprint;
            }
            if (--remaining === 0) finish();
          } catch (error) { fail(error); }
        };
      }
    };
    return () => undefined;
  });
}
