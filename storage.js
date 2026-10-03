/* VARE — lokale Chronik in IndexedDB (nur Browser). Nichts verlässt das Gerät.
   Datenbank „vare“, Version 1. Läden: takes (Zusammenfassung), series (Rahmenverlauf als typisierte
   Arrays), audio (WAV-Blob), calibrations, meta (refs, settings, nextCode).
   Achtung: IndexedDB gehört zur Adresse (Origin). Was unter localhost:8000 aufgenommen wurde, ist
   unter github.io nicht sichtbar — Übertragung per JSON-Sicherung. */
(function (root) {
  'use strict';
  var DB_NAME = 'vare', DB_VERSION = 1, dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    // Ein gescheiterter Versuch darf nicht für die ganze Sitzung gemerkt werden: sonst bleibt die
    // Chronik auch dann unerreichbar, wenn die Ursache (zweite Registerkarte, kurzer Engpass)
    // längst weg ist. Bei Fehlschlag wird der Zwischenspeicher geleert.
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('IndexedDB nicht verfügbar')); return; }
      var req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = req.result, old = ev.oldVersion || 0;
        if (old < 1) {
          var takes = db.createObjectStore('takes', { keyPath: 'id' });
          takes.createIndex('createdAt', 'createdAt'); takes.createIndex('code', 'code');
          db.createObjectStore('series', { keyPath: 'takeId' });
          db.createObjectStore('audio', { keyPath: 'takeId' });
          var cal = db.createObjectStore('calibrations', { keyPath: 'id' });
          cal.createIndex('createdAt', 'createdAt');
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB konnte nicht geöffnet werden')); };
      req.onblocked = function () { reject(new Error('IndexedDB blockiert (andere Registerkarte offen?)')); };
    });
    dbPromise = dbPromise.catch(function (e) { dbPromise = null; throw e; });
    return dbPromise;
  }

  function tx(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(stores, mode), result;
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Transaktion abgebrochen')); };
        result = fn(t);
      });
    });
  }
  function reqToPromise(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }
  function get(store, key) { return open().then(function (db) { return reqToPromise(db.transaction(store, 'readonly').objectStore(store).get(key)); }); }
  function getAll(store) { return open().then(function (db) { return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll()); }); }
  function put(store, value) { return tx([store], 'readwrite', function (t) { t.objectStore(store).put(value); }); }
  function del(store, key) { return tx([store], 'readwrite', function (t) { t.objectStore(store).delete(key); }); }

  var api = {
    open: open,
    putTake: function (take) { return put('takes', take); },
    getTake: function (id) { return get('takes', id); },
    allTakes: function () { return getAll('takes').then(function (a) { a.sort(function (x, y) { return (y.createdAt || '').localeCompare(x.createdAt || ''); }); return a; }); },
    deleteTake: function (id) { return tx(['takes', 'series', 'audio'], 'readwrite', function (t) { t.objectStore('takes').delete(id); t.objectStore('series').delete(id); t.objectStore('audio').delete(id); }); },
    putSeries: function (takeId, series) { var v = { takeId: takeId }; for (var k in series) v[k] = series[k]; return put('series', v); },
    getSeries: function (takeId) { return get('series', takeId).then(function (v) { if (!v) return null; delete v.takeId; return v; }); },
    putAudio: function (takeId, sampleRate, format, blob) { return put('audio', { takeId: takeId, sampleRate: sampleRate, format: format, blob: blob, bytes: blob.size }); },
    getAudio: function (takeId) { return get('audio', takeId); },
    deleteAudio: function (takeId) { return del('audio', takeId); },
    hasAudio: function (takeId) { return open().then(function (db) { return reqToPromise(db.transaction('audio', 'readonly').objectStore('audio').getKey(takeId)); }).then(function (k) { return k != null; }); },
    audioIds: function () { return open().then(function (db) { return reqToPromise(db.transaction('audio', 'readonly').objectStore('audio').getAllKeys()); }); },
    putCalibration: function (c) { return put('calibrations', c); },
    allCalibrations: function () { return getAll('calibrations').then(function (a) { a.sort(function (x, y) { return (y.createdAt || '').localeCompare(x.createdAt || ''); }); return a; }); },
    deleteCalibration: function (id) { return del('calibrations', id); },
    getMeta: function (key, fallback) { return get('meta', key).then(function (v) { return v ? v.value : fallback; }); },
    setMeta: function (key, value) { return put('meta', { key: key, value: value }); },
    clearAll: function () { return tx(['takes', 'series', 'audio', 'calibrations', 'meta'], 'readwrite', function (t) { ['takes', 'series', 'audio', 'calibrations', 'meta'].forEach(function (s) { t.objectStore(s).clear(); }); }); },
    estimate: function () { return (root.navigator && navigator.storage && navigator.storage.estimate) ? navigator.storage.estimate() : Promise.resolve(null); },
    persist: function () { return (root.navigator && navigator.storage && navigator.storage.persist) ? navigator.storage.persist() : Promise.resolve(false); },
    persisted: function () { return (root.navigator && navigator.storage && navigator.storage.persisted) ? navigator.storage.persisted() : Promise.resolve(false); }
  };
  root.VARESTORE = api;
})(typeof self !== 'undefined' ? self : this);
