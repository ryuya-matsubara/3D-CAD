async function access(mode, action) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open("3d-cad-model-library", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("models", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("models", mode);
      const request = action(tx.objectStore("models"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const saveEntry = entry => access("readwrite", store => store.put(entry));
export const listEntries = () => access("readonly", store => store.getAll());
