"use client";

export const P5_FORMAL_SET_MANIFEST_VERSION = "formal-yellow-12.v1";
const DB_NAME = "icb-parts-ocr-p5-formal-set";
const DB_VERSION = 1;
const STORE_NAME = "formal-images";

type StoredFormalImage = {
  manifestVersion: string;
  imageId: string;
  safeImageFingerprint: string;
  filename: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  blob: Blob;
  selectionOrder: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "imageId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb open failed"));
  });
}

export async function saveFormalSet(records: StoredFormalImage[]) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      for (const record of records) store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb save failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexeddb save aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadFormalSet(): Promise<StoredFormalImage[]> {
  const db = await openDb();
  try {
    return await new Promise<StoredFormalImage[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as StoredFormalImage[]).sort((a, b) => a.selectionOrder - b.selectionOrder));
      request.onerror = () => reject(request.error ?? new Error("indexeddb read failed"));
    });
  } finally {
    db.close();
  }
}

export async function clearFormalSet() {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb clear failed"));
    });
  } finally {
    db.close();
  }
}
