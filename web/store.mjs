import { StoreBase } from '../src/store-base.mjs';
export class SQLDatabase {
  constructor(database) { this.database = database; }
  exec(sql) { return this.database.exec(sql); }
  prepare(sql) {
    const database = this.database;
    function rows(args) {
      const statement = database.prepare(sql);
      try { statement.bind(args); const result = []; while (statement.step()) result.push(statement.getAsObject()); return result; }
      finally { statement.free(); }
    }
    return { run(...args) { database.run(sql, args); return { changes: database.getRowsModified() }; },
      get(...args) { return rows(args)[0]; }, all(...args) { return rows(args); } };
  }
  export() { return this.database.export(); }
  close() { this.database.close(); }
}
export class BrowserStore extends StoreBase {
  constructor(SQL, bytes) { super(new SQLDatabase(new SQL.Database(bytes))); }
  snapshot() { return this.db.export(); }
}

export async function openVault(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) throw new Error('This browser cannot retain learning. Enable website storage and reload.');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('napkin-next-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    async read() {
      return new Promise((resolve, reject) => {
        const request = database.transaction('state').objectStore('state').get('knowledge');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    },
    async write(bytes) {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('state', 'readwrite');
        transaction.objectStore('state').put(bytes, 'knowledge');
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Saving was interrupted'));
      });
    }
  };
}
