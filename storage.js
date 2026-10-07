/* VARE — lokale Chronik in IndexedDB (nur Browser). Nichts verlässt das Gerät.
   Datenbank „vare“, Version 2. Läden: takes (Zusammenfassung), series (Rahmenverlauf als typisierte
   Arrays), audio (WAV-Blob), calibrations, meta (refs, settings, nextCode, sitzung), pending (Angaben
   zu Aufnahmen, deren Analyse noch nicht gespeichert ist; ihr WAV liegt unter derselben Kennung in audio).
   Achtung: IndexedDB gehört zur Adresse (Origin). Was unter localhost:8000 aufgenommen wurde, ist
   unter github.io nicht sichtbar — Übertragung per JSON-Sicherung. */
(function (root) {
  'use strict';
  var DB_NAME = 'vare', DB_VERSION = 2, dbPromise = null;

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
        /* Version 2: Eine Aufnahme wird vor ihrer Analyse gesichert (app.js finishTake). Bis dahin lag sie
           minutenlang nur im Arbeitsspeicher, und Neuladen oder Schließen verwarf sie ohne Rückfrage. */
        if (old < 2) db.createObjectStore('pending', { keyPath: 'id' });
      };
      req.onsuccess = function () {
        var db = req.result;
        // Öffnet eine neuere Fassung der Seite die Datenbank, gibt diese sie frei, statt das Umstellen zu blockieren.
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
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
  function serieZeile(takeId, series) { var v = { takeId: takeId }; for (var k in series) v[k] = series[k]; return v; }
  function audioZeile(takeId, a) { return { takeId: takeId, sampleRate: a.sampleRate, format: a.format, blob: a.blob, bytes: a.blob.size }; }
  /* Lesen, ändern, schreiben in EINER Transaktion: Was zwischen Lesen und Schreiben ein anderer Teil der
     Seite geschrieben hat (Neu-Analyse, Notiz im Detail), kann so nicht still überschrieben werden —
     Schreibtransaktionen auf denselben Laden laufen nacheinander. fn(take) muss synchron sein und den
     Take zurückgeben; wirft sie, bleibt alles, wie es war. Liefert den geschriebenen Take, null, wenn es
     ihn nicht (mehr) gibt. Mit series wird der Rahmenverlauf in derselben Transaktion ersetzt. */
  function aendern(id, fn, series) {
    var neu = null, fehler = null;
    return tx(series ? ['takes', 'series'] : ['takes'], 'readwrite', function (t) {
      var req = t.objectStore('takes').get(id);
      req.onsuccess = function () {
        if (!req.result) return;
        try { neu = fn(req.result); } catch (e) { fehler = e; t.abort(); return; }
        t.objectStore('takes').put(neu);
        if (series) t.objectStore('series').put(serieZeile(id, series));
      };
    }).then(function () { return neu; }, function (e) { throw fehler || e; });
  }

  var api = {
    open: open,
    putTake: function (take) { return put('takes', take); },
    getTake: function (id) { return get('takes', id); },
    allTakes: function () { return getAll('takes').then(function (a) { a.sort(function (x, y) { return (y.createdAt || '').localeCompare(x.createdAt || ''); }); return a; }); },
    deleteTake: function (id) { return tx(['takes', 'series', 'audio'], 'readwrite', function (t) { t.objectStore('takes').delete(id); t.objectStore('series').delete(id); t.objectStore('audio').delete(id); }); },
    putSeries: function (takeId, series) { return put('series', serieZeile(takeId, series)); },
    /* Take und Rahmenverlauf in EINER Transaktion. Getrennt geschrieben, stand nach einem Abbruch dazwischen
       (Seite geschlossen, Speicher voll) eine neue Zusammenfassung neben dem alten oder keinem Verlauf.
       extra gehört in dieselbe Transaktion: audio = { sampleRate, format, blob } (WAV dazu), audioLoeschen
       (vorab gesichertes WAV entfernen, wenn kein Audio gespeichert werden soll), offenErledigt (die Angaben
       der vorab gesicherten Aufnahme in pending entfernen — ab jetzt steht der Take in der Chronik). */
    putTakeSeries: function (take, series, extra) {
      extra = extra || {};
      var laeden = ['takes', 'series'];
      if (extra.audio || extra.audioLoeschen) laeden.push('audio');
      if (extra.offenErledigt) laeden.push('pending');
      return tx(laeden, 'readwrite', function (t) {
        t.objectStore('takes').put(take);
        if (series) t.objectStore('series').put(serieZeile(take.id, series));
        if (extra.audio) t.objectStore('audio').put(audioZeile(take.id, extra.audio));
        else if (extra.audioLoeschen) t.objectStore('audio').delete(take.id);
        if (extra.offenErledigt) t.objectStore('pending').delete(take.id);
      });
    },
    updateTake: function (id, fn) { return aendern(id, fn, null); },
    updateTakeSeries: function (id, fn, series) { return aendern(id, fn, series); },
    /* Aufnahme vor der Analyse: Angaben (rec.id = künftige Take-Kennung) und WAV in einer Transaktion —
       nie das eine ohne das andere. deletePending verwirft beides. */
    putPending: function (rec, audio) { return tx(['pending', 'audio'], 'readwrite', function (t) { t.objectStore('pending').put(rec); t.objectStore('audio').put(audioZeile(rec.id, audio)); }); },
    allPending: function () { return getAll('pending'); },
    deletePending: function (id) { return tx(['pending', 'audio'], 'readwrite', function (t) { t.objectStore('pending').delete(id); t.objectStore('audio').delete(id); }); },
    getSeries: function (takeId) { return get('series', takeId).then(function (v) { if (!v) return null; delete v.takeId; return v; }); },
    putAudio: function (takeId, sampleRate, format, blob) { return put('audio', audioZeile(takeId, { sampleRate: sampleRate, format: format, blob: blob })); },
    getAudio: function (takeId) { return get('audio', takeId); },
    deleteAudio: function (takeId) { return del('audio', takeId); },
    hasAudio: function (takeId) { return open().then(function (db) { return reqToPromise(db.transaction('audio', 'readonly').objectStore('audio').getKey(takeId)); }).then(function (k) { return k != null; }); },
    audioIds: function () { return open().then(function (db) { return reqToPromise(db.transaction('audio', 'readonly').objectStore('audio').getAllKeys()); }); },
    putCalibration: function (c) { return put('calibrations', c); },
    allCalibrations: function () { return getAll('calibrations').then(function (a) { a.sort(function (x, y) { return (y.createdAt || '').localeCompare(x.createdAt || ''); }); return a; }); },
    deleteCalibration: function (id) { return del('calibrations', id); },
    getMeta: function (key, fallback) { return get('meta', key).then(function (v) { return v ? v.value : fallback; }); },
    setMeta: function (key, value) { return put('meta', { key: key, value: value }); },
    /* Leert alle Läden. Was in metaBehalten steht ({Schlüssel: Wert}), wird in DERSELBEN Transaktion
       zurückgeschrieben: schließt jemand die Seite mitten im Löschen, ist entweder nichts gelöscht
       oder der Code-Zähler schon wieder da — nie ein leerer Zähler neben einer leeren Chronik. */
    clearAll: function (metaBehalten) {
      var alle = ['takes', 'series', 'audio', 'calibrations', 'meta', 'pending'];
      return tx(alle, 'readwrite', function (t) {
        alle.forEach(function (s) { t.objectStore(s).clear(); });
        for (var k in (metaBehalten || {})) if (metaBehalten[k] !== undefined) t.objectStore('meta').put({ key: k, value: metaBehalten[k] });
      });
    },
    estimate: function () { return (root.navigator && navigator.storage && navigator.storage.estimate) ? navigator.storage.estimate() : Promise.resolve(null); },
    persist: function () { return (root.navigator && navigator.storage && navigator.storage.persist) ? navigator.storage.persist() : Promise.resolve(false); },
    persisted: function () { return (root.navigator && navigator.storage && navigator.storage.persisted) ? navigator.storage.persisted() : Promise.resolve(false); }
  };
  root.VARESTORE = api;
})(typeof self !== 'undefined' ? self : this);
