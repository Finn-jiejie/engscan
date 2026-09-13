'use strict';

/* 生词本：IndexedDB 持久化 + Leitner 间隔复习 + CSV 导出（Anki 兼容） */

const Vocab = (() => {
  const INTERVALS = [1, 2, 4, 8, 16]; // 天，box 0-4
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('engscan', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('words', { keyPath: 'word' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(store, mode);
          const req = fn(t.objectStore(store));
          t.oncomplete = () => resolve(req && req.result);
          t.onerror = () => reject(t.error);
        })
    );
  }

  const put = (item) => tx('words', 'readwrite', (s) => s.put(item));
  const del = (word) => tx('words', 'readwrite', (s) => s.delete(word));
  const clear = () => tx('words', 'readwrite', (s) => s.clear());
  const get = (word) => tx('words', 'readonly', (s) => s.get(word));
  const all = () => tx('words', 'readonly', (s) => s.getAll());

  async function has(word) {
    const r = await get(word);
    return Boolean(r);
  }

  async function toggle(item) {
    const existing = await get(item.word);
    if (existing) {
      await del(item.word);
      return false;
    }
    await put({
      word: item.word,
      phonetic: item.phonetic || '',
      meaning: item.meaning || '',
      addedAt: Date.now(),
      lastReviewAt: 0,
      box: 0,
    });
    return true;
  }

  function isDue(item) {
    if (!item.box) return true; // 新词立即进入复习
    const interval = INTERVALS[Math.min(item.box, INTERVALS.length - 1)] * 86400000;
    return Date.now() - (item.lastReviewAt || item.addedAt) >= interval;
  }

  async function review(word, known) {
    const item = await get(word);
    if (!item) return;
    item.box = known ? Math.min(item.box + 1, INTERVALS.length - 1) : 0;
    item.lastReviewAt = Date.now();
    await put(item);
  }

  function toCSV(items) {
    const esc = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
    const rows = [['front', 'back', 'tags']];
    items.forEach((it) => {
      const front = [it.word, it.phonetic].filter(Boolean).join(' ');
      const back = it.meaning || '';
      rows.push([esc(front), esc(back), esc('engscan')]);
    });
    return '\uFEFF' + rows.map((r) => r.join(',')).join('\r\n');
  }

  function downloadCSV(items) {
    const blob = new Blob([toCSV(items)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'engscan-vocab.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return { toggle, has, del, clear, all, isDue, review, toCSV, downloadCSV };
})();
