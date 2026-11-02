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
  operation: (transaction: IDBTransaction) => () => T,
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
    try { result = operation(transaction); }
    catch (error) {
      failure = error;
      transaction.abort();
    }
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

export async function isReviewMigrated(prefix: string): Promise<boolean> {
  return transact([METADATA], "readonly", transaction => {
    const request = transaction.objectStore(METADATA).get(prefix);
    return () => request.result === true;
  });
}

export async function importLegacyReviewRecords(prefix: string, legacy: Record<string, unknown>): Promise<void> {
  return transact([RECORDS, METADATA], "readwrite", transaction => {
    const records = transaction.objectStore(RECORDS);
    const metadata = transaction.objectStore(METADATA);
    const migrated = metadata.get(prefix);
    migrated.onsuccess = () => {
      // Repeated migration must not resurrect keys removed after migration.
      if (migrated.result === true) return;
      for (const [key, value] of Object.entries(legacy)) {
        if (!key.startsWith(prefix)) continue;
        const existing = records.getKey(key);
        existing.onsuccess = () => {
          // Preserve newer decisions already written to the destination,
          // including a deliberately stored undefined value.
          if (existing.result === undefined) records.add(value, key);
        };
      }
      // This marker and every imported record commit together. Callers can
      // remove legacy storage only after this function's promise resolves.
      metadata.put(true, prefix);
    };
    return () => undefined;
  });
}
