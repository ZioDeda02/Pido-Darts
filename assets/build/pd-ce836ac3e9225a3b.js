(() => {
'use strict';
const IMAGE_PREFIX = /^data:image\/(png|jpeg|webp);base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function safeHex(value, fallback = '#20d868') {
const text = String(value || '').trim();
return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}
function hasRasterSignature(mime, body) {
try {
if (!body || body.length % 4 !== 0) return false;
const headLength = Math.min(body.length, 32);
const head = atob(body.slice(0, headLength));
const b = index => head.charCodeAt(index) & 255;
if (mime === 'png') {
return head.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47
&& b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a;
}
if (mime === 'jpeg') return head.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
if (mime === 'webp') {
return head.length >= 12 && head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
}
return false;
} catch (_) {
return false;
}
}
function safeImageDataUrl(value, maxChars = 3_000_000) {
if (typeof value !== 'string' || !value || value.length > maxChars) return '';
const match = IMAGE_PREFIX.exec(value);
if (!match || match.index !== 0) return '';
const body = value.slice(match[0].length);
if (!body || !BASE64_BODY.test(body) || !hasRasterSignature(match[1].toLowerCase(), body)) return '';
return value;
}
function cssImageUrl(value, maxChars = 3_000_000) {
const safe = safeImageDataUrl(value, maxChars);
return safe ? `url("${safe}")` : '';
}
function safeDisplayName(value, maxLength = 80, fallback = 'Giocatore') {
const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
if (!text) return fallback;
return text.slice(0, maxLength);
}
function validatePlainData(value, options = {}) {
const limits = {
maxDepth: Number(options.maxDepth) || 24,
maxArrayLength: Number(options.maxArrayLength) || 50_000,
maxObjectKeys: Number(options.maxObjectKeys) || 256,
maxStringLength: Number(options.maxStringLength) || 20_000,
maxNodes: Number(options.maxNodes) || 250_000,
maxImageChars: Number(options.maxImageChars) || 3_000_000
};
const state = { nodes: 0 };
function visit(node, path, depth) {
state.nodes += 1;
if (state.nodes > limits.maxNodes) throw new Error('Il backup contiene troppi elementi.');
if (depth > limits.maxDepth) throw new Error('Il backup contiene dati annidati in modo anomalo.');
if (node === null || typeof node === 'boolean') return node;
if (typeof node === 'number') {
if (!Number.isFinite(node)) throw new Error('Il backup contiene un numero non valido.');
return node;
}
if (typeof node === 'string') {
const key = String(path.at(-1) || '');
if (key === 'customBgImage') {
if (node && !safeImageDataUrl(node, limits.maxImageChars)) throw new Error('Il backup contiene uno sfondo immagine non valido.');
return node;
}
if (key === 'avatarValue' && node.startsWith('data:')) {
if (!safeImageDataUrl(node, limits.maxImageChars)) throw new Error('Il backup contiene un avatar immagine non valido.');
return node;
}
if (/(?:^|_)(?:id|name)$/i.test(key) || /(?:Id|Name)$/.test(key)) {
if (node.length > 256) throw new Error(`Il campo ${key} è troppo lungo.`);
return node;
}
if (node.length > limits.maxStringLength) throw new Error(`Il campo ${key || 'testo'} è troppo lungo.`);
return node;
}
if (Array.isArray(node)) {
if (node.length > limits.maxArrayLength) throw new Error('Il backup contiene una lista troppo grande.');
return node.map((item, index) => visit(item, [...path, String(index)], depth + 1));
}
if (typeof node === 'object') {
const proto = Object.getPrototypeOf(node);
if (proto !== Object.prototype && proto !== null) throw new Error('Il backup contiene un oggetto non valido.');
const keys = Object.keys(node);
if (keys.length > limits.maxObjectKeys) throw new Error('Il backup contiene un oggetto con troppi campi.');
const out = {};
for (const key of keys) {
if (BLOCKED_OBJECT_KEYS.has(key)) throw new Error('Il backup contiene una chiave non consentita.');
out[key] = visit(node[key], [...path, key], depth + 1);
}
return out;
}
throw new Error('Il backup contiene un tipo di dato non supportato.');
}
return visit(value, [], 0);
}
function validatePlayerLike(player, { strictName = false } = {}) {
if (!player || typeof player !== 'object') throw new Error('Profilo giocatore non valido nel backup.');
if (typeof player.id !== 'string' || !player.id || player.id.length > 256) throw new Error('Identificativo giocatore non valido nel backup.');
if (typeof player.name !== 'string') throw new Error('Nome giocatore non valido nel backup.');
const name = player.name.trim().replace(/\s+/g, ' ');
if (!name || name.length > (strictName ? 24 : 80)) throw new Error('Nome giocatore non valido nel backup.');
if (player.color != null && safeHex(player.color, '') === '') throw new Error('Colore giocatore non valido nel backup.');
const type = player.avatarType || 'initials';
if (!['initials', 'emoji', 'image'].includes(type)) throw new Error('Tipo avatar non valido nel backup.');
if (type === 'image') {
if (!safeImageDataUrl(player.avatarValue, 2_000_000)) throw new Error('Avatar immagine non valido nel backup.');
} else if (type === 'emoji' && String(player.avatarValue || '').length > 32) {
throw new Error('Avatar emoji non valido nel backup.');
}
return true;
}
window.PidoDartsSecurity = {
safeHex,
safeImageDataUrl,
cssImageUrl,
safeDisplayName,
validatePlainData,
validatePlayerLike
};
})();

;
(() => {
const security = window.PidoDartsSecurity;
const STORAGE_KEY = 'pido-darts-appearance';
const LEGACY_KEY = 'darts-v01-appearance';
const defaults = {
theme: 'green',
customAccent: '#20d868',
customBg: '#030605',
customText: '#f2fff6',
backgroundMode: 'image',
customBgImage: '',
bgIntensity: 24,
animations: true,
mobileLayout: 'app',
navBehavior: 'auto',
uiScale: 'normal',
highContrast: false
};
function normalize(value, allowed, fallback) {
return allowed.includes(value) ? value : fallback;
}
function normalizeColor(value, fallback) {
return security?.safeHex ? security.safeHex(value, fallback) : (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback);
}
function normalizeImage(value) {
if (!value) return '';
return security?.safeImageDataUrl ? security.safeImageDataUrl(value, 3_000_000) : '';
}
function normalizeSettings(saved = {}) {
const source = saved && typeof saved === 'object' ? saved : {};
const settings = { ...defaults };
settings.theme = normalize(source.theme, ['green', 'blue', 'red', 'purple', 'light', 'custom'], defaults.theme);
settings.customAccent = normalizeColor(source.customAccent, defaults.customAccent);
settings.customBg = normalizeColor(source.customBg, defaults.customBg);
settings.customText = normalizeColor(source.customText, defaults.customText);
settings.backgroundMode = normalize(source.backgroundMode, ['image', 'gradient', 'solid', 'custom'], defaults.backgroundMode);
settings.customBgImage = normalizeImage(source.customBgImage);
settings.mobileLayout = normalize(source.mobileLayout, ['app', 'site'], defaults.mobileLayout);
settings.navBehavior = normalize(source.navBehavior, ['auto', 'always', 'manual'], defaults.navBehavior);
settings.uiScale = normalize(source.uiScale, ['compact', 'normal', 'large'], defaults.uiScale);
settings.highContrast = Boolean(source.highContrast);
settings.animations = source.animations !== false;
settings.bgIntensity = Math.max(0, Math.min(70, Number(source.bgIntensity) || defaults.bgIntensity));
return settings;
}
function load() {
try {
const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY) || '{}';
const saved = JSON.parse(raw);
const settings = normalizeSettings(saved);
if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
return settings;
} catch {
return { ...defaults };
}
}
function save(settings) {
const normalized = normalizeSettings(settings);
try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); }
catch (_) {  }
}
function apply(settings) {
settings = normalizeSettings(settings);
const root = document.documentElement;
root.dataset.theme = settings.theme;
root.dataset.mobileLayout = settings.mobileLayout || defaults.mobileLayout;
root.dataset.navBehavior = settings.navBehavior || defaults.navBehavior;
root.dataset.uiScale = settings.uiScale || defaults.uiScale;
const effectiveBackground = settings.backgroundMode === 'custom' && !settings.customBgImage ? 'gradient' : settings.backgroundMode;
root.dataset.background = effectiveBackground || defaults.backgroundMode;
root.style.setProperty('--bg-opacity', String(settings.bgIntensity / 100));
root.style.setProperty('--custom-accent', settings.customAccent || defaults.customAccent);
root.style.setProperty('--custom-bg', settings.customBg || defaults.customBg);
root.style.setProperty('--custom-text', settings.customText || defaults.customText);
if (settings.customBgImage) root.style.setProperty('--custom-bg-image', security?.cssImageUrl ? security.cssImageUrl(settings.customBgImage, 3_000_000) : '');
else root.style.removeProperty('--custom-bg-image');
root.classList.toggle('no-animations', !settings.animations);
root.classList.toggle('high-contrast', Boolean(settings.highContrast));
const metaTheme = document.querySelector('meta[name="theme-color"]');
if (metaTheme) {
if (settings.theme === 'light') metaTheme.content = '#eef4ef';
else if (settings.theme === 'custom') metaTheme.content = settings.customBg || defaults.customBg;
else metaTheme.content = '#06110b';
}
document.dispatchEvent(new CustomEvent('pido:appearancesettings', { detail: { ...settings } }));
}
window.DartsAppearance = { defaults, load, save, apply, normalize: normalizeSettings };
})();

;
(() => {
const DB_NAME = 'pido-darts-db';
const DB_VERSION = 5;
const PLAYERS_STORE = 'players';
const GAME_SESSIONS_STORE = 'gameSessions';
const RECORDS_STORE = 'records';
const COMPLETED_GAMES_STORE = 'completedGames';
const IDEAL_RECORDS_STORE = 'idealRecords';
let dbPromise = null;
function openDb() {
if (dbPromise) return dbPromise;
dbPromise = new Promise((resolve, reject) => {
if (!('indexedDB' in window)) {
reject(new Error('IndexedDB non supportato da questo browser.'));
return;
}
const request = indexedDB.open(DB_NAME, DB_VERSION);
request.onupgradeneeded = () => {
const db = request.result;
if (!db.objectStoreNames.contains(PLAYERS_STORE)) {
const store = db.createObjectStore(PLAYERS_STORE, { keyPath: 'id' });
store.createIndex('updatedAt', 'updatedAt', { unique: false });
store.createIndex('name', 'name', { unique: false });
}
if (!db.objectStoreNames.contains(GAME_SESSIONS_STORE)) {
const store = db.createObjectStore(GAME_SESSIONS_STORE, { keyPath: 'id' });
store.createIndex('updatedAt', 'updatedAt', { unique: false });
store.createIndex('createdAt', 'createdAt', { unique: false });
store.createIndex('mode', 'mode', { unique: false });
}
if (!db.objectStoreNames.contains(RECORDS_STORE)) {
const store = db.createObjectStore(RECORDS_STORE, { keyPath: 'id' });
store.createIndex('playerId', 'playerId', { unique: false });
store.createIndex('startScore', 'startScore', { unique: false });
store.createIndex('updatedAt', 'updatedAt', { unique: false });
}
if (!db.objectStoreNames.contains(COMPLETED_GAMES_STORE)) {
const store = db.createObjectStore(COMPLETED_GAMES_STORE, { keyPath: 'id' });
store.createIndex('completedAt', 'completedAt', { unique: false });
store.createIndex('createdAt', 'createdAt', { unique: false });
store.createIndex('mode', 'mode', { unique: false });
store.createIndex('startScore', 'startScore', { unique: false });
store.createIndex('winnerId', 'winnerId', { unique: false });
}
if (!db.objectStoreNames.contains(IDEAL_RECORDS_STORE)) {
const store = db.createObjectStore(IDEAL_RECORDS_STORE, { keyPath: 'id' });
store.createIndex('playerId', 'playerId', { unique: false });
store.createIndex('startScore', 'startScore', { unique: false });
store.createIndex('updatedAt', 'updatedAt', { unique: false });
}
};
request.onsuccess = () => resolve(request.result);
request.onerror = () => reject(request.error || new Error('Impossibile aprire il database.'));
request.onblocked = () => reject(new Error('Database bloccato da un’altra scheda dell’app.'));
});
return dbPromise;
}
function requestToPromise(request) {
return new Promise((resolve, reject) => {
request.onsuccess = () => resolve(request.result);
request.onerror = () => reject(request.error || new Error('Operazione database non riuscita.'));
});
}
async function transaction(storeName, mode, callback) {
const db = await openDb();
return new Promise((resolve, reject) => {
const tx = db.transaction(storeName, mode);
const store = tx.objectStore(storeName);
let callbackResult;
try {
callbackResult = callback(store);
} catch (error) {
tx.abort();
reject(error);
return;
}
tx.oncomplete = async () => {
try {
resolve(await callbackResult);
} catch (error) {
reject(error);
}
};
tx.onerror = () => reject(tx.error || new Error('Transazione database non riuscita.'));
tx.onabort = () => reject(tx.error || new Error('Transazione database annullata.'));
});
}
async function getPlayers() {
const db = await openDb();
const tx = db.transaction(PLAYERS_STORE, 'readonly');
const store = tx.objectStore(PLAYERS_STORE);
const players = await requestToPromise(store.getAll());
return players.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
async function getPlayer(id) {
const db = await openDb();
const tx = db.transaction(PLAYERS_STORE, 'readonly');
return requestToPromise(tx.objectStore(PLAYERS_STORE).get(id));
}
async function savePlayer(player) {
await transaction(PLAYERS_STORE, 'readwrite', store => requestToPromise(store.put(player)));
return player;
}
async function deletePlayer(id) {
await transaction(PLAYERS_STORE, 'readwrite', store => requestToPromise(store.delete(id)));
}
async function getGameSessions() {
const db = await openDb();
const tx = db.transaction(GAME_SESSIONS_STORE, 'readonly');
const sessions = await requestToPromise(tx.objectStore(GAME_SESSIONS_STORE).getAll());
return sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
async function getGameSession(id) {
const db = await openDb();
const tx = db.transaction(GAME_SESSIONS_STORE, 'readonly');
return requestToPromise(tx.objectStore(GAME_SESSIONS_STORE).get(id));
}
async function saveGameSession(session) {
await transaction(GAME_SESSIONS_STORE, 'readwrite', store => requestToPromise(store.put(session)));
return session;
}
async function deleteGameSession(id) {
if (!id) return;
await transaction(GAME_SESSIONS_STORE, 'readwrite', store => requestToPromise(store.delete(id)));
}
async function clearGameSessions() {
await transaction(GAME_SESSIONS_STORE, 'readwrite', store => requestToPromise(store.clear()));
}
async function getCompletedGames() {
const db = await openDb();
const tx = db.transaction(COMPLETED_GAMES_STORE, 'readonly');
const games = await requestToPromise(tx.objectStore(COMPLETED_GAMES_STORE).getAll());
return games.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
}
async function getCompletedGame(id) {
if (!id) return null;
const db = await openDb();
const tx = db.transaction(COMPLETED_GAMES_STORE, 'readonly');
return requestToPromise(tx.objectStore(COMPLETED_GAMES_STORE).get(id));
}
async function saveCompletedGame(game) {
if (!game?.id) throw new Error('Partita completata senza identificativo.');
await transaction(COMPLETED_GAMES_STORE, 'readwrite', store => requestToPromise(store.put(game)));
return game;
}
async function deleteCompletedGame(id) {
if (!id) return;
await transaction(COMPLETED_GAMES_STORE, 'readwrite', store => requestToPromise(store.delete(id)));
}
async function clearCompletedGames() {
await transaction(COMPLETED_GAMES_STORE, 'readwrite', store => requestToPromise(store.clear()));
}
function createIdealRecordId(playerId, startScore) {
return `ideal::${String(playerId)}::${Number(startScore)}`;
}
async function getIdealRecord(playerId, startScore) {
if (!playerId || !Number.isFinite(Number(startScore))) return null;
const db = await openDb();
const tx = db.transaction(IDEAL_RECORDS_STORE, 'readonly');
return requestToPromise(tx.objectStore(IDEAL_RECORDS_STORE).get(createIdealRecordId(playerId, startScore)));
}
async function getIdealRecords() {
const db = await openDb();
const tx = db.transaction(IDEAL_RECORDS_STORE, 'readonly');
const records = await requestToPromise(tx.objectStore(IDEAL_RECORDS_STORE).getAll());
return records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
async function getIdealRecordsForPlayer(playerId) {
if (!playerId) return [];
const db = await openDb();
const tx = db.transaction(IDEAL_RECORDS_STORE, 'readonly');
const index = tx.objectStore(IDEAL_RECORDS_STORE).index('playerId');
const records = await requestToPromise(index.getAll(playerId));
return records.sort((a, b) => Number(a.startScore) - Number(b.startScore));
}
async function saveIdealRecord(record) {
if (!record?.playerId || !Number.isFinite(Number(record.startScore))) throw new Error('Record ideale non valido.');
const normalized = { ...record, id: record.id || createIdealRecordId(record.playerId, record.startScore), updatedAt: record.updatedAt || Date.now() };
await transaction(IDEAL_RECORDS_STORE, 'readwrite', store => requestToPromise(store.put(normalized)));
return normalized;
}
async function deleteIdealRecord(playerId, startScore) {
if (!playerId || !Number.isFinite(Number(startScore))) return;
await transaction(IDEAL_RECORDS_STORE, 'readwrite', store => requestToPromise(store.delete(createIdealRecordId(playerId, startScore))));
}
async function clearIdealRecords() {
await transaction(IDEAL_RECORDS_STORE, 'readwrite', store => requestToPromise(store.clear()));
}
async function clearAllData() {
const db = await openDb();
return new Promise((resolve, reject) => {
const tx = db.transaction([PLAYERS_STORE, GAME_SESSIONS_STORE, RECORDS_STORE, COMPLETED_GAMES_STORE, IDEAL_RECORDS_STORE], 'readwrite');
tx.objectStore(PLAYERS_STORE).clear();
tx.objectStore(GAME_SESSIONS_STORE).clear();
tx.objectStore(RECORDS_STORE).clear();
tx.objectStore(COMPLETED_GAMES_STORE).clear();
tx.objectStore(IDEAL_RECORDS_STORE).clear();
tx.oncomplete = () => resolve();
tx.onerror = () => reject(tx.error || new Error('Impossibile cancellare tutti i dati.'));
tx.onabort = () => reject(tx.error || new Error('Cancellazione dati annullata.'));
});
}
async function replaceAllDataAtomic(data = {}) {
const collections = {
[PLAYERS_STORE]: Array.isArray(data.players) ? data.players : [],
[GAME_SESSIONS_STORE]: Array.isArray(data.gameSessions) ? data.gameSessions : [],
[RECORDS_STORE]: Array.isArray(data.records) ? data.records : [],
[COMPLETED_GAMES_STORE]: Array.isArray(data.completedGames) ? data.completedGames : [],
[IDEAL_RECORDS_STORE]: Array.isArray(data.idealRecords) ? data.idealRecords : []
};
const storeNames = Object.keys(collections);
const database = await openDb();
return new Promise((resolve, reject) => {
const tx = database.transaction(storeNames, 'readwrite');
let settled = false;
const fail = error => {
if (settled) return;
settled = true;
reject(error || tx.error || new Error('Ripristino dati annullato.'));
};
try {
for (const storeName of storeNames) {
const store = tx.objectStore(storeName);
store.clear();
for (const item of collections[storeName]) store.put(item);
}
} catch (error) {
try { tx.abort(); } catch (_) {}
fail(error);
return;
}
tx.oncomplete = () => {
if (settled) return;
settled = true;
resolve();
};
tx.onerror = () => fail(tx.error || new Error('Ripristino dati non riuscito.'));
tx.onabort = () => fail(tx.error || new Error('Ripristino dati annullato: i dati precedenti sono stati mantenuti.'));
});
}
function createRecordId(playerId, startScore) {
return `record::${String(playerId)}::${Number(startScore)}`;
}
async function getRecord(playerId, startScore) {
if (!playerId || !Number.isFinite(Number(startScore))) return null;
const db = await openDb();
const tx = db.transaction(RECORDS_STORE, 'readonly');
return requestToPromise(tx.objectStore(RECORDS_STORE).get(createRecordId(playerId, startScore)));
}
async function getRecords() {
const db = await openDb();
const tx = db.transaction(RECORDS_STORE, 'readonly');
const records = await requestToPromise(tx.objectStore(RECORDS_STORE).getAll());
return records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
async function getRecordsForPlayer(playerId) {
if (!playerId) return [];
const db = await openDb();
const tx = db.transaction(RECORDS_STORE, 'readonly');
const index = tx.objectStore(RECORDS_STORE).index('playerId');
const records = await requestToPromise(index.getAll(playerId));
return records.sort((a, b) => Number(a.startScore) - Number(b.startScore));
}
async function saveRecord(record) {
const normalized = {
...record,
id: record.id || createRecordId(record.playerId, record.startScore),
updatedAt: record.updatedAt || Date.now()
};
await transaction(RECORDS_STORE, 'readwrite', store => requestToPromise(store.put(normalized)));
return normalized;
}
async function deleteRecord(playerId, startScore) {
if (!playerId || !Number.isFinite(Number(startScore))) return;
await transaction(RECORDS_STORE, 'readwrite', store => requestToPromise(store.delete(createRecordId(playerId, startScore))));
}
function createId(prefix = 'player') {
if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function createGameSessionId() {
return createId('game');
}
window.PidoDartsDB = {
getPlayers,
getPlayer,
savePlayer,
deletePlayer,
getGameSessions,
getGameSession,
saveGameSession,
deleteGameSession,
clearGameSessions,
getCompletedGames,
getCompletedGame,
saveCompletedGame,
deleteCompletedGame,
clearCompletedGames,
getIdealRecord,
getIdealRecords,
getIdealRecordsForPlayer,
saveIdealRecord,
deleteIdealRecord,
clearIdealRecords,
createIdealRecordId,
clearAllData,
replaceAllDataAtomic,
getRecord,
getRecords,
getRecordsForPlayer,
saveRecord,
deleteRecord,
createRecordId,
createId,
createGameSessionId
};
})();

;
(() => {
const ua = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isTouch = navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches;
const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const platform = isIOS ? 'ios' : (isAndroid ? 'android' : 'desktop');
let deferredInstallPrompt = null;
document.documentElement.dataset.platform = platform;
document.documentElement.dataset.input = isTouch ? 'touch' : 'keyboard';
document.documentElement.dataset.displayMode = isStandalone ? 'standalone' : 'browser';
const labels = { ios: 'iPhone / iPad', android: 'Android', desktop: 'PC / Desktop' };
function toast(message) {
if (window.PidoDartsApp?.showToast) window.PidoDartsApp.showToast(message);
else console.info(message);
}
function installHint() {
if (isStandalone) return 'Pido Darts è già installata su questo dispositivo.';
if (isIOS) return 'Su iPhone/iPad: apri Pido Darts in Safari, usa Condividi e scegli “Aggiungi alla schermata Home”.';
if (deferredInstallPrompt) return 'Installazione disponibile: Pido Darts può essere aggiunta al dispositivo come app.';
if (location.protocol === 'file:') return 'Per installare la PWA apri Pido Darts tramite HTTPS o un server locale, non direttamente come file.';
return 'Se il browser rende disponibile l’installazione, il pulsante si attiverà automaticamente.';
}
function syncInstallUi() {
const installBtn = document.getElementById('installAppBtn');
const installStatus = document.getElementById('installAppStatus');
if (installStatus) installStatus.textContent = installHint();
if (!installBtn) return;
installBtn.disabled = isStandalone;
installBtn.textContent = isStandalone ? 'Pido Darts installata' : 'Installa Pido Darts';
}
function updatePlatformUi() {
const platformName = document.getElementById('platformName');
const installMode = document.getElementById('installMode');
const platformDetails = document.getElementById('platformDetails');
const keyboardShortcuts = document.getElementById('keyboardShortcuts');
const installBtn = document.getElementById('installAppBtn');
const shareBtn = document.getElementById('shareAppBtn');
if (platformName) platformName.textContent = labels[platform];
if (installMode) installMode.textContent = isStandalone ? 'App installata' : 'Browser';
if (platformDetails) {
if (isIOS) {
platformDetails.textContent = 'Compatibilità iOS predisposta: safe area, barra Home, notch/Dynamic Island e layout touch. I test reali su Safari/iPhone restano da verificare su un dispositivo Apple.';
} else if (isAndroid) {
platformDetails.textContent = 'Navigazione touch e tasto/gesto Indietro integrati con i pannelli e con la partita.';
} else {
platformDetails.textContent = 'Controlli da tastiera attivi durante la partita. Mouse e navigazione restano sempre disponibili.';
}
}
if (keyboardShortcuts) keyboardShortcuts.hidden = platform !== 'desktop';
installBtn?.addEventListener('click', async () => {
if (isStandalone) return;
if (deferredInstallPrompt) {
deferredInstallPrompt.prompt();
try {
const choice = await deferredInstallPrompt.userChoice;
toast(choice?.outcome === 'accepted' ? 'Installazione avviata' : 'Installazione annullata');
} catch (_) {  }
deferredInstallPrompt = null;
syncInstallUi();
return;
}
toast(isIOS ? 'Safari → Condividi → Aggiungi alla schermata Home' : 'L’installazione non è ancora disponibile in questo browser');
});
shareBtn?.addEventListener('click', async () => {
const url = location.protocol === 'file:' ? '' : location.href.split('#')[0];
if (!url) {
toast('Prima pubblica Pido Darts su un indirizzo HTTPS per condividere un link');
return;
}
const data = { title: 'Pido Darts', text: 'Gioca e allenati a freccette con Pido Darts', url };
if (navigator.share) {
try { await navigator.share(data); }
catch (error) { if (error?.name !== 'AbortError') toast('Condivisione non disponibile'); }
return;
}
try {
await navigator.clipboard.writeText(url);
toast('Link copiato negli appunti');
} catch (_) {
toast('Copia l’indirizzo dalla barra del browser');
}
});
syncInstallUi();
}
window.addEventListener('beforeinstallprompt', event => {
event.preventDefault();
deferredInstallPrompt = event;
syncInstallUi();
});
window.addEventListener('appinstalled', () => {
deferredInstallPrompt = null;
document.documentElement.dataset.displayMode = 'standalone';
toast('Pido Darts installata');
syncInstallUi();
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updatePlatformUi);
else updatePlatformUi();
window.PidoDartsPlatform = {
platform, isIOS, isAndroid, isTouch, isStandalone, label: labels[platform],
canInstall: () => Boolean(deferredInstallPrompt)
};
})();

;
(() => {
const db = window.PidoDartsDB;
const appearance = window.DartsAppearance;
const security = window.PidoDartsSecurity;
if (!db || !appearance || !security) return;
const FORMAT_VERSION = 1;
const APP_VERSION = '1.0.4.3';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_BACKUP_BYTES = 30 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 12;
const ALLOWED_BACKUP_FILES = new Set([
'backup-info.json', 'players.json', 'game-sessions.json', 'records.json',
'completed-games.json', 'ideal-records.json', 'settings.json', 'LEGGIMI.txt'
]);
const REQUIRED_BACKUP_FILES = new Set([
'backup-info.json', 'players.json', 'game-sessions.json', 'records.json',
'completed-games.json', 'ideal-records.json', 'settings.json'
]);
const exportBtn = document.getElementById('exportBackupBtn');
const importInput = document.getElementById('importBackupInput');
const importBtn = document.getElementById('importBackupBtn');
const importModal = document.getElementById('importBackupModal');
const importSummary = document.getElementById('importBackupSummary');
const cancelImportBtn = document.getElementById('cancelImportBackupBtn');
const mergeImportBtn = document.getElementById('mergeImportBackupBtn');
const replaceImportBtn = document.getElementById('replaceImportBackupBtn');
const backupLastStatus = document.getElementById('backupLastStatus');
let pendingBackup = null;
function showToast(message) {
window.PidoDartsApp?.showToast?.(message);
}
function crc32(bytes) {
let crc = 0xffffffff;
for (let i = 0; i < bytes.length; i += 1) {
crc ^= bytes[i];
for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
}
return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
const year = Math.max(1980, date.getFullYear());
const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31);
const day = ((year - 1980) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
return { time, day };
}
function push16(array, value) {
array.push(value & 255, (value >>> 8) & 255);
}
function push32(array, value) {
array.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}
function makeStoredZip(entries) {
const localChunks = [];
const centralChunks = [];
let localOffset = 0;
const { time, day } = dosDateTime();
entries.forEach(entry => {
const name = encoder.encode(entry.name);
const data = entry.bytes instanceof Uint8Array ? entry.bytes : encoder.encode(String(entry.text ?? ''));
const crc = crc32(data);
const localHeader = [];
push32(localHeader, 0x04034b50);
push16(localHeader, 20);
push16(localHeader, 0x0800);
push16(localHeader, 0);
push16(localHeader, time);
push16(localHeader, day);
push32(localHeader, crc);
push32(localHeader, data.length);
push32(localHeader, data.length);
push16(localHeader, name.length);
push16(localHeader, 0);
const local = new Uint8Array(localHeader.length + name.length + data.length);
local.set(localHeader, 0);
local.set(name, localHeader.length);
local.set(data, localHeader.length + name.length);
localChunks.push(local);
const centralHeader = [];
push32(centralHeader, 0x02014b50);
push16(centralHeader, 20);
push16(centralHeader, 20);
push16(centralHeader, 0x0800);
push16(centralHeader, 0);
push16(centralHeader, time);
push16(centralHeader, day);
push32(centralHeader, crc);
push32(centralHeader, data.length);
push32(centralHeader, data.length);
push16(centralHeader, name.length);
push16(centralHeader, 0);
push16(centralHeader, 0);
push16(centralHeader, 0);
push16(centralHeader, 0);
push32(centralHeader, 0);
push32(centralHeader, localOffset);
const central = new Uint8Array(centralHeader.length + name.length);
central.set(centralHeader, 0);
central.set(name, centralHeader.length);
centralChunks.push(central);
localOffset += local.length;
});
const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
const end = [];
push32(end, 0x06054b50);
push16(end, 0);
push16(end, 0);
push16(end, entries.length);
push16(end, entries.length);
push32(end, centralSize);
push32(end, localOffset);
push16(end, 0);
return new Blob([...localChunks, ...centralChunks, new Uint8Array(end)], { type: 'application/zip' });
}
function readU16(view, offset) { return view.getUint16(offset, true); }
function readU32(view, offset) { return view.getUint32(offset, true); }
function parseStoredZip(buffer) {
if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > MAX_BACKUP_BYTES) {
throw new Error('Il backup supera il limite massimo consentito.');
}
const bytes = new Uint8Array(buffer);
const view = new DataView(buffer);
const files = new Map();
let offset = 0;
let entryCount = 0;
let totalPayload = 0;
while (offset + 4 <= bytes.length) {
const signature = readU32(view, offset);
if (signature === 0x02014b50 || signature === 0x06054b50) break;
if (signature !== 0x04034b50) throw new Error('Archivio ZIP non riconosciuto.');
if (offset + 30 > bytes.length) throw new Error('Archivio ZIP incompleto.');
const flags = readU16(view, offset + 6);
const method = readU16(view, offset + 8);
const expectedCrc = readU32(view, offset + 14);
const compressedSize = readU32(view, offset + 18);
const uncompressedSize = readU32(view, offset + 22);
const nameLength = readU16(view, offset + 26);
const extraLength = readU16(view, offset + 28);
if (flags & 0x0001) throw new Error('I backup ZIP cifrati non sono supportati.');
if (flags & 0x0008) throw new Error('Questo ZIP usa un formato non supportato dal backup locale.');
if (flags & ~0x0800) throw new Error('Il backup ZIP usa opzioni non consentite.');
if (method !== 0) throw new Error('Il backup deve essere un ZIP creato da Pido Darts.');
if (compressedSize !== uncompressedSize) throw new Error('Backup ZIP non valido.');
if (nameLength < 1 || nameLength > 120) throw new Error('Nome file non valido nel backup.');
const nameStart = offset + 30;
const dataStart = nameStart + nameLength + extraLength;
const dataEnd = dataStart + compressedSize;
if (dataStart < nameStart || dataEnd < dataStart || dataEnd > bytes.length) throw new Error('Archivio ZIP danneggiato.');
const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
if (!ALLOWED_BACKUP_FILES.has(name)) throw new Error(`File non consentito nel backup: ${name}`);
if (files.has(name)) throw new Error(`File duplicato nel backup: ${name}`);
entryCount += 1;
totalPayload += uncompressedSize;
if (entryCount > MAX_ZIP_ENTRIES || totalPayload > MAX_BACKUP_BYTES) throw new Error('Il backup contiene troppi dati.');
const data = bytes.slice(dataStart, dataEnd);
if (crc32(data) !== expectedCrc) throw new Error(`Controllo integrità non riuscito per ${name}.`);
files.set(name, data);
offset = dataEnd;
}
if (!files.has('backup-info.json')) throw new Error('Backup incompleto: manca backup-info.json.');
return files;
}
function jsonEntry(name, value) {
return { name, text: `${JSON.stringify(value, null, 2)}\n` };
}
async function collectBackup() {
const [players, gameSessions, records, completedGames, idealRecords] = await Promise.all([
db.getPlayers(),
db.getGameSessions(),
db.getRecords(),
db.getCompletedGames(),
db.getIdealRecords()
]);
const settings = appearance.load();
return {
info: {
app: 'Pido Darts',
appVersion: APP_VERSION,
formatVersion: FORMAT_VERSION,
exportedAt: new Date().toISOString(),
note: 'Gli avatar e l’eventuale sfondo personalizzato sono inclusi nei dati JSON come immagini locali.'
},
players,
gameSessions,
records,
completedGames,
idealRecords,
settings
};
}
function fileStamp(date = new Date()) {
const pad = value => String(value).padStart(2, '0');
return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}
async function exportBackup() {
if (!exportBtn) return;
const original = exportBtn.textContent;
exportBtn.disabled = true;
exportBtn.textContent = 'Creazione backup…';
try {
const data = await collectBackup();
const entries = [
jsonEntry('backup-info.json', data.info),
jsonEntry('players.json', data.players),
jsonEntry('game-sessions.json', data.gameSessions),
jsonEntry('records.json', data.records),
jsonEntry('completed-games.json', data.completedGames),
jsonEntry('ideal-records.json', data.idealRecords),
jsonEntry('settings.json', data.settings),
{ name: 'LEGGIMI.txt', text: 'Backup Pido Darts v1.0.4.3. Per ripristinarlo usa Impostazioni > Dati e backup > Importa backup.\n' }
];
const blob = makeStoredZip(entries);
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = `PidoDarts_Backup_${fileStamp()}.zip`;
document.body.appendChild(link);
link.click();
link.remove();
setTimeout(() => URL.revokeObjectURL(url), 5000);
try { localStorage.setItem('pido-darts-last-backup', data.info.exportedAt); } catch (_) {}
updateLastStatus();
showToast('Backup ZIP creato');
} catch (error) {
console.error('Export backup non riuscito:', error);
showToast('Impossibile creare il backup');
} finally {
exportBtn.disabled = false;
exportBtn.textContent = original;
}
}
function parseJsonFile(files, name, fallback) {
const bytes = files.get(name);
if (!bytes) return fallback;
try { return JSON.parse(decoder.decode(bytes)); }
catch { throw new Error(`Il file ${name} non contiene dati validi.`); }
}
function validateEmbeddedPlayerData(value, depth = 0) {
if (depth > 24 || value == null) return;
if (Array.isArray(value)) {
value.forEach(item => validateEmbeddedPlayerData(item, depth + 1));
return;
}
if (typeof value !== 'object') return;
if ('avatarType' in value || 'avatarValue' in value) {
const avatarType = value.avatarType || 'initials';
if (!['initials', 'emoji', 'image'].includes(avatarType)) throw new Error('Tipo avatar non valido nel backup.');
if (avatarType === 'image' && !security.safeImageDataUrl(value.avatarValue, 2_000_000)) {
throw new Error('Avatar immagine non valido nel backup.');
}
if (avatarType === 'emoji' && String(value.avatarValue || '').length > 32) {
throw new Error('Avatar emoji non valido nel backup.');
}
}
if ('color' in value && value.color != null && security.safeHex(value.color, '') === '') {
throw new Error('Colore giocatore non valido nel backup.');
}
if ('name' in value && typeof value.name === 'string' && value.name.length > 80) {
throw new Error('Nome troppo lungo nel backup.');
}
Object.values(value).forEach(item => validateEmbeddedPlayerData(item, depth + 1));
}
function assertRequiredBackupFiles(files) {
for (const name of REQUIRED_BACKUP_FILES) {
if (!files.has(name)) throw new Error(`Backup incompleto: manca ${name}.`);
}
}
function assertUniqueIds(items, section) {
const seen = new Set();
for (const item of items) {
const id = String(item?.id || '');
if (!id) continue;
if (seen.has(id)) throw new Error(`Identificativo duplicato nella sezione ${section}.`);
seen.add(id);
}
}
function assertUniquePlayerNames(players) {
const seen = new Set();
for (const player of players) {
const key = String(player?.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
if (!key) continue;
if (seen.has(key)) throw new Error('Il backup contiene due giocatori con lo stesso nome.');
seen.add(key);
}
}
function normalizeBackup(files) {
assertRequiredBackupFiles(files);
const infoRaw = parseJsonFile(files, 'backup-info.json', null);
const info = security.validatePlainData(infoRaw);
if (!info || info.app !== 'Pido Darts') throw new Error('Questo file non sembra un backup di Pido Darts.');
const formatVersion = Number(info.formatVersion);
if (!Number.isInteger(formatVersion) || formatVersion < 1) throw new Error('Versione formato backup non valida.');
if (formatVersion > FORMAT_VERSION) throw new Error('Il backup è stato creato da una versione più recente e non è compatibile.');
if (info.appVersion != null && (typeof info.appVersion !== 'string' || info.appVersion.length > 32)) throw new Error('Versione app non valida nel backup.');
if (info.exportedAt != null) {
if (typeof info.exportedAt !== 'string' || info.exportedAt.length > 64 || Number.isNaN(new Date(info.exportedAt).getTime())) {
throw new Error('Data di esportazione non valida nel backup.');
}
}
const raw = {
players: parseJsonFile(files, 'players.json', []),
gameSessions: parseJsonFile(files, 'game-sessions.json', []),
records: parseJsonFile(files, 'records.json', []),
completedGames: parseJsonFile(files, 'completed-games.json', []),
idealRecords: parseJsonFile(files, 'ideal-records.json', []),
settings: parseJsonFile(files, 'settings.json', null)
};
const result = {
info,
players: security.validatePlainData(raw.players),
gameSessions: security.validatePlainData(raw.gameSessions),
records: security.validatePlainData(raw.records),
completedGames: security.validatePlainData(raw.completedGames),
idealRecords: security.validatePlainData(raw.idealRecords),
settings: raw.settings == null ? null : appearance.normalize(security.validatePlainData(raw.settings))
};
const limits = {
players: 1000,
gameSessions: 500,
records: 20_000,
completedGames: 20_000,
idealRecords: 20_000
};
Object.entries(limits).forEach(([key, max]) => {
if (!Array.isArray(result[key])) throw new Error(`Sezione ${key} non valida nel backup.`);
if (result[key].length > max) throw new Error(`La sezione ${key} contiene troppi elementi.`);
});
result.players.forEach(player => security.validatePlayerLike(player, { strictName: true }));
assertUniqueIds(result.players, 'players');
assertUniquePlayerNames(result.players);
['gameSessions', 'records', 'completedGames', 'idealRecords'].forEach(key => {
result[key].forEach(item => {
if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || item.id.length > 256) {
throw new Error(`Elemento senza identificativo valido nella sezione ${key}.`);
}
});
assertUniqueIds(result[key], key);
});
validateEmbeddedPlayerData(result.gameSessions);
validateEmbeddedPlayerData(result.records);
validateEmbeddedPlayerData(result.completedGames);
validateEmbeddedPlayerData(result.idealRecords);
return result;
}
function validIdItems(items) {
return items.filter(item => item && typeof item === 'object' && item.id);
}
function newestTimestamp(item) {
return Number(item?.updatedAt || item?.completedAt || item?.createdAt || 0);
}
async function mergeCollection(imported, current, save) {
const currentMap = new Map(validIdItems(current).map(item => [String(item.id), item]));
for (const item of validIdItems(imported)) {
const existing = currentMap.get(String(item.id));
if (!existing || newestTimestamp(item) > newestTimestamp(existing)) await save(item);
}
}
async function applyBackup(backup, mode) {
if (mode === 'replace') {
if (typeof db.replaceAllDataAtomic !== 'function') throw new Error('Ripristino atomico non disponibile.');
await db.replaceAllDataAtomic({
players: validIdItems(backup.players),
gameSessions: validIdItems(backup.gameSessions),
records: validIdItems(backup.records),
completedGames: validIdItems(backup.completedGames),
idealRecords: validIdItems(backup.idealRecords)
});
if (backup.settings && typeof backup.settings === 'object') appearance.save(appearance.normalize(backup.settings));
return;
}
const [players, sessions, records, games, ideals] = await Promise.all([
db.getPlayers(), db.getGameSessions(), db.getRecords(), db.getCompletedGames(), db.getIdealRecords()
]);
await mergeCollection(backup.players, players, item => db.savePlayer(item));
await mergeCollection(backup.gameSessions, sessions, item => db.saveGameSession(item));
await mergeCollection(backup.records, records, item => db.saveRecord(item));
await mergeCollection(backup.completedGames, games, item => db.saveCompletedGame(item));
await mergeCollection(backup.idealRecords, ideals, item => db.saveIdealRecord(item));
}
function closeImportModal() {
if (!importModal || importModal.hidden) return false;
importModal.hidden = true;
document.body.classList.remove('modal-open');
pendingBackup = null;
if (importInput) importInput.value = '';
importBtn?.focus();
return true;
}
function openImportModal(backup) {
if (!importModal || !importSummary) return;
pendingBackup = backup;
const date = backup.info?.exportedAt ? new Date(backup.info.exportedAt) : null;
const dateText = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('it-IT') : 'data sconosciuta';
importSummary.replaceChildren();
const rows = [
['Backup', dateText],
['Giocatori', backup.players.length],
['Partite sospese', backup.gameSessions.length],
['Partite nello storico', backup.completedGames.length],
['Record personali', backup.records.length],
['Record ideali', backup.idealRecords.length]
];
rows.forEach(([label, value]) => {
const row = document.createElement('div');
const span = document.createElement('span');
const strong = document.createElement('strong');
span.textContent = label;
strong.textContent = String(value);
row.append(span, strong);
importSummary.appendChild(row);
});
importModal.hidden = false;
document.body.classList.add('modal-open');
setTimeout(() => cancelImportBtn?.focus(), 0);
}
async function readImportFile(file) {
if (!file) return;
try {
if (file.size > MAX_BACKUP_BYTES) throw new Error('Il backup supera il limite di 30 MB.');
const files = parseStoredZip(await file.arrayBuffer());
openImportModal(normalizeBackup(files));
} catch (error) {
console.error('Import backup non riuscito:', error);
showToast(error.message || 'Backup non valido');
if (importInput) importInput.value = '';
}
}
async function confirmImport(mode, button) {
if (!pendingBackup || !button) return;
const original = button.textContent;
mergeImportBtn.disabled = true;
replaceImportBtn.disabled = true;
button.textContent = mode === 'replace' ? 'Sostituzione…' : 'Unione…';
try {
await applyBackup(pendingBackup, mode);
closeImportModal();
showToast(mode === 'replace' ? 'Backup ripristinato' : 'Backup unito ai dati presenti');
setTimeout(() => window.location.reload(), 550);
} catch (error) {
console.error('Ripristino backup non riuscito:', error);
showToast('Impossibile importare il backup');
mergeImportBtn.disabled = false;
replaceImportBtn.disabled = false;
button.textContent = original;
}
}
function updateLastStatus() {
if (!backupLastStatus) return;
let value = '';
try { value = localStorage.getItem('pido-darts-last-backup') || ''; } catch (_) {}
if (!value) {
backupLastStatus.textContent = 'Nessun backup esportato da questo dispositivo.';
return;
}
const date = new Date(value);
backupLastStatus.textContent = Number.isNaN(date.getTime()) ? 'Backup esportato.' : `Ultimo export: ${date.toLocaleString('it-IT')}`;
}
exportBtn?.addEventListener('click', exportBackup);
importBtn?.addEventListener('click', () => importInput?.click());
importInput?.addEventListener('change', () => readImportFile(importInput.files?.[0]));
cancelImportBtn?.addEventListener('click', closeImportModal);
importModal?.addEventListener('click', event => { if (event.target === importModal) closeImportModal(); });
mergeImportBtn?.addEventListener('click', () => confirmImport('merge', mergeImportBtn));
replaceImportBtn?.addEventListener('click', () => confirmImport('replace', replaceImportBtn));
document.addEventListener('keydown', event => {
if (event.key === 'Escape' && importModal && !importModal.hidden) {
event.preventDefault();
closeImportModal();
}
});
updateLastStatus();
window.PidoDartsBackup = { exportBackup, makeStoredZip, parseStoredZip };
})();

;
(() => {
const APP_VERSION = '1.0.4.3';
const VERSION_URL = './version.json';
const SW_URL = './service-worker.js';
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
let registration = null;
let lastCheck = 0;
let reloadForUpdate = false;
let announcedVersion = '';
const byId = id => document.getElementById(id);
function toast(message) {
if (window.PidoDartsApp?.showToast) window.PidoDartsApp.showToast(message);
else console.info(message);
}
function setStatus(message, shortState = '') {
const status = byId('updateStatus');
const info = byId('updateInfoState');
if (status) status.textContent = message;
if (info && shortState) info.textContent = shortState;
}
function normalizeVersion(version) {
const text = String(version || '').trim();
if (!/^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(text)) return '';
return text;
}
function parts(version) {
const safe = normalizeVersion(version);
return safe ? safe.split('.').map(part => Number.parseInt(part, 10)) : [];
}
function compareVersions(a, b) {
const aa = parts(a), bb = parts(b);
const len = Math.max(aa.length, bb.length);
for (let i = 0; i < len; i += 1) {
const av = aa[i] || 0, bv = bb[i] || 0;
if (av > bv) return 1;
if (av < bv) return -1;
}
return 0;
}
function showBanner(version = '') {
const banner = byId('updateBanner');
const text = byId('updateBannerText');
if (!banner) return;
if (text) text.textContent = version
? `Pido Darts ${version} è pronta. I tuoi profili e le tue statistiche restano sul dispositivo.`
: 'È disponibile una nuova versione di Pido Darts. I dati locali restano invariati.';
banner.hidden = false;
announcedVersion = version || announcedVersion;
setStatus(version ? `Versione ${version} pronta da installare.` : 'Aggiornamento pronto da installare.', 'Disponibile');
}
function hideBanner() {
const banner = byId('updateBanner');
if (banner) banner.hidden = true;
}
function waitingWorker() {
return registration?.waiting || null;
}
async function fetchReleaseInfo() {
const url = `${VERSION_URL}?t=${Date.now()}`;
const response = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
if (!response.ok) throw new Error(`version.json HTTP ${response.status}`);
const text = await response.text();
if (text.length > 4096) throw new Error('version.json troppo grande');
const release = JSON.parse(text);
if (!normalizeVersion(release?.version)) throw new Error('version.json non contiene una versione valida');
return release;
}
async function checkForUpdates({ manual = false } = {}) {
if (location.protocol === 'file:') {
setStatus('Gli aggiornamenti automatici richiedono Pido Darts pubblicata tramite HTTPS o localhost.', 'Non disponibile');
if (manual) toast('Apri Pido Darts da HTTPS/localhost per controllare gli aggiornamenti');
return false;
}
if (!navigator.onLine) {
setStatus('Sei offline. Il controllo aggiornamenti riprenderà quando torni online.', 'Offline');
if (manual) toast('Nessuna connessione: controllo rimandato');
return false;
}
lastCheck = Date.now();
setStatus('Controllo della versione in corso…', 'Controllo…');
try {
if (registration) await registration.update();
const release = await fetchReleaseInfo();
const latest = normalizeVersion(release?.version);
if (waitingWorker()) {
showBanner(latest && compareVersions(latest, APP_VERSION) > 0 ? latest : '');
return true;
}
if (latest && compareVersions(latest, APP_VERSION) > 0) {
announcedVersion = latest;
setStatus(`Versione ${latest} trovata. Preparazione aggiornamento…`, 'Download…');
if (registration) await registration.update();
if (waitingWorker()) showBanner(latest);
else setTimeout(() => { if (waitingWorker()) showBanner(latest); }, 700);
return true;
}
setStatus(`Pido Darts ${APP_VERSION} è aggiornata.`, 'Aggiornata');
if (manual) toast('Hai già l’ultima versione');
return false;
} catch (error) {
console.warn('Controllo aggiornamenti non riuscito:', error);
setStatus('Impossibile controllare gli aggiornamenti in questo momento.', 'Non verificato');
if (manual) toast('Controllo aggiornamenti non riuscito');
return false;
}
}
function watchInstalling(worker) {
if (!worker) return;
worker.addEventListener('statechange', () => {
if (worker.state === 'installed' && navigator.serviceWorker.controller) {
showBanner(announcedVersion);
}
});
}
async function installUpdate() {
const worker = waitingWorker();
if (!worker) {
setStatus('Cerco il pacchetto di aggiornamento…', 'Controllo…');
await checkForUpdates({ manual: true });
if (!waitingWorker()) return;
}
reloadForUpdate = true;
setStatus('Installazione aggiornamento…', 'Installazione…');
byId('updateNowBtn')?.setAttribute('disabled', '');
waitingWorker()?.postMessage({ type: 'SKIP_WAITING' });
}
async function registerServiceWorker() {
if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
setStatus('PWA/aggiornamenti automatici disponibili tramite HTTPS o localhost.', 'Non disponibile');
return;
}
try {
registration = await navigator.serviceWorker.register(SW_URL);
if (registration.waiting && navigator.serviceWorker.controller) showBanner();
if (registration.installing) watchInstalling(registration.installing);
registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
await navigator.serviceWorker.ready;
setStatus(`Pido Darts ${APP_VERSION}. Controllo aggiornamenti disponibile.`, 'Pronta');
setTimeout(() => checkForUpdates(), 1200);
} catch (error) {
console.warn('Service Worker non registrato:', error);
setStatus('Service Worker non disponibile: offline e aggiornamenti automatici potrebbero non funzionare.', 'Errore PWA');
}
}
function bindUi() {
byId('checkUpdatesBtn')?.addEventListener('click', () => checkForUpdates({ manual: true }));
byId('updateNowBtn')?.addEventListener('click', installUpdate);
byId('updateLaterBtn')?.addEventListener('click', () => {
hideBanner();
setStatus('Aggiornamento rimandato. Verrà riproposto alla prossima apertura/controllo.', 'Rimandato');
});
}
navigator.serviceWorker?.addEventListener('controllerchange', () => {
if (!reloadForUpdate) return;
reloadForUpdate = false;
window.location.reload();
});
window.addEventListener('online', () => checkForUpdates());
document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'visible' && Date.now() - lastCheck > CHECK_INTERVAL_MS) checkForUpdates();
});
const init = () => { bindUi(); registerServiceWorker(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
window.PidoDartsUpdater = { version: APP_VERSION, checkForUpdates, compareVersions, normalizeVersion };
})();

;
(() => {
const appearance = window.DartsAppearance;
let settings = appearance.load();
appearance.apply(settings);
const screens = [...document.querySelectorAll('[data-screen]')];
const backBtn = document.getElementById('backBtn');
const homeBtn = document.getElementById('homeBtn');
const settingsShortcut = document.getElementById('settingsShortcut');
const toast = document.getElementById('toast');
const screenAnnouncer = document.getElementById('screenAnnouncer');
const bottomNav = document.getElementById('bottomNav');
const bottomNavToggle = document.getElementById('bottomNavToggle');
const bottomNavItems = [...document.querySelectorAll('[data-bottom-go]')];
const moreNavBtn = document.getElementById('moreNavBtn');
const moreMenu = document.getElementById('moreMenu');
const closeMoreMenuBtn = document.getElementById('closeMoreMenu');
const historyStack = ['home'];
let currentScreen = 'home';
let toastTimer;
let suppressNextPop = false;
let moreHasHistory = false;
let pendingMoreDestination = '';
let navCollapsed = false;
let lastScrollY = window.scrollY;
let scrollTicking = false;
const themePicker = document.getElementById('themePicker');
const customThemeControls = document.getElementById('customThemeControls');
const customAccentColor = document.getElementById('customAccentColor');
const customBgColor = document.getElementById('customBgColor');
const customTextColor = document.getElementById('customTextColor');
const settingsColorButtons = [...document.querySelectorAll('[data-settings-color-key]')];
const customAccentSwatch = document.getElementById('customAccentSwatch');
const customBgSwatch = document.getElementById('customBgSwatch');
const customTextSwatch = document.getElementById('customTextSwatch');
const customAccentHex = document.getElementById('customAccentHex');
const customBgHex = document.getElementById('customBgHex');
const customTextHex = document.getElementById('customTextHex');
const settingsColorModal = document.getElementById('settingsColorModal');
const closeSettingsColorPicker = document.getElementById('closeSettingsColorPicker');
const cancelSettingsColorPicker = document.getElementById('cancelSettingsColorPicker');
const applySettingsColor = document.getElementById('applySettingsColor');
const resetSettingsColor = document.getElementById('resetSettingsColor');
const settingsColorTitle = document.getElementById('settingsColorTitle');
const settingsColorPreview = document.getElementById('settingsColorPreview');
const settingsColorPreviewSwatch = document.getElementById('settingsColorPreviewSwatch');
const settingsColorPreviewLabel = document.getElementById('settingsColorPreviewLabel');
const settingsColorPreviewHex = document.getElementById('settingsColorPreviewHex');
const settingsColorSpectrum = document.getElementById('settingsColorSpectrum');
const settingsColorSpectrumMarker = document.getElementById('settingsColorSpectrumMarker');
const settingsColorHueSlider = document.getElementById('settingsColorHueSlider');
const settingsColorHueValue = document.getElementById('settingsColorHueValue');
const settingsColorCodeSwatch = document.getElementById('settingsColorCodeSwatch');
const settingsColorHexInput = document.getElementById('settingsColorHexInput');
const backgroundPicker = document.getElementById('backgroundPicker');
const customBackgroundTools = document.getElementById('customBackgroundTools');
const customBackgroundInput = document.getElementById('customBackgroundInput');
const chooseCustomBackgroundBtn = document.getElementById('chooseCustomBackgroundBtn');
const removeCustomBackgroundBtn = document.getElementById('removeCustomBackgroundBtn');
const customBackgroundStatus = document.getElementById('customBackgroundStatus');
const backupShortcut = document.getElementById('backupShortcut');
const bgIntensity = document.getElementById('bgIntensity');
const bgIntensityValue = document.getElementById('bgIntensityValue');
const animationsToggle = document.getElementById('animationsToggle');
const resetAppearance = document.getElementById('resetAppearance');
const resetAllDataBtn = document.getElementById('resetAllDataBtn');
const resetAllDataModal = document.getElementById('resetAllDataModal');
const cancelResetAllDataBtn = document.getElementById('cancelResetAllDataBtn');
const confirmResetAllDataBtn = document.getElementById('confirmResetAllDataBtn');
const offlineStatus = document.getElementById('offlineStatus');
const mobileLayoutPicker = document.getElementById('mobileLayoutPicker');
const navBehaviorPicker = document.getElementById('navBehaviorPicker');
const navBehaviorSettings = document.getElementById('navBehaviorSettings');
const navBehaviorNote = document.getElementById('navBehaviorNote');
const interfaceSizePicker = document.getElementById('interfaceSizePicker');
const highContrastToggle = document.getElementById('highContrastToggle');
const settingsSections = [...document.querySelectorAll('[data-settings-section]')];
const settingsOpenButtons = [...document.querySelectorAll('[data-settings-open]')];
const settingsInnerOpenButtons = [...document.querySelectorAll('[data-settings-inner-open]')];
const settingsInnerBackButtons = [...document.querySelectorAll('[data-settings-inner-back]')];
let activeSettingsSection = '';
let activeSettingsInner = '';
const settingsColorState = { key: 'customAccent', hsv: { h: 140, s: 85, v: 85 } };
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function normalizeHex(value) { const raw=String(value||'').trim().replace(/^#/,''); if(/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c=>c+c).join('')}`.toLowerCase(); if(/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase(); return null; }
function hsvToHex(h,s,v) { h=((Number(h)%360)+360)%360; s=clamp(Number(s),0,100)/100; v=clamp(Number(v),0,100)/100; const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c; let r=0,g=0,b=0; if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x]; const part=n=>Math.round((n+m)*255).toString(16).padStart(2,'0'); return `#${part(r)}${part(g)}${part(b)}`; }
function hexToHsv(hex) { const n=normalizeHex(hex)||'#20d868'; const r=parseInt(n.slice(1,3),16)/255,g=parseInt(n.slice(3,5),16)/255,b=parseInt(n.slice(5,7),16)/255; const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min; let h=0; if(d){if(max===r)h=60*(((g-b)/d)%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);} if(h<0)h+=360; return {h,s:max?(d/max)*100:0,v:max*100}; }
function isPhoneLayout() {
return window.matchMedia('(max-width: 720px)').matches;
}
function isCompactNavViewport() {
return settings.mobileLayout === 'app' || window.matchMedia('(max-width: 899px)').matches;
}
function motionAllowed() {
return settings.animations && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function scrollBehavior() {
return motionAllowed() ? 'smooth' : 'auto';
}
function announceAndFocusScreen(target) {
if (!target) return;
const heading = target.querySelector('h1, h2, h3');
const label = heading?.textContent?.replace(/\s+/g, ' ').trim() || 'Pido Darts';
if (screenAnnouncer) {
screenAnnouncer.textContent = '';
window.setTimeout(() => { screenAnnouncer.textContent = label; }, 10);
}
target.setAttribute('tabindex', '-1');
window.setTimeout(() => {
try { target.focus({ preventScroll: true }); }
catch (_) { target.focus(); }
}, 20);
}
function appSettingsMode() {
return isPhoneLayout() && settings.mobileLayout === 'app';
}
function syncSettingsNavigation() {
const appMode = appSettingsMode();
document.body.classList.toggle('settings-app-subpage', appMode && Boolean(activeSettingsSection));
document.body.classList.toggle('settings-app-inner', appMode && Boolean(activeSettingsInner));
settingsSections.forEach(section => {
const active = appMode && section.dataset.settingsSection === activeSettingsSection;
section.classList.toggle('is-app-active', active);
if (appMode) section.open = active;
});
document.querySelectorAll('[data-settings-inner-panel]').forEach(panel => {
panel.classList.toggle('is-active', appMode && panel.dataset.settingsInnerPanel === activeSettingsInner);
});
}
function openSettingsSection(name) {
if (!appSettingsMode()) return;
activeSettingsSection = name;
activeSettingsInner = '';
syncSettingsNavigation();
window.scrollTo({ top: 0, behavior: scrollBehavior() });
}
function openSettingsInner(name) {
if (!appSettingsMode() || activeSettingsSection !== 'appearance') return;
activeSettingsInner = name;
syncSettingsNavigation();
window.scrollTo({ top: 0, behavior: scrollBehavior() });
}
function closeSettingsLayer() {
if (!appSettingsMode()) return false;
if (activeSettingsInner) {
activeSettingsInner = '';
syncSettingsNavigation();
return true;
}
if (activeSettingsSection) {
activeSettingsSection = '';
syncSettingsNavigation();
return true;
}
return false;
}
function resetSettingsNavigation() {
activeSettingsSection = '';
activeSettingsInner = '';
document.body.classList.remove('settings-app-subpage', 'settings-app-inner');
settingsSections.forEach(section => section.classList.remove('is-app-active'));
document.querySelectorAll('[data-settings-inner-panel]').forEach(panel => panel.classList.remove('is-active'));
}
function showToast(message) {
clearTimeout(toastTimer);
toast.textContent = message;
toast.classList.add('show');
toastTimer = setTimeout(() => toast.classList.remove('show'), 1900);
}
function navAvailable() {
if (currentScreen === 'game') return false;
if (settings.mobileLayout === 'site') return false;
return true;
}
function toggleAvailable() {
return navAvailable() && isCompactNavViewport() && settings.navBehavior !== 'always';
}
function setNavCollapsed(collapsed, { force = false } = {}) {
if (!force && !toggleAvailable() && collapsed) return;
navCollapsed = Boolean(collapsed) && navAvailable();
document.body.classList.toggle('bottom-nav-collapsed', navCollapsed);
if (bottomNavToggle) {
bottomNavToggle.setAttribute('aria-expanded', String(!navCollapsed));
bottomNavToggle.setAttribute('aria-label', navCollapsed ? 'Mostra barra di navigazione' : 'Nascondi barra di navigazione');
const icon = bottomNavToggle.querySelector('span');
if (icon) icon.textContent = navCollapsed ? '▲' : '▼';
}
}
function syncNavigationVisibility({ forceShow = false } = {}) {
const available = navAvailable();
document.body.classList.toggle('bottom-nav-unavailable', !available);
if (forceShow || !available || settings.navBehavior === 'always') setNavCollapsed(false, { force: true });
if (bottomNavToggle) bottomNavToggle.hidden = !toggleAvailable();
}
function syncBottomNavigation(name) {
const direct = ['home', 'training', 'multiplayer', 'statistics'];
const trainingChildren = ['game-setup', 'record-setup', 'computer-setup'];
const statisticsChildren = ['stats-progress', 'stats-compare', 'stats-ideal'];
const menuOpen = Boolean(moreMenu && !moreMenu.hidden);
const activeKey = menuOpen
? 'more'
: (trainingChildren.includes(name) ? 'training' : (statisticsChildren.includes(name) ? 'statistics' : (direct.includes(name) ? name : (['players', 'settings'].includes(name) ? 'more' : ''))));
bottomNavItems.forEach(button => {
const active = button.dataset.bottomGo === activeKey;
button.classList.toggle('active', active);
if (active) button.setAttribute('aria-current', 'page');
else button.removeAttribute('aria-current');
});
const moreActive = activeKey === 'more';
moreNavBtn?.classList.toggle('active', moreActive);
if (moreActive) moreNavBtn?.setAttribute('aria-current', 'page');
else moreNavBtn?.removeAttribute('aria-current');
}
function syncChrome(name) {
backBtn.classList.toggle('is-hidden', name === 'home');
document.body.classList.toggle('game-mode', name === 'game');
syncBottomNavigation(name);
syncNavigationVisibility({ forceShow: true });
}
function pushBrowserState(name) {
try {
window.history.pushState({ pidoDarts: true, screen: name }, '');
} catch (error) {
console.warn('Cronologia browser non disponibile:', error);
}
}
function replaceBrowserState(name) {
try {
window.history.replaceState({ pidoDarts: true, screen: name }, '');
} catch (error) {
console.warn('Cronologia browser non disponibile:', error);
}
}
function setScreen(name, { pushInternal = true, pushBrowser = true, scroll = true, focus = true } = {}) {
const target = screens.find(screen => screen.dataset.screen === name);
if (!target) return;
screens.forEach(screen => screen.classList.toggle('is-active', screen === target));
if (pushInternal && historyStack.at(-1) !== name) historyStack.push(name);
currentScreen = name;
if (name !== 'settings') resetSettingsNavigation();
syncChrome(name);
if (moreMenu && !moreMenu.hidden) closeMoreMenu(false, 'replace');
if (pushBrowser) pushBrowserState(name);
if (scroll) window.scrollTo({ top: 0, behavior: scrollBehavior() });
if (focus) announceAndFocusScreen(target);
lastScrollY = 0;
document.dispatchEvent(new CustomEvent('pido:screenchange', { detail: { screen: name } }));
}
function goTo(name, push = true) {
setScreen(name, { pushInternal: push, pushBrowser: push });
}
function openMoreMenu() {
if (!moreMenu || currentScreen === 'game') return;
moreMenu.hidden = false;
document.body.classList.add('nav-modal-open');
syncBottomNavigation(currentScreen);
setNavCollapsed(false, { force: true });
if (!moreHasHistory) {
pushBrowserState(currentScreen);
moreHasHistory = true;
}
setTimeout(() => closeMoreMenuBtn?.focus(), 0);
}
function closeMoreMenu(restoreFocus = true, historyMode = 'consume') {
if (!moreMenu || moreMenu.hidden) return false;
moreMenu.hidden = true;
document.body.classList.remove('nav-modal-open');
syncBottomNavigation(currentScreen);
if (restoreFocus) moreNavBtn?.focus();
if (moreHasHistory) {
if (historyMode === 'consume') {
moreHasHistory = false;
suppressNextPop = true;
try { window.history.back(); }
catch (_) { suppressNextPop = false; }
} else if (historyMode === 'replace') {
moreHasHistory = false;
replaceBrowserState(currentScreen);
} else if (historyMode === 'from-pop') {
moreHasHistory = false;
}
}
return true;
}
function dispatchBackRequest(source) {
const detail = { source, screen: currentScreen, handled: false };
document.dispatchEvent(new CustomEvent('pido:backrequest', { detail }));
return detail.handled;
}
function manualBack() {
if (historyStack.length <= 1) return false;
historyStack.pop();
const previous = historyStack.at(-1) || 'home';
setScreen(previous, { pushInternal: false, pushBrowser: false });
return true;
}
function requestBack(source = 'button') {
if (moreMenu && !moreMenu.hidden) {
closeMoreMenu(false, source === 'browser' ? 'from-pop' : 'consume');
return true;
}
if (dispatchBackRequest(source)) {
if (source === 'browser') pushBrowserState(currentScreen);
return true;
}
if (historyStack.length <= 1) return false;
if (source === 'browser') return manualBack();
try {
window.history.back();
return true;
} catch (_) {
return manualBack();
}
}
document.querySelectorAll('[data-go]').forEach(btn => {
btn.addEventListener('click', () => goTo(btn.dataset.go));
});
bottomNavItems.forEach(btn => {
btn.addEventListener('click', () => {
if (btn.dataset.bottomGo === currentScreen) return;
goTo(btn.dataset.bottomGo);
});
});
bottomNavToggle?.addEventListener('click', () => setNavCollapsed(!navCollapsed, { force: true }));
moreNavBtn?.addEventListener('click', () => {
if (moreMenu.hidden) openMoreMenu();
else closeMoreMenu();
});
closeMoreMenuBtn?.addEventListener('click', () => closeMoreMenu());
moreMenu?.addEventListener('click', event => {
if (event.target === moreMenu) closeMoreMenu();
const button = event.target.closest('[data-more-go]');
if (!button) return;
const destination = button.dataset.moreGo;
pendingMoreDestination = destination;
closeMoreMenu(false, 'consume');
});
settingsOpenButtons.forEach(button => button.addEventListener('click', () => openSettingsSection(button.dataset.settingsOpen)));
settingsInnerOpenButtons.forEach(button => button.addEventListener('click', () => openSettingsInner(button.dataset.settingsInnerOpen)));
settingsInnerBackButtons.forEach(button => button.addEventListener('click', () => closeSettingsLayer()));
settingsSections.forEach(section => {
section.querySelector(':scope > summary')?.addEventListener('click', event => {
if (!appSettingsMode()) return;
event.preventDefault();
openSettingsSection(section.dataset.settingsSection);
});
});
document.addEventListener('pido:backrequest', event => {
if (settingsColorModal && !settingsColorModal.hidden) { closeSettingsColorModal(); event.detail.handled = true; return; }
if (currentScreen !== 'settings' || !appSettingsMode()) return;
if (closeSettingsLayer()) event.detail.handled = true;
});
backBtn.addEventListener('click', () => requestBack('button'));
homeBtn.addEventListener('click', () => {
if (currentScreen === 'game') { requestBack('button'); return; }
if (currentScreen !== 'home') goTo('home');
});
settingsShortcut.addEventListener('click', () => {
if (currentScreen === 'game') { requestBack('button'); return; }
goTo('settings');
});
backupShortcut?.addEventListener('click', () => {
if (currentScreen === 'game') return;
if (moreMenu && !moreMenu.hidden) closeMoreMenu(false, 'replace');
goTo('settings');
if (appSettingsMode()) openSettingsSection('data');
else {
const dataSection = document.querySelector('[data-settings-section="data"]');
if (dataSection) dataSection.open = true;
setTimeout(() => dataSection?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }), 0);
}
});
window.addEventListener('popstate', () => {
if (suppressNextPop) {
suppressNextPop = false;
if (pendingMoreDestination) {
const destination = pendingMoreDestination;
pendingMoreDestination = '';
goTo(destination);
}
return;
}
requestBack('browser');
});
document.addEventListener('keydown', event => {
if (event.key === 'Escape' && settingsColorModal && !settingsColorModal.hidden) { event.preventDefault(); closeSettingsColorModal(); return; }
if (event.key !== 'Escape' || currentScreen === 'game') return;
if (moreMenu && !moreMenu.hidden) {
event.preventDefault();
closeMoreMenu();
return;
}
if (document.body.classList.contains('modal-open')) return;
if (historyStack.length > 1) {
event.preventDefault();
requestBack('keyboard');
}
});
function resetNavigation(name, trail = ['home']) {
historyStack.length = 0;
trail.forEach(item => {
if (item && historyStack.at(-1) !== item) historyStack.push(item);
});
if (historyStack.at(-1) !== name) historyStack.push(name);
setScreen(name, { pushInternal: false, pushBrowser: true });
}
const SETTINGS_COLOR_META = {
customAccent: { title:'Colore principale', label:'COLORE PRINCIPALE', fallback:'#20d868' },
customBg: { title:'Colore dello sfondo', label:'COLORE SFONDO', fallback:'#030605' },
customText: { title:'Colore del testo', label:'COLORE TESTO', fallback:'#f2fff6' }
};
function syncThemeColorButtons() {
const rows=[[customAccentSwatch,customAccentHex,settings.customAccent],[customBgSwatch,customBgHex,settings.customBg],[customTextSwatch,customTextHex,settings.customText]];
rows.forEach(([swatch,label,value])=>{ if(swatch){swatch.style.background=value;swatch.style.setProperty('--settings-swatch',value);} if(label)label.textContent=String(value).toUpperCase(); });
}
function syncSettingsColorPickerUi() {
if(!settingsColorModal)return; const {h,s,v}=settingsColorState.hsv; const color=hsvToHex(h,s,v); const meta=SETTINGS_COLOR_META[settingsColorState.key];
settingsColorModal.style.setProperty('--picker-hue',h); settingsColorModal.style.setProperty('--picker-color',color); settingsColorSpectrum?.style.setProperty('--picker-hue',h); settingsColorHueSlider?.style.setProperty('--picker-hue',h); settingsColorPreview?.style.setProperty('--picker-color',color);
if(settingsColorSpectrumMarker){settingsColorSpectrumMarker.style.left=`${s}%`;settingsColorSpectrumMarker.style.top=`${100-v}%`;}
if(settingsColorHueSlider)settingsColorHueSlider.value=String(Math.round(h)); if(settingsColorHueValue)settingsColorHueValue.textContent=`${Math.round(h)}°`; if(settingsColorCodeSwatch)settingsColorCodeSwatch.style.background=color; if(settingsColorPreviewSwatch)settingsColorPreviewSwatch.style.background=color;
if(settingsColorHexInput){settingsColorHexInput.value=color.toUpperCase();settingsColorHexInput.classList.remove('invalid');} if(settingsColorPreviewHex)settingsColorPreviewHex.textContent=color.toUpperCase(); if(settingsColorTitle)settingsColorTitle.textContent=meta.title; if(settingsColorPreviewLabel)settingsColorPreviewLabel.textContent=meta.label; if(settingsColorPreview)settingsColorPreview.dataset.colorTarget=settingsColorState.key;
}
function openSettingsColorModal(key) { if(!settingsColorModal||!SETTINGS_COLOR_META[key])return; settingsColorState.key=key; settingsColorState.hsv=hexToHsv(settings[key]||SETTINGS_COLOR_META[key].fallback); settingsColorModal.hidden=false; document.body.classList.add('modal-open'); syncSettingsColorPickerUi(); setTimeout(()=>closeSettingsColorPicker?.focus(),0); }
function closeSettingsColorModal({apply=false}={}) { if(!settingsColorModal||settingsColorModal.hidden)return false; if(apply){const color=hsvToHex(settingsColorState.hsv.h,settingsColorState.hsv.s,settingsColorState.hsv.v);settings[settingsColorState.key]=color;settings.theme='custom';appearance.apply(settings);appearance.save(settings);syncSettingsUi();showToast(`${SETTINGS_COLOR_META[settingsColorState.key].title} salvato`);} settingsColorModal.hidden=true;document.body.classList.remove('modal-open');return true; }
function updateSettingsSpectrumFromPointer(x,y){if(!settingsColorSpectrum)return;const r=settingsColorSpectrum.getBoundingClientRect();if(!r.width||!r.height)return;settingsColorState.hsv.s=clamp(((x-r.left)/r.width)*100,0,100);settingsColorState.hsv.v=clamp(100-((y-r.top)/r.height)*100,0,100);syncSettingsColorPickerUi();}
function syncSettingsUi() {
themePicker.querySelectorAll('[data-theme-choice]').forEach(btn => {
btn.classList.toggle('selected', btn.dataset.themeChoice === settings.theme);
});
if (customThemeControls) customThemeControls.hidden = settings.theme !== 'custom';
if (customAccentColor) customAccentColor.value = settings.customAccent || appearance.defaults.customAccent;
if (customBgColor) customBgColor.value = settings.customBg || appearance.defaults.customBg;
if (customTextColor) customTextColor.value = settings.customText || appearance.defaults.customText;
syncThemeColorButtons();
backgroundPicker?.querySelectorAll('[data-background-choice]').forEach(btn => {
const selected = btn.dataset.backgroundChoice === settings.backgroundMode;
btn.classList.toggle('selected', selected);
btn.setAttribute('aria-pressed', String(selected));
});
if (customBackgroundTools) customBackgroundTools.hidden = settings.backgroundMode !== 'custom';
if (customBackgroundStatus) customBackgroundStatus.textContent = settings.customBgImage ? 'Immagine personalizzata salvata sul dispositivo.' : 'Nessuna immagine personalizzata salvata.';
if (removeCustomBackgroundBtn) removeCustomBackgroundBtn.hidden = !settings.customBgImage;
bgIntensity.value = settings.bgIntensity;
bgIntensityValue.value = `${settings.bgIntensity}%`;
animationsToggle.classList.toggle('is-on', settings.animations);
animationsToggle.setAttribute('aria-checked', String(settings.animations));
mobileLayoutPicker?.querySelectorAll('[data-mobile-layout-choice]').forEach(btn => {
const selected = btn.dataset.mobileLayoutChoice === settings.mobileLayout;
btn.classList.toggle('selected', selected);
btn.setAttribute('aria-pressed', String(selected));
});
navBehaviorPicker?.querySelectorAll('[data-nav-behavior]').forEach(btn => {
const selected = btn.dataset.navBehavior === settings.navBehavior;
btn.classList.toggle('selected', selected);
btn.setAttribute('aria-pressed', String(selected));
});
if (navBehaviorSettings) navBehaviorSettings.classList.toggle('is-disabled-setting', settings.mobileLayout === 'site');
if (navBehaviorNote) {
navBehaviorNote.textContent = settings.navBehavior === 'always'
? 'Sempre: la barra resta visibile mentre scorri.'
: settings.navBehavior === 'manual'
? 'Manuale: la barra cambia solo quando premi la linguetta ▼/▲.'
: 'Auto: scorrendo verso il basso la barra si nasconde; tornando verso l\'alto ricompare. La linguetta ▼/▲ resta disponibile.';
}
interfaceSizePicker?.querySelectorAll('[data-ui-scale]').forEach(btn => {
const selected = btn.dataset.uiScale === settings.uiScale;
btn.classList.toggle('selected', selected);
btn.setAttribute('aria-pressed', String(selected));
});
highContrastToggle?.classList.toggle('is-on', Boolean(settings.highContrast));
highContrastToggle?.setAttribute('aria-checked', String(Boolean(settings.highContrast)));
syncSettingsNavigation();
}
themePicker.addEventListener('click', event => {
const btn = event.target.closest('[data-theme-choice]');
if (!btn) return;
settings.theme = btn.dataset.themeChoice;
appearance.apply(settings);
appearance.save(settings);
syncSettingsUi();
showToast(`Tema ${btn.textContent.trim()} applicato`);
});
function updateCustomThemeColor(key, input) {
if (!input) return;
settings[key] = input.value;
settings.theme = 'custom';
appearance.apply(settings);
appearance.save(settings);
syncSettingsUi();
}
settingsColorButtons.forEach(button=>button.addEventListener('click',()=>openSettingsColorModal(button.dataset.settingsColorKey)));
closeSettingsColorPicker?.addEventListener('click',()=>closeSettingsColorModal());
cancelSettingsColorPicker?.addEventListener('click',()=>closeSettingsColorModal());
applySettingsColor?.addEventListener('click',()=>closeSettingsColorModal({apply:true}));
resetSettingsColor?.addEventListener('click',()=>{const meta=SETTINGS_COLOR_META[settingsColorState.key];settingsColorState.hsv=hexToHsv(meta.fallback);syncSettingsColorPickerUi();});
settingsColorModal?.addEventListener('click',event=>{if(event.target===settingsColorModal)closeSettingsColorModal();});
settingsColorHueSlider?.addEventListener('input',()=>{settingsColorState.hsv.h=Number(settingsColorHueSlider.value);syncSettingsColorPickerUi();});
settingsColorHexInput?.addEventListener('input',()=>{const n=normalizeHex(settingsColorHexInput.value);settingsColorHexInput.classList.toggle('invalid',!n);if(n){settingsColorState.hsv=hexToHsv(n);syncSettingsColorPickerUi();}});
settingsColorSpectrum?.addEventListener('pointerdown',event=>{settingsColorSpectrum.setPointerCapture?.(event.pointerId);updateSettingsSpectrumFromPointer(event.clientX,event.clientY);});
settingsColorSpectrum?.addEventListener('pointermove',event=>{if(!settingsColorSpectrum.hasPointerCapture?.(event.pointerId))return;updateSettingsSpectrumFromPointer(event.clientX,event.clientY);});
settingsColorSpectrum?.addEventListener('keydown',event=>{const step=event.shiftKey?10:2;if(event.key==='ArrowLeft')settingsColorState.hsv.s=clamp(settingsColorState.hsv.s-step,0,100);else if(event.key==='ArrowRight')settingsColorState.hsv.s=clamp(settingsColorState.hsv.s+step,0,100);else if(event.key==='ArrowUp')settingsColorState.hsv.v=clamp(settingsColorState.hsv.v+step,0,100);else if(event.key==='ArrowDown')settingsColorState.hsv.v=clamp(settingsColorState.hsv.v-step,0,100);else return;event.preventDefault();syncSettingsColorPickerUi();});
backgroundPicker?.addEventListener('click', event => {
const btn = event.target.closest('[data-background-choice]');
if (!btn) return;
settings.backgroundMode = btn.dataset.backgroundChoice;
appearance.apply(settings);
appearance.save(settings);
syncSettingsUi();
if (settings.backgroundMode === 'custom' && !settings.customBgImage) showToast('Scegli un’immagine personale');
else showToast(`Sfondo: ${btn.querySelector('strong')?.textContent || btn.textContent.trim()}`);
});
async function backgroundFileToDataUrl(file) {
if (!file) return '';
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
if (!allowedTypes.has(String(file.type || '').toLowerCase())) throw new Error('Formato non consentito. Usa PNG, JPEG o WebP.');
if (file.size > 10 * 1024 * 1024) throw new Error('L’immagine supera 10 MB.');
const original = await new Promise((resolve, reject) => {
const reader = new FileReader();
reader.onload = () => resolve(reader.result);
reader.onerror = () => reject(new Error('Impossibile leggere l’immagine.'));
reader.readAsDataURL(file);
});
const image = await new Promise((resolve, reject) => {
const img = new Image();
img.onload = () => resolve(img);
img.onerror = () => reject(new Error('Formato immagine non valido.'));
img.src = original;
});
if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 12000 || image.naturalHeight > 12000 || image.naturalWidth * image.naturalHeight > 60_000_000) {
throw new Error('Le dimensioni dell’immagine non sono supportate.');
}
const maxSide = 1600;
const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
const canvas = document.createElement('canvas');
canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Impossibile elaborare l’immagine.');
ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
const result = canvas.toDataURL('image/webp', 0.76);
if (result.length > 2_400_000) throw new Error('L’immagine resta troppo grande dopo l’ottimizzazione.');
return result;
}
chooseCustomBackgroundBtn?.addEventListener('click', () => customBackgroundInput?.click());
customBackgroundInput?.addEventListener('change', async () => {
const file = customBackgroundInput.files?.[0];
if (!file) return;
const originalText = chooseCustomBackgroundBtn?.textContent || '';
if (chooseCustomBackgroundBtn) {
chooseCustomBackgroundBtn.disabled = true;
chooseCustomBackgroundBtn.textContent = 'Ottimizzazione…';
}
try {
settings.customBgImage = await backgroundFileToDataUrl(file);
settings.backgroundMode = 'custom';
appearance.apply(settings);
appearance.save(settings);
syncSettingsUi();
showToast('Sfondo personalizzato salvato');
} catch (error) {
console.error('Sfondo personalizzato non riuscito:', error);
showToast(error.message || 'Impossibile usare questa immagine');
} finally {
if (chooseCustomBackgroundBtn) {
chooseCustomBackgroundBtn.disabled = false;
chooseCustomBackgroundBtn.textContent = originalText;
}
customBackgroundInput.value = '';
}
});
removeCustomBackgroundBtn?.addEventListener('click', () => {
settings.customBgImage = '';
settings.backgroundMode = 'image';
appearance.apply(settings);
appearance.save(settings);
syncSettingsUi();
showToast('Sfondo personalizzato rimosso');
});
bgIntensity.addEventListener('input', () => {
settings.bgIntensity = Number(bgIntensity.value);
appearance.apply(settings);
bgIntensityValue.value = `${settings.bgIntensity}%`;
});
bgIntensity.addEventListener('change', () => {
appearance.save(settings);
showToast('Intensità sfondo salvata');
});
animationsToggle.addEventListener('click', () => {
settings.animations = !settings.animations;
appearance.apply(settings);
appearance.save(settings);
syncSettingsUi();
showToast(settings.animations ? 'Animazioni attive' : 'Animazioni disattivate');
});
mobileLayoutPicker?.addEventListener('click', event => {
const btn = event.target.closest('[data-mobile-layout-choice]');
if (!btn) return;
settings.mobileLayout = btn.dataset.mobileLayoutChoice;
if (settings.mobileLayout === 'site') resetSettingsNavigation();
appearance.apply(settings);
appearance.save(settings);
setNavCollapsed(false, { force: true });
syncSettingsUi();
syncNavigationVisibility({ forceShow: true });
showToast(settings.mobileLayout === 'app' ? 'Stile App attivo' : 'Stile Sito attivo');
});
navBehaviorPicker?.addEventListener('click', event => {
const btn = event.target.closest('[data-nav-behavior]');
if (!btn || settings.mobileLayout === 'site') return;
settings.navBehavior = btn.dataset.navBehavior;
appearance.apply(settings);
appearance.save(settings);
setNavCollapsed(false, { force: true });
syncSettingsUi();
syncNavigationVisibility({ forceShow: true });
showToast(`Barra inferiore: ${btn.textContent.trim()}`);
});
interfaceSizePicker?.addEventListener('click', event => {
const btn = event.target.closest('[data-ui-scale]');
if (!btn) return;
settings.uiScale = btn.dataset.uiScale;
appearance.apply(settings);
appearance.save(settings);
syncSettingsUi();
showToast(`Interfaccia: ${btn.textContent.trim()}`);
});
highContrastToggle?.addEventListener('click', () => {
settings.highContrast = !settings.highContrast;
appearance.apply(settings);
appearance.save(settings);
syncSettingsUi();
showToast(settings.highContrast ? 'Contrasto elevato attivo' : 'Contrasto elevato disattivato');
});
resetAppearance.addEventListener('click', () => {
settings = { ...appearance.defaults };
appearance.apply(settings);
appearance.save(settings);
setNavCollapsed(false, { force: true });
syncSettingsUi();
syncNavigationVisibility({ forceShow: true });
showToast('Aspetto predefinito ripristinato');
});
function openResetAllDataModal() {
if (!resetAllDataModal) return;
resetAllDataModal.hidden = false;
document.body.classList.add('modal-open');
setTimeout(() => cancelResetAllDataBtn?.focus(), 0);
}
function closeResetAllDataModal() {
if (!resetAllDataModal || resetAllDataModal.hidden) return false;
resetAllDataModal.hidden = true;
document.body.classList.remove('modal-open');
resetAllDataBtn?.focus();
return true;
}
resetAllDataBtn?.addEventListener('click', openResetAllDataModal);
cancelResetAllDataBtn?.addEventListener('click', closeResetAllDataModal);
resetAllDataModal?.addEventListener('click', event => {
if (event.target === resetAllDataModal) closeResetAllDataModal();
});
confirmResetAllDataBtn?.addEventListener('click', async () => {
if (!window.PidoDartsDB?.clearAllData) {
showToast('Cancellazione dati non disponibile');
return;
}
const originalText = confirmResetAllDataBtn.textContent;
confirmResetAllDataBtn.disabled = true;
confirmResetAllDataBtn.textContent = 'Cancellazione…';
try {
await window.PidoDartsDB.clearAllData();
try {
localStorage.removeItem('pido-darts-appearance');
localStorage.removeItem('darts-v01-appearance');
localStorage.removeItem('pido-darts-last-backup');
localStorage.removeItem('pidoDartsRecentEmojis');
} catch (_) {  }
closeResetAllDataModal();
showToast('Dati cancellati. Pido Darts riparte da zero.');
setTimeout(() => window.location.reload(), 450);
} catch (error) {
console.error('Reset dati non riuscito:', error);
showToast('Impossibile cancellare i dati');
confirmResetAllDataBtn.disabled = false;
confirmResetAllDataBtn.textContent = originalText;
}
});
function visibleDialog() {
const dialogs = [...document.querySelectorAll('[role="dialog"]')];
return dialogs.reverse().find(dialog => {
if (dialog.closest('[hidden]')) return false;
const style = window.getComputedStyle(dialog);
return style.display !== 'none' && style.visibility !== 'hidden';
}) || null;
}
document.addEventListener('keydown', event => {
if (event.key !== 'Tab') return;
const dialog = visibleDialog();
if (!dialog) return;
const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
.filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null);
if (!focusable.length) {
event.preventDefault();
dialog.setAttribute('tabindex', '-1');
dialog.focus();
return;
}
const first = focusable[0];
const last = focusable[focusable.length - 1];
if (event.shiftKey && document.activeElement === first) {
event.preventDefault();
last.focus();
} else if (!event.shiftKey && document.activeElement === last) {
event.preventDefault();
first.focus();
}
}, true);
document.addEventListener('keydown', event => {
if (event.key === 'Escape' && resetAllDataModal && !resetAllDataModal.hidden) {
event.preventDefault();
closeResetAllDataModal();
}
});
function handleScroll() {
if (!navAvailable() || !isCompactNavViewport() || settings.navBehavior !== 'auto' || document.body.classList.contains('modal-open') || document.body.classList.contains('nav-modal-open')) {
lastScrollY = window.scrollY;
return;
}
const y = Math.max(0, window.scrollY);
const delta = y - lastScrollY;
if (y < 72) setNavCollapsed(false, { force: true });
else if (delta > 9) setNavCollapsed(true, { force: true });
else if (delta < -9) setNavCollapsed(false, { force: true });
lastScrollY = y;
}
window.addEventListener('scroll', () => {
if (scrollTicking) return;
scrollTicking = true;
window.requestAnimationFrame(() => {
handleScroll();
scrollTicking = false;
});
}, { passive: true });
window.addEventListener('resize', () => {
syncNavigationVisibility({ forceShow: !isCompactNavViewport() });
if (!appSettingsMode()) resetSettingsNavigation();
syncSettingsNavigation();
});
function updateConnectionStatus() {
offlineStatus.textContent = navigator.onLine ? 'Pronta per l\'uso' : 'Offline · l\'app resta disponibile';
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
screens.forEach(screen => screen.setAttribute('tabindex', '-1'));
updateConnectionStatus();
syncSettingsUi();
syncChrome('home');
replaceBrowserState('home');
window.PidoDartsApp = {
showToast,
goTo,
resetNavigation,
requestBack,
closeMoreMenu,
getCurrentScreen: () => currentScreen,
getSettings: () => ({ ...settings })
};
})();

;
(() => {
const db = window.PidoDartsDB;
const security = window.PidoDartsSecurity;
if (!db) return;
const state = {
players: [],
completedGames: [],
editingId: null,
deleteId: null,
avatarMode: 'initials',
emoji: '🎯',
imageData: '',
color: '#20d868',
emojiCategory: 'recent',
pickerColorBeforeOpen: '#20d868',
pickerHsv: { h: 140, s: 85, v: 85 }
};
const profilesGrid = document.getElementById('profilesGrid');
const emptyState = document.getElementById('playersEmptyState');
const playersCount = document.getElementById('playersCount');
const homePlayersCount = document.getElementById('homePlayersCount');
const playersPreview = document.getElementById('playersPreview');
const playersPreviewEmpty = document.getElementById('playersPreviewEmpty');
const newPlayerBtn = document.getElementById('newPlayerBtn');
const emptyNewPlayerBtn = document.getElementById('emptyNewPlayerBtn');
const playerModal = document.getElementById('playerModal');
const closePlayerModal = document.getElementById('closePlayerModal');
const cancelPlayerForm = document.getElementById('cancelPlayerForm');
const playerForm = document.getElementById('playerForm');
const playerId = document.getElementById('playerId');
const playerName = document.getElementById('playerName');
const playerNameError = document.getElementById('playerNameError');
const playerFormError = document.getElementById('playerFormError');
const playerModalEyebrow = document.getElementById('playerModalEyebrow');
const playerModalTitle = document.getElementById('playerModalTitle');
const avatarPreview = document.getElementById('avatarPreview');
const avatarModePicker = document.getElementById('avatarModePicker');
const avatarPanels = [...document.querySelectorAll('[data-avatar-panel]')];
const emojiGrid = document.getElementById('emojiGrid');
const avatarUpload = document.getElementById('avatarUpload');
const removeAvatarImage = document.getElementById('removeAvatarImage');
const colorPresets = document.getElementById('colorPresets');
const customPlayerColor = document.getElementById('customPlayerColor');
const openEmojiPicker = document.getElementById('openEmojiPicker');
const emojiPickerModal = document.getElementById('emojiPickerModal');
const closeEmojiPicker = document.getElementById('closeEmojiPicker');
const emojiCategoryTabs = document.getElementById('emojiCategoryTabs');
const emojiCategoryTitle = document.getElementById('emojiCategoryTitle');
const emojiPickerCount = document.getElementById('emojiPickerCount');
const emojiLibraryGrid = document.getElementById('emojiLibraryGrid');
const openPlayerColorPicker = document.getElementById('openPlayerColorPicker');
const playerColorModal = document.getElementById('playerColorModal');
const closePlayerColorPicker = document.getElementById('closePlayerColorPicker');
const cancelPlayerColorPicker = document.getElementById('cancelPlayerColorPicker');
const applyPlayerColor = document.getElementById('applyPlayerColor');
const resetCustomPlayerColor = document.getElementById('resetCustomPlayerColor');
const customColorSwatch = document.getElementById('customColorSwatch');
const customColorHex = document.getElementById('customColorHex');
const colorProfilePreview = document.getElementById('colorProfilePreview');
const colorPickerAvatar = document.getElementById('colorPickerAvatar');
const colorPickerName = document.getElementById('colorPickerName');
const colorPickerPreviewHex = document.getElementById('colorPickerPreviewHex');
const colorSpectrum = document.getElementById('colorSpectrum');
const colorSpectrumMarker = document.getElementById('colorSpectrumMarker');
const colorHueSlider = document.getElementById('colorHueSlider');
const colorHueValue = document.getElementById('colorHueValue');
const colorCodeSwatch = document.getElementById('colorCodeSwatch');
const colorHexInput = document.getElementById('colorHexInput');
const deleteModal = document.getElementById('deleteModal');
const deleteMessage = document.getElementById('deleteMessage');
const cancelDelete = document.getElementById('cancelDelete');
const confirmDelete = document.getElementById('confirmDelete');
const DEFAULT_STATS = {
games: 0,
wins: 0,
bestTurn: null,
averageTurn: null,
personalRecords: {}
};
const RECENT_EMOJI_KEY = 'pidoDartsRecentEmojis';
const EMOJI_CATEGORIES = {
recent: { label: 'Recenti', icon: '🕘', items: [] },
faces: { label: 'Faccine', icon: '😀', items: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😋','😎','🤓','🧐','🥳','🤩','🤠','😴','🤯','😤','😡','🥶','🥵','😱','🤗','🫡','🤔','🤭','🫢','😏','😜','🤪','😬','🥹','😈','👻','💀','🤖','👽'] },
animals: { label: 'Animali', icon: '🐾', items: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦅','🦉','🦆','🐺','🐗','🐴','🦄','🐝','🦋','🐌','🐞','🐢','🐍','🦎','🐙','🦑','🦈','🐬','🐳','🐊','🐉'] },
sport: { label: 'Sport', icon: '⚽', items: ['🎯','⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥅','🏒','🏑','🥍','🏏','⛳','🏹','🎣','🥊','🥋','⛸️','🎿','🏂','🏋️','🤸','🤺','🏊','🚴','🏆','🥇','🥈','🥉','🏅'] },
food: { label: 'Cibo', icon: '🍕', items: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥝','🍅','🥑','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🍝','🍜','🍣','🍤','🍦','🍩','🍪','🎂','🍫','🍿','☕','🥤','🍺','🍷'] },
objects: { label: 'Oggetti', icon: '🎮', items: ['🎮','🕹️','🎲','♟️','🎸','🎹','🥁','🎧','🎤','📱','💻','⌚','📷','💡','🔦','🧭','⏰','⌛','🔑','🗝️','🛠️','🔧','⚙️','🧲','🧪','🔬','🚀','✈️','🚗','🏍️','🚲','⛵','🏠','🏰','🎁','💎'] },
symbols: { label: 'Simboli', icon: '✨', items: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','💯','💥','💫','⭐','🌟','✨','⚡','🔥','🌈','☀️','🌙','❄️','☘️','🍀','👑','♠️','♥️','♦️','♣️','☯️','☮️','✅','❌','❗','❓','♾️'] },
flags: { label: 'Bandiere', icon: '🚩', items: ['🇮🇹','🇩🇪','🇦🇹','🇨🇭','🇩🇰','🇫🇷','🇪🇸','🇵🇹','🇬🇧','🇮🇪','🇳🇱','🇧🇪','🇱🇺','🇱🇮','🇸🇪','🇳🇴','🇫🇮','🇮🇸','🇵🇱','🇨🇿','🇸🇰','🇭🇺','🇬🇷','🇭🇷','🇸🇮','🇷🇴','🇺🇸','🇨🇦','🇯🇵','🇰🇷','🇧🇷','🇦🇷','🏴‍☠️','🏁','🚩'] }
};
function safeRecentEmojis() {
try {
const raw = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) || '[]');
return Array.isArray(raw) ? raw.filter(Boolean).slice(0, 24) : [];
} catch (_) {
return [];
}
}
function rememberEmoji(emoji) {
const next = [emoji, ...safeRecentEmojis().filter(item => item !== emoji)].slice(0, 24);
try { localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next)); } catch (_) {}
}
function clamp(value, min, max) {
return Math.min(max, Math.max(min, value));
}
function normalizeHex(value) {
const raw = String(value || '').trim().replace(/^#/, '');
if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(char => char + char).join('')}`.toLowerCase();
if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase();
return null;
}
function hsvToHex(h, s, v) {
h = ((Number(h) % 360) + 360) % 360;
s = clamp(Number(s), 0, 100) / 100;
v = clamp(Number(v), 0, 100) / 100;
const c = v * s;
const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
const m = v - c;
let r = 0, g = 0, b = 0;
if (h < 60) [r,g,b] = [c,x,0];
else if (h < 120) [r,g,b] = [x,c,0];
else if (h < 180) [r,g,b] = [0,c,x];
else if (h < 240) [r,g,b] = [0,x,c];
else if (h < 300) [r,g,b] = [x,0,c];
else [r,g,b] = [c,0,x];
const toHex = channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0');
return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function hexToHsv(hex) {
const normalized = normalizeHex(hex) || '#20d868';
const raw = normalized.slice(1);
const r = parseInt(raw.slice(0,2),16) / 255;
const g = parseInt(raw.slice(2,4),16) / 255;
const b = parseInt(raw.slice(4,6),16) / 255;
const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max - min;
let h = 0;
if (delta) {
if (max === r) h = 60 * (((g - b) / delta) % 6);
else if (max === g) h = 60 * (((b - r) / delta) + 2);
else h = 60 * (((r - g) / delta) + 4);
}
if (h < 0) h += 360;
const s = max === 0 ? 0 : delta / max;
return { h: Math.round(h), s: Math.round(s * 100), v: Math.round(max * 100) };
}
function showToast(message) {
if (window.PidoDartsApp?.showToast) window.PidoDartsApp.showToast(message);
}
function initials(name) {
const trimmed = String(name || '').trim();
if (!trimmed) return 'A';
const parts = trimmed.split(/\s+/).filter(Boolean);
if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}
function textColorFor(hex) {
const clean = String(hex || '#20d868').replace('#', '');
if (!/^[0-9a-f]{6}$/i.test(clean)) return '#041008';
const r = parseInt(clean.slice(0, 2), 16);
const g = parseInt(clean.slice(2, 4), 16);
const b = parseInt(clean.slice(4, 6), 16);
const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
return luminance > 0.58 ? '#07100b' : '#ffffff';
}
function applyAvatar(element, player, large = false) {
const color = security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868';
element.style.setProperty('--player-color', color);
element.style.setProperty('--player-text-color', textColorFor(color));
element.classList.toggle('large', large);
element.classList.remove('has-image');
element.style.backgroundImage = '';
element.textContent = '';
const avatarImage = security?.safeImageDataUrl ? security.safeImageDataUrl(player.avatarValue, 2_000_000) : '';
if (player.avatarType === 'image' && avatarImage) {
element.classList.add('has-image');
element.style.backgroundImage = security.cssImageUrl(avatarImage, 2_000_000);
element.setAttribute('aria-label', `Avatar di ${player.name || 'giocatore'}`);
return;
}
const span = document.createElement('span');
span.textContent = player.avatarType === 'emoji' ? String(player.avatarValue || '🎯').slice(0, 32) : initials(player.name);
element.appendChild(span);
}
function makeStat(label, value) {
const item = document.createElement('div');
item.className = 'profile-stat';
const strong = document.createElement('strong');
strong.textContent = value;
const small = document.createElement('small');
small.textContent = label;
item.append(strong, small);
return item;
}
function aggregatePlayerStats(playerId) {
let games = 0;
let wins = 0;
let bestTurn = 0;
let totalPoints = 0;
let totalTurns = 0;
state.completedGames.forEach(game => {
const participant = (game.participants || []).find(item => item.playerId === playerId);
if (!participant) return;
games += 1;
if (game.winnerId === playerId) wins += 1;
const stats = participant.stats || {};
bestTurn = Math.max(bestTurn, Number(stats.bestTurn || 0));
totalPoints += Number(stats.pointsScored || 0);
totalTurns += Number(stats.turns || 0);
});
return {
games,
wins,
bestTurn: bestTurn || null,
averageTurn: totalTurns ? totalPoints / totalTurns : null
};
}
function renderProfiles() {
profilesGrid.textContent = '';
const hasPlayers = state.players.length > 0;
emptyState.hidden = hasPlayers;
playersCount.textContent = String(state.players.length);
homePlayersCount.textContent = `${state.players.length} ${state.players.length === 1 ? 'profilo' : 'profili'}`;
state.players.forEach((player, index) => {
const card = document.createElement('article');
card.className = 'profile-card';
card.style.setProperty('--player-color', security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868');
const top = document.createElement('div');
top.className = 'profile-card-top';
const avatar = document.createElement('div');
avatar.className = 'avatar-preview';
applyAvatar(avatar, player);
const identity = document.createElement('div');
identity.className = 'profile-identity';
const order = document.createElement('span');
order.className = 'profile-number';
order.textContent = `#${index + 1}`;
const name = document.createElement('h3');
name.textContent = player.name;
const saved = document.createElement('small');
saved.textContent = 'Profilo locale';
identity.append(order, name, saved);
top.append(avatar, identity);
const stats = document.createElement('div');
stats.className = 'profile-stats';
const currentStats = { ...DEFAULT_STATS, ...(player.stats || {}), ...aggregatePlayerStats(player.id) };
stats.append(
makeStat('Partite', String(currentStats.games || 0)),
makeStat('Vittorie', String(currentStats.wins || 0)),
makeStat('Miglior turno', currentStats.bestTurn ?? '—')
);
const actions = document.createElement('div');
actions.className = 'profile-actions';
const edit = document.createElement('button');
edit.type = 'button';
edit.className = 'secondary-btn action-inline';
edit.dataset.editPlayer = player.id;
edit.textContent = '✏️ Modifica';
const remove = document.createElement('button');
remove.type = 'button';
remove.className = 'ghost-danger action-inline';
remove.dataset.deletePlayer = player.id;
remove.textContent = '🗑️ Elimina';
actions.append(edit, remove);
card.append(top, stats, actions);
profilesGrid.appendChild(card);
});
renderMultiplayerPreview();
}
function renderMultiplayerPreview() {
if (!playersPreview || !playersPreviewEmpty) return;
playersPreview.textContent = '';
const previewPlayers = state.players.slice(0, 8);
const hasPlayers = previewPlayers.length > 0;
playersPreview.hidden = !hasPlayers;
playersPreviewEmpty.hidden = hasPlayers;
previewPlayers.forEach((player, index) => {
const pill = document.createElement('button');
pill.type = 'button';
pill.className = `player-pill${index === 0 ? ' active' : ''}`;
pill.style.setProperty('--player-color', security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868');
const order = document.createElement('b');
order.textContent = `#${index + 1}`;
const avatar = document.createElement('span');
avatar.className = 'avatar-preview avatar-preview-small';
applyAvatar(avatar, player);
const info = document.createElement('span');
const name = document.createElement('span');
name.className = 'player-pill-name';
name.textContent = player.name;
const score = document.createElement('small');
score.textContent = '301';
info.append(name, score);
pill.append(order, avatar, info);
playersPreview.appendChild(pill);
});
}
function ensureQuickEmojiSelection() {
const more = document.getElementById('openEmojiPicker');
if (!more) return;
emojiGrid.querySelectorAll('.emoji-picked-extra').forEach(button => button.remove());
const exists = [...emojiGrid.querySelectorAll('[data-emoji]')].some(button => button.dataset.emoji === state.emoji);
if (!exists && state.emoji) {
const button = document.createElement('button');
button.type = 'button';
button.className = 'emoji-picked-extra';
button.dataset.emoji = state.emoji;
button.textContent = state.emoji;
button.setAttribute('aria-label', `Emoji selezionata ${state.emoji}`);
emojiGrid.insertBefore(button, more);
}
}
function renderEmojiCategories() {
emojiCategoryTabs.replaceChildren();
Object.entries(EMOJI_CATEGORIES).forEach(([key, category]) => {
const button = document.createElement('button');
button.type = 'button';
button.dataset.emojiCategory = key;
button.classList.toggle('selected', key === state.emojiCategory);
button.textContent = `${category.icon} ${category.label}`;
emojiCategoryTabs.appendChild(button);
});
}
function renderEmojiLibrary() {
const category = EMOJI_CATEGORIES[state.emojiCategory] || EMOJI_CATEGORIES.faces;
const items = state.emojiCategory === 'recent' ? safeRecentEmojis() : category.items;
emojiCategoryTitle.textContent = category.label;
emojiPickerCount.textContent = items.length ? `${items.length} emoji` : 'Nessuna emoji recente';
emojiLibraryGrid.replaceChildren();
if (!items.length) {
const empty = document.createElement('div');
empty.className = 'emoji-library-empty';
empty.textContent = 'Le emoji che scegli appariranno qui per ritrovarle più velocemente.';
emojiLibraryGrid.appendChild(empty);
return;
}
items.forEach(emoji => {
const button = document.createElement('button');
button.type = 'button';
button.dataset.libraryEmoji = emoji;
button.textContent = emoji;
button.classList.toggle('selected', emoji === state.emoji);
button.setAttribute('aria-label', `Usa ${emoji} come avatar`);
emojiLibraryGrid.appendChild(button);
});
}
function openEmojiLibrary() {
state.emojiCategory = safeRecentEmojis().length ? 'recent' : 'faces';
renderEmojiCategories();
renderEmojiLibrary();
emojiPickerModal.hidden = false;
}
function closeEmojiLibrary() {
emojiPickerModal.hidden = true;
}
function syncColorPickerUi() {
const { h, s, v } = state.pickerHsv;
const color = hsvToHex(h, s, v);
state.color = color;
customPlayerColor.value = color;
playerColorModal.style.setProperty('--picker-hue', h);
colorSpectrum.style.setProperty('--picker-hue', h);
colorHueSlider.style.setProperty('--picker-hue', h);
playerColorModal.style.setProperty('--picker-color', color);
colorProfilePreview.style.setProperty('--picker-color', color);
colorSpectrumMarker.style.left = `${s}%`;
colorSpectrumMarker.style.top = `${100 - v}%`;
colorHueSlider.value = String(Math.round(h));
colorHueValue.textContent = `${Math.round(h)}°`;
colorCodeSwatch.style.background = color;
colorHexInput.value = color.toUpperCase();
colorHexInput.classList.remove('invalid');
colorPickerPreviewHex.textContent = color.toUpperCase();
colorPickerName.textContent = playerName.value.trim() || 'Giocatore';
applyAvatar(colorPickerAvatar, {
name: playerName.value,
color,
avatarType: state.avatarMode,
avatarValue: state.avatarMode === 'emoji' ? state.emoji : state.imageData
});
syncEditorUi(false);
}
function setPickerFromHex(hex) {
const normalized = normalizeHex(hex);
if (!normalized) return false;
state.pickerHsv = hexToHsv(normalized);
syncColorPickerUi();
return true;
}
function openColorPicker() {
state.pickerColorBeforeOpen = state.color;
state.pickerHsv = hexToHsv(state.color);
playerColorModal.hidden = false;
syncColorPickerUi();
}
function closeColorPicker({ restore = false } = {}) {
if (restore) state.color = state.pickerColorBeforeOpen;
playerColorModal.hidden = true;
syncEditorUi();
}
function updateSpectrumFromPointer(clientX, clientY) {
const rect = colorSpectrum.getBoundingClientRect();
if (!rect.width || !rect.height) return;
state.pickerHsv.s = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
state.pickerHsv.v = clamp(100 - ((clientY - rect.top) / rect.height) * 100, 0, 100);
syncColorPickerUi();
}
function setPlayerNameError(message = '') {
const text = String(message || '');
if (playerNameError) {
playerNameError.textContent = text;
playerNameError.hidden = !text;
}
playerName.setAttribute('aria-invalid', text ? 'true' : 'false');
playerName.closest('.form-field')?.classList.toggle('has-error', Boolean(text));
}
function focusNameFieldWithError() {
playerName.focus();
window.setTimeout(() => {
try { playerName.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
}, 60);
}
function resetEditor() {
state.editingId = null;
state.avatarMode = 'initials';
state.emoji = '🎯';
state.imageData = '';
state.color = '#20d868';
playerId.value = '';
playerName.value = '';
avatarUpload.value = '';
customPlayerColor.value = state.color;
playerFormError.textContent = '';
setPlayerNameError('');
playerModalEyebrow.textContent = 'NUOVO PROFILO';
playerModalTitle.textContent = 'Crea giocatore';
syncEditorUi();
}
function syncEditorUi(refreshPicker = true) {
avatarModePicker.querySelectorAll('[data-avatar-mode]').forEach(button => {
button.classList.toggle('selected', button.dataset.avatarMode === state.avatarMode);
});
avatarPanels.forEach(panel => {
panel.hidden = panel.dataset.avatarPanel !== state.avatarMode;
});
ensureQuickEmojiSelection();
emojiGrid.querySelectorAll('[data-emoji]').forEach(button => {
button.classList.toggle('selected', button.dataset.emoji === state.emoji);
});
let presetMatch = false;
colorPresets.querySelectorAll('[data-player-color]').forEach(button => {
const selected = button.dataset.playerColor.toLowerCase() === state.color.toLowerCase();
button.classList.toggle('selected', selected);
presetMatch ||= selected;
});
customPlayerColor.value = state.color;
customColorSwatch.style.background = state.color;
customColorSwatch.style.setProperty('--custom-swatch', state.color);
customColorHex.textContent = state.color.toUpperCase();
openPlayerColorPicker.classList.toggle('selected', !presetMatch);
removeAvatarImage.classList.toggle('is-hidden', !state.imageData);
applyAvatar(avatarPreview, {
name: playerName.value,
color: state.color,
avatarType: state.avatarMode,
avatarValue: state.avatarMode === 'emoji' ? state.emoji : state.imageData
}, true);
}
function openModal(player = null) {
if (player) {
state.editingId = player.id;
state.avatarMode = ['initials', 'emoji', 'image'].includes(player.avatarType) ? player.avatarType : 'initials';
state.emoji = player.avatarType === 'emoji' ? String(player.avatarValue || '🎯').slice(0, 32) : '🎯';
state.imageData = player.avatarType === 'image' && security?.safeImageDataUrl ? security.safeImageDataUrl(player.avatarValue, 2_000_000) : '';
if (state.avatarMode === 'image' && !state.imageData) state.avatarMode = 'initials';
state.color = security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868';
playerId.value = player.id;
playerName.value = player.name || '';
avatarUpload.value = '';
playerFormError.textContent = '';
setPlayerNameError('');
playerModalEyebrow.textContent = 'MODIFICA PROFILO';
playerModalTitle.textContent = 'Modifica giocatore';
syncEditorUi();
} else {
resetEditor();
}
playerModal.hidden = false;
document.body.classList.add('modal-open');
setTimeout(() => playerName.focus(), 30);
}
function closeModal() {
emojiPickerModal.hidden = true;
playerColorModal.hidden = true;
playerModal.hidden = true;
document.body.classList.remove('modal-open');
playerFormError.textContent = '';
setPlayerNameError('');
}
function openDeleteModal(player) {
state.deleteId = player.id;
deleteMessage.textContent = `Il profilo “${player.name}” verrà rimosso da questo dispositivo. Le partite già presenti nello storico resteranno consultabili con il nome e l’avatar salvati al momento della partita.`;
deleteModal.hidden = false;
document.body.classList.add('modal-open');
}
function closeDeleteModal() {
state.deleteId = null;
deleteModal.hidden = true;
document.body.classList.remove('modal-open');
}
async function fileToSquareDataUrl(file) {
if (!file) return '';
const maxBytes = 8 * 1024 * 1024;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
if (!allowedTypes.has(String(file.type || '').toLowerCase())) throw new Error('Formato non consentito. Usa PNG, JPEG o WebP.');
if (file.size > maxBytes) throw new Error('La foto è troppo grande. Scegline una sotto gli 8 MB.');
const dataUrl = await new Promise((resolve, reject) => {
const reader = new FileReader();
reader.onload = () => resolve(reader.result);
reader.onerror = () => reject(new Error('Impossibile leggere la foto.'));
reader.readAsDataURL(file);
});
const image = await new Promise((resolve, reject) => {
const img = new Image();
img.onload = () => resolve(img);
img.onerror = () => reject(new Error('Formato immagine non valido.'));
img.src = dataUrl;
});
if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 12000 || image.naturalHeight > 12000 || image.naturalWidth * image.naturalHeight > 60_000_000) {
throw new Error('Le dimensioni della foto non sono supportate.');
}
const size = 320;
const canvas = document.createElement('canvas');
canvas.width = size;
canvas.height = size;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Impossibile elaborare la foto.');
const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
const sx = (image.naturalWidth - sourceSize) / 2;
const sy = (image.naturalHeight - sourceSize) / 2;
ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
return canvas.toDataURL('image/webp', 0.82);
}
async function loadPlayers() {
try {
const [players, completedGames] = await Promise.all([
db.getPlayers(),
db.getCompletedGames ? db.getCompletedGames() : Promise.resolve([])
]);
state.players = players || [];
state.completedGames = completedGames || [];
renderProfiles();
} catch (error) {
console.error(error);
profilesGrid.replaceChildren();
const errorBox = document.createElement('div');
errorBox.className = 'database-error';
errorBox.textContent = 'Impossibile aprire l’archivio locale dei giocatori. Prova ad aprire Pido Darts in un browser moderno o tramite localhost.';
profilesGrid.appendChild(errorBox);
emptyState.hidden = true;
showToast('Errore nell’archivio locale');
}
}
newPlayerBtn.addEventListener('click', () => openModal());
emptyNewPlayerBtn.addEventListener('click', () => openModal());
closePlayerModal.addEventListener('click', closeModal);
cancelPlayerForm.addEventListener('click', closeModal);
playerModal.addEventListener('click', event => {
if (event.target === playerModal) closeModal();
});
deleteModal.addEventListener('click', event => {
if (event.target === deleteModal) closeDeleteModal();
});
playerName.addEventListener('input', () => {
setPlayerNameError('');
playerFormError.textContent = '';
syncEditorUi();
});
avatarModePicker.addEventListener('click', event => {
const button = event.target.closest('[data-avatar-mode]');
if (!button) return;
state.avatarMode = button.dataset.avatarMode;
syncEditorUi();
});
emojiGrid.addEventListener('click', event => {
const button = event.target.closest('[data-emoji]');
if (!button) return;
state.emoji = button.dataset.emoji;
state.avatarMode = 'emoji';
rememberEmoji(state.emoji);
syncEditorUi();
});
colorPresets.addEventListener('click', event => {
const button = event.target.closest('[data-player-color]');
if (!button) return;
state.color = button.dataset.playerColor;
syncEditorUi();
});
openEmojiPicker.addEventListener('click', openEmojiLibrary);
closeEmojiPicker.addEventListener('click', closeEmojiLibrary);
emojiPickerModal.addEventListener('click', event => {
if (event.target === emojiPickerModal) closeEmojiLibrary();
});
emojiCategoryTabs.addEventListener('click', event => {
const button = event.target.closest('[data-emoji-category]');
if (!button) return;
state.emojiCategory = button.dataset.emojiCategory;
renderEmojiCategories();
renderEmojiLibrary();
});
emojiLibraryGrid.addEventListener('click', event => {
const button = event.target.closest('[data-library-emoji]');
if (!button) return;
state.emoji = button.dataset.libraryEmoji;
state.avatarMode = 'emoji';
rememberEmoji(state.emoji);
closeEmojiLibrary();
syncEditorUi();
});
openPlayerColorPicker.addEventListener('click', openColorPicker);
closePlayerColorPicker.addEventListener('click', () => closeColorPicker({ restore: true }));
cancelPlayerColorPicker.addEventListener('click', () => closeColorPicker({ restore: true }));
applyPlayerColor.addEventListener('click', () => closeColorPicker({ restore: false }));
resetCustomPlayerColor.addEventListener('click', () => {
state.pickerHsv = hexToHsv('#20d868');
syncColorPickerUi();
});
playerColorModal.addEventListener('click', event => {
if (event.target === playerColorModal) closeColorPicker({ restore: true });
});
colorHueSlider.addEventListener('input', () => {
state.pickerHsv.h = Number(colorHueSlider.value);
syncColorPickerUi();
});
colorHexInput.addEventListener('input', () => {
const normalized = normalizeHex(colorHexInput.value);
colorHexInput.classList.toggle('invalid', !normalized);
if (normalized) setPickerFromHex(normalized);
});
colorSpectrum.addEventListener('pointerdown', event => {
colorSpectrum.setPointerCapture?.(event.pointerId);
updateSpectrumFromPointer(event.clientX, event.clientY);
});
colorSpectrum.addEventListener('pointermove', event => {
if (!colorSpectrum.hasPointerCapture?.(event.pointerId)) return;
updateSpectrumFromPointer(event.clientX, event.clientY);
});
colorSpectrum.addEventListener('keydown', event => {
const step = event.shiftKey ? 10 : 2;
if (event.key === 'ArrowLeft') state.pickerHsv.s = clamp(state.pickerHsv.s - step, 0, 100);
else if (event.key === 'ArrowRight') state.pickerHsv.s = clamp(state.pickerHsv.s + step, 0, 100);
else if (event.key === 'ArrowUp') state.pickerHsv.v = clamp(state.pickerHsv.v + step, 0, 100);
else if (event.key === 'ArrowDown') state.pickerHsv.v = clamp(state.pickerHsv.v - step, 0, 100);
else return;
event.preventDefault();
syncColorPickerUi();
});
avatarUpload.addEventListener('change', async () => {
const file = avatarUpload.files?.[0];
if (!file) return;
try {
playerFormError.textContent = 'Elaborazione foto…';
state.imageData = await fileToSquareDataUrl(file);
state.avatarMode = 'image';
playerFormError.textContent = '';
syncEditorUi();
} catch (error) {
state.imageData = '';
avatarUpload.value = '';
playerFormError.textContent = error.message || 'Impossibile usare questa foto.';
syncEditorUi();
}
});
removeAvatarImage.addEventListener('click', () => {
state.imageData = '';
avatarUpload.value = '';
state.avatarMode = 'initials';
syncEditorUi();
});
profilesGrid.addEventListener('click', event => {
const editButton = event.target.closest('[data-edit-player]');
if (editButton) {
const player = state.players.find(item => item.id === editButton.dataset.editPlayer);
if (player) openModal(player);
return;
}
const deleteButton = event.target.closest('[data-delete-player]');
if (deleteButton) {
const player = state.players.find(item => item.id === deleteButton.dataset.deletePlayer);
if (player) openDeleteModal(player);
}
});
playerForm.addEventListener('submit', async event => {
event.preventDefault();
const name = playerName.value.trim().replace(/\s+/g, ' ');
if (!name) {
setPlayerNameError('Inserisci il nome del giocatore.');
focusNameFieldWithError();
return;
}
if (name.length > 24) {
setPlayerNameError('Il nome può contenere al massimo 24 caratteri.');
focusNameFieldWithError();
return;
}
const normalizedName = name.toLocaleLowerCase('it-IT');
const duplicate = state.players.find(player =>
player.id !== state.editingId &&
String(player.name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('it-IT') === normalizedName
);
if (duplicate) {
setPlayerNameError(`Esiste già un giocatore chiamato “${duplicate.name}”. Cambia almeno una lettera o aggiungi un numero.`);
focusNameFieldWithError();
return;
}
setPlayerNameError('');
if (state.avatarMode === 'image' && !state.imageData) {
playerFormError.textContent = 'Scegli una foto oppure usa Iniziale o Emoji.';
return;
}
const existing = state.players.find(player => player.id === state.editingId);
const now = Date.now();
const player = {
id: existing?.id || db.createId(),
name,
color: state.color,
avatarType: state.avatarMode,
avatarValue: state.avatarMode === 'emoji' ? state.emoji : (state.avatarMode === 'image' ? state.imageData : ''),
stats: existing?.stats || { ...DEFAULT_STATS },
createdAt: existing?.createdAt || now,
updatedAt: now
};
try {
await db.savePlayer(player);
closeModal();
await loadPlayers();
showToast(existing ? `${name} aggiornato` : `${name} creato`);
} catch (error) {
console.error(error);
playerFormError.textContent = 'Non sono riuscito a salvare il profilo sul dispositivo.';
}
});
cancelDelete.addEventListener('click', closeDeleteModal);
confirmDelete.addEventListener('click', async () => {
const player = state.players.find(item => item.id === state.deleteId);
if (!player) {
closeDeleteModal();
return;
}
try {
await db.deletePlayer(player.id);
closeDeleteModal();
await loadPlayers();
showToast(`${player.name} eliminato`);
} catch (error) {
console.error(error);
closeDeleteModal();
showToast('Impossibile eliminare il profilo');
}
});
document.addEventListener('pido:screenchange', event => {
if (event.detail?.screen === 'players') loadPlayers();
});
document.addEventListener('pido:statschanged', () => loadPlayers());
document.addEventListener('pido:backrequest', event => {
if (!playerColorModal.hidden) {
closeColorPicker({ restore: true });
event.detail.handled = true;
return;
}
if (!emojiPickerModal.hidden) {
closeEmojiLibrary();
event.detail.handled = true;
return;
}
if (!deleteModal.hidden) {
closeDeleteModal();
event.detail.handled = true;
return;
}
if (!playerModal.hidden) {
closeModal();
event.detail.handled = true;
}
});
document.addEventListener('keydown', event => {
if (event.key !== 'Escape') return;
if (!playerColorModal.hidden) closeColorPicker({ restore: true });
else if (!emojiPickerModal.hidden) closeEmojiLibrary();
else if (!deleteModal.hidden) closeDeleteModal();
else if (!playerModal.hidden) closeModal();
});
loadPlayers();
})();

;
(() => {
const MAX_DARTS = 3;
function clampInteger(value, min, max) {
const parsed = Number.parseInt(value, 10);
if (!Number.isFinite(parsed)) return null;
return Math.min(max, Math.max(min, parsed));
}
function makeDart(number, multiplier = 1) {
const safeNumber = clampInteger(number, 1, 20);
const safeMultiplier = clampInteger(multiplier, 1, 3);
if (safeNumber === null || safeMultiplier === null) throw new Error('Freccetta non valida.');
const prefix = safeMultiplier === 2 ? 'D' : (safeMultiplier === 3 ? 'T' : '');
const type = safeMultiplier === 1 ? 'Normale' : (safeMultiplier === 2 ? 'Doppio' : 'Triplo');
return {
kind: 'number',
number: safeNumber,
multiplier: safeMultiplier,
label: `${prefix}${safeNumber}`,
description: `${type} ${safeNumber}`,
value: safeNumber * safeMultiplier
};
}
function makeSpecial(kind) {
const specials = {
miss: { kind: 'miss', label: 'Miss', description: 'Miss', value: 0 },
bull: { kind: 'bull', label: 'Bull', description: 'Bull 25', value: 25 },
center: { kind: 'center', label: 'Centro', description: 'Centro 50', value: 50 }
};
if (!specials[kind]) throw new Error('Tiro speciale non valido.');
return { ...specials[kind] };
}
function turnTotal(darts = []) {
return darts.reduce((sum, dart) => sum + Number(dart?.value || 0), 0);
}
function evaluateTurn(scoreBefore, darts = []) {
const startingScore = Math.max(0, Number.parseInt(scoreBefore, 10) || 0);
const total = turnTotal(darts);
const rawRemaining = startingScore - total;
const bust = rawRemaining < 0;
const won = rawRemaining === 0 && !bust;
return {
total,
rawRemaining,
scoreAfter: bust ? startingScore : Math.max(0, rawRemaining),
bust,
won,
dartsUsed: darts.length
};
}
function canAddDart(darts = []) {
return darts.length < MAX_DARTS;
}
window.PidoDartsGameEngine = {
MAX_DARTS,
makeDart,
makeSpecial,
turnTotal,
evaluateTurn,
canAddDart
};
})();

;
(() => {
const engine = window.PidoDartsGameEngine;
if (!engine) return;
const PRESETS = {
beginner: { key: 'beginner', label: 'Principiante', targetAverage: 20, spread: 18, checkoutChance: 0.18, missChance: 0.16 },
easy: { key: 'easy', label: 'Facile', targetAverage: 30, spread: 17, checkoutChance: 0.32, missChance: 0.10 },
medium: { key: 'medium', label: 'Medio', targetAverage: 43, spread: 16, checkoutChance: 0.52, missChance: 0.06 },
hard: { key: 'hard', label: 'Difficile', targetAverage: 58, spread: 15, checkoutChance: 0.76, missChance: 0.03 }
};
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function normalRandom() {
let u = 0, v = 0;
while (u === 0) u = Math.random();
while (v === 0) v = Math.random();
return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function allDarts() {
const darts = [engine.makeSpecial('miss')];
for (let n = 1; n <= 20; n += 1) {
darts.push(engine.makeDart(n, 1), engine.makeDart(n, 2), engine.makeDart(n, 3));
}
darts.push(engine.makeSpecial('bull'), engine.makeSpecial('center'));
return darts;
}
const DARTS = allDarts();
const SCORING_DARTS = DARTS.filter(d => d.value > 0);
function cloneDart(dart) { return { ...dart }; }
function findCheckout(score, maxDarts = 3) {
const target = Number(score);
if (!Number.isInteger(target) || target <= 0 || target > 180) return null;
const candidates = [...SCORING_DARTS].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
const memo = new Map();
function search(remaining, left) {
if (remaining === 0) return [];
if (left <= 0 || remaining < 0 || remaining > 60 * left) return null;
const key = `${remaining}|${left}`;
if (memo.has(key)) return memo.get(key);
for (const dart of candidates) {
if (dart.value > remaining) continue;
const rest = search(remaining - dart.value, left - 1);
if (rest) {
const result = [cloneDart(dart), ...rest];
memo.set(key, result);
return result;
}
}
memo.set(key, null);
return null;
}
for (let darts = 1; darts <= maxDarts; darts += 1) {
const result = search(target, darts);
if (result) return result;
}
return null;
}
function equivalentPreset(targetAverage) {
const avg = Number(targetAverage) || 0;
if (avg < 25) return 'beginner';
if (avg < 37) return 'easy';
if (avg < 51) return 'medium';
return 'hard';
}
function profileFor(key, overrides = {}) {
const base = PRESETS[key] || PRESETS.medium;
return { ...base, ...overrides, key: overrides.key || base.key, label: overrides.label || base.label };
}
function adaptiveProfile(targetAverage, sampleCount = 0, note = '') {
const target = clamp(targetAverage, 18, 68);
const equivalent = equivalentPreset(target);
const ref = PRESETS[equivalent];
return {
key: 'adaptive',
label: 'Adattivo',
targetAverage: target,
spread: clamp(ref.spread + 1, 12, 20),
checkoutChance: clamp(ref.checkoutChance * 0.95, 0.15, 0.78),
missChance: clamp(ref.missChance, 0.025, 0.16),
equivalent,
sampleCount,
note
};
}
function chooseScoringDart(profile, scoreBefore) {
if (Math.random() < Number(profile.missChance || 0)) return engine.makeSpecial('miss');
const desired = clamp((Number(profile.targetAverage) || 40) / 3 + normalRandom() * ((Number(profile.spread) || 16) / 3), 1, 60);
const remaining = Number(scoreBefore) || 0;
const pool = SCORING_DARTS.filter(d => remaining <= 5 ? d.value <= Math.max(remaining + 4, 1) : true);
let best = pool[0];
let bestScore = Infinity;
for (const dart of pool) {
const distance = Math.abs(dart.value - desired);
const bustPenalty = dart.value > remaining ? (profile.key === 'beginner' ? 5 : 18) : 0;
const tripleBonus = dart.multiplier === 3 && desired > 16 ? -0.8 : 0;
const jitter = Math.random() * 3.5;
const score = distance + bustPenalty + tripleBonus + jitter;
if (score < bestScore) { best = dart; bestScore = score; }
}
return cloneDart(best);
}
function simulateTurn(scoreBefore, profileInput) {
const profile = profileInput?.key === 'adaptive'
? { ...adaptiveProfile(profileInput.targetAverage, profileInput.sampleCount, profileInput.note), ...profileInput }
: profileFor(profileInput?.key || 'medium', profileInput || {});
const darts = [];
let score = Number(scoreBefore) || 0;
const checkout = findCheckout(score, 3);
const useCheckout = checkout && Math.random() < Number(profile.checkoutChance || 0);
if (useCheckout) {
for (let i = 0; i < checkout.length; i += 1) {
const planned = checkout[i];
const reliability = clamp(0.48 + Number(profile.checkoutChance || 0) * 0.6, 0.5, 0.95);
const dart = Math.random() < reliability ? cloneDart(planned) : chooseScoringDart(profile, score);
darts.push(dart);
const evaluation = engine.evaluateTurn(scoreBefore, darts);
if (evaluation.bust || evaluation.won || darts.length >= 3) break;
score = evaluation.scoreAfter;
}
return darts;
}
for (let i = 0; i < 3; i += 1) {
const dart = chooseScoringDart(profile, score);
darts.push(dart);
const evaluation = engine.evaluateTurn(scoreBefore, darts);
if (evaluation.bust || evaluation.won) break;
score = evaluation.scoreAfter;
}
return darts;
}
window.PidoDartsComputer = {
PRESETS,
profileFor,
adaptiveProfile,
equivalentPreset,
findCheckout,
simulateTurn
};
})();

;
(() => {
const db = window.PidoDartsDB;
const security = window.PidoDartsSecurity;
if (!db) return;
const playerFilter = document.getElementById('statsPlayerFilter');
const modeFilter = document.getElementById('statsModeFilter');
const scoreFilter = document.getElementById('statsScoreFilter');
const refreshBtn = document.getElementById('statsRefreshBtn');
const matchesEl = document.getElementById('statsMatches');
const matchesLabel = document.getElementById('statsMatchesLabel');
const winsEl = document.getElementById('statsWins');
const winsLabel = document.getElementById('statsWinsLabel');
const winsNote = document.getElementById('statsWinsNote');
const bestTurnEl = document.getElementById('statsBestTurn');
const averageEl = document.getElementById('statsAverage');
const bustsEl = document.getElementById('statsBusts');
const playerFocus = document.getElementById('statsPlayerFocus');
const playerAvatar = document.getElementById('statsPlayerAvatar');
const playerName = document.getElementById('statsPlayerName');
const playerSubtitle = document.getElementById('statsPlayerSubtitle');
const playerDarts = document.getElementById('statsPlayerDarts');
const playerPodiums = document.getElementById('statsPlayerPodiums');
const playerFirsts = document.getElementById('statsPlayerFirsts');
const playerMisses = document.getElementById('statsPlayerMisses');
const trend = document.getElementById('statsTrend');
const trendEmpty = document.getElementById('statsTrendEmpty');
const trendNote = document.getElementById('statsTrendNote');
const profileGrid = document.getElementById('statsProfileGrid');
const profilesEmpty = document.getElementById('statsProfilesEmpty');
const historyList = document.getElementById('statsHistoryList');
const historyEmpty = document.getElementById('statsHistoryEmpty');
const historyCount = document.getElementById('statsHistoryCount');
const detailModal = document.getElementById('statsDetailModal');
const closeDetailBtn = document.getElementById('closeStatsDetail');
const detailEyebrow = document.getElementById('statsDetailEyebrow');
const detailTitle = document.getElementById('statsDetailTitle');
const detailMeta = document.getElementById('statsDetailMeta');
const detailSummary = document.getElementById('statsDetailSummary');
const detailRankingSection = document.getElementById('statsDetailRankingSection');
const detailRanking = document.getElementById('statsDetailRanking');
const detailTurnCount = document.getElementById('statsDetailTurnCount');
const detailTurns = document.getElementById('statsDetailTurns');
const state = { games: [], players: [], playerMap: new Map(), visible: [], loading: false };
function formatAverage(value) {
const n = Number(value);
return Number.isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
}
function formatDate(timestamp, withTime = true) {
if (!timestamp) return 'Data non disponibile';
try {
return new Intl.DateTimeFormat('it-IT', withTime
? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
: { day: '2-digit', month: 'short' }).format(new Date(timestamp));
} catch (_) { return 'Data non disponibile'; }
}
function formatDuration(ms) {
const minutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
if (!minutes) return '< 1 min';
if (minutes < 60) return `${minutes} min`;
const hours = Math.floor(minutes / 60);
const rest = minutes % 60;
return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
function initials(name = '') {
return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '🎯';
}
function renderAvatar(element, player) {
if (!element) return;
element.textContent = '';
element.style.backgroundImage = '';
element.classList.remove('has-image');
element.style.setProperty('--player-color', security?.safeHex ? security.safeHex(player?.color, '#20d868') : '#20d868');
const avatarImage = security?.safeImageDataUrl ? security.safeImageDataUrl(player?.avatarValue, 2_000_000) : '';
if (player?.avatarType === 'image' && avatarImage) {
element.classList.add('has-image');
element.style.backgroundImage = security.cssImageUrl(avatarImage, 2_000_000);
return;
}
const span = document.createElement('span');
span.textContent = player?.avatarType === 'emoji' ? String(player.avatarValue || '🎯').slice(0, 32) : initials(player?.name);
element.appendChild(span);
}
function gameModeLabel(game) {
if (game.mode === 'multi') return 'Multiplayer';
if (game.mode === 'computer' || game.trainingMode === 'computer') return 'Contro il computer';
if (game.trainingMode === 'ideal') return 'Record ideale';
return game.trainingMode === 'record' ? 'Batti il record' : 'Allenamento';
}
function participantFor(game, playerId) {
return (game.participants || []).find(item => item.playerId === playerId || item.player?.id === playerId) || null;
}
function filteredParticipantStats(game, playerId) {
if (playerId !== 'all') return participantFor(game, playerId)?.stats || null;
const participants = (game.participants || []).filter(item => !item.player?.isComputer && item.playerId !== '__pido_computer__');
const turns = participants.reduce((sum, item) => sum + Number(item.stats?.turns || 0), 0);
const points = participants.reduce((sum, item) => sum + Number(item.stats?.pointsScored || 0), 0);
return {
turns,
dartsUsed: participants.reduce((sum, item) => sum + Number(item.stats?.dartsUsed || 0), 0),
pointsScored: points,
bestTurn: participants.reduce((best, item) => Math.max(best, Number(item.stats?.bestTurn || 0)), 0),
busts: participants.reduce((sum, item) => sum + Number(item.stats?.busts || 0), 0),
misses: participants.reduce((sum, item) => sum + Number(item.stats?.misses || 0), 0),
averagePerTurn: turns ? points / turns : 0
};
}
function gameMatchesNonPlayerFilters(game) {
const mode = modeFilter?.value || 'all';
const score = scoreFilter?.value || 'all';
if (mode === 'multi' && game.mode !== 'multi') return false;
if (mode === 'computer' && !(game.mode === 'computer' || game.trainingMode === 'computer')) return false;
if (mode === 'single' && !(game.mode === 'single' && !['record', 'ideal', 'computer'].includes(game.trainingMode))) return false;
if (mode === 'record' && !(game.mode === 'single' && game.trainingMode === 'record')) return false;
if (mode === 'ideal' && !(game.mode === 'single' && game.trainingMode === 'ideal')) return false;
if (score !== 'all' && Number(game.startScore) !== Number(score)) return false;
return true;
}
function gameMatchesFilters(game) {
const playerId = playerFilter?.value || 'all';
if (playerId !== 'all' && !participantFor(game, playerId)) return false;
return gameMatchesNonPlayerFilters(game);
}
function collectPlayers() {
const map = new Map();
state.players.forEach(player => map.set(player.id, player));
state.games.forEach(game => (game.participants || []).forEach(item => {
const player = item.player || { id: item.playerId, name: 'Giocatore eliminato' };
if (player?.isComputer || item.playerId === '__pido_computer__') return;
if (!map.has(item.playerId || player.id)) map.set(item.playerId || player.id, player);
}));
state.playerMap = map;
return [...map.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it'));
}
function syncFilterOptions() {
const previousPlayer = playerFilter.value;
const previousScore = scoreFilter.value;
const players = collectPlayers();
playerFilter.replaceChildren(new Option('Tutti i giocatori', 'all'));
players.forEach(player => {
const option = document.createElement('option');
option.value = player.id;
option.textContent = player.name;
playerFilter.appendChild(option);
});
if ([...playerFilter.options].some(o => o.value === previousPlayer)) playerFilter.value = previousPlayer;
const scores = [...new Set(state.games.map(game => Number(game.startScore)).filter(Number.isFinite))].sort((a,b)=>a-b);
scoreFilter.replaceChildren(new Option('Tutti', 'all'));
scores.forEach(score => {
const option = document.createElement('option');
option.value = String(score);
option.textContent = `${score} punti`;
scoreFilter.appendChild(option);
});
if ([...scoreFilter.options].some(o => o.value === previousScore)) scoreFilter.value = previousScore;
}
function selectedPlayer() {
const id = playerFilter.value;
return id === 'all' ? null : state.playerMap.get(id) || null;
}
function playerAggregate(playerId, games = state.visible) {
const relevant = games.filter(game => participantFor(game, playerId));
let totalTurns = 0, totalPoints = 0, darts = 0, busts = 0, misses = 0, best = 0, wins = 0, podiums = 0, firsts = 0;
relevant.forEach(game => {
const participant = participantFor(game, playerId);
const stats = participant?.stats || {};
totalTurns += Number(stats.turns || 0);
totalPoints += Number(stats.pointsScored || 0);
darts += Number(stats.dartsUsed || 0);
busts += Number(stats.busts || 0);
misses += Number(stats.misses || 0);
best = Math.max(best, Number(stats.bestTurn || 0));
if (game.winnerId === playerId) wins += 1;
if (game.mode === 'multi' && participant?.actualPlace && participant.actualPlace <= 3) podiums += 1;
if (game.mode === 'multi' && participant?.actualPlace === 1) firsts += 1;
});
return { games: relevant.length, wins, podiums, firsts, totalTurns, totalPoints, darts, busts, misses, bestTurn: best, average: totalTurns ? totalPoints / totalTurns : 0 };
}
function renderOverview() {
const playerId = playerFilter.value;
const stats = state.visible.map(game => filteredParticipantStats(game, playerId)).filter(Boolean);
const turns = stats.reduce((sum, item) => sum + Number(item.turns || 0), 0);
const points = stats.reduce((sum, item) => sum + Number(item.pointsScored || 0), 0);
const best = stats.reduce((value, item) => Math.max(value, Number(item.bestTurn || 0)), 0);
const busts = stats.reduce((sum, item) => sum + Number(item.busts || 0), 0);
matchesEl.textContent = String(state.visible.length);
bestTurnEl.textContent = best ? String(best) : '—';
averageEl.textContent = turns ? formatAverage(points / turns) : '—';
bustsEl.textContent = String(busts);
if (playerId === 'all') {
matchesLabel.textContent = 'Partite';
winsLabel.textContent = 'Giocatori';
const activePlayers = new Set(state.visible.flatMap(game => (game.participants || []).filter(item => !item.player?.isComputer && item.playerId !== '__pido_computer__').map(item => item.playerId))).size;
winsEl.textContent = String(activePlayers);
winsNote.textContent = 'presenti nello storico filtrato';
} else {
const aggregate = playerAggregate(playerId);
matchesLabel.textContent = 'Partite';
winsLabel.textContent = 'Vittorie';
winsEl.textContent = String(aggregate.wins);
winsNote.textContent = aggregate.games ? `${Math.round((aggregate.wins / aggregate.games) * 100)}% delle partite` : 'nessuna partita';
}
}
function renderPlayerFocus() {
const player = selectedPlayer();
playerFocus.hidden = !player;
if (!player) return;
const aggregate = playerAggregate(player.id);
renderAvatar(playerAvatar, player);
playerName.textContent = player.name || 'Giocatore';
playerSubtitle.textContent = aggregate.games
? `${aggregate.games} partite · media ${formatAverage(aggregate.average)} · miglior turno ${aggregate.bestTurn || '—'}`
: 'Nessuna partita con i filtri attuali.';
playerDarts.textContent = String(aggregate.darts);
playerPodiums.textContent = String(aggregate.podiums);
playerFirsts.textContent = String(aggregate.firsts);
playerMisses.textContent = String(aggregate.misses);
}
function trendPoints() {
const playerId = playerFilter.value;
return [...state.visible].sort((a,b)=>(a.completedAt||0)-(b.completedAt||0)).map(game => {
const stats = filteredParticipantStats(game, playerId);
return stats ? { game, value: Number(stats.averagePerTurn || 0) } : null;
}).filter(Boolean).slice(-12);
}
function renderTrend() {
trend.textContent = '';
const points = trendPoints();
trendEmpty.hidden = points.length > 0;
trend.hidden = points.length === 0;
const player = selectedPlayer();
trendNote.textContent = player ? `${player.name} · ultime ${points.length || 0}` : `Ultime ${points.length || 0} partite`;
if (!points.length) return;
const max = Math.max(1, ...points.map(point => point.value));
points.forEach((point, index) => {
const item = document.createElement('button');
item.type = 'button';
item.className = 'stats-trend-item';
item.dataset.statsGameId = point.game.id;
item.title = `${formatDate(point.game.completedAt)} · media ${formatAverage(point.value)}`;
const value = document.createElement('span');
value.className = 'stats-trend-value';
value.textContent = formatAverage(point.value);
const track = document.createElement('span');
track.className = 'stats-trend-track';
const bar = document.createElement('span');
bar.className = 'stats-trend-bar';
bar.style.height = `${Math.max(6, (point.value / max) * 100)}%`;
track.appendChild(bar);
const label = document.createElement('small');
label.textContent = formatDate(point.game.completedAt, false).replace('.', '');
item.append(value, track, label);
trend.appendChild(item);
});
}
function renderProfileGrid() {
profileGrid.textContent = '';
const profileGames = state.games.filter(gameMatchesNonPlayerFilters);
const players = collectPlayers().map(player => ({ player, stats: playerAggregate(player.id, profileGames) })).filter(item => item.stats.games > 0).sort((a,b)=>b.stats.games-a.stats.games || b.stats.wins-a.stats.wins);
profilesEmpty.hidden = players.length > 0;
players.forEach(({ player, stats }) => {
const button = document.createElement('button');
button.type = 'button';
button.className = `stats-profile-card${playerFilter.value === player.id ? ' selected' : ''}`;
button.dataset.statsPlayerId = player.id;
const avatar = document.createElement('div');
avatar.className = 'avatar-preview avatar-preview-small';
renderAvatar(avatar, player);
const copy = document.createElement('span');
const name = document.createElement('strong');
name.textContent = player.name;
const detail = document.createElement('small');
detail.textContent = `${stats.games} partite · ${stats.wins} vittorie · media ${formatAverage(stats.average)}`;
copy.append(name, detail);
const best = document.createElement('b');
const bestLabel = document.createElement('small');
bestLabel.textContent = 'BEST';
best.append(bestLabel, document.createTextNode(String(stats.bestTurn || '—')));
button.append(avatar, copy, best);
profileGrid.appendChild(button);
});
}
function gameHistoryMetric(game) {
const playerId = playerFilter.value;
if (playerId !== 'all') {
const participant = participantFor(game, playerId);
return participant ? `Media ${formatAverage(participant.stats?.averagePerTurn)} · Best ${participant.stats?.bestTurn || '—'} · ${participant.stats?.busts || 0} BUST` : '';
}
const total = filteredParticipantStats(game, 'all');
return `Media ${formatAverage(total?.averagePerTurn)} · Best ${total?.bestTurn || '—'} · ${total?.busts || 0} BUST`;
}
function renderHistory() {
historyList.textContent = '';
historyEmpty.hidden = state.visible.length > 0;
historyCount.textContent = state.visible.length === 1 ? '1 partita' : `${state.visible.length} partite`;
state.visible.forEach(game => {
const card = document.createElement('button');
card.type = 'button';
card.className = 'stats-history-card';
card.dataset.statsGameId = game.id;
const icon = document.createElement('span');
icon.className = 'stats-history-icon';
icon.textContent = game.mode === 'multi' ? '👥' : ((game.mode === 'computer' || game.trainingMode === 'computer') ? '🤖' : (game.trainingMode === 'ideal' ? '✨' : (game.trainingMode === 'record' ? '🏆' : '🎯')));
const copy = document.createElement('span');
copy.className = 'stats-history-copy';
const title = document.createElement('strong');
title.textContent = `${gameModeLabel(game)} · ${game.startScore} punti`;
const players = document.createElement('small');
const names = (game.participants || []).map(item => item.player?.name || 'Giocatore');
players.textContent = names.length <= 3 ? names.join(' · ') : `${names.slice(0,3).join(' · ')} +${names.length-3}`;
const metric = document.createElement('small');
metric.className = 'stats-history-metric';
metric.textContent = gameHistoryMetric(game);
copy.append(title, players, metric);
const meta = document.createElement('span');
meta.className = 'stats-history-meta';
const winner = (game.participants || []).find(item => item.playerId === game.winnerId);
const metaTitle = document.createElement('strong');
metaTitle.textContent = winner ? `🏆 ${winner.player?.name || 'Vincitore'}` : 'Completata';
const metaDate = document.createElement('small');
metaDate.textContent = formatDate(game.completedAt);
const metaArrow = document.createElement('b');
metaArrow.textContent = '›';
meta.append(metaTitle, metaDate, metaArrow);
card.append(icon, copy, meta);
historyList.appendChild(card);
});
}
function renderAll() {
state.visible = state.games.filter(gameMatchesFilters);
renderOverview();
renderPlayerFocus();
renderTrend();
renderProfileGrid();
renderHistory();
}
async function loadData({ preserveFilters = true } = {}) {
if (state.loading) return;
state.loading = true;
refreshBtn?.classList.add('is-loading');
try {
const [games, players] = await Promise.all([db.getCompletedGames(), db.getPlayers()]);
state.games = games || [];
state.players = players || [];
if (!preserveFilters) {
playerFilter.value = 'all'; modeFilter.value = 'all'; scoreFilter.value = 'all';
}
syncFilterOptions();
renderAll();
} catch (error) {
console.error('Impossibile leggere le statistiche:', error);
window.PidoDartsApp?.showToast?.('Statistiche non disponibili');
} finally {
state.loading = false;
refreshBtn?.classList.remove('is-loading');
}
}
function rankLabel(rank) {
if (rank === 1) return '🥇 1°';
if (rank === 2) return '🥈 2°';
if (rank === 3) return '🥉 3°';
return `${rank}°`;
}
function dartLabel(dart) {
if (!dart) return '—';
return dart.label || (Number(dart.value) === 0 ? 'Miss' : String(dart.value ?? '—'));
}
function openDetail(gameId) {
const game = state.games.find(item => item.id === gameId);
if (!game || !detailModal) return;
detailEyebrow.textContent = `${gameModeLabel(game).toUpperCase()} · ${game.startScore} PUNTI`;
const winner = (game.participants || []).find(item => item.playerId === game.winnerId);
detailTitle.textContent = winner ? `🏆 ${winner.player?.name || 'Partita completata'}` : 'Partita completata';
detailMeta.textContent = `${formatDate(game.completedAt)} · ${formatDuration(game.durationMs)}${game.mode === 'multi' ? ` · ${game.finishMode === 'full' ? 'Classifica completa' : 'Primo a zero'}` : ((game.mode === 'computer' || game.trainingMode === 'computer') ? ` · PC ${game.computerDifficulty === 'adaptive' ? 'Adattivo' : (game.computerDifficulty || 'Medio')}` : '')}`;
detailSummary.textContent = '';
(game.participants || []).forEach(participant => {
const card = document.createElement('article');
card.className = 'stats-detail-player';
card.style.setProperty('--player-color', security?.safeHex ? security.safeHex(participant.player?.color, '#20d868') : '#20d868');
const avatar = document.createElement('div'); avatar.className = 'avatar-preview avatar-preview-small'; renderAvatar(avatar, participant.player);
const copy = document.createElement('div');
const name = document.createElement('strong'); name.textContent = participant.player?.name || 'Giocatore';
const s = participant.stats || {};
const metrics = document.createElement('small'); metrics.textContent = `${s.turns || 0} turni · ${s.dartsUsed || 0} freccette · media ${formatAverage(s.averagePerTurn)}`;
const metrics2 = document.createElement('small'); metrics2.textContent = `Best ${s.bestTurn || '—'} · ${s.busts || 0} BUST · ${s.misses || 0} Miss`;
copy.append(name, metrics, metrics2);
card.append(avatar, copy);
detailSummary.appendChild(card);
});
const ranking = [...(game.ranking || [])].sort((a,b)=>a.rank-b.rank);
detailRankingSection.hidden = !(game.mode === 'multi' || game.mode === 'computer' || game.trainingMode === 'computer');
detailRanking.textContent = '';
if (game.mode === 'multi' || game.mode === 'computer' || game.trainingMode === 'computer') ranking.forEach(item => {
const participant = participantFor(game, item.playerId);
if (!participant) return;
const row = document.createElement('article');
row.className = `stats-detail-rank-row${item.rank === 1 ? ' winner' : ''}`;
const avatar = document.createElement('div'); avatar.className = 'avatar-preview avatar-preview-tiny'; renderAvatar(avatar, participant.player);
const copy = document.createElement('span');
const name = document.createElement('strong'); name.textContent = participant.player?.name || 'Giocatore';
const note = document.createElement('small');
note.textContent = item.actual ? 'Posizione reale' : `${participant.finalScore} punti rimasti · posizione al termine`;
copy.append(name,note);
const position = document.createElement('b'); position.textContent = rankLabel(item.rank);
row.append(position,avatar,copy); detailRanking.appendChild(row);
});
detailTurns.textContent = '';
const history = game.history || [];
detailTurnCount.textContent = history.length === 1 ? '1 turno' : `${history.length} turni`;
history.forEach(record => {
const participant = participantFor(game, record.playerId);
const row = document.createElement('article');
row.className = `stats-detail-turn${record.bust ? ' bust' : ''}${record.won ? ' win' : ''}`;
const head = document.createElement('div');
const who = document.createElement('strong'); who.textContent = `${participant?.player?.name || record.playerName || 'Giocatore'} · turno ${record.playerTurn || '?'}`;
const total = document.createElement('b'); total.textContent = record.bust ? 'BUST' : `${record.total || 0} pt`;
head.append(who,total);
const darts = document.createElement('div'); darts.className = 'stats-detail-darts';
(record.darts || []).forEach(dart => { const chip=document.createElement('span'); chip.textContent=`${dartLabel(dart)} · ${dart.value ?? 0}`; darts.appendChild(chip); });
const score = document.createElement('small');
score.textContent = record.bust ? `${record.scoreBefore} → ${record.scoreAfter} (invariato)` : `${record.scoreBefore} → ${record.scoreAfter}${record.won ? ' · CHIUSO' : ''}`;
row.append(head,darts,score); detailTurns.appendChild(row);
});
detailModal.hidden = false;
document.body.classList.add('modal-open');
setTimeout(()=>closeDetailBtn?.focus(),0);
}
function closeDetail() {
if (!detailModal || detailModal.hidden) return false;
detailModal.hidden = true;
document.body.classList.remove('modal-open');
return true;
}
playerFilter?.addEventListener('change', renderAll);
modeFilter?.addEventListener('change', renderAll);
scoreFilter?.addEventListener('change', renderAll);
refreshBtn?.addEventListener('click', () => loadData());
profileGrid?.addEventListener('click', event => {
const button = event.target.closest('[data-stats-player-id]');
if (!button) return;
playerFilter.value = button.dataset.statsPlayerId;
renderAll();
window.scrollTo({ top: 0, behavior: document.documentElement.dataset.animations === 'off' ? 'auto' : 'smooth' });
});
historyList?.addEventListener('click', event => {
const button = event.target.closest('[data-stats-game-id]'); if (button) openDetail(button.dataset.statsGameId);
});
trend?.addEventListener('click', event => {
const button = event.target.closest('[data-stats-game-id]'); if (button) openDetail(button.dataset.statsGameId);
});
closeDetailBtn?.addEventListener('click', closeDetail);
detailModal?.addEventListener('click', event => { if (event.target === detailModal) closeDetail(); });
document.addEventListener('pido:screenchange', event => { if (event.detail?.screen === 'stats-progress') loadData(); });
document.addEventListener('pido:statschanged', () => loadData());
document.addEventListener('pido:backrequest', event => { if (closeDetail()) event.detail.handled = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && closeDetail()) event.preventDefault(); });
loadData();
})();

;
(() => {
const db = window.PidoDartsDB;
const security = window.PidoDartsSecurity;
if (!db) return;
const $ = id => document.getElementById(id);
const state = { games: [], players: [], playerMap: new Map(), compareIds: [], currentIdeal: null, loading: false };
const MAX_COMPARE = 4;
const svgNS = 'http://www.w3.org/2000/svg';
const comparePlayer = $('comparePlayerFilter');
const compareScore = $('compareScoreFilter');
const compareRefresh = $('compareRefreshBtn');
const compareSelectedCount = $('compareSelectedCount');
const comparePicker = $('compareGamePicker');
const compareEmpty = $('compareGamesEmpty');
const compareResults = $('compareResults');
const compareNeedSelection = $('compareNeedSelection');
const compareSummaryGrid = $('compareSummaryGrid');
const compareChart = $('compareProgressChart');
const compareChartNote = $('compareChartNote');
const compareChartLegend = $('compareChartLegend');
const compareDeltaList = $('compareDeltaList');
const idealPlayer = $('idealPlayerFilter');
const idealScore = $('idealScoreFilter');
const idealRefresh = $('idealRefreshBtn');
const generateIdealBtn = $('generateIdealBtn');
const idealSourceTitle = $('idealSourceTitle');
const idealSourceDetail = $('idealSourceDetail');
const idealResult = $('idealResult');
const idealResultTitle = $('idealResultTitle');
const idealResultSubtitle = $('idealResultSubtitle');
const idealScoreBadge = $('idealScoreBadge');
const idealTurns = $('idealTurns');
const idealDarts = $('idealDarts');
const idealAverage = $('idealAverage');
const idealBest = $('idealBest');
const idealVsRecord = $('idealVsRecord');
const idealRoute = $('idealRoute');
const challengeIdealBtn = $('challengeIdealBtn');
const regenerateIdealBtn = $('regenerateIdealBtn');
const idealSavedList = $('idealSavedList');
const idealSavedEmpty = $('idealSavedEmpty');
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function formatAverage(value) {
const n = Number(value);
return Number.isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
}
function formatDate(timestamp, time = false) {
if (!timestamp) return 'Data non disponibile';
try {
return new Intl.DateTimeFormat('it-IT', time
? { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }
: { day: '2-digit', month: 'short', year: '2-digit' }).format(new Date(timestamp));
} catch (_) { return 'Data non disponibile'; }
}
function initials(name = '') {
return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '🎯';
}
function renderAvatar(el, player) {
if (!el) return;
el.textContent = '';
el.style.backgroundImage = '';
el.classList.remove('has-image');
el.style.setProperty('--player-color', security?.safeHex ? security.safeHex(player?.color, '#20d868') : '#20d868');
const avatarImage = security?.safeImageDataUrl ? security.safeImageDataUrl(player?.avatarValue, 2_000_000) : '';
if (player?.avatarType === 'image' && avatarImage) {
el.classList.add('has-image');
el.style.backgroundImage = security.cssImageUrl(avatarImage, 2_000_000);
return;
}
const span = document.createElement('span');
span.textContent = player?.avatarType === 'emoji' ? String(player.avatarValue || '🎯').slice(0, 32) : initials(player?.name);
el.appendChild(span);
}
function participantFor(game, playerId) {
return (game.participants || []).find(item => item.playerId === playerId || item.player?.id === playerId) || null;
}
function gameModeLabel(game) {
if (game.mode === 'multi') return 'Multiplayer';
if (game.mode === 'computer' || game.trainingMode === 'computer') return 'Contro il computer';
if (game.trainingMode === 'ideal') return 'Record ideale';
if (game.trainingMode === 'record') return 'Batti record';
return 'Allenamento';
}
function collectPlayers() {
const map = new Map();
state.players.forEach(player => map.set(player.id, player));
state.games.forEach(game => (game.participants || []).forEach(item => {
const player = item.player || { id: item.playerId, name: 'Giocatore eliminato', color: '#20d868' };
const id = item.playerId || player.id;
if (player?.isComputer || id === '__pido_computer__') return;
if (id && !map.has(id)) map.set(id, player);
}));
state.playerMap = map;
return [...map.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it'));
}
function fillPlayerSelect(select) {
if (!select) return;
const old = select.value;
select.textContent = '';
const first = document.createElement('option'); first.value = ''; first.textContent = 'Scegli un giocatore'; select.appendChild(first);
const players = collectPlayers().filter(player => state.games.some(game => participantFor(game, player.id)));
players.forEach(player => { const o = document.createElement('option'); o.value = player.id; o.textContent = player.name; select.appendChild(o); });
if ([...select.options].some(o => o.value === old)) select.value = old;
else if (players.length === 1) select.value = players[0].id;
}
function gamesForPlayer(playerId) { return playerId ? state.games.filter(game => participantFor(game, playerId)) : []; }
function metric(game, playerId) {
const p = participantFor(game, playerId); const s = p?.stats || {};
return {
game, participant: p,
turns: Number(s.turns || 0), darts: Number(s.dartsUsed || 0), average: Number(s.averagePerTurn || 0),
best: Number(s.bestTurn || 0), busts: Number(s.busts || 0), misses: Number(s.misses || 0),
won: game.winnerId === playerId, finished: Boolean(p?.finished || Number(p?.finalScore) === 0)
};
}
function syncCompareScores() {
if (!compareScore) return;
const old = compareScore.value;
compareScore.textContent = '';
const all = document.createElement('option'); all.value = 'all'; all.textContent = 'Tutti'; compareScore.appendChild(all);
[...new Set(gamesForPlayer(comparePlayer?.value).map(g => Number(g.startScore)).filter(Number.isFinite))].sort((a, b) => a - b).forEach(score => {
const o = document.createElement('option'); o.value = String(score); o.textContent = `${score} punti`; compareScore.appendChild(o);
});
if ([...compareScore.options].some(o => o.value === old)) compareScore.value = old;
}
function visibleCompareGames() {
const playerId = comparePlayer?.value;
if (!playerId) return [];
const score = compareScore?.value || 'all';
return gamesForPlayer(playerId).filter(game => score === 'all' || Number(game.startScore) === Number(score));
}
function toggleCompare(id) {
const index = state.compareIds.indexOf(id);
if (index >= 0) state.compareIds.splice(index, 1);
else {
if (state.compareIds.length >= MAX_COMPARE) { window.PidoDartsApp?.showToast?.('Puoi confrontare al massimo 4 partite'); return; }
state.compareIds.push(id);
}
renderComparePicker();
}
function renderComparePicker(resetScroll = false) {
if (!comparePicker) return;
const scrollHost = comparePicker.classList.contains('list-viewer-live') ? comparePicker.parentElement : comparePicker;
const preservedScrollTop = resetScroll ? 0 : (scrollHost?.scrollTop || 0);
comparePicker.textContent = '';
const games = visibleCompareGames();
const allowed = new Set(games.map(g => g.id));
state.compareIds = state.compareIds.filter(id => allowed.has(id));
compareEmpty.hidden = games.length > 0;
games.forEach(game => {
const m = metric(game, comparePlayer.value);
const selected = state.compareIds.includes(game.id);
const btn = document.createElement('button'); btn.type = 'button'; btn.className = `compare-game-choice${selected ? ' selected' : ''}`; btn.dataset.compareGameId = game.id;
const mark = document.createElement('span'); mark.className = 'compare-choice-mark'; mark.textContent = selected ? '✓' : '+';
const copy = document.createElement('span');
const title = document.createElement('strong'); title.textContent = `${game.startScore} · ${gameModeLabel(game)}`;
const detail = document.createElement('small'); detail.textContent = `${formatDate(game.completedAt, true)} · ${m.turns} turni · media ${formatAverage(m.average)}`;
copy.append(title, detail);
const result = document.createElement('b'); result.textContent = m.won ? '🏆' : (m.finished ? '✓' : `${m.participant?.finalScore ?? '—'} pt`);
btn.append(mark, copy, result); comparePicker.appendChild(btn);
});
compareSelectedCount.textContent = `${state.compareIds.length} / ${MAX_COMPARE}`;
renderCompareResults();
if (scrollHost) requestAnimationFrame(() => { scrollHost.scrollTop = preservedScrollTop; });
}
function turnPath(game, playerId) {
const start = Number(game.startScore || 0);
const turns = (game.history || []).filter(turn => turn.playerId === playerId);
const points = [{ turn: 0, remaining: start }];
turns.forEach((turn, i) => points.push({ turn: i + 1, remaining: Number(turn.scoreAfter ?? turn.scoreBefore ?? start) }));
return points;
}
function svgEl(name, attrs = {}) {
const el = document.createElementNS(svgNS, name);
Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
return el;
}
function renderCompareChart(games, playerId) {
compareChart.textContent = ''; compareChartLegend.textContent = '';
const paths = games.map(game => ({ game, path: turnPath(game, playerId) }));
const maxTurns = Math.max(1, ...paths.map(item => item.path.length - 1));
const sameScore = new Set(games.map(g => Number(g.startScore))).size === 1;
const maxY = sameScore ? Number(games[0].startScore) : 100;
compareChartNote.textContent = sameScore ? `${games[0].startScore} punti · scala reale` : 'Punteggi diversi · scala percentuale';
const left = 70, right = 970, top = 28, bottom = 285;
const x = turn => left + (turn / maxTurns) * (right - left);
const normalized = (remaining, start) => sameScore ? remaining : (start ? remaining / start * 100 : 0);
const y = value => bottom - (value / Math.max(1, maxY)) * (bottom - top);
for (let i = 0; i <= 4; i++) {
const gy = top + (bottom - top) * i / 4;
compareChart.appendChild(svgEl('line', { x1: left, y1: gy, x2: right, y2: gy, class: 'compare-grid-line' }));
const label = svgEl('text', { x: left - 12, y: gy + 5, 'text-anchor': 'end', class: 'compare-axis-label' });
label.textContent = sameScore ? String(Math.round(maxY * (1 - i / 4))) : `${Math.round(100 * (1 - i / 4))}%`; compareChart.appendChild(label);
}
for (let i = 0; i <= maxTurns; i++) {
if (maxTurns > 12 && i % 2) continue;
const gx = x(i); compareChart.appendChild(svgEl('line', { x1: gx, y1: top, x2: gx, y2: bottom, class: 'compare-grid-line vertical' }));
const label = svgEl('text', { x: gx, y: bottom + 28, 'text-anchor': 'middle', class: 'compare-axis-label' }); label.textContent = String(i); compareChart.appendChild(label);
}
paths.forEach((item, index) => {
const d = item.path.map((point, i) => `${i ? 'L' : 'M'} ${x(point.turn).toFixed(1)} ${y(normalized(point.remaining, item.game.startScore)).toFixed(1)}`).join(' ');
compareChart.appendChild(svgEl('path', { d, class: `compare-line compare-line-${index + 1}` }));
item.path.forEach(point => compareChart.appendChild(svgEl('circle', { cx: x(point.turn), cy: y(normalized(point.remaining, item.game.startScore)), r: 5, class: `compare-point compare-line-${index + 1}` })));
const legend = document.createElement('span'); legend.className = `compare-legend-item compare-line-${index + 1}`;
const swatch = document.createElement('i'); const letter = document.createElement('b'); letter.textContent = String.fromCharCode(65 + index);
legend.append(swatch, letter, document.createTextNode(formatDate(item.game.completedAt))); compareChartLegend.appendChild(legend);
});
const title = svgEl('text', { x: (left + right) / 2, y: 332, 'text-anchor': 'middle', class: 'compare-axis-title' }); title.textContent = 'Turni'; compareChart.appendChild(title);
}
function delta(value, lowerBetter = false, suffix = '') {
const n = Number(value); if (!Number.isFinite(n) || Math.abs(n) < 0.0001) return { text: `0${suffix}`, tone: 'level' };
const improved = lowerBetter ? n < 0 : n > 0;
return { text: `${n > 0 ? '+' : ''}${Number.isInteger(n) ? n : formatAverage(n)}${suffix}`, tone: improved ? 'ahead' : 'behind' };
}
function renderCompareResults() {
const games = state.compareIds.map(id => state.games.find(g => g.id === id)).filter(Boolean);
const ready = games.length >= 2;
compareResults.hidden = !ready; compareNeedSelection.hidden = ready;
if (!ready) return;
const playerId = comparePlayer.value; const items = games.map(g => metric(g, playerId));
compareSummaryGrid.textContent = '';
items.forEach((m, index) => {
const card = document.createElement('article'); card.className = `compare-summary-card compare-line-${index + 1}`;
const head = document.createElement('div'); head.className = 'compare-summary-head';
const letter = document.createElement('span'); letter.textContent = String.fromCharCode(65 + index);
const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${m.game.startScore} · ${gameModeLabel(m.game)}`;
const date = document.createElement('small'); date.textContent = formatDate(m.game.completedAt, true); copy.append(title, date); head.append(letter, copy);
const grid = document.createElement('div'); grid.className = 'compare-metric-grid';
[['Turni', m.turns], ['Media', formatAverage(m.average)], ['Freccette', m.darts], ['Best', m.best || '—'], ['BUST', m.busts], ['Miss', m.misses]].forEach(([label, value]) => {
const cell = document.createElement('span'); const small = document.createElement('small'); small.textContent = label; const b = document.createElement('b'); b.textContent = String(value); cell.append(small, b); grid.appendChild(cell);
});
const outcome = document.createElement('p'); outcome.textContent = m.won ? '🏆 Vittoria' : (m.finished ? '✓ Completata' : `Terminata con ${m.participant?.finalScore ?? '—'} punti`);
card.append(head, grid, outcome); compareSummaryGrid.appendChild(card);
});
renderCompareChart(games, playerId);
compareDeltaList.textContent = ''; const base = items[0];
items.slice(1).forEach((m, index) => {
const row = document.createElement('article'); row.className = 'compare-delta-row';
const title = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = `${String.fromCharCode(66 + index)} vs A`; const date = document.createElement('small'); date.textContent = formatDate(m.game.completedAt); title.append(strong, date);
const metrics = document.createElement('div'); metrics.className = 'compare-delta-metrics';
[['Media', delta(m.average - base.average, false, ' pt')], ['Turni', delta(m.turns - base.turns, true)], ['Freccette', delta(m.darts - base.darts, true)], ['BUST', delta(m.busts - base.busts, true)]].forEach(([label, d]) => {
const cell = document.createElement('span'); cell.className = d.tone; const small = document.createElement('small'); small.textContent = label; const b = document.createElement('b'); b.textContent = d.text; cell.append(small, b); metrics.appendChild(cell);
});
row.append(title, metrics); compareDeltaList.appendChild(row);
});
}
function finishedGamesFor(playerId, startScore) {
return gamesForPlayer(playerId).filter(game => Number(game.startScore) === Number(startScore)).filter(game => {
const p = participantFor(game, playerId); return p && (p.finished || Number(p.finalScore) === 0);
});
}
function syncIdealScores() {
if (!idealScore) return;
const old = idealScore.value; idealScore.textContent = '';
const first = document.createElement('option'); first.value = ''; first.textContent = 'Scegli un punteggio'; idealScore.appendChild(first);
const scores = [...new Set(gamesForPlayer(idealPlayer?.value).filter(game => {
const p = participantFor(game, idealPlayer?.value); return p && (p.finished || Number(p.finalScore) === 0);
}).map(g => Number(g.startScore)).filter(Number.isFinite))].sort((a, b) => a - b);
scores.forEach(score => { const o = document.createElement('option'); o.value = String(score); o.textContent = `${score} punti`; idealScore.appendChild(o); });
if ([...idealScore.options].some(o => o.value === old)) idealScore.value = old;
else if (scores.length === 1) idealScore.value = String(scores[0]);
syncIdealSource();
}
function sourceTurns(playerId, startScore) {
const games = finishedGamesFor(playerId, startScore); const all = [];
games.forEach(game => (game.history || []).filter(turn => turn.playerId === playerId && !turn.bust && Number(turn.total) > 0).forEach((turn, i) => {
all.push({ key: `${game.id}:${i}`, gameId: game.id, completedAt: game.completedAt, total: Number(turn.total), darts: clone(turn.darts || []), dartsUsed: (turn.darts || []).length, sourceTurn: Number(turn.playerTurn || i + 1) });
}));
const groups = new Map(); all.forEach(c => { if (!groups.has(c.total)) groups.set(c.total, []); groups.get(c.total).push(c); });
const candidates = [];
groups.forEach((items, total) => {
items.sort((a, b) => a.dartsUsed - b.dartsUsed || (b.completedAt || 0) - (a.completedAt || 0));
const maxNeeded = Math.max(1, Math.floor(Number(startScore) / Number(total)));
candidates.push(...items.slice(0, maxNeeded));
});
candidates.sort((a, b) => b.total - a.total || a.dartsUsed - b.dartsUsed);
return { games, candidates };
}
function buildIdealSequence(playerId, startScore) {
const target = Number(startScore); const source = sourceTurns(playerId, target); const candidates = source.candidates;
if (!target || !candidates.length) return { ideal: null, source };
const dp = new Array(target + 1).fill(null); dp[0] = { turns: 0, darts: 0, last: -1, prev: null };
candidates.forEach((candidate, index) => {
for (let sum = target; sum >= candidate.total; sum--) {
const from = dp[sum - candidate.total]; if (!from) continue;
const turns = from.turns + 1, darts = from.darts + candidate.dartsUsed, current = dp[sum];
if (!current || turns < current.turns || (turns === current.turns && darts < current.darts)) dp[sum] = { turns, darts, last: index, prev: from };
}
});
if (!dp[target]) return { ideal: null, source };
const picked = []; let node = dp[target];
while (node && node.last >= 0) { picked.push(candidates[node.last]); node = node.prev; }
picked.sort((a, b) => b.total - a.total || a.dartsUsed - b.dartsUsed || (b.completedAt || 0) - (a.completedAt || 0));
let remaining = target;
const turnsData = picked.map((c, index) => {
const before = remaining; remaining -= c.total;
return { playerTurn: index + 1, scoreBefore: before, scoreAfter: remaining, total: c.total, bust: false, darts: clone(c.darts), sourceGameId: c.gameId, sourceTurn: c.sourceTurn, sourceCompletedAt: c.completedAt };
});
const player = state.playerMap.get(playerId) || { id: playerId, name: 'Giocatore' }; const now = Date.now();
return { source, ideal: {
id: db.createIdealRecordId?.(playerId, target) || `ideal::${playerId}::${target}`, schemaVersion: 1,
playerId, player: clone(player), playerName: player.name, startScore: target,
turns: turnsData.length, dartsUsed: turnsData.reduce((sum, t) => sum + t.darts.length, 0), bestTurn: Math.max(0, ...turnsData.map(t => t.total)),
averagePerTurn: turnsData.length ? target / turnsData.length : 0, turnsData,
sourceGameCount: new Set(picked.map(c => c.gameId)).size, sourceTurnCount: picked.length, sourceAvailableGames: source.games.length,
createdAt: now, updatedAt: now
}};
}
async function syncIdealSource() {
if (!idealSourceTitle) return;
state.currentIdeal = null; idealResult.hidden = true;
const playerId = idealPlayer?.value; const score = Number(idealScore?.value);
if (!playerId || !score) {
idealSourceTitle.textContent = 'Scegli giocatore e punteggio'; idealSourceDetail.textContent = 'Verranno usati solo turni reali di partite concluse a 0 con quel giocatore.'; generateIdealBtn.disabled = true; return;
}
const source = sourceTurns(playerId, score); const player = state.playerMap.get(playerId);
idealSourceTitle.textContent = `${player?.name || 'Giocatore'} · ${score} punti`;
idealSourceDetail.textContent = source.games.length ? `${source.games.length} ${source.games.length === 1 ? 'partita completata' : 'partite completate'} disponibili · ${source.candidates.length} turni reali utili.` : 'Non ci sono partite concluse a 0 utilizzabili per questo punteggio.';
generateIdealBtn.disabled = !source.games.length;
try { const saved = await db.getIdealRecord(playerId, score); if (saved) await renderIdeal(saved, true); } catch (error) { console.error(error); }
}
function idealComparisonText(ideal, record) {
if (!record) return 'Non hai ancora un record personale per questo punteggio: il record ideale diventa il tuo obiettivo teorico.';
if (ideal.turns < record.turns) return `Il percorso ideale è ${record.turns - ideal.turns} ${record.turns - ideal.turns === 1 ? 'turno' : 'turni'} più corto del tuo record personale (${record.turns}).`;
if (ideal.turns === record.turns && ideal.dartsUsed < record.dartsUsed) return `Stessi ${ideal.turns} turni del tuo record, ma il percorso ideale usa ${record.dartsUsed - ideal.dartsUsed} freccette in meno.`;
if (ideal.turns === record.turns && ideal.dartsUsed === record.dartsUsed) return 'Il tuo record personale è già equivalente al record ideale costruibile con i turni salvati.';
return `Record personale: ${record.turns} turni / ${record.dartsUsed} freccette. Record ideale: ${ideal.turns} / ${ideal.dartsUsed}.`;
}
async function renderIdeal(ideal, saved = false) {
state.currentIdeal = clone(ideal); idealResult.hidden = false; idealResult.classList.toggle('is-saved', saved);
const player = state.playerMap.get(ideal.playerId) || ideal.player || { name: ideal.playerName || 'Giocatore' };
idealResultTitle.textContent = `${player.name} · record ideale`; idealResultSubtitle.textContent = `Costruito da ${ideal.sourceTurnCount || ideal.turns} turni reali provenienti da ${ideal.sourceGameCount || '—'} partite.`;
idealScoreBadge.textContent = String(ideal.startScore); idealTurns.textContent = String(ideal.turns); idealDarts.textContent = String(ideal.dartsUsed); idealAverage.textContent = formatAverage(ideal.averagePerTurn); idealBest.textContent = String(ideal.bestTurn || 0);
let record = null; try { record = await db.getRecord(ideal.playerId, ideal.startScore); } catch (_) {}
idealVsRecord.textContent = idealComparisonText(ideal, record); idealRoute.textContent = '';
(ideal.turnsData || []).forEach((turn, index) => {
const card = document.createElement('article'); card.className = 'ideal-route-turn';
const n = document.createElement('span'); n.textContent = String(index + 1);
const copy = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = `${turn.total} punti`; const small = document.createElement('small'); small.textContent = (turn.darts || []).map(d => d.label).join(' · ') || `${turn.total} pt`; copy.append(strong, small);
const left = document.createElement('b'); left.textContent = `${turn.scoreAfter} rimasti`; card.append(n, copy, left); idealRoute.appendChild(card);
});
}
async function generateIdeal() {
const playerId = idealPlayer?.value; const score = Number(idealScore?.value); if (!playerId || !score) return;
const old = generateIdealBtn.textContent; generateIdealBtn.disabled = true; generateIdealBtn.textContent = 'Costruzione…';
try {
const { ideal } = buildIdealSequence(playerId, score);
if (!ideal) { window.PidoDartsApp?.showToast?.('Non riesco a costruire un percorso esatto con i turni disponibili'); return; }
const previous = await db.getIdealRecord(playerId, score); ideal.createdAt = previous?.createdAt || ideal.createdAt; ideal.updatedAt = Date.now();
const saved = await db.saveIdealRecord(ideal); await renderIdeal(saved, true); await renderSavedIdeals(); window.PidoDartsApp?.showToast?.('Record ideale costruito e salvato');
} catch (error) { console.error(error); window.PidoDartsApp?.showToast?.('Impossibile costruire il record ideale'); }
finally { generateIdealBtn.disabled = false; generateIdealBtn.textContent = old; }
}
async function renderSavedIdeals() {
if (!idealSavedList) return;
let records = []; try { records = await db.getIdealRecords(); } catch (error) { console.error(error); }
idealSavedList.textContent = ''; idealSavedEmpty.hidden = records.length > 0;
records.forEach(record => {
const player = state.playerMap.get(record.playerId) || record.player || { name: record.playerName || 'Giocatore' };
const card = document.createElement('article'); card.className = 'ideal-saved-card';
const avatar = document.createElement('div'); avatar.className = 'avatar-preview avatar-preview-small'; renderAvatar(avatar, player);
const copy = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = `${player.name} · ${record.startScore}`; const small = document.createElement('small'); small.textContent = `${record.turns} turni · ${record.dartsUsed} freccette · media ${formatAverage(record.averagePerTurn)}`; copy.append(strong, small);
const actions = document.createElement('div'); actions.className = 'ideal-saved-actions';
const open = document.createElement('button'); open.type = 'button'; open.className = 'secondary-btn'; open.dataset.openIdeal = record.id; open.textContent = 'Apri';
const play = document.createElement('button'); play.type = 'button'; play.className = 'primary-btn'; play.dataset.playIdeal = record.id; play.textContent = '🎯'; play.title = 'Prova a batterlo'; actions.append(open, play);
card.append(avatar, copy, actions); idealSavedList.appendChild(card);
});
}
function challenge(ideal) {
if (!ideal) return;
document.dispatchEvent(new CustomEvent('pido:startideal', { detail: { ideal: clone(ideal), playerId: ideal.playerId, startScore: ideal.startScore } }));
}
async function openSavedIdeal(id, play = false) {
const records = await db.getIdealRecords(); const ideal = records.find(item => item.id === id); if (!ideal) return;
if (play) { challenge(ideal); return; }
idealPlayer.value = ideal.playerId; syncIdealScores(); idealScore.value = String(ideal.startScore); await syncIdealSource();
window.scrollTo({ top: 0, behavior: document.documentElement.dataset.animations === 'off' ? 'auto' : 'smooth' });
}
async function loadData() {
if (state.loading) return; state.loading = true; compareRefresh?.classList.add('is-loading'); idealRefresh?.classList.add('is-loading');
try {
const [games, players] = await Promise.all([db.getCompletedGames(), db.getPlayers()]); state.games = games || []; state.players = players || []; collectPlayers();
fillPlayerSelect(comparePlayer); syncCompareScores(); renderComparePicker();
fillPlayerSelect(idealPlayer); syncIdealScores(); await renderSavedIdeals();
} catch (error) { console.error('Impossibile caricare analisi v0.8:', error); }
finally { state.loading = false; compareRefresh?.classList.remove('is-loading'); idealRefresh?.classList.remove('is-loading'); }
}
comparePlayer?.addEventListener('change', () => { state.compareIds = []; syncCompareScores(); renderComparePicker(true); });
compareScore?.addEventListener('change', () => { state.compareIds = []; renderComparePicker(true); });
comparePicker?.addEventListener('click', event => { const btn = event.target.closest('[data-compare-game-id]'); if (btn) toggleCompare(btn.dataset.compareGameId); });
compareRefresh?.addEventListener('click', loadData);
idealPlayer?.addEventListener('change', syncIdealScores);
idealScore?.addEventListener('change', syncIdealSource);
generateIdealBtn?.addEventListener('click', generateIdeal);
regenerateIdealBtn?.addEventListener('click', generateIdeal);
challengeIdealBtn?.addEventListener('click', () => challenge(state.currentIdeal));
idealRefresh?.addEventListener('click', loadData);
idealSavedList?.addEventListener('click', event => {
const play = event.target.closest('[data-play-ideal]'); if (play) { openSavedIdeal(play.dataset.playIdeal, true); return; }
const open = event.target.closest('[data-open-ideal]'); if (open) openSavedIdeal(open.dataset.openIdeal, false);
});
document.addEventListener('pido:screenchange', event => { if (['stats-compare', 'stats-ideal'].includes(event.detail?.screen)) loadData(); });
document.addEventListener('pido:statschanged', loadData);
window.PidoDartsAnalytics = { buildIdealSequence, turnPath, metric };
loadData();
})();

;
(() => {
const db = window.PidoDartsDB;
const engine = window.PidoDartsGameEngine;
const computer = window.PidoDartsComputer;
const security = window.PidoDartsSecurity;
if (!db || !engine) return;
const state = {
players: [],
mode: 'single',
trainingMode: 'free',
selectedScore: 301,
recordSelectedScore: 301,
computerSelectedScore: 301,
computerDifficulty: 'medium',
computerProfile: null,
computerAdaptiveEligible: false,
computerAdaptiveSampleCount: 0,
computerTurnRunning: false,
recordBaseline: null,
idealBaseline: null,
recordUpdate: null,
multiSelectedScore: 301,
multiFinishMode: 'first',
multiSelectedIds: [],
startScore: 301,
participants: [],
currentIndex: 0,
darts: [],
history: [],
active: false,
finished: false,
restored: false,
notice: '',
pickerMultiplier: 1,
draftDart: null,
keyboardBuffer: '',
rosterRenderKey: '',
sessionId: null,
sessionCreatedAt: null,
completedGameId: null
};
const setupPlayer = document.getElementById('gameSetupPlayer');
const setupPlayerPreview = document.getElementById('gameSetupPlayerPreview');
const setupNoPlayers = document.getElementById('gameSetupNoPlayers');
const setupControls = document.getElementById('gameSetupControls');
const scorePicker = document.getElementById('gameScorePicker');
const customScoreWrap = document.getElementById('customScoreWrap');
const customScore = document.getElementById('customScore');
const startGameBtn = document.getElementById('startGameBtn');
const setupError = document.getElementById('gameSetupError');
const recordSetupPlayer = document.getElementById('recordSetupPlayer');
const recordSetupPlayerPreview = document.getElementById('recordSetupPlayerPreview');
const recordSetupNoPlayers = document.getElementById('recordSetupNoPlayers');
const recordSetupControls = document.getElementById('recordSetupControls');
const recordScorePicker = document.getElementById('recordScorePicker');
const recordCustomScoreWrap = document.getElementById('recordCustomScoreWrap');
const recordCustomScore = document.getElementById('recordCustomScore');
const recordSetupError = document.getElementById('recordSetupError');
const startRecordGameBtn = document.getElementById('startRecordGameBtn');
const recordCurrentTitle = document.getElementById('recordCurrentTitle');
const recordCurrentScore = document.getElementById('recordCurrentScore');
const recordCurrentEmpty = document.getElementById('recordCurrentEmpty');
const recordCurrentStats = document.getElementById('recordCurrentStats');
const recordCurrentTurns = document.getElementById('recordCurrentTurns');
const recordCurrentDarts = document.getElementById('recordCurrentDarts');
const recordCurrentBest = document.getElementById('recordCurrentBest');
const recordCurrentAverage = document.getElementById('recordCurrentAverage');
const recordCurrentDate = document.getElementById('recordCurrentDate');
const computerSetupPlayer = document.getElementById('computerSetupPlayer');
const computerSetupPlayerPreview = document.getElementById('computerSetupPlayerPreview');
const computerSetupNoPlayers = document.getElementById('computerSetupNoPlayers');
const computerSetupControls = document.getElementById('computerSetupControls');
const computerScorePicker = document.getElementById('computerScorePicker');
const computerCustomScoreWrap = document.getElementById('computerCustomScoreWrap');
const computerCustomScore = document.getElementById('computerCustomScore');
const computerDifficultyPicker = document.getElementById('computerDifficultyPicker');
const computerAdaptiveDifficultyBtn = document.getElementById('computerAdaptiveDifficultyBtn');
const computerAdaptiveUnlockText = document.getElementById('computerAdaptiveUnlockText');
const computerAdaptiveCard = document.getElementById('computerAdaptiveCard');
const computerAdaptiveTitle = document.getElementById('computerAdaptiveTitle');
const computerAdaptiveDetail = document.getElementById('computerAdaptiveDetail');
const computerAdaptiveMeter = document.getElementById('computerAdaptiveMeter');
const computerSetupError = document.getElementById('computerSetupError');
const startComputerGameBtn = document.getElementById('startComputerGameBtn');
const multiPlayerSelector = document.getElementById('multiPlayerSelector');
const multiSelectedCount = document.getElementById('multiSelectedCount');
const multiNoPlayers = document.getElementById('multiNoPlayers');
const multiOrderList = document.getElementById('multiOrderList');
const multiScorePicker = document.getElementById('multiScorePicker');
const multiCustomScoreWrap = document.getElementById('multiCustomScoreWrap');
const multiCustomScore = document.getElementById('multiCustomScore');
const multiFinishModePicker = document.getElementById('multiFinishModePicker');
const multiSetupError = document.getElementById('multiSetupError');
const startMultiGameBtn = document.getElementById('startMultiGameBtn');
const multiAppIndex = document.getElementById('multiAppIndex');
const multiAppPlayersSummary = document.getElementById('multiAppPlayersSummary');
const multiAppOrderSummary = document.getElementById('multiAppOrderSummary');
const multiAppScoreSummary = document.getElementById('multiAppScoreSummary');
const multiAppFinishSummary = document.getElementById('multiAppFinishSummary');
const multiAppSections = [...document.querySelectorAll('[data-multi-app-section]')];
let activeMultiAppSection = '';
const gameTitle = document.getElementById('gameTitle');
const gamePlayerCard = document.getElementById('gamePlayerCard');
const gamePlayerAvatar = document.getElementById('gamePlayerAvatar');
const gamePlayerName = document.getElementById('gamePlayerName');
const gamePlayerOrder = document.getElementById('gamePlayerOrder');
const gameTurnNumber = document.getElementById('gameTurnNumber');
const gameStartScore = document.getElementById('gameStartScore');
const gameRemaining = document.getElementById('gameRemaining');
const projectedRemaining = document.getElementById('projectedRemaining');
const turnTotal = document.getElementById('turnTotal');
const activeDartIndicator = document.getElementById('activeDartIndicator');
const dartSlots = [...document.querySelectorAll('[data-dart-slot]')];
const openDartPickerBtn = document.getElementById('openDartPickerBtn');
const nextDartHint = document.getElementById('nextDartHint');
const dartPicker = document.getElementById('dartPicker');
const dartPickerTitle = document.getElementById('dartPickerTitle');
const closeDartPickerBtn = document.getElementById('closeDartPickerBtn');
const multiplierTabs = document.getElementById('multiplierTabs');
const numberPad = document.getElementById('numberPad');
const pickerSpecials = document.getElementById('pickerSpecials');
const pickerSelectedLabel = document.getElementById('pickerSelectedLabel');
const pickerSelectedPoints = document.getElementById('pickerSelectedPoints');
const confirmDartBtn = document.getElementById('confirmDartBtn');
const pickerCancelLastBtn = document.getElementById('pickerCancelLastBtn');
const cancelDartBtn = document.getElementById('cancelDartBtn');
const confirmTurnBtn = document.getElementById('confirmTurnBtn');
const undoTurnBtn = document.getElementById('undoTurnBtn');
const gameNotice = document.getElementById('gameNotice');
const historyList = document.getElementById('turnHistory');
const historyEmpty = document.getElementById('turnHistoryEmpty');
const historyCount = document.getElementById('turnHistoryCount');
const clearGameBtn = document.getElementById('clearGameBtn');
const keyboardInputStatus = document.getElementById('keyboardInputStatus');
const recordPaceCard = document.getElementById('recordPaceCard');
const recordPaceStatus = document.getElementById('recordPaceStatus');
const recordPaceScore = document.getElementById('recordPaceScore');
const recordPaceTarget = document.getElementById('recordPaceTarget');
const recordPaceCurrent = document.getElementById('recordPaceCurrent');
const recordPaceDeltaCard = document.getElementById('recordPaceDeltaCard');
const recordPaceDelta = document.getElementById('recordPaceDelta');
const recordPaceNote = document.getElementById('recordPaceNote');
const gameRosterWrap = document.getElementById('gameRosterWrap');
const gameRoster = document.getElementById('gameRoster');
const gameRosterHint = document.getElementById('gameRosterHint');
const gameModeChip = document.getElementById('gameModeChip');
const exitModal = document.getElementById('gameExitModal');
const stayInGameBtn = document.getElementById('stayInGameBtn');
const pauseGameBtn = document.getElementById('pauseGameBtn');
const confirmExitGameBtn = document.getElementById('confirmExitGameBtn');
const resumeCard = document.getElementById('resumeCard');
const resumeCardTitle = document.getElementById('resumeCardTitle');
const resumeCardDetail = document.getElementById('resumeCardDetail');
const resumeCardCount = document.getElementById('resumeCardCount');
const resumeGamesModal = document.getElementById('resumeGamesModal');
const closeResumeGamesModalBtn = document.getElementById('closeResumeGamesModal');
const resumeGamesList = document.getElementById('resumeGamesList');
const resumeGamesEmpty = document.getElementById('resumeGamesEmpty');
const finishModal = document.getElementById('gameFinishModal');
const finishEyebrow = document.getElementById('finishEyebrow');
const finishPlayerName = document.getElementById('finishPlayerName');
const finishIntroText = document.getElementById('finishIntroText');
const finishTurns = document.getElementById('finishTurns');
const finishDarts = document.getElementById('finishDarts');
const finishBestTurn = document.getElementById('finishBestTurn');
const finishAverage = document.getElementById('finishAverage');
const finishRecordResult = document.getElementById('finishRecordResult');
const finishRecordTitle = document.getElementById('finishRecordTitle');
const finishRecordDetail = document.getElementById('finishRecordDetail');
const finishIdealResult = document.getElementById('finishIdealResult');
const finishIdealTitle = document.getElementById('finishIdealTitle');
const finishIdealDetail = document.getElementById('finishIdealDetail');
const finishRanking = document.getElementById('finishRanking');
const finishRankingTitle = document.getElementById('finishRankingTitle');
const finishRankingSubtitle = document.getElementById('finishRankingSubtitle');
const finishRankingList = document.getElementById('finishRankingList');
const finishUndoBtn = document.getElementById('finishUndoBtn');
const finishNewGameBtn = document.getElementById('finishNewGameBtn');
const finishHomeBtn = document.getElementById('finishHomeBtn');
function showToast(message) {
window.PidoDartsApp?.showToast?.(message);
}
let saveChain = Promise.resolve();
function cloneData(value) {
if (typeof structuredClone === 'function') {
try { return structuredClone(value); } catch (_) {  }
}
return JSON.parse(JSON.stringify(value));
}
function formatSavedTime(timestamp) {
if (!timestamp) return 'salvataggio recente';
try {
return new Intl.DateTimeFormat('it-IT', {
day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(new Date(timestamp));
} catch (_) {
return 'salvataggio recente';
}
}
function formatRecordDate(timestamp) {
if (!timestamp) return '';
try {
return new Intl.DateTimeFormat('it-IT', {
day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(timestamp));
} catch (_) {
return '';
}
}
function formatAverage(value) {
const number = Number(value);
if (!Number.isFinite(number)) return '0,0';
return number.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function currentSavedParticipant(session) {
if (!session?.participants?.length) return null;
return session.participants[Math.min(Math.max(Number(session.currentIndex) || 0, 0), session.participants.length - 1)] || session.participants[0];
}
function sessionLabel(session) {
const multi = session?.mode === 'multi';
const computerMatch = session?.mode === 'computer' || session?.trainingMode === 'computer';
const recordChallenge = !multi && !computerMatch && session?.trainingMode === 'record';
const idealChallenge = !multi && !computerMatch && session?.trainingMode === 'ideal';
const label = multi ? 'Multiplayer' : (computerMatch ? 'Contro Pido PC' : (idealChallenge ? 'Record ideale' : (recordChallenge ? 'Batti record' : 'Allenamento')));
return `${label} · ${session?.startScore || 0} punti`;
}
function sessionPlayersLabel(session) {
const names = (session?.participants || []).map(item => item?.player?.name).filter(Boolean);
if (names.length <= 3) return names.join(' · ');
return `${names.slice(0, 3).join(' · ')} +${names.length - 3}`;
}
function makeSessionSnapshot() {
if (!state.sessionId || !state.participants.length) return null;
const now = Date.now();
return {
id: state.sessionId,
schemaVersion: 1,
createdAt: state.sessionCreatedAt || now,
updatedAt: now,
mode: state.mode,
trainingMode: state.trainingMode,
selectedScore: state.selectedScore,
recordSelectedScore: state.recordSelectedScore,
computerSelectedScore: state.computerSelectedScore,
computerDifficulty: state.computerDifficulty,
computerProfile: cloneData(state.computerProfile),
recordBaseline: cloneData(state.recordBaseline),
idealBaseline: cloneData(state.idealBaseline),
multiSelectedScore: state.multiSelectedScore,
multiFinishMode: state.multiFinishMode,
multiSelectedIds: [...state.multiSelectedIds],
startScore: state.startScore,
participants: cloneData(state.participants),
currentIndex: state.currentIndex,
darts: cloneData(state.darts),
history: cloneData(state.history),
active: true,
finished: false,
restored: state.restored,
notice: state.notice,
completedGameId: state.completedGameId
};
}
function queueAutoSave(reason = 'aggiornamento') {
if (!state.active || state.finished || !state.participants.length) return Promise.resolve();
if (!state.sessionId) state.sessionId = db.createGameSessionId?.() || db.createId?.('game');
if (!state.sessionCreatedAt) state.sessionCreatedAt = Date.now();
const snapshot = makeSessionSnapshot();
if (!snapshot) return Promise.resolve();
saveChain = saveChain
.catch(() => undefined)
.then(() => db.saveGameSession(snapshot))
.then(() => refreshResumeUI())
.catch(error => console.error(`Salvataggio automatico non riuscito (${reason}):`, error));
return saveChain;
}
async function deleteSavedSession(id) {
if (!id) return;
try {
await saveChain.catch(() => undefined);
await db.deleteGameSession(id);
} catch (error) {
console.error('Impossibile eliminare il salvataggio:', error);
}
await refreshResumeUI();
}
function renderResumeList(sessions) {
if (!resumeGamesList || !resumeGamesEmpty) return;
resumeGamesList.textContent = '';
resumeGamesEmpty.hidden = sessions.length > 0;
sessions.forEach(session => {
const current = currentSavedParticipant(session);
const item = document.createElement('article');
item.className = 'resume-game-item';
const icon = document.createElement('span');
icon.className = 'resume-game-icon';
icon.textContent = session.mode === 'multi' ? '👥' : (session.mode === 'computer' ? '🤖' : '🎯');
const copy = document.createElement('div');
copy.className = 'resume-game-copy';
const title = document.createElement('strong');
title.textContent = sessionLabel(session);
const names = document.createElement('small');
names.textContent = sessionPlayersLabel(session) || 'Giocatore';
const status = document.createElement('small');
status.className = 'resume-game-status';
status.textContent = current
? `Turno di ${current.player?.name || 'giocatore'} · ${current.score} rimasti · ${formatSavedTime(session.updatedAt)}`
: formatSavedTime(session.updatedAt);
copy.append(title, names, status);
const actions = document.createElement('div');
actions.className = 'resume-game-actions';
const resume = document.createElement('button');
resume.type = 'button';
resume.className = 'primary-btn resume-game-open';
resume.dataset.resumeGameId = session.id;
resume.textContent = 'Riprendi';
const remove = document.createElement('button');
remove.type = 'button';
remove.className = 'game-quiet-btn resume-game-delete';
remove.dataset.deleteResumeId = session.id;
remove.setAttribute('aria-label', `Elimina salvataggio ${title.textContent}`);
remove.textContent = '🗑';
actions.append(resume, remove);
item.append(icon, copy, actions);
resumeGamesList.appendChild(item);
});
}
async function refreshResumeUI() {
if (!resumeCard) return [];
let sessions = [];
try {
sessions = (await db.getGameSessions()).filter(session => session && !session.finished && session.participants?.length);
} catch (error) {
console.error('Impossibile leggere le partite sospese:', error);
}
const hasSessions = sessions.length > 0;
resumeCard.disabled = !hasSessions;
resumeCard.classList.toggle('is-disabled', !hasSessions);
resumeCard.setAttribute('aria-disabled', String(!hasSessions));
if (!hasSessions) {
if (resumeCardTitle) resumeCardTitle.textContent = 'Nessuna partita da riprendere';
if (resumeCardDetail) resumeCardDetail.textContent = 'Le partite in corso vengono salvate automaticamente sul dispositivo.';
if (resumeCardCount) resumeCardCount.hidden = true;
} else {
const latest = sessions[0];
const current = currentSavedParticipant(latest);
if (resumeCardTitle) resumeCardTitle.textContent = sessions.length === 1 ? sessionLabel(latest) : `${sessions.length} partite da riprendere`;
if (resumeCardDetail) {
const currentText = current ? `${current.player?.name || 'Giocatore'} · ${current.score} rimasti` : sessionPlayersLabel(latest);
resumeCardDetail.textContent = `${sessions.length === 1 ? '' : 'Ultima: '}${currentText} · ${formatSavedTime(latest.updatedAt)}`;
}
if (resumeCardCount) {
resumeCardCount.hidden = sessions.length <= 1;
resumeCardCount.textContent = String(sessions.length);
}
}
renderResumeList(sessions);
return sessions;
}
function openResumeGamesModal() {
if (!resumeGamesModal || resumeCard?.disabled) return;
refreshResumeUI();
resumeGamesModal.hidden = false;
syncBodyModalState();
setTimeout(() => closeResumeGamesModalBtn?.focus(), 0);
}
function closeResumeGamesModal() {
if (!resumeGamesModal) return;
resumeGamesModal.hidden = true;
syncBodyModalState();
}
async function restoreGameSession(id) {
let session;
try {
session = await db.getGameSession(id);
} catch (error) {
console.error(error);
}
if (!session?.participants?.length || !Number.isInteger(Number(session.startScore))) {
showToast('Salvataggio non valido');
await deleteSavedSession(id);
return;
}
state.sessionId = session.id;
state.sessionCreatedAt = session.createdAt || Date.now();
state.completedGameId = session.completedGameId || null;
state.mode = session.mode === 'multi' ? 'multi' : (session.mode === 'computer' ? 'computer' : 'single');
state.trainingMode = state.mode === 'single'
? (['record', 'ideal'].includes(session.trainingMode) ? session.trainingMode : 'free')
: (state.mode === 'computer' ? 'computer' : 'free');
state.selectedScore = session.selectedScore ?? session.startScore;
state.recordSelectedScore = session.recordSelectedScore ?? session.startScore;
state.computerSelectedScore = session.computerSelectedScore ?? session.startScore;
state.computerDifficulty = session.computerDifficulty || 'medium';
state.computerProfile = session.computerProfile ? cloneData(session.computerProfile) : null;
state.computerTurnRunning = false;
state.recordBaseline = session.recordBaseline ? cloneData(session.recordBaseline) : null;
state.idealBaseline = session.idealBaseline ? cloneData(session.idealBaseline) : null;
state.recordUpdate = null;
state.multiSelectedScore = session.multiSelectedScore ?? session.startScore;
state.multiFinishMode = session.multiFinishMode === 'full' ? 'full' : 'first';
state.multiSelectedIds = Array.isArray(session.multiSelectedIds) ? [...session.multiSelectedIds] : [];
state.startScore = Number(session.startScore);
state.participants = cloneData(session.participants);
state.currentIndex = Math.min(Math.max(Number(session.currentIndex) || 0, 0), state.participants.length - 1);
state.darts = Array.isArray(session.darts) ? cloneData(session.darts) : [];
state.history = Array.isArray(session.history) ? cloneData(session.history) : [];
state.active = true;
state.finished = false;
state.restored = true;
state.notice = `Partita ripresa. ${session.notice || 'Continua dal punto in cui avevi lasciato.'}`;
state.pickerMultiplier = 1;
state.draftDart = null;
state.keyboardBuffer = '';
state.rosterRenderKey = '';
if (state.trainingMode === 'record' && !state.recordBaseline && state.participants[0]?.player?.id) {
try { state.recordBaseline = await db.getRecord(state.participants[0].player.id, state.startScore); }
catch (error) { console.error('Impossibile leggere il record durante la ripresa:', error); }
}
if (isComputerMatch() && currentParticipant()?.player?.isComputer && state.darts.length) {
state.darts = [];
state.notice = 'Partita ripresa. Pido PC riparte dal proprio turno.';
}
closeResumeGamesModal();
renderGame();
if (window.PidoDartsApp?.resetNavigation) {
const stack = isMultiplayer()
? ['home', 'multiplayer']
: (isComputerMatch() ? ['home', 'training', 'computer-setup'] : (state.trainingMode === 'ideal' ? ['home', 'statistics', 'stats-ideal'] : ['home', 'training', state.trainingMode === 'record' ? 'record-setup' : 'game-setup']));
window.PidoDartsApp.resetNavigation('game', stack);
} else {
window.PidoDartsApp?.goTo?.('game');
}
queueAutoSave('ripresa');
if (isComputerMatch() && currentParticipant()?.player?.isComputer) scheduleComputerTurn();
showToast('Partita ripresa');
}
function textColorFor(hex) {
const clean = String(hex || '#20d868').replace('#', '');
if (!/^[0-9a-f]{6}$/i.test(clean)) return '#041008';
const r = parseInt(clean.slice(0, 2), 16);
const g = parseInt(clean.slice(2, 4), 16);
const b = parseInt(clean.slice(4, 6), 16);
const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
return luminance > 0.58 ? '#07100b' : '#ffffff';
}
function initials(name) {
const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
if (!parts.length) return '?';
if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase();
}
function renderAvatar(element, player) {
if (!element) return;
const color = security?.safeHex ? security.safeHex(player?.color, '#20d868') : '#20d868';
element.style.setProperty('--player-color', color);
element.style.setProperty('--player-text-color', textColorFor(color));
element.classList.remove('has-image');
element.style.backgroundImage = '';
element.textContent = '';
const avatarImage = security?.safeImageDataUrl ? security.safeImageDataUrl(player?.avatarValue, 2_000_000) : '';
if (player?.avatarType === 'image' && avatarImage) {
element.classList.add('has-image');
element.style.backgroundImage = security.cssImageUrl(avatarImage, 2_000_000);
return;
}
const span = document.createElement('span');
span.textContent = player?.avatarType === 'emoji' ? String(player.avatarValue || '🎯').slice(0, 32) : initials(player?.name);
element.appendChild(span);
}
function currentParticipant() {
return state.participants[state.currentIndex] || null;
}
function isMultiplayer() {
return state.mode === 'multi';
}
function isComputerMatch() {
return state.mode === 'computer' || state.trainingMode === 'computer';
}
function isComputerParticipant(participant = currentParticipant()) {
return Boolean(participant?.player?.isComputer);
}
function makeParticipant(player, order) {
return {
player: { ...player },
order,
score: state.startScore,
turns: 0,
finished: false,
place: null
};
}
async function loadPlayers() {
try {
state.players = await db.getPlayers();
state.multiSelectedIds = state.multiSelectedIds.filter(id => state.players.some(player => player.id === id));
renderSingleSetupPlayers();
renderRecordSetupPlayers();
renderComputerSetupPlayers();
renderMultiSetup();
} catch (error) {
console.error(error);
if (setupError) setupError.textContent = 'Non riesco a leggere i profili salvati sul dispositivo.';
if (recordSetupError) recordSetupError.textContent = 'Non riesco a leggere i profili salvati sul dispositivo.';
if (computerSetupError) computerSetupError.textContent = 'Non riesco a leggere i profili salvati sul dispositivo.';
if (multiSetupError) multiSetupError.textContent = 'Non riesco a leggere i profili salvati sul dispositivo.';
if (startGameBtn) startGameBtn.disabled = true;
if (startRecordGameBtn) startRecordGameBtn.disabled = true;
if (startComputerGameBtn) startComputerGameBtn.disabled = true;
if (startMultiGameBtn) startMultiGameBtn.disabled = true;
}
}
function renderSingleSetupPlayers() {
if (!setupPlayer) return;
const previous = setupPlayer.value;
setupPlayer.textContent = '';
state.players.forEach(player => {
const option = document.createElement('option');
option.value = player.id;
option.textContent = player.name;
setupPlayer.appendChild(option);
});
if (previous && state.players.some(player => player.id === previous)) setupPlayer.value = previous;
const hasPlayers = state.players.length > 0;
if (setupNoPlayers) setupNoPlayers.hidden = hasPlayers;
if (setupControls) setupControls.hidden = !hasPlayers;
if (startGameBtn) startGameBtn.disabled = !hasPlayers;
if (hasPlayers) renderSetupPlayerPreview();
}
function renderSetupPlayerPreview() {
if (!setupPlayerPreview || !setupPlayer) return;
const player = state.players.find(item => item.id === setupPlayer.value) || state.players[0];
setupPlayerPreview.textContent = '';
if (!player) return;
const avatar = document.createElement('div');
avatar.className = 'avatar-preview avatar-preview-small';
renderAvatar(avatar, player);
const copy = document.createElement('div');
const strong = document.createElement('strong');
strong.textContent = player.name;
const small = document.createElement('small');
small.textContent = 'Profilo selezionato';
copy.append(strong, small);
setupPlayerPreview.append(avatar, copy);
}
let recordPreviewToken = 0;
function renderRecordSetupPlayers() {
if (!recordSetupPlayer) return;
const previous = recordSetupPlayer.value;
recordSetupPlayer.textContent = '';
state.players.forEach(player => {
const option = document.createElement('option');
option.value = player.id;
option.textContent = player.name;
recordSetupPlayer.appendChild(option);
});
if (previous && state.players.some(player => player.id === previous)) recordSetupPlayer.value = previous;
const hasPlayers = state.players.length > 0;
if (recordSetupNoPlayers) recordSetupNoPlayers.hidden = hasPlayers;
if (recordSetupControls) recordSetupControls.hidden = !hasPlayers;
if (startRecordGameBtn) startRecordGameBtn.disabled = !hasPlayers || getRecordStartScore() === null;
if (hasPlayers) {
renderRecordPlayerPreview();
refreshRecordPreview();
}
}
function renderRecordPlayerPreview() {
if (!recordSetupPlayerPreview || !recordSetupPlayer) return;
const player = state.players.find(item => item.id === recordSetupPlayer.value) || state.players[0];
recordSetupPlayerPreview.textContent = '';
if (!player) return;
const avatar = document.createElement('div');
avatar.className = 'avatar-preview avatar-preview-small';
renderAvatar(avatar, player);
const copy = document.createElement('div');
const strong = document.createElement('strong');
strong.textContent = player.name;
const small = document.createElement('small');
small.textContent = 'Record personali separati per punteggio';
copy.append(strong, small);
recordSetupPlayerPreview.append(avatar, copy);
}
function selectRecordScore(value) {
state.recordSelectedScore = value;
recordScorePicker?.querySelectorAll('[data-record-score]').forEach(button => {
button.classList.toggle('selected', String(value) === button.dataset.recordScore);
});
if (recordCustomScoreWrap) recordCustomScoreWrap.hidden = value !== 'custom';
if (recordSetupError) recordSetupError.textContent = '';
if (value === 'custom') recordCustomScore?.focus();
refreshRecordPreview();
}
function getRecordStartScore() {
if (state.recordSelectedScore !== 'custom') return Number(state.recordSelectedScore);
const value = Number.parseInt(recordCustomScore?.value, 10);
if (!Number.isInteger(value) || value < 1 || value > 9999) return null;
return value;
}
async function refreshRecordPreview() {
if (!recordSetupPlayer || !recordCurrentTitle) return;
const token = ++recordPreviewToken;
const player = state.players.find(item => item.id === recordSetupPlayer.value) || state.players[0];
const score = getRecordStartScore();
if (recordCurrentScore) recordCurrentScore.textContent = score === null ? '—' : String(score);
if (startRecordGameBtn) startRecordGameBtn.disabled = !player || score === null;
if (!player || score === null) {
if (recordCurrentTitle) recordCurrentTitle.textContent = score === null ? 'Inserisci un punteggio valido' : 'Scegli un giocatore';
if (recordCurrentEmpty) recordCurrentEmpty.hidden = false;
if (recordCurrentStats) recordCurrentStats.hidden = true;
if (recordCurrentDate) recordCurrentDate.textContent = '';
return;
}
recordCurrentTitle.textContent = 'Caricamento…';
let record = null;
try { record = await db.getRecord(player.id, score); }
catch (error) {
console.error('Impossibile leggere il record:', error);
if (token === recordPreviewToken && recordSetupError) recordSetupError.textContent = 'Non riesco a leggere i record salvati.';
return;
}
if (token !== recordPreviewToken) return;
if (!record) {
recordCurrentTitle.textContent = `${player.name} · nessun record`;
if (recordCurrentEmpty) recordCurrentEmpty.hidden = false;
if (recordCurrentStats) recordCurrentStats.hidden = true;
if (recordCurrentDate) recordCurrentDate.textContent = 'Completa la prima partita per stabilirlo.';
return;
}
recordCurrentTitle.textContent = `${player.name} · miglior risultato`;
if (recordCurrentEmpty) recordCurrentEmpty.hidden = true;
if (recordCurrentStats) recordCurrentStats.hidden = false;
if (recordCurrentTurns) recordCurrentTurns.textContent = String(record.turns);
if (recordCurrentDarts) recordCurrentDarts.textContent = String(record.dartsUsed);
if (recordCurrentBest) recordCurrentBest.textContent = String(record.bestTurn);
if (recordCurrentAverage) recordCurrentAverage.textContent = formatAverage(record.averagePerTurn);
if (recordCurrentDate) recordCurrentDate.textContent = record.updatedAt ? `Aggiornato il ${formatRecordDate(record.updatedAt)}` : '';
}
function renderComputerSetupPlayers() {
if (!computerSetupPlayer) return;
const previous = computerSetupPlayer.value;
computerSetupPlayer.textContent = '';
state.players.forEach(player => {
const option = document.createElement('option');
option.value = player.id;
option.textContent = player.name;
computerSetupPlayer.appendChild(option);
});
if (previous && state.players.some(player => player.id === previous)) computerSetupPlayer.value = previous;
const hasPlayers = state.players.length > 0;
if (computerSetupNoPlayers) computerSetupNoPlayers.hidden = hasPlayers;
if (computerSetupControls) computerSetupControls.hidden = !hasPlayers;
if (startComputerGameBtn) startComputerGameBtn.disabled = !hasPlayers || getComputerStartScore() === null;
if (hasPlayers) {
renderComputerPlayerPreview();
refreshComputerAdaptivePreview();
}
}
function renderComputerPlayerPreview() {
if (!computerSetupPlayerPreview || !computerSetupPlayer) return;
const player = state.players.find(item => item.id === computerSetupPlayer.value) || state.players[0];
computerSetupPlayerPreview.textContent = '';
if (!player) return;
const avatar = document.createElement('div');
avatar.className = 'avatar-preview avatar-preview-small';
renderAvatar(avatar, player);
const copy = document.createElement('div');
const strong = document.createElement('strong');
strong.textContent = player.name;
const small = document.createElement('small');
small.textContent = 'Tu inizi per primo contro Pido PC';
copy.append(strong, small);
computerSetupPlayerPreview.append(avatar, copy);
}
function selectComputerScore(value) {
state.computerSelectedScore = value;
computerScorePicker?.querySelectorAll('[data-computer-score]').forEach(button => {
button.classList.toggle('selected', String(value) === button.dataset.computerScore);
});
if (computerCustomScoreWrap) computerCustomScoreWrap.hidden = value !== 'custom';
if (computerSetupError) computerSetupError.textContent = '';
if (value === 'custom') computerCustomScore?.focus();
if (startComputerGameBtn) startComputerGameBtn.disabled = !computerSetupPlayer?.value || getComputerStartScore() === null;
}
function getComputerStartScore() {
if (state.computerSelectedScore !== 'custom') return Number(state.computerSelectedScore);
const value = Number.parseInt(computerCustomScore?.value, 10);
if (!Number.isInteger(value) || value < 1 || value > 9999) return null;
return value;
}
function computerDifficultyLabel(key) {
if (key === 'adaptive') return 'Adattivo';
return computer?.PRESETS?.[key]?.label || 'Medio';
}
async function getAdaptivePlayerGames(playerId) {
if (!playerId || !computer) return [];
let games = [];
try { games = await db.getCompletedGames(); }
catch (error) {
console.error('Impossibile leggere le partite per il livello adattivo:', error);
return [];
}
return games
.map(game => {
const participant = (game.participants || []).find(item => item.playerId === playerId || item.player?.id === playerId);
if (!participant || participant.player?.isComputer) return null;
const average = Number(participant.stats?.averagePerTurn);
if (!Number.isFinite(average) || Number(participant.stats?.turns || 0) <= 0) return null;
return { game, participant, average };
})
.filter(Boolean);
}
async function refreshComputerAdaptiveAvailability(playerId = null) {
const player = (playerId ? state.players.find(item => item.id === playerId) : null) || state.players.find(item => item.id === computerSetupPlayer?.value) || state.players[0];
const relevant = await getAdaptivePlayerGames(player?.id);
const sampleCount = relevant.length;
const unlocked = sampleCount >= 3;
state.computerAdaptiveEligible = unlocked;
state.computerAdaptiveSampleCount = sampleCount;
if (computerAdaptiveDifficultyBtn) {
computerAdaptiveDifficultyBtn.disabled = !unlocked;
computerAdaptiveDifficultyBtn.classList.toggle('is-locked', !unlocked);
computerAdaptiveDifficultyBtn.setAttribute('aria-disabled', String(!unlocked));
const icon = computerAdaptiveDifficultyBtn.querySelector(':scope > span:first-child');
if (icon) icon.textContent = unlocked ? '🧠' : '🔒';
}
if (computerAdaptiveUnlockText) {
computerAdaptiveUnlockText.textContent = unlocked
? `Sbloccato · usa le ultime ${Math.min(4, sampleCount)} partite e cambia solo tra una partita e l'altra.`
: `Completa 3 partite per sbloccare · ${Math.min(sampleCount, 3)}/3`;
}
if (!unlocked && state.computerDifficulty === 'adaptive') {
state.computerDifficulty = 'medium';
state.computerProfile = null;
computerDifficultyPicker?.querySelectorAll('[data-computer-difficulty]').forEach(button => {
button.classList.toggle('selected', button.dataset.computerDifficulty === 'medium');
});
}
return { unlocked, sampleCount, relevant };
}
async function computeAdaptiveComputerProfile(playerId) {
const availability = await refreshComputerAdaptiveAvailability(playerId);
const relevant = availability.relevant.slice(0, 4);
const sampleCount = relevant.length;
if (!availability.unlocked || sampleCount < 3) return null;
const baseAverage = relevant.reduce((sum, item) => sum + item.average, 0) / sampleCount;
let target = baseAverage;
const versus = relevant.filter(item => item.game.mode === 'computer');
if (versus.length >= 3) {
const wins = versus.filter(item => item.game.winnerId === playerId).length;
if (wins >= 3) target += 4;
else if (wins <= 1) target -= 3;
}
const note = `Calibrato sulle ultime ${sampleCount} partite concluse. Il livello verrà ricalcolato solo alla prossima sfida.`;
return computer.adaptiveProfile(target, sampleCount, note);
}
async function refreshComputerAdaptivePreview() {
if (!computerAdaptiveCard) return;
const availability = await refreshComputerAdaptiveAvailability();
const adaptive = state.computerDifficulty === 'adaptive';
computerAdaptiveCard.classList.toggle('active', adaptive);
if (!availability.unlocked) {
if (computerAdaptiveTitle) computerAdaptiveTitle.textContent = `Adattivo bloccato · ${Math.min(availability.sampleCount, 3)}/3 partite`;
if (computerAdaptiveDetail) computerAdaptiveDetail.textContent = 'Completa almeno 3 partite con questo profilo per sbloccare la difficoltà Adattiva.';
if (computerAdaptiveMeter) computerAdaptiveMeter.style.width = `${Math.max(8, Math.min(100, (availability.sampleCount / 3) * 100))}%`;
return;
}
if (!adaptive) {
const preset = computer?.profileFor?.(state.computerDifficulty) || computer?.PRESETS?.medium;
if (computerAdaptiveTitle) computerAdaptiveTitle.textContent = `${computerDifficultyLabel(state.computerDifficulty)} · circa ${Math.round(preset?.targetAverage || 43)} punti/turno`;
if (computerAdaptiveDetail) computerAdaptiveDetail.textContent = `Adattivo sbloccato: può usare le ultime ${Math.min(4, availability.sampleCount)} partite quando lo selezioni.`;
if (computerAdaptiveMeter) computerAdaptiveMeter.style.width = `${Math.min(100, Math.max(8, (Number(preset?.targetAverage || 43) / 70) * 100))}%`;
return;
}
if (computerAdaptiveTitle) computerAdaptiveTitle.textContent = 'Analizzo le tue partite…';
const profile = await computeAdaptiveComputerProfile((state.players.find(item => item.id === computerSetupPlayer?.value) || state.players[0])?.id);
if (state.computerDifficulty !== 'adaptive' || !profile) return;
state.computerProfile = cloneData(profile);
if (computerAdaptiveTitle) {
const equivalent = computerDifficultyLabel(profile.equivalent);
computerAdaptiveTitle.textContent = `Livello attuale: ${Math.round(profile.targetAverage)} pt/turno · simile a ${equivalent}`;
}
if (computerAdaptiveDetail) computerAdaptiveDetail.textContent = profile.note || 'Il livello viene calcolato prima della partita.';
if (computerAdaptiveMeter) computerAdaptiveMeter.style.width = `${Math.min(100, Math.max(8, (Number(profile.targetAverage || 34) / 70) * 100))}%`;
}
function selectComputerDifficulty(key) {
const allowed = ['beginner', 'easy', 'medium', 'hard', 'adaptive'];
if (key === 'adaptive' && !state.computerAdaptiveEligible) {
if (computerSetupError) computerSetupError.textContent = `Adattivo si sblocca dopo 3 partite concluse (${Math.min(state.computerAdaptiveSampleCount, 3)}/3).`;
return;
}
state.computerDifficulty = allowed.includes(key) ? key : 'medium';
state.computerProfile = null;
computerDifficultyPicker?.querySelectorAll('[data-computer-difficulty]').forEach(button => {
button.classList.toggle('selected', button.dataset.computerDifficulty === state.computerDifficulty);
});
if (computerSetupError) computerSetupError.textContent = '';
refreshComputerAdaptivePreview();
}
function makeComputerPlayer(profile) {
const target = Math.round(Number(profile?.targetAverage || 43));
return {
id: '__pido_computer__',
name: 'Pido PC',
color: '#20d868',
avatarType: 'emoji',
avatarValue: '🤖',
isComputer: true,
computerDifficulty: state.computerDifficulty,
computerTargetAverage: target
};
}
async function startComputerGame() {
const player = state.players.find(item => item.id === computerSetupPlayer?.value);
const startScore = getComputerStartScore();
if (!player) {
if (computerSetupError) computerSetupError.textContent = 'Seleziona un giocatore.';
return;
}
if (startScore === null) {
if (computerSetupError) computerSetupError.textContent = 'Inserisci un punteggio personalizzato da 1 a 9999.';
computerCustomScore?.focus();
return;
}
if (!computer) {
if (computerSetupError) computerSetupError.textContent = 'Il modulo del computer non è disponibile.';
return;
}
let profile;
if (state.computerDifficulty === 'adaptive') {
profile = await computeAdaptiveComputerProfile(player.id);
if (!profile) {
if (computerSetupError) computerSetupError.textContent = `Adattivo si sblocca dopo 3 partite concluse (${Math.min(state.computerAdaptiveSampleCount, 3)}/3).`;
return;
}
} else {
profile = computer.profileFor(state.computerDifficulty);
}
state.mode = 'computer';
state.trainingMode = 'computer';
state.computerProfile = cloneData(profile);
state.recordBaseline = null;
state.idealBaseline = null;
state.recordUpdate = null;
state.startScore = startScore;
state.participants = [
makeParticipant(player, 0),
makeParticipant(makeComputerPlayer(profile), 1)
];
beginMatch(`Sfida iniziata: ${player.name} contro Pido PC · ${computerDifficultyLabel(state.computerDifficulty)}.`);
}
function selectScore(value) {
state.selectedScore = value;
scorePicker?.querySelectorAll('[data-game-score]').forEach(button => {
button.classList.toggle('selected', String(value) === button.dataset.gameScore);
});
if (customScoreWrap) customScoreWrap.hidden = value !== 'custom';
if (setupError) setupError.textContent = '';
if (value === 'custom') customScore?.focus();
}
function getChosenStartScore() {
if (state.selectedScore !== 'custom') return Number(state.selectedScore);
const value = Number.parseInt(customScore?.value, 10);
if (!Number.isInteger(value) || value < 1 || value > 9999) return null;
return value;
}
function isMultiAppMode() {
const app = window.PidoDartsApp;
const settings = app?.getSettings?.();
return window.matchMedia('(max-width: 720px)').matches && settings?.mobileLayout === 'app';
}
function syncMultiAppSummaries() {
const selectedPlayers = state.multiSelectedIds
.map(id => state.players.find(player => player.id === id))
.filter(Boolean);
if (multiAppPlayersSummary) {
multiAppPlayersSummary.textContent = selectedPlayers.length
? `${selectedPlayers.length} ${selectedPlayers.length === 1 ? 'giocatore selezionato' : 'giocatori selezionati'}`
: 'Scegli da 2 a 8 profili';
}
if (multiAppOrderSummary) {
multiAppOrderSummary.textContent = selectedPlayers.length
? selectedPlayers.map((player, index) => `#${index + 1} ${player.name}`).join(' · ')
: 'Da definire';
}
const score = getMultiStartScore();
if (multiAppScoreSummary) {
multiAppScoreSummary.textContent = state.multiSelectedScore === 'custom'
? (score === null ? 'Punteggio personalizzato' : `${score} punti`)
: `${state.multiSelectedScore} punti`;
}
if (multiAppFinishSummary) {
multiAppFinishSummary.textContent = state.multiFinishMode === 'full' ? 'Classifica completa' : 'Primo a zero';
}
}
function syncMultiAppNavigation() {
activeMultiAppSection = '';
document.body.classList.remove('multi-app-subpage');
multiAppSections.forEach(section => section.classList.remove('is-app-active'));
syncMultiAppSummaries();
}
function openMultiAppSection() {
}
function closeMultiAppSection() {
return false;
}
function selectMultiScore(value) {
state.multiSelectedScore = value;
multiScorePicker?.querySelectorAll('[data-multi-score]').forEach(button => {
button.classList.toggle('selected', String(value) === button.dataset.multiScore);
});
if (multiCustomScoreWrap) multiCustomScoreWrap.hidden = value !== 'custom';
if (multiSetupError) multiSetupError.textContent = '';
if (value === 'custom') multiCustomScore?.focus();
syncMultiStartButton();
syncMultiAppSummaries();
}
function getMultiStartScore() {
if (state.multiSelectedScore !== 'custom') return Number(state.multiSelectedScore);
const value = Number.parseInt(multiCustomScore?.value, 10);
if (!Number.isInteger(value) || value < 1 || value > 9999) return null;
return value;
}
function selectFinishMode(mode) {
state.multiFinishMode = mode === 'full' ? 'full' : 'first';
multiFinishModePicker?.querySelectorAll('[data-finish-mode]').forEach(button => {
button.classList.toggle('selected', button.dataset.finishMode === state.multiFinishMode);
});
syncMultiAppSummaries();
}
function renderMultiSetup() {
if (!multiPlayerSelector) return;
const enoughProfiles = state.players.length >= 2;
if (multiNoPlayers) multiNoPlayers.hidden = enoughProfiles;
multiPlayerSelector.textContent = '';
state.players.forEach(player => {
const selectedIndex = state.multiSelectedIds.indexOf(player.id);
const selected = selectedIndex >= 0;
const button = document.createElement('button');
button.type = 'button';
button.className = `multi-player-choice${selected ? ' selected' : ''}`;
button.dataset.multiPlayerId = player.id;
button.style.setProperty('--player-color', security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868');
button.style.setProperty('--player-text-color', textColorFor(security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868'));
button.setAttribute('aria-pressed', String(selected));
const avatar = document.createElement('div');
avatar.className = 'avatar-preview avatar-preview-small';
renderAvatar(avatar, player);
const copy = document.createElement('span');
const strong = document.createElement('strong');
strong.textContent = player.name;
const small = document.createElement('small');
small.textContent = selected ? `#${selectedIndex + 1} nell'ordine` : 'Tocca per aggiungere';
copy.append(strong, small);
const mark = document.createElement('b');
mark.className = 'multi-choice-mark';
mark.textContent = selected ? '✓' : '+';
button.append(avatar, copy, mark);
multiPlayerSelector.appendChild(button);
});
if (multiSelectedCount) multiSelectedCount.textContent = `${state.multiSelectedIds.length} / 8`;
renderMultiOrder();
syncMultiStartButton();
syncMultiAppSummaries();
}
function renderMultiOrder() {
if (!multiOrderList) return;
multiOrderList.textContent = '';
if (!state.multiSelectedIds.length) {
const empty = document.createElement('div');
empty.className = 'multi-order-empty';
empty.textContent = 'Seleziona almeno 2 giocatori.';
multiOrderList.appendChild(empty);
return;
}
state.multiSelectedIds.forEach((id, index) => {
const player = state.players.find(item => item.id === id);
if (!player) return;
const row = document.createElement('article');
row.className = 'multi-order-row';
row.style.setProperty('--player-color', security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868');
const number = document.createElement('span');
number.className = 'multi-order-number';
number.textContent = `#${index + 1}`;
const avatar = document.createElement('div');
avatar.className = 'avatar-preview avatar-preview-small';
renderAvatar(avatar, player);
const name = document.createElement('strong');
name.textContent = player.name;
const controls = document.createElement('div');
controls.className = 'multi-order-controls';
const up = document.createElement('button');
up.type = 'button';
up.dataset.moveMulti = 'up';
up.dataset.multiPlayerId = id;
up.disabled = index === 0;
up.setAttribute('aria-label', `Sposta ${player.name} prima`);
up.textContent = '↑';
const down = document.createElement('button');
down.type = 'button';
down.dataset.moveMulti = 'down';
down.dataset.multiPlayerId = id;
down.disabled = index === state.multiSelectedIds.length - 1;
down.setAttribute('aria-label', `Sposta ${player.name} dopo`);
down.textContent = '↓';
const remove = document.createElement('button');
remove.type = 'button';
remove.dataset.removeMulti = id;
remove.className = 'multi-order-remove';
remove.setAttribute('aria-label', `Rimuovi ${player.name}`);
remove.textContent = '×';
controls.append(up, down, remove);
row.append(number, avatar, name, controls);
multiOrderList.appendChild(row);
});
}
function syncMultiStartButton() {
if (!startMultiGameBtn) return;
const countOkay = state.multiSelectedIds.length >= 2 && state.multiSelectedIds.length <= 8;
const scoreOkay = getMultiStartScore() !== null;
startMultiGameBtn.disabled = !(countOkay && scoreOkay);
}
function toggleMultiPlayer(id) {
const currentIndex = state.multiSelectedIds.indexOf(id);
if (currentIndex >= 0) {
state.multiSelectedIds.splice(currentIndex, 1);
} else {
if (state.multiSelectedIds.length >= 8) {
showToast('Puoi scegliere al massimo 8 giocatori');
return;
}
state.multiSelectedIds.push(id);
}
if (multiSetupError) multiSetupError.textContent = '';
renderMultiSetup();
}
function moveMultiPlayer(id, direction) {
const index = state.multiSelectedIds.indexOf(id);
if (index < 0) return;
const target = direction === 'up' ? index - 1 : index + 1;
if (target < 0 || target >= state.multiSelectedIds.length) return;
[state.multiSelectedIds[index], state.multiSelectedIds[target]] = [state.multiSelectedIds[target], state.multiSelectedIds[index]];
renderMultiSetup();
}
function startSingleGame() {
const player = state.players.find(item => item.id === setupPlayer?.value);
const startScore = getChosenStartScore();
if (!player) {
if (setupError) setupError.textContent = 'Seleziona un giocatore.';
return;
}
if (startScore === null) {
if (setupError) setupError.textContent = 'Inserisci un punteggio personalizzato da 1 a 9999.';
customScore?.focus();
return;
}
state.mode = 'single';
state.trainingMode = 'free';
state.recordBaseline = null;
state.idealBaseline = null;
state.recordUpdate = null;
state.startScore = startScore;
state.participants = [makeParticipant(player, 0)];
beginMatch('Partita iniziata. Inserisci la prima freccetta.');
}
async function startRecordGame() {
const player = state.players.find(item => item.id === recordSetupPlayer?.value);
const startScore = getRecordStartScore();
if (!player) {
if (recordSetupError) recordSetupError.textContent = 'Seleziona un giocatore.';
return;
}
if (startScore === null) {
if (recordSetupError) recordSetupError.textContent = 'Inserisci un punteggio personalizzato da 1 a 9999.';
recordCustomScore?.focus();
return;
}
let record = null;
try { record = await db.getRecord(player.id, startScore); }
catch (error) {
console.error(error);
if (recordSetupError) recordSetupError.textContent = 'Non riesco a leggere il record salvato.';
return;
}
state.mode = 'single';
state.trainingMode = 'record';
state.recordBaseline = record ? cloneData(record) : null;
state.idealBaseline = null;
state.recordUpdate = null;
state.startScore = startScore;
state.participants = [makeParticipant(player, 0)];
beginMatch(record
? `Sfida record iniziata: prova a battere ${record.turns} turni e ${record.dartsUsed} freccette.`
: 'Nessun record precedente: questa partita stabilirà il primo record personale.');
}
function startMultiGame() {
const startScore = getMultiStartScore();
const selectedPlayers = state.multiSelectedIds
.map(id => state.players.find(player => player.id === id))
.filter(Boolean);
if (selectedPlayers.length < 2 || selectedPlayers.length > 8) {
if (multiSetupError) multiSetupError.textContent = 'Seleziona da 2 a 8 giocatori.';
return;
}
if (startScore === null) {
if (multiSetupError) multiSetupError.textContent = 'Inserisci un punteggio personalizzato da 1 a 9999.';
multiCustomScore?.focus();
return;
}
state.mode = 'multi';
state.trainingMode = 'free';
state.recordBaseline = null;
state.idealBaseline = null;
state.recordUpdate = null;
state.startScore = startScore;
state.participants = selectedPlayers.map((player, index) => makeParticipant(player, index));
beginMatch(`Tocca a ${selectedPlayers[0].name}.`);
}
function beginMatch(notice) {
state.currentIndex = 0;
state.darts = [];
state.history = [];
state.active = true;
state.finished = false;
state.restored = false;
state.pickerMultiplier = 1;
state.draftDart = null;
state.keyboardBuffer = '';
state.notice = notice;
state.rosterRenderKey = '';
state.recordUpdate = null;
state.sessionId = db.createGameSessionId?.() || db.createId?.('game');
state.sessionCreatedAt = Date.now();
state.completedGameId = null;
renderGame();
if (window.PidoDartsApp?.resetNavigation) {
const stack = isMultiplayer()
? ['home', 'multiplayer']
: (isComputerMatch()
? ['home', 'training', 'computer-setup']
: (state.trainingMode === 'ideal' ? ['home', 'statistics', 'stats-ideal'] : ['home', 'training', state.trainingMode === 'record' ? 'record-setup' : 'game-setup']));
window.PidoDartsApp.resetNavigation('game', stack);
} else {
window.PidoDartsApp?.goTo?.('game');
}
queueAutoSave('inizio partita');
if (isComputerMatch() && isComputerParticipant()) scheduleComputerTurn();
}
function currentEvaluation() {
const participant = currentParticipant();
return engine.evaluateTurn(participant?.score ?? 0, state.darts);
}
function isRecordChallenge() {
return !isMultiplayer() && state.trainingMode === 'record';
}
function isIdealChallenge() {
return !isMultiplayer() && state.trainingMode === 'ideal' && Boolean(state.idealBaseline);
}
function activePaceBaseline() {
return isIdealChallenge() ? state.idealBaseline : state.recordBaseline;
}
function recordRemainingAfterTurn(record, turnNumber) {
if (!record) return null;
if (turnNumber <= 0) return Number(record.startScore);
const turn = Array.isArray(record.turnsData) ? record.turnsData[turnNumber - 1] : null;
if (turn && Number.isFinite(Number(turn.scoreAfter))) return Number(turn.scoreAfter);
if (turnNumber >= Number(record.turns || 0)) return 0;
return null;
}
function renderRecordPace(evaluation = currentEvaluation()) {
if (!recordPaceCard) return;
const participant = currentParticipant();
const active = (isRecordChallenge() || isIdealChallenge()) && participant;
recordPaceCard.hidden = !active;
if (!active) return;
if (recordPaceScore) recordPaceScore.textContent = String(state.startScore);
recordPaceDeltaCard?.classList.remove('ahead', 'behind', 'level');
const baseline = activePaceBaseline();
const confirmedDarts = recordsForParticipant(participant).reduce((sum, turn) => sum + turn.darts.length, 0);
const previewingTurn = state.darts.length > 0;
const comparisonTurn = participant.turns + (previewingTurn ? 1 : 0);
const currentRemaining = previewingTurn
? (evaluation.bust ? participant.score : evaluation.scoreAfter)
: participant.score;
const currentDarts = confirmedDarts + state.darts.length;
if (!baseline) {
if (recordPaceStatus) recordPaceStatus.textContent = 'Stai stabilendo il primo record';
if (recordPaceTarget) recordPaceTarget.textContent = 'Nessun record';
if (recordPaceCurrent) recordPaceCurrent.textContent = `${participant.turns}${previewingTurn ? '+1' : ''} turni · ${currentDarts} frecce`;
if (recordPaceDelta) recordPaceDelta.textContent = 'Prima prova';
recordPaceDeltaCard?.classList.add('level');
if (recordPaceNote) recordPaceNote.textContent = 'Completa la partita: il risultato diventerà il primo record per questo punteggio.';
return;
}
if (recordPaceTarget) recordPaceTarget.textContent = `${baseline.turns} turni · ${baseline.dartsUsed} frecce${isIdealChallenge() ? ' · IDEALE' : ''}`;
if (recordPaceCurrent) recordPaceCurrent.textContent = `${comparisonTurn || 0} turni · ${currentRemaining} rimasti`;
const baselineRemaining = recordRemainingAfterTurn(baseline, comparisonTurn);
if (participant.turns >= Number(baseline.turns) && participant.score > 0 && !previewingTurn) {
const extra = participant.turns - Number(baseline.turns);
if (recordPaceStatus) recordPaceStatus.textContent = isIdealChallenge() ? 'Il record ideale sui turni è già oltre' : 'Il record sui turni è già oltre';
if (recordPaceDelta) recordPaceDelta.textContent = extra > 0 ? `+${extra} turni` : 'Serve un turno in più';
recordPaceDeltaCard?.classList.add('behind');
if (recordPaceNote) recordPaceNote.textContent = isIdealChallenge() ? 'Puoi comunque completare la partita: il risultato verrà salvato e potrà ancora migliorare il tuo record personale.' : 'Puoi comunque completare la partita: il record personale resterà invariato.';
return;
}
if (baselineRemaining === null) {
if (recordPaceStatus) recordPaceStatus.textContent = isIdealChallenge() ? 'Sfida al record ideale in corso' : 'Sfida record in corso';
if (recordPaceDelta) recordPaceDelta.textContent = 'Confronto in corso';
recordPaceDeltaCard?.classList.add('level');
return;
}
const delta = baselineRemaining - currentRemaining;
if (delta > 0) {
if (recordPaceStatus) recordPaceStatus.textContent = isIdealChallenge() ? 'Sei davanti al record ideale' : 'Sei davanti al record';
if (recordPaceDelta) recordPaceDelta.textContent = `${delta} pt avanti`;
recordPaceDeltaCard?.classList.add('ahead');
} else if (delta < 0) {
if (recordPaceStatus) recordPaceStatus.textContent = isIdealChallenge() ? 'Sei dietro al record ideale' : 'Sei dietro al record';
if (recordPaceDelta) recordPaceDelta.textContent = `${Math.abs(delta)} pt dietro`;
recordPaceDeltaCard?.classList.add('behind');
} else {
if (recordPaceStatus) recordPaceStatus.textContent = isIdealChallenge() ? 'Sei in linea col record ideale' : 'Sei in linea col record';
if (recordPaceDelta) recordPaceDelta.textContent = 'In linea';
recordPaceDeltaCard?.classList.add('level');
}
if (recordPaceNote) {
recordPaceNote.textContent = comparisonTurn > 0
? `Dopo il turno ${comparisonTurn}, ${isIdealChallenge() ? 'il record ideale' : 'il record'} aveva ${baselineRemaining} punti rimasti.`
: `${isIdealChallenge() ? 'Record ideale' : 'Record'} da battere: ${baseline.turns} turni e ${baseline.dartsUsed} freccette.`;
}
}
function renderGame() {
const participant = currentParticipant();
if (!participant) return;
const player = participant.player;
if (gameTitle) {
gameTitle.textContent = isMultiplayer()
? 'PARTITA · MULTIPLAYER v1.0.4.3'
: (isComputerMatch()
? `PARTITA · VS PIDO PC · ${computerDifficultyLabel(state.computerDifficulty).toUpperCase()}`
: (isIdealChallenge() ? 'PARTITA · RECORD IDEALE v1.0.4.3' : (isRecordChallenge() ? 'PARTITA · BATTI IL RECORD v1.0.4.3' : 'PARTITA · ALLENAMENTO v1.0.4.3')));
}
gamePlayerCard?.style.setProperty('--player-color', security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868');
renderAvatar(gamePlayerAvatar, player);
if (gamePlayerName) gamePlayerName.textContent = player.name;
if (gamePlayerOrder) gamePlayerOrder.textContent = `#${participant.order + 1}`;
if (gameTurnNumber) gameTurnNumber.textContent = String(participant.turns + 1);
if (gameStartScore) gameStartScore.textContent = String(state.startScore);
if (gameRemaining) gameRemaining.textContent = String(participant.score);
renderRoster();
const evaluation = currentEvaluation();
renderRecordPace(evaluation);
if (turnTotal) turnTotal.textContent = String(evaluation.total);
if (projectedRemaining) projectedRemaining.textContent = evaluation.bust ? String(participant.score) : String(evaluation.scoreAfter);
projectedRemaining?.closest('.game-mini-stat')?.classList.toggle('danger', evaluation.bust);
const humanTurn = !isComputerParticipant(participant);
const canAdd = state.active && !state.finished && humanTurn && !state.computerTurnRunning && engine.canAddDart(state.darts) && !evaluation.bust && !evaluation.won;
const activeIndex = canAdd ? state.darts.length : -1;
dartSlots.forEach((slot, index) => {
const dart = state.darts[index];
slot.classList.toggle('filled', Boolean(dart));
slot.classList.toggle('next', index === activeIndex);
slot.classList.toggle('locked', Boolean(dart));
const value = slot.querySelector('strong');
const label = slot.querySelector('small');
if (dart) {
value.textContent = dart.label;
label.textContent = `${dart.value} ${dart.value === 1 ? 'punto' : 'punti'} · OK`;
} else {
value.textContent = '+';
label.textContent = index === activeIndex ? `Freccetta ${index + 1} · ATTIVA` : `Freccetta ${index + 1}`;
}
slot.disabled = !(canAdd && index === state.darts.length);
slot.setAttribute('aria-label', dart
? `Freccetta ${index + 1}: ${dart.description}, ${dart.value} punti, confermata`
: index === activeIndex ? `Freccetta ${index + 1} attiva: inserisci valore` : `Freccetta ${index + 1}`);
});
if (activeDartIndicator) {
const label = activeDartIndicator.querySelector('strong');
if (state.finished) label.textContent = 'Partita completata';
else if (isComputerParticipant(participant)) label.textContent = state.computerTurnRunning ? 'Pido PC sta lanciando…' : 'Turno di Pido PC';
else if (evaluation.bust) label.textContent = 'BUST · conferma il turno';
else if (evaluation.won) label.textContent = '0 raggiunto · conferma';
else if (state.darts.length >= engine.MAX_DARTS) label.textContent = '3 di 3 · turno completo';
else label.textContent = `${state.darts.length + 1} di ${engine.MAX_DARTS}`;
activeDartIndicator.classList.toggle('complete', !canAdd && state.darts.length > 0);
activeDartIndicator.classList.toggle('danger', evaluation.bust);
}
if (openDartPickerBtn) openDartPickerBtn.disabled = !canAdd;
if (nextDartHint) nextDartHint.textContent = canAdd
? `Freccetta ${state.darts.length + 1} di ${engine.MAX_DARTS} · premi OK dopo la scelta`
: (state.finished ? 'Partita completata' : (isComputerParticipant(participant) ? 'Pido PC gioca automaticamente' : 'Controlla i valori e premi Conferma'));
if (cancelDartBtn) cancelDartBtn.disabled = !state.darts.length || state.finished || state.computerTurnRunning || isComputerParticipant(participant);
if (confirmTurnBtn) confirmTurnBtn.disabled = !state.darts.length || state.finished || state.computerTurnRunning || isComputerParticipant(participant);
if (undoTurnBtn) undoTurnBtn.disabled = !state.history.length || state.computerTurnRunning || isComputerParticipant(participant);
if (pickerCancelLastBtn) pickerCancelLastBtn.disabled = !state.darts.length || state.finished;
updatePickerUI();
if (gameNotice) {
if (evaluation.bust) {
gameNotice.textContent = `BUST rilevato: ${evaluation.total} supera i ${participant.score} rimasti. Controlla le freccette e premi Conferma.`;
} else if (evaluation.won) {
gameNotice.textContent = isMultiplayer()
? `${player.name} ha raggiunto esattamente 0. Controlla il tiro e premi Conferma.`
: (isComputerMatch()
? (isComputerParticipant(participant) ? 'Pido PC ha raggiunto esattamente 0.' : 'Hai raggiunto esattamente 0. Controlla il tiro e premi Conferma per vincere.')
: 'Hai raggiunto esattamente 0. Controlla il tiro e premi Conferma per chiudere la partita.');
} else {
gameNotice.textContent = state.notice || 'Pronto.';
}
gameNotice.classList.toggle('notice-danger', evaluation.bust);
gameNotice.classList.toggle('notice-success', evaluation.won || state.finished);
}
updateKeyboardStatus();
renderHistory();
}
function renderRoster() {
if (!gameRosterWrap || !gameRoster) return;
const multi = (isMultiplayer() || isComputerMatch()) && state.participants.length > 1;
gameRosterWrap.hidden = !multi;
if (!multi) return;
if (gameModeChip) gameModeChip.textContent = isComputerMatch()
? `VS PIDO PC · ${computerDifficultyLabel(state.computerDifficulty).toUpperCase()}`
: (state.multiFinishMode === 'full' ? 'CLASSIFICA COMPLETA' : 'PRIMO A ZERO');
const rosterKey = [
state.currentIndex,
state.finished ? 1 : 0,
state.participants.map(item => `${item.player.id}:${item.score}:${item.finished ? 1 : 0}:${item.place ?? ''}`).join('|')
].join('::');
if (state.rosterRenderKey === rosterKey) return;
state.rosterRenderKey = rosterKey;
gameRoster.textContent = '';
const count = state.participants.length;
const rotateForSmallScreenList = isMultiplayer() && count >= 5;
if (gameRosterHint) {
gameRosterHint.textContent = rotateForSmallScreenList
? 'Puoi scorrere i punteggi. Il giocatore attivo è mostrato per primo.'
: 'Tutti i giocatori restano visibili; il turno attivo è evidenziato.';
}
gameRoster.classList.toggle('show-all', count <= 4);
gameRoster.dataset.count = String(count);
const displayParticipants = rotateForSmallScreenList
? Array.from({ length: count }, (_, offset) => state.participants[(state.currentIndex + offset) % count])
: [...state.participants].sort((a, b) => a.order - b.order);
displayParticipants.forEach(participant => {
const player = participant.player;
const card = document.createElement('article');
card.className = `game-roster-player${participant === currentParticipant() && !state.finished ? ' active' : ''}${participant.finished ? ' finished' : ''}`;
card.style.setProperty('--player-color', security?.safeHex ? security.safeHex(player.color, '#20d868') : '#20d868');
const order = document.createElement('b');
order.textContent = `#${participant.order + 1}`;
const avatar = document.createElement('div');
avatar.className = 'avatar-preview avatar-preview-tiny';
renderAvatar(avatar, player);
const copy = document.createElement('span');
const name = document.createElement('strong');
name.textContent = player.name;
const score = document.createElement('small');
if (participant.finished) {
score.textContent = `${placeLabel(participant.place)} · FINITO`;
} else {
score.textContent = `${participant.score} punti`;
}
copy.append(name, score);
card.append(order, avatar, copy);
gameRoster.appendChild(card);
});
requestAnimationFrame(() => {
try { gameRoster.scrollTo({ left: 0, behavior: 'auto' }); } catch (_) { gameRoster.scrollLeft = 0; }
});
}
function placeLabel(place) {
if (!Number.isInteger(place)) return '—';
return `${place}°`;
}
function syncBodyModalState() {
const otherModalOpen = document.getElementById('playerModal')?.hidden === false || document.getElementById('deleteModal')?.hidden === false;
document.body.classList.toggle('modal-open', dartPicker?.hidden === false || finishModal?.hidden === false || exitModal?.hidden === false || resumeGamesModal?.hidden === false || otherModalOpen);
}
let keyboardCommitTimer;
function multiplierPrefix() {
if (Number(state.pickerMultiplier) === 2) return 'D';
if (Number(state.pickerMultiplier) === 3) return 'T';
return '';
}
function clearKeyboardBuffer() {
clearTimeout(keyboardCommitTimer);
state.keyboardBuffer = '';
updateKeyboardStatus();
}
function updateKeyboardStatus() {
if (!keyboardInputStatus) return;
if (isComputerMatch() && isComputerParticipant()) {
keyboardInputStatus.textContent = state.computerTurnRunning ? 'Pido PC sta lanciando…' : 'Turno automatico di Pido PC';
return;
}
const prefix = multiplierPrefix();
if (state.keyboardBuffer) {
keyboardInputStatus.textContent = `Freccetta ${state.darts.length + 1}: ${prefix}${state.keyboardBuffer} · Invio = OK freccetta`;
return;
}
if (state.draftDart) {
keyboardInputStatus.textContent = `Selezionata ${state.draftDart.label} · Invio = OK freccetta`;
return;
}
const mode = Number(state.pickerMultiplier) === 2 ? 'Doppio ×2' : (Number(state.pickerMultiplier) === 3 ? 'Triplo ×3' : 'Normale ×1');
keyboardInputStatus.textContent = `Freccetta ${Math.min(state.darts.length + 1, 3)} · ${mode}`;
}
function canAddKeyboardDart() {
const evaluation = currentEvaluation();
return state.active && !state.finished && !state.computerTurnRunning && !isComputerParticipant() && engine.canAddDart(state.darts) && !evaluation.bust && !evaluation.won;
}
function selectDraftDart(dart) {
if (!canAddKeyboardDart()) return;
state.draftDart = { ...dart };
state.keyboardBuffer = '';
updatePickerUI();
updateKeyboardStatus();
}
function commitKeyboardNumber() {
clearTimeout(keyboardCommitTimer);
const value = Number.parseInt(state.keyboardBuffer, 10);
if (!Number.isInteger(value) || value < 1 || value > 20 || !canAddKeyboardDart()) {
state.keyboardBuffer = '';
updateKeyboardStatus();
return;
}
state.keyboardBuffer = '';
try {
state.draftDart = engine.makeDart(value, state.pickerMultiplier);
confirmDraftDart();
} catch (error) {
showToast(error.message || 'Tiro non valido');
}
updateKeyboardStatus();
}
function queueKeyboardDigit(digit) {
if (!canAddKeyboardDart()) return;
if (digit === '0' && !state.keyboardBuffer) {
selectDraftDart(engine.makeSpecial('miss'));
return;
}
state.draftDart = null;
const candidate = `${state.keyboardBuffer}${digit}`.replace(/^0+/, '');
const numeric = Number.parseInt(candidate, 10);
if (!candidate || !Number.isInteger(numeric) || numeric > 20) {
state.keyboardBuffer = digit === '0' ? '' : digit;
} else {
state.keyboardBuffer = candidate;
}
clearTimeout(keyboardCommitTimer);
updatePickerUI();
updateKeyboardStatus();
}
function selectKeyboardSpecial(type) {
if (!canAddKeyboardDart()) return;
clearKeyboardBuffer();
try {
selectDraftDart(engine.makeSpecial(type));
} catch (error) {
showToast(error.message || 'Tiro non valido');
}
}
function setKeyboardMultiplier(multiplier) {
state.pickerMultiplier = multiplier;
state.draftDart = null;
updatePickerUI();
updateKeyboardStatus();
const label = multiplier === 2 ? 'Doppio ×2' : (multiplier === 3 ? 'Triplo ×3' : 'Normale ×1');
showToast(`Tastiera · ${label}`);
}
function updatePickerUI() {
if (!dartPickerTitle || !multiplierTabs) return;
const nextIndex = Math.min(state.darts.length + 1, engine.MAX_DARTS);
dartPickerTitle.textContent = `Freccetta ${nextIndex} di ${engine.MAX_DARTS}`;
multiplierTabs.querySelectorAll('[data-multiplier]').forEach(button => {
button.classList.toggle('selected', Number(button.dataset.multiplier) === Number(state.pickerMultiplier));
});
numberPad?.querySelectorAll('[data-dart-number]').forEach(button => {
const draft = state.draftDart;
const prefix = multiplierPrefix();
button.classList.toggle('draft-selected', Boolean(draft && draft.label === `${prefix}${button.dataset.dartNumber}`));
});
pickerSpecials?.querySelectorAll('[data-special-dart]').forEach(button => {
const type = button.dataset.specialDart;
const labels = { miss: 'Miss', bull: 'Bull', center: 'Centro' };
button.classList.toggle('draft-selected', Boolean(state.draftDart && state.draftDart.label === labels[type]));
});
if (pickerSelectedLabel && pickerSelectedPoints) {
if (state.draftDart) {
pickerSelectedLabel.textContent = state.draftDart.label;
pickerSelectedPoints.textContent = `${state.draftDart.value} ${state.draftDart.value === 1 ? 'punto' : 'punti'} · premi OK per fissare la freccetta ${nextIndex}`;
} else {
pickerSelectedLabel.textContent = 'Scegli un valore';
pickerSelectedPoints.textContent = `Freccetta ${nextIndex}: la selezione non passa alla successiva finché non premi OK.`;
}
}
if (confirmDartBtn) confirmDartBtn.disabled = !state.draftDart || !canAddKeyboardDart();
if (pickerCancelLastBtn) pickerCancelLastBtn.disabled = !state.darts.length || state.finished;
}
function openDartPicker() {
const evaluation = currentEvaluation();
const canAdd = state.active && !state.finished && !state.computerTurnRunning && !isComputerParticipant() && engine.canAddDart(state.darts) && !evaluation.bust && !evaluation.won;
if (!canAdd) return;
state.pickerMultiplier = 1;
state.draftDart = null;
clearKeyboardBuffer();
updatePickerUI();
dartPicker.hidden = false;
syncBodyModalState();
}
function closeDartPicker() {
if (!dartPicker) return;
dartPicker.hidden = true;
state.draftDart = null;
clearKeyboardBuffer();
syncBodyModalState();
}
function confirmDraftDart() {
if (!state.draftDart || !canAddKeyboardDart()) return false;
const dart = { ...state.draftDart };
state.draftDart = null;
state.darts.push(dart);
state.pickerMultiplier = 1;
state.restored = false;
const evaluation = currentEvaluation();
const number = state.darts.length;
if (evaluation.bust) {
state.notice = `Freccetta ${number} confermata: ${dart.label}. BUST rilevato; premi Conferma per registrare il turno.`;
renderGame();
queueAutoSave('freccetta confermata');
closeDartPicker();
return true;
}
if (evaluation.won) {
state.notice = `Freccetta ${number} confermata: ${dart.label}. 0 raggiunto; premi Conferma per chiudere il turno.`;
renderGame();
queueAutoSave('freccetta confermata');
closeDartPicker();
return true;
}
if (state.darts.length === engine.MAX_DARTS) {
state.notice = 'Tre freccette confermate. Controlla i valori e premi Conferma per chiudere il turno.';
renderGame();
queueAutoSave('freccetta confermata');
closeDartPicker();
return true;
}
state.notice = `Freccetta ${number} confermata: ${dart.label}. Ora inserisci la freccetta ${number + 1}.`;
renderGame();
queueAutoSave('freccetta confermata');
updatePickerUI();
showToast(`Freccetta ${number} OK · ora ${number + 1}`);
return false;
}
function cancelLastDart() {
if (!state.darts.length || state.finished) return;
const removed = state.darts.pop();
state.pickerMultiplier = 1;
state.draftDart = null;
state.restored = false;
state.notice = `${removed.label} cancellata. La freccetta ${state.darts.length + 1} è di nuovo attiva.`;
renderGame();
queueAutoSave('freccetta cancellata');
if (!dartPicker.hidden) updatePickerUI();
}
function wait(ms) {
return new Promise(resolve => setTimeout(resolve, ms));
}
function scheduleComputerTurn() {
if (!isComputerMatch() || !state.active || state.finished || state.computerTurnRunning || !isComputerParticipant()) return;
window.setTimeout(() => runComputerTurn(), 320);
}
async function runComputerTurn() {
const participant = currentParticipant();
if (!isComputerMatch() || !participant || !isComputerParticipant(participant) || !state.active || state.finished || state.computerTurnRunning) return;
if (!computer) return;
state.computerTurnRunning = true;
state.darts = [];
state.draftDart = null;
state.pickerMultiplier = 1;
state.notice = 'Pido PC sta preparando il tiro…';
renderGame();
await wait(420);
if (!state.active || state.finished || !isComputerParticipant()) {
state.computerTurnRunning = false;
return;
}
const profile = state.computerProfile || computer.profileFor(state.computerDifficulty || 'medium');
const planned = computer.simulateTurn(participant.score, profile);
for (const dart of planned) {
if (!state.active || state.finished || !isComputerParticipant()) {
state.computerTurnRunning = false;
return;
}
state.darts.push({ ...dart });
const evaluation = currentEvaluation();
state.notice = `Pido PC lancia ${dart.label}: ${dart.value} ${dart.value === 1 ? 'punto' : 'punti'}.`;
renderGame();
queueAutoSave('freccetta Pido PC');
await wait(520);
if (evaluation.bust || evaluation.won || state.darts.length >= engine.MAX_DARTS) break;
}
if (!state.active || state.finished || !isComputerParticipant()) {
state.computerTurnRunning = false;
return;
}
const evaluation = currentEvaluation();
state.computerTurnRunning = false;
await wait(260);
recordTurn({ bust: evaluation.bust, won: evaluation.won });
}
function confirmTurn() {
if (!state.darts.length || state.finished || state.computerTurnRunning || isComputerParticipant()) return;
const evaluation = currentEvaluation();
recordTurn({ bust: evaluation.bust, won: evaluation.won });
}
function recordTurn({ bust, won }) {
const participant = currentParticipant();
if (!participant) return;
const scoreBefore = participant.score;
const darts = state.darts.map(dart => ({ ...dart }));
const evaluation = engine.evaluateTurn(scoreBefore, darts);
const scoreAfter = bust ? scoreBefore : evaluation.scoreAfter;
const playerTurn = participant.turns + 1;
participant.turns += 1;
participant.score = scoreAfter;
let place = null;
if (won) {
place = state.participants.filter(item => item.finished).length + 1;
participant.finished = true;
participant.place = place;
}
state.history.push({
sequence: state.history.length + 1,
playerId: participant.player.id,
playerName: participant.player.name,
playerOrder: participant.order,
playerTurn,
scoreBefore,
scoreAfter,
darts,
total: evaluation.total,
bust: Boolean(bust),
won: Boolean(won),
place
});
state.darts = [];
state.pickerMultiplier = 1;
state.draftDart = null;
state.restored = false;
if (won && (!isMultiplayer() || state.multiFinishMode === 'first')) {
finishMatch(participant);
return;
}
if (won && isMultiplayer() && state.multiFinishMode === 'full') {
if (state.participants.every(item => item.finished)) {
finishMatch(state.participants.find(item => item.place === 1) || participant);
return;
}
const completedName = participant.player.name;
const completedPlace = participant.place;
moveToNextActive();
const next = currentParticipant();
state.notice = `${completedName} ha chiuso: ${placeLabel(completedPlace)} posto. Ora tocca a ${next.player.name}.`;
renderGame();
queueAutoSave('turno confermato');
showToast(`🏆 ${completedName} · ${placeLabel(completedPlace)} posto`);
return;
}
moveToNextActive();
const next = currentParticipant();
const previousText = bust
? `BUST: ${participant.player.name} resta a ${participant.score}.`
: `${participant.player.name}: ${evaluation.total} punti, restano ${participant.score}.`;
state.notice = isMultiplayer()
? `${previousText} Ora tocca a ${next.player.name}.`
: (isComputerMatch()
? `${previousText} ${isComputerParticipant(next) ? 'Ora gioca Pido PC.' : `Ora tocca a ${next.player.name}.`}`
: (bust ? `BUST registrato. Resti a ${participant.score} punti: nuovo turno.` : `Turno confermato: ${evaluation.total} punti. Ora restano ${participant.score}.`));
renderGame();
queueAutoSave('turno confermato');
if (bust) showToast(`BUST · ${participant.player.name} resta a ${participant.score}`);
if (isComputerMatch() && isComputerParticipant(next)) scheduleComputerTurn();
}
function moveToNextActive() {
if (!state.participants.length) return;
if (isComputerMatch()) {
state.currentIndex = state.currentIndex === 0 ? 1 : 0;
return;
}
if (!isMultiplayer()) {
state.currentIndex = 0;
return;
}
const count = state.participants.length;
for (let offset = 1; offset <= count; offset += 1) {
const index = (state.currentIndex + offset) % count;
if (!state.participants[index].finished) {
state.currentIndex = index;
return;
}
}
}
function buildRecordCandidate(participant) {
const records = recordsForParticipant(participant);
const turns = records.length;
const dartsUsed = records.reduce((sum, turn) => sum + turn.darts.length, 0);
const bestTurn = records.reduce((best, turn) => turn.bust ? best : Math.max(best, turn.total), 0);
const busts = records.filter(turn => turn.bust).length;
const now = Date.now();
return {
id: db.createRecordId(participant.player.id, state.startScore),
playerId: participant.player.id,
playerName: participant.player.name,
startScore: state.startScore,
turns,
dartsUsed,
bestTurn,
busts,
averagePerTurn: turns ? state.startScore / turns : 0,
turnsData: records.map(turn => ({
playerTurn: turn.playerTurn,
scoreBefore: turn.scoreBefore,
scoreAfter: turn.scoreAfter,
total: turn.total,
bust: turn.bust,
darts: turn.darts.map(dart => ({ label: dart.label, value: dart.value, multiplier: dart.multiplier, type: dart.type }))
})),
createdAt: now,
updatedAt: now
};
}
function isBetterRecord(candidate, current) {
if (!current) return true;
const candidateTurns = Number(candidate.turns);
const currentTurns = Number(current.turns);
if (candidateTurns !== currentTurns) return candidateTurns < currentTurns;
return Number(candidate.dartsUsed) < Number(current.dartsUsed);
}
async function processSingleRecordAtFinish(participant) {
if (isMultiplayer() || isComputerMatch() || !participant) {
state.recordUpdate = null;
return;
}
const candidate = buildRecordCandidate(participant);
let previous = null;
try {
previous = await db.getRecord(participant.player.id, state.startScore);
if (isBetterRecord(candidate, previous)) {
candidate.createdAt = previous?.createdAt || candidate.createdAt;
candidate.updatedAt = Date.now();
const saved = await db.saveRecord(candidate);
state.recordUpdate = {
saved: true,
first: !previous,
previous: previous ? cloneData(previous) : null,
current: cloneData(saved)
};
} else {
state.recordUpdate = {
saved: false,
first: false,
previous: previous ? cloneData(previous) : null,
current: cloneData(candidate)
};
}
} catch (error) {
console.error('Impossibile salvare il record:', error);
state.recordUpdate = { saved: false, first: false, previous: previous ? cloneData(previous) : null, current: cloneData(candidate), error: true };
}
}
async function rollbackRecordUpdate() {
const update = state.recordUpdate;
if (!update?.saved || isMultiplayer() || isComputerMatch()) {
state.recordUpdate = null;
return;
}
const participant = currentParticipant() || state.participants[0];
if (!participant) return;
try {
if (update.previous) await db.saveRecord(update.previous);
else await db.deleteRecord(participant.player.id, state.startScore);
} catch (error) {
console.error('Impossibile ripristinare il record precedente:', error);
}
state.recordUpdate = null;
refreshRecordPreview();
}
function participantGameStats(participant) {
const records = state.history.filter(record => record.playerId === participant.player.id);
const scored = records.reduce((sum, turn) => sum + (turn.bust ? 0 : Number(turn.total || 0)), 0);
const dartsUsed = records.reduce((sum, turn) => sum + (Array.isArray(turn.darts) ? turn.darts.length : 0), 0);
const bestTurn = records.reduce((best, turn) => turn.bust ? best : Math.max(best, Number(turn.total || 0)), 0);
const busts = records.filter(turn => turn.bust).length;
const misses = records.reduce((sum, turn) => sum + (turn.darts || []).filter(dart => Number(dart.value) === 0).length, 0);
return {
turns: records.length,
dartsUsed,
pointsScored: scored,
bestTurn,
busts,
misses,
averagePerTurn: records.length ? scored / records.length : 0
};
}
function completedRanking() {
if (isComputerMatch()) {
const winner = state.participants.find(item => item.finished || item.score === 0);
const loser = state.participants.find(item => item !== winner);
return [winner, loser].filter(Boolean).map((item, index) => ({ playerId: item.player.id, rank: index + 1, actual: true }));
}
if (!isMultiplayer()) return state.participants.map(item => ({ playerId: item.player.id, rank: 1, actual: true }));
if (state.multiFinishMode === 'full') {
return [...state.participants]
.sort((a, b) => (a.place || 999) - (b.place || 999))
.map((item, index) => ({ playerId: item.player.id, rank: item.place || index + 1, actual: true }));
}
const winner = state.participants.find(item => item.place === 1);
const others = state.participants.filter(item => item !== winner).sort((a, b) => a.score - b.score || a.order - b.order);
return [winner, ...others].filter(Boolean).map((item, index) => ({
playerId: item.player.id,
rank: index + 1,
actual: index === 0
}));
}
function makeCompletedGameSnapshot(winnerParticipant) {
const now = Date.now();
const ranking = completedRanking();
const rankMap = new Map(ranking.map(item => [item.playerId, item]));
const id = state.completedGameId || db.createId?.('completed-game') || `completed-${now}`;
state.completedGameId = id;
return {
id,
schemaVersion: 1,
createdAt: state.sessionCreatedAt || now,
completedAt: now,
durationMs: Math.max(0, now - (state.sessionCreatedAt || now)),
mode: state.mode,
trainingMode: state.trainingMode,
startScore: state.startScore,
finishMode: isMultiplayer() ? state.multiFinishMode : (isComputerMatch() ? 'computer-first' : 'single'),
computerDifficulty: isComputerMatch() ? state.computerDifficulty : null,
computerProfile: isComputerMatch() ? cloneData(state.computerProfile) : null,
winnerId: winnerParticipant?.player?.id || null,
participants: state.participants.map(item => {
const rankingInfo = rankMap.get(item.player.id) || null;
return {
player: cloneData(item.player),
playerId: item.player.id,
order: item.order,
finalScore: item.score,
finished: Boolean(item.finished),
actualPlace: item.place || null,
displayRank: rankingInfo?.rank || null,
displayRankActual: Boolean(rankingInfo?.actual),
stats: participantGameStats(item)
};
}),
ranking,
history: cloneData(state.history)
};
}
async function saveCompletedMatch(winnerParticipant) {
try {
const snapshot = makeCompletedGameSnapshot(winnerParticipant);
await db.saveCompletedGame(snapshot);
document.dispatchEvent(new CustomEvent('pido:statschanged', { detail: { gameId: snapshot.id } }));
return snapshot;
} catch (error) {
console.error('Impossibile salvare la partita nelle statistiche:', error);
showToast('Partita conclusa · storico non salvato');
return null;
}
}
async function finishMatch(winnerParticipant) {
const completedSessionId = state.sessionId;
state.finished = true;
state.active = false;
await saveCompletedMatch(winnerParticipant);
state.sessionId = null;
state.sessionCreatedAt = null;
state.notice = isMultiplayer()
? `${winnerParticipant.player.name} vince la partita!`
: (isComputerMatch()
? (winnerParticipant.player.isComputer ? 'Pido PC vince questa sfida.' : `${winnerParticipant.player.name} vince contro Pido PC!`)
: 'Hai raggiunto esattamente 0. Partita completata!');
renderGame();
if (completedSessionId) deleteSavedSession(completedSessionId);
if (!isMultiplayer() && !isComputerMatch()) await processSingleRecordAtFinish(winnerParticipant);
openFinishModal();
}
async function undoLastTurn() {
if (state.finished && state.completedGameId) {
try {
await db.deleteCompletedGame(state.completedGameId);
document.dispatchEvent(new CustomEvent('pido:statschanged', { detail: { gameId: state.completedGameId, removed: true } }));
} catch (error) {
console.error('Impossibile rimuovere la partita dallo storico prima della correzione:', error);
}
}
if (state.finished && state.recordUpdate) await rollbackRecordUpdate();
if (isComputerMatch() && state.history.length >= 2) {
const last = state.history.at(-1);
if (last && state.participants.find(item => item.player.id === last.playerId)?.player?.isComputer) {
const computerTurn = state.history.pop();
const computerIndex = state.participants.findIndex(item => item.player.id === computerTurn.playerId);
if (computerIndex >= 0) {
const pc = state.participants[computerIndex];
pc.score = computerTurn.scoreBefore;
pc.turns = Math.max(0, pc.turns - 1);
if (computerTurn.won) { pc.finished = false; pc.place = null; }
}
}
}
const previous = state.history.pop();
if (!previous) return;
closeFinishModal();
const index = state.participants.findIndex(item => item.player.id === previous.playerId);
if (index < 0) return;
const participant = state.participants[index];
participant.score = previous.scoreBefore;
participant.turns = Math.max(0, participant.turns - 1);
if (previous.won) {
participant.finished = false;
participant.place = null;
}
state.currentIndex = index;
state.darts = previous.darts.map(dart => ({ ...dart }));
state.pickerMultiplier = 1;
state.draftDart = null;
state.active = true;
state.finished = false;
state.restored = true;
state.notice = isMultiplayer()
? `Turno di ${participant.player.name} ripristinato. Usa Ultima per correggere oppure Conferma per riconfermarlo.`
: (isComputerMatch()
? `Turno di ${participant.player.name} ripristinato. Correggilo e conferma: Pido PC rigiocherà dopo di te.`
: `Turno ${previous.playerTurn} ripristinato. Usa Ultima per correggere oppure Conferma per riconfermarlo.`);
renderGame();
queueAutoSave('annulla turno');
showToast(`Turno di ${participant.player.name} ripristinato`);
}
function renderHistory() {
if (!historyList || !historyEmpty || !historyCount) return;
historyList.textContent = '';
historyEmpty.hidden = state.history.length > 0;
historyCount.textContent = state.history.length === 1 ? '1 turno registrato' : `${state.history.length} turni registrati`;
[...state.history].reverse().forEach(record => {
const item = document.createElement('article');
item.className = `turn-history-item${record.bust ? ' bust' : ''}${record.won ? ' win' : ''}`;
const head = document.createElement('div');
const title = document.createElement('strong');
title.textContent = (isMultiplayer() || isComputerMatch())
? `#${record.playerOrder + 1} ${record.playerName} · Turno ${record.playerTurn}`
: `Turno ${record.playerTurn}`;
const result = document.createElement('b');
result.textContent = record.won ? (isMultiplayer() && state.multiFinishMode === 'full' ? placeLabel(record.place) : 'CHIUSO') : (record.bust ? 'BUST' : `${record.total} pt`);
head.append(title, result);
const darts = document.createElement('p');
darts.textContent = record.darts.map(dart => dart.label).join('  ·  ');
const score = document.createElement('small');
score.textContent = record.bust
? `${record.scoreBefore} → ${record.scoreAfter} (punteggio invariato)`
: `${record.scoreBefore} → ${record.scoreAfter}`;
item.append(head, darts, score);
historyList.appendChild(item);
});
}
function recordsForParticipant(participant) {
return state.history.filter(record => record.playerId === participant.player.id);
}
function openFinishModal() {
closeDartPicker();
if (!finishModal) return;
const winner = isMultiplayer()
? (state.participants.find(item => item.place === 1) || currentParticipant())
: currentParticipant();
if (!winner) return;
const winnerRecords = recordsForParticipant(winner);
const dartsUsed = winnerRecords.reduce((sum, turn) => sum + turn.darts.length, 0);
const bestTurn = winnerRecords.reduce((best, turn) => turn.bust ? best : Math.max(best, turn.total), 0);
const average = winnerRecords.length ? state.startScore / winnerRecords.length : 0;
finishPlayerName.textContent = winner.player.name;
finishTurns.textContent = String(winnerRecords.length);
finishDarts.textContent = String(dartsUsed);
finishBestTurn.textContent = String(bestTurn);
if (finishAverage) finishAverage.textContent = formatAverage(average);
if (finishRecordResult) {
finishRecordResult.hidden = true;
finishRecordResult.classList.remove('record-missed');
}
if (finishIdealResult) {
finishIdealResult.hidden = true;
finishIdealResult.classList.remove('record-missed');
}
if (isComputerMatch()) {
const human = state.participants.find(item => !item.player.isComputer);
finishEyebrow.textContent = winner.player.isComputer ? 'SFIDA TERMINATA' : '🏆 CONGRATULAZIONI!';
finishIntroText.textContent = winner.player.isComputer
? `Pido PC ha raggiunto 0 per primo. ${human?.player?.name || 'Puoi'} riprovare subito con un rematch.`
: `${winner.player.name} ha battuto Pido PC raggiungendo esattamente 0 per primo!`;
finishRanking.hidden = false;
renderFinishRanking();
} else if (!isMultiplayer()) {
finishEyebrow.textContent = isIdealChallenge() ? 'SFIDA RECORD IDEALE COMPLETATA' : (isRecordChallenge() ? 'SFIDA RECORD COMPLETATA' : 'PUNTEGGIO CHIUSO');
finishIntroText.textContent = 'Hai raggiunto esattamente 0. Partita completata.';
finishRanking.hidden = true;
renderFinishIdealResult(winnerRecords, dartsUsed);
renderFinishRecordResult();
} else {
finishEyebrow.textContent = 'PARTITA TERMINATA';
finishIntroText.textContent = state.multiFinishMode === 'full'
? 'Classifica completata: tutti i giocatori hanno raggiunto esattamente 0.'
: `${winner.player.name} è stato il primo a raggiungere esattamente 0.`;
renderFinishRanking();
}
finishModal.hidden = false;
syncBodyModalState();
}
function renderFinishIdealResult(records, dartsUsed) {
if (!finishIdealResult || !finishIdealTitle || !finishIdealDetail || !isIdealChallenge()) return;
const baseline = state.idealBaseline;
if (!baseline) return;
const turns = records.length;
const better = turns < Number(baseline.turns) || (turns === Number(baseline.turns) && dartsUsed < Number(baseline.dartsUsed));
const equal = turns === Number(baseline.turns) && dartsUsed === Number(baseline.dartsUsed);
finishIdealResult.hidden = false;
finishIdealResult.classList.toggle('record-missed', !better && !equal);
if (better) {
finishIdealTitle.textContent = '🌟 HAI BATTUTO IL RECORD IDEALE!';
finishIdealDetail.textContent = `Obiettivo: ${baseline.turns} turni / ${baseline.dartsUsed} freccette. Tu: ${turns} turni / ${dartsUsed} freccette.`;
} else if (equal) {
finishIdealTitle.textContent = '🎯 Record ideale eguagliato';
finishIdealDetail.textContent = `${turns} turni e ${dartsUsed} freccette: hai replicato esattamente il percorso ideale.`;
} else {
finishIdealTitle.textContent = 'Record ideale non superato';
finishIdealDetail.textContent = `Obiettivo: ${baseline.turns} turni / ${baseline.dartsUsed} freccette. Questa partita: ${turns} turni / ${dartsUsed} freccette.`;
}
}
function renderFinishRecordResult() {
if (!finishRecordResult || !finishRecordTitle || !finishRecordDetail || isMultiplayer()) return;
const update = state.recordUpdate;
if (!update?.current) return;
finishRecordResult.hidden = false;
const current = update.current;
if (update.error) {
finishRecordResult.classList.add('record-missed');
finishRecordTitle.textContent = 'Record non salvato';
finishRecordDetail.textContent = 'La partita è conclusa, ma non sono riuscito a salvare il record sul dispositivo.';
return;
}
if (update.saved && update.first) {
finishRecordTitle.textContent = '🏆 Primo record personale!';
finishRecordDetail.textContent = `${current.turns} turni · ${current.dartsUsed} freccette · media ${formatAverage(current.averagePerTurn)} punti per turno.`;
return;
}
if (update.saved) {
const previous = update.previous;
finishRecordTitle.textContent = '✨ NUOVO RECORD PERSONALE!';
finishRecordDetail.textContent = previous
? `Prima: ${previous.turns} turni / ${previous.dartsUsed} freccette. Ora: ${current.turns} turni / ${current.dartsUsed} freccette.`
: `${current.turns} turni · ${current.dartsUsed} freccette.`;
return;
}
finishRecordResult.classList.add('record-missed');
const record = update.previous;
finishRecordTitle.textContent = isRecordChallenge() ? 'Record non superato' : 'Record personale invariato';
finishRecordDetail.textContent = record
? `Record: ${record.turns} turni / ${record.dartsUsed} freccette. Questa partita: ${current.turns} turni / ${current.dartsUsed} freccette.`
: 'Partita completata.';
}
function renderFinishRanking() {
if (!finishRanking || !finishRankingList) return;
finishRanking.hidden = false;
finishRankingList.textContent = '';
let ranking;
if (isComputerMatch()) {
finishRankingTitle.textContent = 'Risultato della sfida';
finishRankingSubtitle.textContent = `Difficoltà: ${computerDifficultyLabel(state.computerDifficulty)} · il primo a 0 vince.`;
const winner = state.participants.find(item => item.finished || item.score === 0);
const other = state.participants.find(item => item !== winner);
ranking = [winner, other].filter(Boolean);
} else if (state.multiFinishMode === 'full') {
finishRankingTitle.textContent = 'Classifica finale';
finishRankingSubtitle.textContent = 'Posizioni reali: tutti hanno concluso la partita.';
ranking = [...state.participants].sort((a, b) => (a.place || 999) - (b.place || 999));
} else {
finishRankingTitle.textContent = 'Classifica al termine';
finishRankingSubtitle.textContent = 'Dopo il vincitore, l’ordine segue i punti rimasti quando la partita è terminata.';
const winner = state.participants.find(item => item.place === 1);
const others = state.participants
.filter(item => item !== winner)
.sort((a, b) => a.score - b.score || a.order - b.order);
ranking = [winner, ...others].filter(Boolean);
}
ranking.forEach((participant, index) => {
const row = document.createElement('article');
row.className = `finish-ranking-row${index === 0 ? ' winner' : ''}`;
row.style.setProperty('--player-color', security?.safeHex ? security.safeHex(participant.player.color, '#20d868') : '#20d868');
const position = document.createElement('strong');
position.className = 'finish-position';
position.textContent = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${index + 1}°`));
const avatar = document.createElement('div');
avatar.className = 'avatar-preview avatar-preview-tiny';
renderAvatar(avatar, participant.player);
const copy = document.createElement('span');
const name = document.createElement('strong');
name.textContent = participant.player.name;
const detail = document.createElement('small');
if (isComputerMatch()) {
detail.textContent = index === 0
? `${participant.player.isComputer ? 'Pido PC' : 'Giocatore'} · Vincitore · 0 punti`
: `${participant.player.isComputer ? 'Pido PC' : 'Giocatore'} · ${participant.score} punti rimasti`;
} else if (state.multiFinishMode === 'full') {
detail.textContent = `#${participant.order + 1} · ${placeLabel(participant.place)} posto · 0 punti`;
} else {
detail.textContent = index === 0
? `#${participant.order + 1} · Vincitore · 0 punti`
: `#${participant.order + 1} · ${participant.score} punti rimasti`;
}
copy.append(name, detail);
row.append(position, avatar, copy);
finishRankingList.appendChild(row);
});
}
function closeFinishModal() {
if (!finishModal) return;
finishModal.hidden = true;
syncBodyModalState();
}
function openExitModal() {
closeDartPicker();
if (!exitModal) return;
exitModal.hidden = false;
syncBodyModalState();
setTimeout(() => stayInGameBtn?.focus(), 0);
}
function closeExitModal() {
if (!exitModal) return;
exitModal.hidden = true;
syncBodyModalState();
}
function resetStateAfterLeaving() {
state.participants = [];
state.currentIndex = 0;
state.active = false;
state.finished = false;
state.history = [];
state.darts = [];
state.draftDart = null;
state.notice = '';
state.keyboardBuffer = '';
state.rosterRenderKey = '';
state.sessionId = null;
state.sessionCreatedAt = null;
state.completedGameId = null;
state.recordBaseline = null;
state.idealBaseline = null;
state.recordUpdate = null;
state.computerTurnRunning = false;
state.computerProfile = null;
state.trainingMode = 'free';
}
async function pauseAndGoHome() {
if (state.active && !state.finished) await queueAutoSave('pausa');
closeDartPicker();
closeFinishModal();
closeExitModal();
resetStateAfterLeaving();
if (window.PidoDartsApp?.resetNavigation) window.PidoDartsApp.resetNavigation('home', ['home']);
else window.PidoDartsApp?.goTo?.('home');
await refreshResumeUI();
showToast('Partita salvata · puoi riprenderla dalla Home');
}
async function terminateAndReturnSetup() {
const sessionId = state.sessionId;
if (sessionId) await deleteSavedSession(sessionId);
resetToSetup();
showToast('Partita terminata');
}
function resetToSetup() {
const recordMode = !isMultiplayer() && !isComputerMatch() && state.trainingMode === 'record';
const idealMode = !isMultiplayer() && !isComputerMatch() && state.trainingMode === 'ideal';
const computerMode = isComputerMatch();
const target = isMultiplayer() ? 'multiplayer' : (computerMode ? 'computer-setup' : (idealMode ? 'stats-ideal' : (recordMode ? 'record-setup' : 'game-setup')));
const stack = isMultiplayer() ? ['home'] : (idealMode ? ['home', 'statistics'] : ['home', 'training']);
closeDartPicker();
closeFinishModal();
closeExitModal();
resetStateAfterLeaving();
if (window.PidoDartsApp?.resetNavigation) window.PidoDartsApp.resetNavigation(target, stack);
else window.PidoDartsApp?.goTo?.(target);
loadPlayers();
}
async function startRematch() {
if (!state.participants.length || !Number.isInteger(state.startScore) || state.startScore < 1) {
resetToSetup();
return;
}
const recordMode = !isMultiplayer() && !isComputerMatch() && state.trainingMode === 'record';
const idealMode = !isMultiplayer() && !isComputerMatch() && state.trainingMode === 'ideal';
const computerMode = isComputerMatch();
const playerCopies = [...state.participants]
.sort((a, b) => a.order - b.order)
.map(item => ({ ...item.player }));
if (recordMode && playerCopies[0]) {
try { state.recordBaseline = await db.getRecord(playerCopies[0].id, state.startScore); }
catch (error) { console.error('Impossibile aggiornare il record per il rematch:', error); }
}
if (computerMode && state.computerDifficulty === 'adaptive' && playerCopies[0]) {
try {
const refreshedProfile = await computeAdaptiveComputerProfile(playerCopies[0].id);
if (refreshedProfile) {
state.computerProfile = refreshedProfile;
const pcIndex = playerCopies.findIndex(player => player.isComputer);
if (pcIndex >= 0) playerCopies[pcIndex] = makeComputerPlayer(state.computerProfile);
}
} catch (error) {
console.error('Impossibile aggiornare il livello adattivo per il rematch:', error);
}
}
state.recordUpdate = null;
state.participants = playerCopies.map((player, index) => makeParticipant(player, index));
beginMatch(isMultiplayer()
? `Rematch: tocca a ${playerCopies[0].name}.`
: (computerMode
? `Rematch contro Pido PC: ${playerCopies[0].name} inizia per primo.`
: (idealMode && state.idealBaseline
? `Nuova sfida ideale: prova a battere ${state.idealBaseline.turns} turni e ${state.idealBaseline.dartsUsed} freccette.`
: (recordMode && state.recordBaseline
? `Nuova sfida: prova a battere ${state.recordBaseline.turns} turni e ${state.recordBaseline.dartsUsed} freccette.`
: `Rematch iniziato: ${playerCopies[0].name}, ${state.startScore} punti.`))));
closeFinishModal();
showToast(computerMode ? 'Rematch contro Pido PC' : (idealMode ? 'Nuova sfida al record ideale' : (recordMode ? 'Nuova sfida record iniziata' : 'Rematch iniziato')));
}
function goHomeAfterFinish() {
closeDartPicker();
closeFinishModal();
closeExitModal();
resetStateAfterLeaving();
if (window.PidoDartsApp?.resetNavigation) window.PidoDartsApp.resetNavigation('home', ['home']);
else window.PidoDartsApp?.goTo?.('home');
}
async function startIdealChallenge(event) {
const detail = event?.detail || {};
const ideal = detail.ideal;
const playerId = detail.playerId || ideal?.playerId;
const startScore = Number(detail.startScore || ideal?.startScore);
if (!ideal || !playerId || !Number.isInteger(startScore) || startScore < 1) { showToast('Record ideale non valido'); return; }
await loadPlayers();
const player = state.players.find(item => item.id === playerId) || ideal.player;
if (!player) { showToast('Giocatore non disponibile'); return; }
state.mode = 'single';
state.trainingMode = 'ideal';
state.startScore = startScore;
state.selectedScore = startScore;
state.recordSelectedScore = startScore;
state.recordBaseline = null;
state.idealBaseline = cloneData(ideal);
state.recordUpdate = null;
state.participants = [makeParticipant({ ...player }, 0)];
state.currentIndex = 0;
beginMatch(`Sfida ideale: prova a battere ${ideal.turns} turni e ${ideal.dartsUsed} freccette.`);
showToast('Sfida al record ideale iniziata');
}
document.addEventListener('pido:startideal', startIdealChallenge);
setupPlayer?.addEventListener('change', renderSetupPlayerPreview);
scorePicker?.addEventListener('click', event => {
const button = event.target.closest('[data-game-score]');
if (!button) return;
selectScore(button.dataset.gameScore === 'custom' ? 'custom' : Number(button.dataset.gameScore));
});
startGameBtn?.addEventListener('click', startSingleGame);
customScore?.addEventListener('input', () => {
if (setupError) setupError.textContent = '';
});
recordSetupPlayer?.addEventListener('change', () => {
renderRecordPlayerPreview();
if (recordSetupError) recordSetupError.textContent = '';
refreshRecordPreview();
});
recordScorePicker?.addEventListener('click', event => {
const button = event.target.closest('[data-record-score]');
if (!button) return;
selectRecordScore(button.dataset.recordScore === 'custom' ? 'custom' : Number(button.dataset.recordScore));
});
recordCustomScore?.addEventListener('input', () => {
if (recordSetupError) recordSetupError.textContent = '';
refreshRecordPreview();
});
startRecordGameBtn?.addEventListener('click', startRecordGame);
computerSetupPlayer?.addEventListener('change', () => {
renderComputerPlayerPreview();
if (computerSetupError) computerSetupError.textContent = '';
refreshComputerAdaptivePreview();
});
computerScorePicker?.addEventListener('click', event => {
const button = event.target.closest('[data-computer-score]');
if (!button) return;
selectComputerScore(button.dataset.computerScore === 'custom' ? 'custom' : Number(button.dataset.computerScore));
});
computerCustomScore?.addEventListener('input', () => {
if (computerSetupError) computerSetupError.textContent = '';
if (startComputerGameBtn) startComputerGameBtn.disabled = !computerSetupPlayer?.value || getComputerStartScore() === null;
});
computerDifficultyPicker?.addEventListener('click', event => {
const button = event.target.closest('[data-computer-difficulty]');
if (!button) return;
selectComputerDifficulty(button.dataset.computerDifficulty);
});
startComputerGameBtn?.addEventListener('click', startComputerGame);
multiPlayerSelector?.addEventListener('click', event => {
const button = event.target.closest('[data-multi-player-id]');
if (!button) return;
toggleMultiPlayer(button.dataset.multiPlayerId);
});
multiOrderList?.addEventListener('click', event => {
const move = event.target.closest('[data-move-multi]');
if (move) {
moveMultiPlayer(move.dataset.multiPlayerId, move.dataset.moveMulti);
return;
}
const remove = event.target.closest('[data-remove-multi]');
if (remove) toggleMultiPlayer(remove.dataset.removeMulti);
});
multiScorePicker?.addEventListener('click', event => {
const button = event.target.closest('[data-multi-score]');
if (!button) return;
selectMultiScore(button.dataset.multiScore === 'custom' ? 'custom' : Number(button.dataset.multiScore));
});
multiCustomScore?.addEventListener('input', () => {
if (multiSetupError) multiSetupError.textContent = '';
syncMultiStartButton();
syncMultiAppSummaries();
});
multiFinishModePicker?.addEventListener('click', event => {
const button = event.target.closest('[data-finish-mode]');
if (!button) return;
selectFinishMode(button.dataset.finishMode);
});
multiAppIndex?.addEventListener('click', event => {
const button = event.target.closest('[data-multi-app-open]');
if (!button) return;
openMultiAppSection(button.dataset.multiAppOpen);
});
document.querySelectorAll('[data-multi-app-back]').forEach(button => {
button.addEventListener('click', () => closeMultiAppSection());
});
startMultiGameBtn?.addEventListener('click', startMultiGame);
openDartPickerBtn?.addEventListener('click', openDartPicker);
closeDartPickerBtn?.addEventListener('click', closeDartPicker);
dartSlots.forEach(slot => {
slot.addEventListener('click', () => {
if (Number(slot.dataset.dartSlot) === state.darts.length) openDartPicker();
});
});
multiplierTabs?.addEventListener('click', event => {
const button = event.target.closest('[data-multiplier]');
if (!button) return;
state.pickerMultiplier = Number(button.dataset.multiplier);
state.draftDart = null;
updatePickerUI();
});
numberPad?.addEventListener('click', event => {
const button = event.target.closest('[data-dart-number]');
if (!button) return;
try {
selectDraftDart(engine.makeDart(button.dataset.dartNumber, state.pickerMultiplier));
} catch (error) {
showToast(error.message || 'Seleziona un tiro valido');
}
});
pickerSpecials?.addEventListener('click', event => {
const button = event.target.closest('[data-special-dart]');
if (!button) return;
try {
selectDraftDart(engine.makeSpecial(button.dataset.specialDart));
} catch (error) {
showToast(error.message || 'Tiro non valido');
}
});
confirmDartBtn?.addEventListener('click', confirmDraftDart);
pickerCancelLastBtn?.addEventListener('click', () => {
cancelLastDart();
updatePickerUI();
});
dartPicker?.addEventListener('click', event => {
if (event.target === dartPicker) closeDartPicker();
});
cancelDartBtn?.addEventListener('click', cancelLastDart);
confirmTurnBtn?.addEventListener('click', confirmTurn);
undoTurnBtn?.addEventListener('click', undoLastTurn);
finishUndoBtn?.addEventListener('click', undoLastTurn);
finishNewGameBtn?.addEventListener('click', startRematch);
finishHomeBtn?.addEventListener('click', goHomeAfterFinish);
clearGameBtn?.addEventListener('click', () => {
if (state.active && !state.finished) openExitModal();
else resetToSetup();
});
stayInGameBtn?.addEventListener('click', closeExitModal);
pauseGameBtn?.addEventListener('click', pauseAndGoHome);
confirmExitGameBtn?.addEventListener('click', terminateAndReturnSetup);
exitModal?.addEventListener('click', event => {
if (event.target === exitModal) closeExitModal();
});
resumeCard?.addEventListener('click', openResumeGamesModal);
closeResumeGamesModalBtn?.addEventListener('click', closeResumeGamesModal);
resumeGamesModal?.addEventListener('click', event => {
if (event.target === resumeGamesModal) closeResumeGamesModal();
});
resumeGamesList?.addEventListener('click', async event => {
const resume = event.target.closest('[data-resume-game-id]');
if (resume) {
await restoreGameSession(resume.dataset.resumeGameId);
return;
}
const remove = event.target.closest('[data-delete-resume-id]');
if (remove) {
await deleteSavedSession(remove.dataset.deleteResumeId);
showToast('Salvataggio eliminato');
const sessions = await refreshResumeUI();
if (!sessions.length) closeResumeGamesModal();
}
});
document.addEventListener('pido:screenchange', event => {
const screen = event.detail?.screen;
if (screen === 'multiplayer') {
activeMultiAppSection = '';
syncMultiAppNavigation();
} else if (activeMultiAppSection) {
activeMultiAppSection = '';
syncMultiAppNavigation();
}
if (screen === 'game-setup' || screen === 'record-setup' || screen === 'computer-setup' || screen === 'multiplayer') loadPlayers();
if (screen === 'home') refreshResumeUI();
if (screen !== 'game') {
if (dartPicker && !dartPicker.hidden) closeDartPicker();
if (exitModal && !exitModal.hidden) closeExitModal();
clearKeyboardBuffer();
}
});
document.addEventListener('pido:backrequest', event => {
if (resumeGamesModal && !resumeGamesModal.hidden) {
closeResumeGamesModal();
event.detail.handled = true;
return;
}
const currentScreen = window.PidoDartsApp?.getCurrentScreen?.();
if (currentScreen === 'multiplayer' && closeMultiAppSection()) {
event.detail.handled = true;
return;
}
if (currentScreen !== 'game') return;
if (exitModal && !exitModal.hidden) {
closeExitModal();
event.detail.handled = true;
return;
}
if (dartPicker && !dartPicker.hidden) {
closeDartPicker();
event.detail.handled = true;
return;
}
if (finishModal && !finishModal.hidden) {
closeFinishModal();
event.detail.handled = true;
return;
}
if (state.active && !state.finished) {
openExitModal();
event.detail.handled = true;
}
});
document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'hidden') queueAutoSave('app in background');
});
window.addEventListener('pagehide', () => { queueAutoSave('chiusura app'); });
window.addEventListener('resize', syncMultiAppNavigation);
const multiLayoutObserver = new MutationObserver(syncMultiAppNavigation);
multiLayoutObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mobile-layout'] });
document.addEventListener('keydown', event => {
if (window.PidoDartsApp?.getCurrentScreen?.() !== 'game') return;
const tag = event.target?.tagName;
if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || event.target?.isContentEditable) return;
if (event.ctrlKey || event.metaKey || event.altKey) return;
const key = event.key;
const lower = key.toLowerCase();
if (key === 'Escape') {
event.preventDefault();
window.PidoDartsApp?.requestBack?.('keyboard');
return;
}
if ((exitModal && !exitModal.hidden) || (finishModal && !finishModal.hidden)) return;
if (/^[0-9]$/.test(key)) {
event.preventDefault();
queueKeyboardDigit(key);
return;
}
if (lower === 'n' || lower === 's') { event.preventDefault(); setKeyboardMultiplier(1); return; }
if (lower === 'd') { event.preventDefault(); setKeyboardMultiplier(2); return; }
if (lower === 't') { event.preventDefault(); setKeyboardMultiplier(3); return; }
if (lower === 'b') { event.preventDefault(); selectKeyboardSpecial('bull'); return; }
if (lower === 'c') { event.preventDefault(); selectKeyboardSpecial('center'); return; }
if (lower === 'm') { event.preventDefault(); selectKeyboardSpecial('miss'); return; }
if (lower === 'u') { event.preventDefault(); undoLastTurn(); return; }
if (key === 'Backspace' || key === 'Delete') {
event.preventDefault();
if (state.keyboardBuffer) {
state.keyboardBuffer = state.keyboardBuffer.slice(0, -1);
updateKeyboardStatus();
} else if (state.draftDart) {
state.draftDart = null;
updatePickerUI();
updateKeyboardStatus();
} else {
cancelLastDart();
}
return;
}
if (key === 'Enter') {
event.preventDefault();
if (state.keyboardBuffer) commitKeyboardNumber();
else if (state.draftDart) confirmDraftDart();
else if (state.darts.length) confirmTurn();
}
});
selectScore(301);
selectRecordScore(301);
selectMultiScore(301);
selectFinishMode('first');
loadPlayers();
refreshResumeUI();
})();

;
(() => {
const modal = document.getElementById('listViewerModal');
const body = document.getElementById('listViewerBody');
const backBtn = document.getElementById('listViewerBackBtn');
const title = document.getElementById('listViewerTitle');
const eyebrow = document.getElementById('listViewerEyebrow');
const count = document.getElementById('listViewerCount');
const buttons = [...document.querySelectorAll('[data-expanded-list-target]')];
if (!modal || !body || !backBtn || !buttons.length) return;
let active = null;
let placeholder = null;
let previousFocus = null;
const savedScroll = new Map();
const isSiteMode = () => window.innerWidth > 720 || document.documentElement.dataset.mobileLayout === 'site';
const itemCount = target => target ? target.children.length : 0;
function updateButton(button) {
const target = document.getElementById(button.dataset.expandedListTarget);
const limit = Number(button.dataset.expandedListLimit || 8);
const shouldShow = Boolean(target && isSiteMode() && itemCount(target) > limit);
button.hidden = !shouldShow;
}
function updateAllButtons() { buttons.forEach(updateButton); }
function updateModalMeta() {
if (!active) return;
const n = itemCount(active.target);
count.textContent = `${n} ${n === 1 ? 'elemento' : 'elementi'}`;
}
function openViewer(button) {
const target = document.getElementById(button.dataset.expandedListTarget);
if (!target || !isSiteMode()) return;
if (active) closeViewer(false);
previousFocus = document.activeElement;
placeholder = document.createComment(`pido-list:${target.id}`);
target.parentNode.insertBefore(placeholder, target);
active = { target, button, id: target.id };
target.classList.add('list-viewer-live');
body.appendChild(target);
eyebrow.textContent = button.dataset.expandedListEyebrow || 'ELENCO COMPLETO';
title.textContent = button.dataset.expandedListTitle || 'Tutti gli elementi';
updateModalMeta();
modal.hidden = false;
document.body.classList.add('list-viewer-open');
requestAnimationFrame(() => {
body.scrollTop = savedScroll.get(active.id) || 0;
backBtn.focus();
});
}
function closeViewer(restoreFocus = true) {
if (!active || modal.hidden) return false;
savedScroll.set(active.id, body.scrollTop);
const { target, button } = active;
target.classList.remove('list-viewer-live');
if (placeholder?.parentNode) placeholder.parentNode.replaceChild(target, placeholder);
else button?.parentNode?.insertBefore(target, button);
body.textContent = '';
modal.hidden = true;
document.body.classList.remove('list-viewer-open');
active = null;
placeholder = null;
updateAllButtons();
if (restoreFocus) {
const focusTarget = previousFocus?.isConnected ? previousFocus : button;
setTimeout(() => focusTarget?.focus?.(), 0);
}
previousFocus = null;
return true;
}
buttons.forEach(button => {
const target = document.getElementById(button.dataset.expandedListTarget);
button.addEventListener('click', () => openViewer(button));
if (target) {
new MutationObserver(() => {
updateButton(button);
if (active?.target === target) updateModalMeta();
}).observe(target, { childList: true });
}
});
backBtn.addEventListener('click', () => closeViewer());
modal.addEventListener('click', event => {
if (event.target === modal) closeViewer();
if (event.target.closest('[data-open-ideal]')) setTimeout(() => closeViewer(false), 0);
});
document.addEventListener('keydown', event => {
if (event.defaultPrevented || event.key !== 'Escape' || !active) return;
event.preventDefault();
closeViewer();
});
document.addEventListener('pido:backrequest', event => {
if (event.detail?.handled || !active) return;
closeViewer(false);
event.detail.handled = true;
});
document.addEventListener('pido:screenchange', () => {
if (active) closeViewer(false);
});
const layoutObserver = new MutationObserver(() => {
if (active && !isSiteMode()) closeViewer(false);
updateAllButtons();
});
layoutObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mobile-layout'] });
window.addEventListener('resize', () => {
if (active && !isSiteMode()) closeViewer(false);
updateAllButtons();
});
updateAllButtons();
window.PidoDartsListViewer = { close: closeViewer, refresh: updateAllButtons };
})();
