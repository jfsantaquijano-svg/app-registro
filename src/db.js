// IndexedDB: un almacén clave → valor. Cada sección de los datos se guarda en su propia clave.
const NOMBRE = 'app-registro';
const VERSION = 1;
const ALMACEN = 'datos';

let _db = null;

export function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN);
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => {
        _db.close();
        _db = null;
      };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(modo, fn) {
  return abrir().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(ALMACEN, modo);
        const st = t.objectStore(ALMACEN);
        let res;
        Promise.resolve(fn(st, (r) => (res = r))).catch(reject);
        t.oncomplete = () => resolve(res);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export function leerTodo() {
  return tx('readonly', (st, fin) => {
    const out = {};
    const req = st.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        out[c.key] = c.value;
        c.continue();
      } else fin(out);
    };
  });
}

export function leer(clave) {
  return tx('readonly', (st, fin) => {
    const req = st.get(clave);
    req.onsuccess = () => fin(req.result);
  });
}

/** Guarda varias claves en una sola transacción. */
export function guardarVarias(obj) {
  return tx('readwrite', (st) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) st.delete(k);
      else st.put(v, k);
    }
  });
}

export function borrar(clave) {
  return tx('readwrite', (st) => st.delete(clave));
}

export function borrarTodo() {
  return tx('readwrite', (st) => st.clear());
}

/** Pide que el navegador no borre los datos por falta de espacio. */
export async function pedirPersistencia() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
