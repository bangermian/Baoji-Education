/**
 * 本地持久化：IndexedDB 优先，不可用时回退 localStorage。
 *
 * 目的：刷新 / 重开页面后不用再选一次文件夹。存的是"原始记录"，
 * 派生 K 线在读取时重算，因此计算口径升级后旧缓存也能自动跟上。
 */

import { STORAGE } from './config.js';

const LS_KEY = 'gaokaoshun:snapshot';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB 不可用')); return; }
    const request = indexedDB.open(STORAGE.dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORAGE.storeName)) db.createObjectStore(STORAGE.storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
  });
}

function withStore(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORAGE.storeName, mode);
    const store = tx.objectStore(STORAGE.storeName);
    let result;
    try {
      result = run(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
  });
}

/** 保存快照（字符串），失败时静默降级，不打断主流程 */
export async function saveSnapshot(payload) {
  if (!payload) return { ok: false, reason: 'empty' };
  try {
    const db = await openDatabase();
    await withStore(db, 'readwrite', (store) => store.put(payload, STORAGE.key));
    db.close();
    return { ok: true, backend: 'indexeddb' };
  } catch {
    try {
      localStorage.setItem(LS_KEY, payload);
      return { ok: true, backend: 'localstorage' };
    } catch (error) {
      return { ok: false, reason: error?.message ?? 'unknown' };
    }
  }
}

/** 读取快照；没有则返回 null */
export async function loadSnapshot() {
  try {
    const db = await openDatabase();
    // 注意：必须在创建请求的同时挂 onsuccess。
    // 传出去再挂的话，事务可能早就 complete 了，onsuccess 永远不会再触发，Promise 就卡死。
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORAGE.storeName, 'readonly');
      const request = tx.objectStore(STORAGE.storeName).get(STORAGE.key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('读取失败'));
      tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
    });
    db.close();
    if (value) return value;
  } catch {
    // 继续尝试 localStorage
  }
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

/** 清空快照 */
export async function clearSnapshot() {
  try {
    const db = await openDatabase();
    await withStore(db, 'readwrite', (store) => store.delete(STORAGE.key));
    db.close();
  } catch {
    // 忽略，继续清 localStorage
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // 忽略
  }
}
