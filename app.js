// Кинодневник — логика мини-аппа (дизайн из Claude Design).
// Оценка проходит в 4 шага: фильм → оценки → итог с заметками → запись.
// Хранение: облако Telegram (CloudStorage); вне Telegram — localStorage.

"use strict";

// ─── Telegram WebApp ─────────────────────────────────────────────

const tg = window.Telegram ? window.Telegram.WebApp : null;
// initData не пустой только внутри настоящего Telegram
const inTelegram = !!(tg && tg.initData);
let fullscreenUnavailable = false;

function lockTelegramVerticalSwipes() {
  if (!tg || typeof tg.disableVerticalSwipes !== "function") return;
  try { tg.disableVerticalSwipes(); } catch (_) { /* старый клиент */ }
}

function requestAppFullscreen() {
  if (!tg) return;

  // expand работает в старых клиентах, requestFullscreen — в Telegram 8.0+.
  tg.expand();
  if (fullscreenUnavailable || tg.isFullscreen) return;
  if (typeof tg.requestFullscreen !== "function" || !tg.isVersionAtLeast("8.0")) return;

  try {
    tg.requestFullscreen();
  } catch (_) {
    fullscreenUnavailable = true;
  }
}

if (tg) {
  tg.ready();
  lockTelegramVerticalSwipes();
  requestAppFullscreen();
  lockTelegramVerticalSwipes();

  if (typeof tg.onEvent === "function" && tg.isVersionAtLeast("8.0")) {
    tg.onEvent("fullscreenFailed", (event) => {
      if (!event || event.error !== "ALREADY_FULLSCREEN") fullscreenUnavailable = true;
      tg.expand();
      lockTelegramVerticalSwipes();
    });
  }
}

function syncTelegramInsets() {
  const stableHeight = Number(tg?.viewportStableHeight || 0);
  const layoutHeight = window.innerHeight;
  const stableGap = stableHeight ? Math.max(0, layoutHeight - stableHeight) : 0;
  const apiInset = Number(tg?.contentSafeAreaInset?.top || tg?.safeAreaInset?.top || 0);
  const styles = getComputedStyle(document.documentElement);
  const cssInset = Math.max(
    parseFloat(styles.getPropertyValue("--tg-content-safe-area-inset-top")) || 0,
    parseFloat(styles.getPropertyValue("--tg-safe-area-inset-top")) || 0,
  );
  const visualTop = Number(window.visualViewport?.offsetTop || 0);
  const measuredInset = Math.max(stableGap, apiInset, visualTop, cssInset);
  // Telegram и CSS сами сообщают safe area; не подгоняем отступ под модель iPhone.
  const extraInset = Math.max(0, measuredInset - cssInset);
  document.documentElement.style.setProperty("--telegram-header-inset", `${extraInset}px`);
  if (stableHeight) document.documentElement.style.setProperty("--stable-viewport-height", `${stableHeight}px`);
}

syncTelegramInsets();
window.addEventListener("resize", syncTelegramInsets);
if (tg?.onEvent) {
  ["viewportChanged", "safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged"].forEach((event) =>
    tg.onEvent(event, () => {
      syncTelegramInsets();
      lockTelegramVerticalSwipes();
    }));
}
// requestFullscreen() асинхронный: Telegram присылает реальные отступы чуть
// позже первого кадра. Подстраховываемся повторными измерениями.
if (inTelegram) {
  [0, 100, 250, 500, 900, 1600].forEach((delay) => setTimeout(() => {
    syncTelegramInsets();
    lockTelegramVerticalSwipes();
  }, delay));
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) lockTelegramVerticalSwipes();
});
window.addEventListener("pageshow", lockTelegramVerticalSwipes);

// ─── Критерии и формулы (один в один из kinodnevnik.jsx) ─────────

const CRITERIA = [
  { id: "plot", label: "Сюжет и сценарий" },
  { id: "chars", label: "Персонажи и игра" },
  { id: "visual", label: "Визуал и режиссура" },
  { id: "sound", label: "Звук и музыка" },
  { id: "emotion", label: "Эмоциональное воздействие" },
];

const GENRES = ["Хоррор", "Триллер", "Драма", "Фантастика", "Боевик",
  "Комедия", "Детектив", "Фэнтези", "Анимация", "Документальный", "Другое"];

const GENRE_COLORS = {
  "Хоррор": "#B84C4C",
  "Триллер": "#B84C4C",
  "Драма": "#5C7C9C",
  "Комедия": "#E8B54F",
  "Фантастика": "#4FBFA8",
};
const DEFAULT_ACCENT = "var(--accent)";

// TMDB допускает клиентские read-only ключи в браузерных приложениях.
const TMDB_KEY = "cf097ea6bdd4ac2b03c73baf862d389a";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/";
const TMDB_GENRES = {
  27: "Хоррор", 53: "Триллер", 18: "Драма", 878: "Фантастика",
  28: "Боевик", 35: "Комедия", 9648: "Детектив", 14: "Фэнтези",
  16: "Анимация", 99: "Документальный",
};
const TMDB_GENRE_IDS = Object.fromEntries(Object.entries(TMDB_GENRES).map(([id, name]) => [name, id]));
const PROFILE_KEY = "kino_profile_v1";
const TRENDING_CACHE_KEY = "tmdb_trending_day_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

const verdict = (s) => {
  if (s >= 9) return "Почти шедевр";
  if (s >= 8) return "Отлично";
  if (s >= 7) return "Хорошо";
  if (s >= 6) return "Нормально";
  if (s >= 4) return "Слабо";
  return "Плохо";
};

// 10-балльная → 5-балльная с половинками (как звёзды на Letterboxd)
const toFive = (s10) => Math.round(s10) / 2;

// текстовые звёзды для экспорта: ★★★½☆
const starsText = (s10) => {
  const v = toFive(s10);
  const full = Math.floor(v);
  return "★".repeat(full) + (v % 1 ? "½" : "") + "☆".repeat(5 - Math.ceil(v));
};

// среднее по 5 критериям, округление до 0.1
const calcQuality = (scores) => {
  const sum = CRITERIA.reduce((s, c) => s + scores[c.id], 0);
  return Math.round((sum / CRITERIA.length) * 10) / 10;
};

// ─── Хранилище: облако Telegram или localStorage ─────────────────
// Каждый фильм — отдельный ключ "film_<id>", значение — JSON.

const cloud = {
  getKeys: () => new Promise((res, rej) =>
    tg.CloudStorage.getKeys((e, keys) => e ? rej(e) : res(keys || []))),
  getItems: (keys) => new Promise((res, rej) =>
    tg.CloudStorage.getItems(keys, (e, vals) => e ? rej(e) : res(vals || {}))),
  set: (k, v) => new Promise((res, rej) =>
    tg.CloudStorage.setItem(k, v, (e) => e ? rej(e) : res())),
  remove: (k) => new Promise((res, rej) =>
    tg.CloudStorage.removeItem(k, (e) => e ? rej(e) : res())),
};

const useCloud = inTelegram && tg.CloudStorage && tg.isVersionAtLeast("6.9");

const store = {
  async getAll() {
    let raw = [];
    if (useCloud) {
      const keys = (await cloud.getKeys()).filter((k) => k.startsWith("film_"));
      if (keys.length) raw = Object.values(await cloud.getItems(keys));
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith("film_")) raw.push(localStorage.getItem(k));
      }
    }
    const films = [];
    for (const r of raw) {
      try {
        const saved = withDirectTmdbImages(JSON.parse(r));
        const entryId = saved.entryId || saved.id;
        films.push({ ...saved, id: entryId, entryId, movieId: saved.movieId || saved.tmdbId || null });
      } catch (e) { /* битую запись пропускаем */ }
    }
    return films.sort((a, b) => b.entryId - a.entryId); // новые сверху
  },
  async save(film) {
    const entryId = film.entryId || film.id;
    const k = "film_" + entryId, v = JSON.stringify({ ...film, id: entryId, entryId });
    if (useCloud) await cloud.set(k, v);
    else localStorage.setItem(k, v);
  },
  async remove(id) {
    const k = "film_" + id;
    if (useCloud) await cloud.remove(k);
    else localStorage.removeItem(k);
  },
  async clearAll() {
    let keys = [];
    if (useCloud) {
      keys = (await cloud.getKeys()).filter((key) => key.startsWith("film_"));
      await Promise.all(keys.map((key) => cloud.remove(key)));
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("film_")) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    }
    return keys.length;
  },
};

async function loadProfile() {
  let raw = "";
  try {
    if (useCloud) raw = (await cloud.getItems([PROFILE_KEY]))[PROFILE_KEY] || "";
    else raw = localStorage.getItem(PROFILE_KEY) || "";
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

async function saveProfileData(value) {
  const raw = JSON.stringify(value);
  if (useCloud) await cloud.set(PROFILE_KEY, raw);
  else localStorage.setItem(PROFILE_KEY, raw);
}

async function applyResetRequest() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("reset") !== "1") return null;

  try {
    const removed = await store.clearAll();
    const savedProfile = await loadProfile();
    await saveProfileData({ ...savedProfile, favorites: [] });
    url.searchParams.delete("reset");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    return { removed };
  } catch (error) {
    return { error };
  }
}

function showResetNotice(result) {
  const failed = !!result?.error;
  const text = failed
    ? "Не удалось очистить оценки. Попробуй ещё раз."
    : result.removed
      ? `Все оценки удалены · ${result.removed}`
      : "Оценённых фильмов уже нет";
  const notice = el("div", `reset-notice${failed ? " is-error" : ""}`, text);
  notice.setAttribute("role", failed ? "alert" : "status");
  document.body.append(notice);
  haptic("notification", failed ? "error" : "success");
  setTimeout(() => notice.classList.add("is-leaving"), 2400);
  setTimeout(() => notice.remove(), 2700);
}

// ─── Состояние ───────────────────────────────────────────────────

const emptyForm = () => ({
  title: "", year: "", genre: GENRES[0],
  tmdbId: null, poster: "", posterPreview: "", backdrop: "", backdropPreview: "",
  scores: { plot: 5, chars: 5, visual: 5, sound: 5, emotion: 5 },
  personal: 5,
  liked: "", disliked: "", moment: "",
  review: "",
});

let form = emptyForm();
let tab = "feed";   // "rate" | "feed" | "diary"
let step = 0;       // 0 фильм · 1 оценки · 2 итог · 3 запись
let expandedId = null;
let searchTimer = null;
let searchController = null;
let searchBlurTimer = null;
let searchSkeletonTimer = null;
let renderedSearchMovies = [];
let selectingMovie = false;
let rateReturnTab = "feed";
let profileBaseline = "";
let searchLayoutBottom = window.visualViewport
  ? window.visualViewport.offsetTop + window.visualViewport.height
  : window.innerHeight;
let popularLoaded = false;
let recommendationsLoaded = false;
let popularMovies = [];
let popularAnimationFrame = 0;
let popularPauseUntil = 0;
let popularLastFrame = 0;
let popularPosition = 0;
let activeStarsMorph = null;
let editingEntryId = null;
let editingOriginalDate = "";
let duplicatePendingMovie = null;
let duplicatePendingEntry = null;
let profile = {};
let profileReturnTab = "feed";
let profileDraftFavorites = [];
let selectedOnboardingGenres = new Set();
let selectedFrequency = "";

const STEP_TITLES = ["Выбери фильм", "Оценки", "Ну как?", "Запись"];
const TAB_INDEX = { rate: 0, feed: 1, diary: 2, profile: 3 };
const SEARCH_CACHE = new Map();
const RECENT_MOVIES_KEY = "kino_recent_movies_v1";

// ─── Промпт для ручного режима (как manualPrompt в jsx) ──────────

function filmContext() {
  const details = CRITERIA.map((c) => `${c.label}: ${form.scores[c.id]}/10`).join("\n");
  const q = calcQuality(form.scores);
  return `Фильм: «${form.title}»${form.year ? ` (${form.year})` : ""}, жанр: ${form.genre}.
Оценки по критериям:
${details}
Итог по качеству: ${q}/10 (${verdict(q)})
Личное удовольствие: ${form.personal}/10
Заметки зрителя:
Понравилось: ${form.liked || "—"}
Не понравилось: ${form.disliked || "—"}
Запомнившийся момент: ${form.moment || "—"}`;
}

function manualPrompt() {
  return `Напиши короткую запись о фильме для моего личного кинодневника, от первого лица.

${filmContext()}

Важно: 70–130 слов максимум. Пиши как заметку для себя, спокойным разговорным тоном, простыми предложениями. Максимально сохраняй мои формулировки из заметок — не заменяй мои слова на сленг и не добавляй «молодёжных» выражений от себя. Без красивых оборотов, без формального итога, без списков. Возьми 2–3 вещи, которые меня реально зацепили, и напиши про них конкретно. Ответь только текстом записи.`;
}

// ─── Помощники ───────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    // запасной способ для старых webview
    const ta = el("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

function confirmAsk(msg) {
  return new Promise((res) => {
    if (inTelegram && tg.isVersionAtLeast("6.2")) tg.showConfirm(msg, res);
    else res(window.confirm(msg));
  });
}

function haptic(type, style) {
  if (!inTelegram || !tg.HapticFeedback) return;
  try {
    if (type === "selection") tg.HapticFeedback.selectionChanged();
    else if (type === "impact") tg.HapticFeedback.impactOccurred(style);
    else tg.HapticFeedback.notificationOccurred(style);
  } catch (e) { /* не критично */ }
}

function genreColor(genre) {
  return GENRE_COLORS[genre] || DEFAULT_ACCENT;
}

function syncGenreAccent(genre) {
  document.documentElement.style.setProperty("--genre-accent", genre ? genreColor(genre) : DEFAULT_ACCENT);
}

function microPreview(url, size) {
  const source = legacyTmdbSource(url) || url || "";
  return source.replace(/\/(?:w\d+|h\d+|original)\//, `/${size}/`);
}

// Старые записи могли сохранить обёрнутую ссылку. Забираем из неё исходный
// адрес TMDB, но больше не отправляем изображения через сторонний сервис.
function legacyTmdbSource(url) {
  const marker = "/https://image.tmdb.org/";
  const sourceAt = (url || "").indexOf(marker);
  return sourceAt < 0 ? "" : decodeURI(url.slice(sourceAt + 1));
}

function tmdbImagePath(url) {
  const source = legacyTmdbSource(url) || url || "";
  const match = source.match(/^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+(\/.*)$/);
  return match ? match[1] : "";
}

function tmdbPoster(path, size = "w500") {
  return path ? TMDB_IMG + size + path : "";
}

function tmdbBackdrop(path, size = "w1280") {
  return path ? TMDB_IMG + size + path : "";
}

function originalBackdrop(url, size = "w1280") {
  const path = tmdbImagePath(url);
  return path ? tmdbBackdrop(path, size) : (legacyTmdbSource(url) || url || "");
}

function withDirectTmdbImages(film) {
  const posterPath = tmdbImagePath(film.poster);
  const backdropPath = tmdbImagePath(film.backdrop);
  const poster = posterPath ? tmdbPoster(posterPath, "w500") : (legacyTmdbSource(film.poster) || film.poster || "");
  const posterPreview = posterPath
    ? tmdbPoster(posterPath, "w92")
    : (legacyTmdbSource(film.posterPreview) || film.posterPreview || "");
  return {
    ...film,
    poster,
    posterPreview,
    backdrop: backdropPath
      ? tmdbBackdrop(backdropPath, "w1280")
      : (legacyTmdbSource(film.backdrop) || film.backdrop || poster),
    backdropPreview: backdropPath
      ? tmdbBackdrop(backdropPath, "w300")
      : (legacyTmdbSource(film.backdropPreview) || film.backdropPreview || posterPreview),
  };
}

function backdropPreview(backdrop, poster, savedPreview, posterMicroPreview) {
  return savedPreview || posterMicroPreview || microPreview(poster, "w92") ||
    microPreview(backdrop, "w300");
}

function cssImage(url) {
  return url ? `url("${url.replace(/["\\]/g, "\\$&")}")` : "none";
}

// Два слоя дают настоящий blur-up: маленькое превью остаётся под
// полноразмерной картинкой, пока та не загрузилась и не декодировалась.
function setBlurPicture(frame, previewImg, fullImg, preview, full) {
  const target = full || preview;
  frame.classList.remove("is-loaded");
  frame.dataset.blurTarget = target || "";
  previewImg.removeAttribute("src");
  fullImg.removeAttribute("src");
  if (!target) return;

  previewImg.src = preview || target;
  previewImg.onerror = () => {
    const fallback = legacyTmdbSource(preview || target);
    if (fallback && previewImg.dataset.fallback !== fallback) {
      previewImg.dataset.fallback = fallback;
      previewImg.src = fallback;
    }
  };
  fullImg.onload = async () => {
    try { await fullImg.decode(); } catch (e) { /* изображение уже готово */ }
    if (frame.dataset.blurTarget !== target) return;
    requestAnimationFrame(() => {
      if (frame.dataset.blurTarget === target) frame.classList.add("is-loaded");
    });
  };
  fullImg.onerror = () => {
    const fallback = legacyTmdbSource(target);
    if (fallback && fullImg.dataset.fallback !== fallback) {
      fullImg.dataset.fallback = fallback;
      fullImg.src = fallback;
    }
    // Если не загрузится и оригинал, микро-превью останется вместо пустого блока.
  };
  fullImg.src = target;
  if (fullImg.complete && fullImg.naturalWidth) fullImg.onload();
}

function blurPicture(preview, full, className, loading = "lazy") {
  const frame = el("span", `blur-up-media ${className}`);
  const low = new Image();
  const high = new Image();
  low.className = "blur-up-preview";
  high.className = "blur-up-full";
  low.alt = "";
  high.alt = "";
  low.setAttribute("aria-hidden", "true");
  high.setAttribute("aria-hidden", "true");
  low.decoding = "async";
  high.decoding = "async";
  low.loading = "eager";
  high.loading = loading;
  frame.append(low, high);
  setBlurPicture(frame, low, high, preview, full);
  return frame;
}

function setBlurBackground(node, preview, full, previewProperty, fullProperty, loadedClass) {
  const target = full || preview;
  node.classList.remove(loadedClass);
  node.dataset.blurTarget = target || "";
  node.style.setProperty(previewProperty, cssImage(preview || target));
  node.style.setProperty(fullProperty, cssImage(target));
  if (!target) {
    node.classList.add(loadedClass);
    return;
  }

  const image = new Image();
  image.decoding = "async";
  image.onload = async () => {
    try { await image.decode(); } catch (e) { /* изображение уже готово */ }
    if (node.dataset.blurTarget !== target) return;
    requestAnimationFrame(() => {
      if (node.dataset.blurTarget === target) node.classList.add(loadedClass);
    });
  };
  image.onerror = () => { /* превью остаётся видимым */ };
  image.src = target;
  if (image.complete && image.naturalWidth) image.onload();
}

// нарисовать звёзды с половинками: пять ★, у каждой золотая «заливка» 0/50/100%
function renderStars(container, five) {
  if (container.children.length !== 5) {
    container.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const star = el("div", "star", "★");
      star.append(el("div", "fill", "★"));
      container.append(star);
    }
  }
  for (let i = 0; i < 5; i++) {
    const v = five - i;
    const pct = v >= 1 ? 100 : v >= 0.5 ? 50 : 0;
    container.children[i].querySelector(".fill").style.width = pct + "%";
    container.children[i].classList.toggle("has-fill", pct > 0);
  }

  const strength = Math.max(0, Math.min(1, (five - 0.5) / 4.5));
  const red = Math.round(107 + (245 - 107) * strength);
  const green = Math.round(101 + (185 - 101) * strength);
  const blue = Math.round(94 + (66 - 94) * strength);
  const dynamicStars = container.classList.contains("dynamic");
  if (dynamicStars) {
    const available = Math.min(window.innerWidth, 560) * 0.9;
    const gap = 2 + strength * 10;
    const maxSize = Math.min(68, (available - gap * 4) / 5);
    const size = 24 + (maxSize - 24) * strength;
    container.style.setProperty("--star-size", `${size.toFixed(1)}px`);
    container.style.setProperty("--star-gap", `${gap.toFixed(1)}px`);
  }
  container.style.setProperty("--stars-color", `rgb(${red}, ${green}, ${blue})`);
  container.classList.toggle("is-perfect", five === 5);
  container.classList.toggle("is-high", five >= 4.5);
  container.dataset.rating = String(five);
}

function ratingHapticBand(five) {
  if (five >= 5) return "success";
  if (five >= 3.5) return "rigid";
  if (five >= 2) return "medium";
  return "light";
}

function ratingThresholdHaptic(previousFive, nextFive) {
  if (previousFive === nextFive) return;
  const previousBand = ratingHapticBand(previousFive);
  const nextBand = ratingHapticBand(nextFive);
  if (previousBand === nextBand) return;
  if (nextBand === "success") haptic("notification", "success");
  else haptic("impact", nextBand);
}

// ─── Переключение вкладок и шагов ────────────────────────────────

function syncTelegramSwipeBehavior(insideRating) {
  lockTelegramVerticalSwipes();
}

async function showTab(name) {
  const previousTab = tab;
  const changed = previousTab !== name;
  const nextScreen = $("screen-" + name);
  if (name === "rate" && previousTab !== "rate") rateReturnTab = previousTab;
  tab = name;
  if (name !== "rate") closeSearchKeyboard();
  $("screen-rate").classList.toggle("hidden", name !== "rate");
  $("screen-feed").classList.toggle("hidden", name !== "feed");
  $("screen-diary").classList.toggle("hidden", name !== "diary");
  $("screen-profile").classList.toggle("hidden", name !== "profile");
  $("head-rate").classList.toggle("hidden", name !== "rate");
  $("head-feed").classList.toggle("hidden", name !== "feed");
  $("head-diary").classList.toggle("hidden", name !== "diary");
  $("head-profile").classList.toggle("hidden", name !== "profile");
  const showRateAction = name === "rate" && (step > 0 || (step === 0 && !!form.title));
  $("footer-action").classList.toggle("hidden", !showRateAction);
  $("tab-rate").classList.toggle("on", name === "rate");
  $("tab-feed").classList.toggle("on", name === "feed");
  $("tab-diary").classList.toggle("on", name === "diary");
  $("tab-profile").classList.toggle("on", name === "profile");
  document.querySelector(".tabbar").style.setProperty("--tab-index", TAB_INDEX[name]);
  document.body.classList.toggle("has-action", showRateAction);
  document.body.classList.toggle("rate-flow", name === "rate");
  syncTelegramSwipeBehavior(name === "rate");
  syncAtmosphere();

  if (changed) {
    nextScreen.classList.remove("tab-enter-from-left", "tab-enter-from-right");
    void nextScreen.offsetWidth;
    nextScreen.classList.add(TAB_INDEX[name] > TAB_INDEX[previousTab]
      ? "tab-enter-from-right" : "tab-enter-from-left");
    const finishTabMotion = (event) => {
      if (event.target !== nextScreen) return;
      nextScreen.classList.remove("tab-enter-from-left", "tab-enter-from-right");
      nextScreen.removeEventListener("animationend", finishTabMotion);
    };
    nextScreen.addEventListener("animationend", finishTabMotion);
  }

  if (name === "rate") {
    if (!popularLoaded) loadPopular();
    if (!recommendationsLoaded) loadRecommendations();
  }
  if (name === "feed") return renderFeed();
  if (name === "diary") return renderDiary();
  if (name === "profile") return renderProfile();
}

function syncAtmosphere() {
  const insideFilm = tab === "rate" && !!form.title;
  const heroMode = insideFilm && step === 0;
  document.body.classList.toggle("immersive", insideFilm);
  document.body.classList.toggle("hero", heroMode);
  document.documentElement.classList.toggle("hero-mode", heroMode);
}
function starsVisualRect(container) {
  const stars = [...container.querySelectorAll(".star")];
  if (!stars.length) return container.getBoundingClientRect();
  const first = stars[0].getBoundingClientRect();
  const last = stars[stars.length - 1].getBoundingClientRect();
  return {
    left: first.left,
    top: Math.min(...stars.map((star) => star.getBoundingClientRect().top)),
    width: last.right - first.left,
    height: Math.max(...stars.map((star) => star.getBoundingClientRect().bottom)) -
      Math.min(...stars.map((star) => star.getBoundingClientRect().top)),
  };
}

function moveSharedStars(targetSlot, previousRect = null) {
  const stars = $("stars-shared");
  activeStarsMorph?.cancel();
  activeStarsMorph = null;
  targetSlot.append(stars);
  if (!previousRect || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const destination = starsVisualRect(stars);
  const dx = previousRect.left - destination.left;
  const dy = previousRect.top - destination.top;
  const animation = stars.animate([
    { transform: `translate3d(${dx}px, ${dy}px, 0)`, opacity: 1 },
    { transform: "translate3d(0, 0, 0)", opacity: 1 },
  ], {
    duration: 360,
    easing: "cubic-bezier(.22, 1, .36, 1)",
  });
  activeStarsMorph = animation;
  animation.finished.then(() => {
    if (activeStarsMorph === animation) activeStarsMorph = null;
  }, () => {});
}

function syncRateHeader() {
  const searching = document.body.classList.contains("search-active");
  const isEntry = step === 0 && !form.title && !searching;
  $("head-title").textContent = isEntry
    ? "Оценить"
    : editingEntryId && step === 2 ? "Что изменилось?" : STEP_TITLES[step];
  $("head-sub").textContent = `Шаг ${step + 1} из 4`;
  $("head-sub").classList.toggle("hidden", isEntry);
  $("progress").classList.toggle("hidden", isEntry);
}


function showStep(n) {
  const previousStep = step;
  const shouldMoveStars = (previousStep === 1 && n === 2) || (previousStep === 2 && n === 1);
  const previousStarsRect = shouldMoveStars ? starsVisualRect($("stars-shared")) : null;
  step = n;
  for (let i = 0; i <= 3; i++) $("step-" + i).classList.toggle("hidden", i !== n);
  syncRateHeader();
  const segs = $("progress").children;
  for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("on", i <= n);
  $("btn-back").classList.toggle("hidden", n === 0);
  syncAtmosphere();

  const primary = $("btn-primary");
  primary.textContent = editingEntryId && n >= 2
    ? "Обновить запись"
    : n === 0 ? "Оценить фильм" : n === 1 ? "Далее" : n === 2 ? "Записать" : "Сохранить запись";
  primary.classList.toggle("muted", n === 0 && !form.title);
  $("btn-save-empty").classList.toggle("hidden", n !== 3);
  const showRateAction = tab === "rate" && (n > 0 || (n === 0 && !!form.title));
  $("footer-action").classList.toggle("hidden", !showRateAction);
  document.body.classList.toggle("has-action", showRateAction);

  if (n === 1) {
    moveSharedStars($("stars-slot-rating"), previousStarsRect);
    $("rating-mode-label").textContent = editingEntryId ? "Меняешь оценку" : "Оцениваешь";
    $("rating-title").textContent = form.title;
    $("rating-meta").textContent = [form.year, form.genre].filter(Boolean).join(" · ");
    const posterWrap = $("rating-poster-wrap");
    const ratingImage = form.backdrop || form.poster;
    const ratingPreview = form.backdropPreview || form.posterPreview || microPreview(ratingImage, "w300");
    posterWrap.classList.toggle("hidden", !ratingImage);
    if (ratingImage) setBlurPicture(
      posterWrap,
      $("rating-poster-preview"),
      $("rating-poster"),
      ratingPreview,
      ratingImage,
    );
    $("rating-film").classList.remove("poster-enter");
    void $("rating-film").offsetWidth;
    $("rating-film").classList.add("poster-enter");
    updateStars("1");
  }
  if (n === 2) {
    moveSharedStars($("stars-slot-final"), previousStarsRect);
    updateStars("2");
  }
  if (n === 3) {
    $("e-prompt").value = manualPrompt();
    $("e-review").value = form.review || "";
  }
  window.scrollTo(0, 0);
}

// ─── Шаг 1: выбор фильма ─────────────────────────────────────────

function showSearchSuggestions() {
  $("popular").classList.add("hidden");
  $("recommended").classList.add("hidden");
  $("results").classList.remove("hidden");
  const recent = readRecentMovies();
  const suggestions = recent.length ? recent : popularMovies.slice(0, 5);
  $("results").setAttribute("aria-busy", "false");
  if (suggestions.length) {
    renderSearchResults(suggestions);
    $("results").prepend(el("div", "search-section-label", recent.length ? "Недавние" : "Популярное сейчас"));
  } else {
    renderSearchSkeletons();
  }
}

function readRecentMovies() {
  try { return JSON.parse(localStorage.getItem(RECENT_MOVIES_KEY) || "[]").slice(0, 5); }
  catch (_) { return []; }
}

function rememberMovie(movie) {
  const recent = readRecentMovies().filter((item) => Number(item.id) !== Number(movie.id));
  recent.unshift(movie);
  localStorage.setItem(RECENT_MOVIES_KEY, JSON.stringify(recent.slice(0, 5)));
}

function setSearchLoading(loading) {
  $("results").setAttribute("aria-busy", String(loading));
  $("search-spinner").classList.toggle("hidden", !loading);
  $("btn-query-clear").classList.toggle("hidden", loading || !$("f-query").value);
}

function renderSearchSkeletons() {
  $("results").innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const row = el("div", "search-skeleton");
    row.append(el("i", ""), el("span", ""));
    $("results").append(row);
  }
}

function renderSearchResults(movies) {
  renderedSearchMovies = movies;
  $("results").classList.remove("is-changing");
  void $("results").offsetWidth;
  renderMovies($("results"), movies, false);
  $("results").classList.add("is-changing");
}

function renderSearchMessage(title, detail, action = null) {
  $("results").innerHTML = "";
  const state = el("div", "search-state");
  state.append(el("strong", "", title), el("p", "", detail));
  if (action) {
    const button = el("button", "search-state-action", action.label);
    button.type = "button";
    button.addEventListener("click", action.run);
    state.append(button);
  }
  $("results").append(state);
}

function onQueryInput() {
  const q = $("f-query").value.trim();
  $("query-err").classList.add("hidden");
  $("f-query").classList.remove("bad");
  clearTimeout(searchTimer);
  clearTimeout(searchSkeletonTimer);
  if (searchController) searchController.abort();
  $("btn-query-clear").classList.toggle("hidden", !q);
  if (!q) {
    setSearchLoading(false);
    if (document.body.classList.contains("search-active")) showSearchSuggestions();
    else resetSearchView();
    return;
  }
  $("popular").classList.add("hidden");
  $("recommended").classList.add("hidden");
  $("results").classList.remove("hidden");
  if (q.length < 2) {
    setSearchLoading(false);
    renderSearchMessage("Введите ещё 1 символ", "Так результаты будут точнее.");
    return;
  }
  if (SEARCH_CACHE.has(q.toLocaleLowerCase("ru"))) {
    setSearchLoading(false);
    renderSearchResults(SEARCH_CACHE.get(q.toLocaleLowerCase("ru")));
    return;
  }
  setSearchLoading(true);
  if (!renderedSearchMovies.length) {
    searchSkeletonTimer = setTimeout(renderSearchSkeletons, 180);
  }
  searchTimer = setTimeout(() => searchMovies(q), 280);
}

function resetSearchView() {
  clearTimeout(searchTimer);
  clearTimeout(searchSkeletonTimer);
  searchTimer = null;
  if (searchController) searchController.abort();
  searchController = null;
  renderedSearchMovies = [];
  $("results").innerHTML = "";
  $("results").classList.add("hidden");
  $("results").setAttribute("aria-busy", "false");
  setSearchLoading(false);
  $("popular").classList.remove("hidden");
  $("recommended").classList.toggle("hidden", !recommendationsLoaded);
}

function syncSearchViewport() {
  if (!document.body.classList.contains("search-active")) return;
  const viewport = window.visualViewport;
  const inputBottom = document.querySelector(".search-row").getBoundingClientRect().bottom;
  const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const available = Math.max(150, viewportBottom - inputBottom - 12);
  document.documentElement.style.setProperty("--search-results-height", `${available}px`);
}

function setSearchMode(active) {
  clearTimeout(searchBlurTimer);
  const wasActive = document.body.classList.contains("search-active");
  if (active && !wasActive) {
    const viewport = window.visualViewport;
    searchLayoutBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  }
  document.body.classList.toggle("search-active", active);
  $("film-search").classList.toggle("search-focused", active);
  syncRateHeader();
  if (active) {
    if (!$("f-query").value.trim()) showSearchSuggestions();
    requestAnimationFrame(() => {
      syncSearchViewport();
    });
  } else {
    document.documentElement.style.removeProperty("--search-results-height");
    $("results").classList.add("hidden");
    $("popular").classList.remove("hidden");
    $("recommended").classList.toggle("hidden", !recommendationsLoaded);
  }
}

function closeSearchKeyboard() {
  clearTimeout(searchBlurTimer);
  if (document.activeElement === $("f-query")) $("f-query").blur();
  setSearchMode(false);
}

async function tmdb(path, signal) {
  const join = path.includes("?") ? "&" : "?";
  const response = await fetch(`${TMDB_API}${path}${join}api_key=${TMDB_KEY}&language=ru-RU`, { signal });
  if (!response.ok) throw new Error(`TMDB: ${response.status}`);
  return response.json();
}

function yearOf(movie) {
  return (movie.release_date || "").slice(0, 4);
}

function genreOf(movie) {
  const id = (movie.genre_ids || []).find((genreId) => TMDB_GENRES[genreId]);
  return TMDB_GENRES[id] || "Другое";
}

function movieCard(movie, compact = false) {
  const button = el("button", compact ? "movie-card compact popular-card" : "movie-card search-result");
  button.type = "button";
  if (movie.poster_path) {
    button.append(blurPicture(
      tmdbPoster(movie.poster_path, "w92"),
      tmdbPoster(movie.poster_path, compact ? "w342" : "w185"),
      "poster-media",
      compact ? "eager" : "lazy",
    ));
  } else {
    button.append(el("div", "movie-placeholder", "🎬"));
  }
  const info = el("span", "movie-card-info");
  info.append(el("strong", "", movie.title));
  info.append(el("small", "", [yearOf(movie), genreOf(movie)].filter(Boolean).join(" · ")));
  button.append(info);
  button.addEventListener("click", () => selectMovie(movie));
  return button;
}

function renderMovies(container, movies, popular = false) {
  container.innerHTML = "";
  movies.slice(0, popular ? 20 : 10).forEach((movie) => container.append(movieCard(movie, popular)));
}

function renderRecommendations(container, movies) {
  container.innerHTML = "";
  movies.slice(0, 20).forEach((movie) => {
    const card = movieCard(movie, true);
    card.classList.add("recommendation-card");
    container.append(card);
  });
}

function normalizePopularPosition(container) {
  const segment = Number(container.dataset.segmentWidth || 0);
  if (!segment) return;
  if (popularPosition < segment * .5) popularPosition += segment;
  else if (popularPosition >= segment * 1.5) popularPosition -= segment;
  container.scrollLeft = popularPosition;
}

function pausePopularMarquee(duration = 8000) {
  popularPauseUntil = performance.now() + duration;
}

function startPopularMarquee() {
  cancelAnimationFrame(popularAnimationFrame);
  popularLastFrame = 0;
  const container = $("popular-list");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tick = (time) => {
    const delta = popularLastFrame ? Math.min(34, time - popularLastFrame) : 0;
    popularLastFrame = time;
    if (time < popularPauseUntil) popularPosition = container.scrollLeft;
    normalizePopularPosition(container);
    if (time >= popularPauseUntil && !document.hidden && !$("popular").classList.contains("hidden"))
      popularPosition += delta * .018;
    popularAnimationFrame = requestAnimationFrame(tick);
  };
  popularAnimationFrame = requestAnimationFrame(tick);
}

function renderPopularMarquee(movies) {
  const container = $("popular-list");
  container.innerHTML = "";
  const selection = movies.slice(0, 12);
  for (let copy = 0; copy < 3; copy++) {
    selection.forEach((movie) => {
      const card = movieCard(movie, true);
      card.dataset.marqueeCopy = String(copy);
      if (copy !== 1) card.tabIndex = -1;
      container.append(card);
    });
  }
  if (!container.dataset.motionBound) {
    ["pointerdown", "touchstart", "wheel"].forEach((event) =>
      container.addEventListener(event, () => pausePopularMarquee(), { passive: true }));
    container.dataset.motionBound = "true";
  }
  requestAnimationFrame(() => {
    const segment = container.children[selection.length]?.offsetLeft - container.children[0]?.offsetLeft;
    if (!segment) return;
    container.dataset.segmentWidth = String(segment);
    popularPosition = segment;
    container.scrollLeft = segment;
    startPopularMarquee();
  });
}

function normalizeTitle(text) {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return row[b.length];
}

// Если TMDB не понял опечатку, ищем по отдельным словам и их устойчивым префиксам.
async function typoSearch(query, signal) {
  const words = query.split(/\s+/).filter((word) => word.length >= 3);
  const terms = [...new Set(words.flatMap((word) => [word, word.slice(0, Math.max(3, word.length - 3))]))].slice(0, 4);
  const pages = await Promise.all(terms.map((term) =>
    tmdb(`/search/movie?query=${encodeURIComponent(term)}&include_adult=false`, signal)));
  const unique = new Map();
  pages.flatMap((page) => page.results || []).forEach((movie) => unique.set(movie.id, movie));
  const wanted = normalizeTitle(query);
  return [...unique.values()].sort((a, b) =>
    editDistance(wanted, normalizeTitle(a.title)) - editDistance(wanted, normalizeTitle(b.title)));
}

async function searchMovies(query) {
  const controller = new AbortController();
  searchController = controller;
  try {
    const data = await tmdb(`/search/movie?query=${encodeURIComponent(query)}&include_adult=false`, controller.signal);
    if ($("f-query").value.trim() !== query) return;
    let movies = data.results || [];
    let corrected = false;
    if (!movies.length) {
      movies = await typoSearch(query, controller.signal);
      corrected = movies.length > 0;
    }
    if ($("f-query").value.trim() !== query) return;
    clearTimeout(searchSkeletonTimer);
    SEARCH_CACHE.set(query.toLocaleLowerCase("ru"), movies);
    if (movies.length) {
      renderSearchResults(movies);
      if (corrected) $("results").prepend(el("div", "search-section-label", "Возможно, в названии опечатка"));
    } else {
      renderedSearchMovies = [];
      renderSearchMessage(
        "Ничего не найдено",
        `Не удалось найти фильм «${query}». Проверь написание.`,
        { label: "Очистить запрос", run: clearSearchQuery },
      );
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    clearTimeout(searchSkeletonTimer);
    renderSearchMessage(
      "Не удалось выполнить поиск",
      "Проверь подключение и попробуй снова.",
      { label: "Повторить", run: () => searchMovies(query) },
    );
  } finally {
    if (searchController === controller) searchController = null;
    if ($("f-query").value.trim() === query) setSearchLoading(false);
  }
}

function clearSearchQuery() {
  $("f-query").value = "";
  onQueryInput();
  $("f-query").focus();
}

async function loadPopular() {
  try {
    let data = null;
    try {
      const cached = JSON.parse(localStorage.getItem(TRENDING_CACHE_KEY) || "null");
      if (cached && Date.now() - cached.savedAt < DAY_MS) data = cached.data;
    } catch (_) { /* cache miss */ }
    if (!data) {
      data = await tmdb("/trending/movie/day?page=1");
      localStorage.setItem(TRENDING_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    }
    popularMovies = data.results || [];
    renderPopularMarquee(popularMovies);
    popularLoaded = true;
    $("popular").classList.toggle("hidden", !!$("f-query").value.trim());
    if (document.body.classList.contains("search-active") && !$("f-query").value.trim())
      showSearchSuggestions();
  } catch (e) {
    $("popular").classList.add("hidden");
  }
}

async function loadRecommendations() {
  try {
    const films = await store.getAll();
    const genreScores = new Map();
    films.forEach((film) => {
      const weight = Math.max(1, Number(film.quality || 5));
      genreScores.set(film.genre, (genreScores.get(film.genre) || 0) + weight);
    });
    (profile.genres || []).forEach((genre) => genreScores.set(genre, (genreScores.get(genre) || 0) + 6));
    const genres = [...genreScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([genre]) => TMDB_GENRE_IDS[genre])
      .filter(Boolean)
      .slice(0, 3);
    if (!genres.length) {
      $("recommended").classList.add("hidden");
      return;
    }
    const data = await tmdb(`/discover/movie?sort_by=popularity.desc&vote_count.gte=150&with_genres=${genres.join("|")}`);
    const ratedIds = new Set(films.map((film) => Number(film.movieId || film.tmdbId)).filter(Boolean));
    const choices = (data.results || []).filter((movie) => !ratedIds.has(movie.id));
    renderRecommendations($("recommended-list"), choices);
    recommendationsLoaded = choices.length > 0;
    $("recommended").classList.toggle("hidden", !recommendationsLoaded || !!$("f-query").value.trim());
  } catch (_) {
    $("recommended").classList.add("hidden");
  }
}

function applyCatalogMovie(movie) {
  form.title = movie.title;
  form.year = yearOf(movie);
  form.genre = genreOf(movie);
  form.tmdbId = movie.id;
  form.poster = tmdbPoster(movie.poster_path, "w500");
  form.posterPreview = tmdbPoster(movie.poster_path, "w92");
  form.backdrop = movie.backdrop_path
    ? tmdbBackdrop(movie.backdrop_path, "w1280")
    : form.poster;
  form.backdropPreview = movie.backdrop_path
    ? tmdbBackdrop(movie.backdrop_path, "w300")
    : form.posterPreview;
}

async function selectMovie(movie) {
  if (selectingMovie) return;
  selectingMovie = true;
  document.body.classList.add("movie-selecting");
  rememberMovie(movie);
  closeSearchKeyboard();
  try {
    const films = await store.getAll();
    const existing = films.find((film) => Number(film.movieId || film.tmdbId) === Number(movie.id));
    duplicatePendingMovie = existing ? movie : null;
    duplicatePendingEntry = existing || null;
    editingEntryId = null;
    editingOriginalDate = "";
    applyCatalogMovie(movie);
    syncGenreAccent(form.genre);
    haptic("impact", existing ? "medium" : "rigid");
    showSelectedMovie(true);
  } finally {
    selectingMovie = false;
    document.body.classList.remove("movie-selecting");
  }
}

function fillFormFromEntry(film, preserveNotes) {
  const fresh = emptyForm();
  form = {
    ...fresh,
    title: film.title, year: film.year || "", genre: film.genre || GENRES[0],
    tmdbId: film.movieId || film.tmdbId || null,
    poster: film.poster || "", posterPreview: film.posterPreview || "",
    backdrop: film.backdrop || "", backdropPreview: film.backdropPreview || "",
    scores: preserveNotes ? { ...fresh.scores, ...(film.scores || {}) } : { ...fresh.scores },
    personal: preserveNotes ? Number(film.personal || 5) : fresh.personal,
    liked: preserveNotes ? film.liked || "" : "",
    disliked: preserveNotes ? film.disliked || "" : "",
    moment: preserveNotes ? film.moment || "" : "",
    review: preserveNotes ? film.review || "" : "",
  };
  $("f-liked").value = form.liked;
  $("f-disliked").value = form.disliked;
  $("f-moment").value = form.moment;
  $("e-review").value = form.review;
  syncFeelingCards();
  $("sliders").innerHTML = "";
  buildSliders();
  syncGenreAccent(form.genre);
}

function editExistingEntry(film, movie = null) {
  duplicatePendingMovie = null;
  duplicatePendingEntry = null;
  editingEntryId = film.entryId || film.id;
  editingOriginalDate = film.date || "";
  fillFormFromEntry(film, true);
  if (movie) applyCatalogMovie(movie);
  showTab("rate");
  showSelectedMovie(!!form.tmdbId);
  showStep(1);
}

function rerateExistingEntry(film, movie = null) {
  duplicatePendingMovie = null;
  duplicatePendingEntry = null;
  editingEntryId = null;
  editingOriginalDate = "";
  fillFormFromEntry(film, false);
  if (movie) applyCatalogMovie(movie);
  showTab("rate");
  showSelectedMovie(!!form.tmdbId);
  showStep(1);
}

function showSelectedMovie(fromCatalog) {
  closeSearchKeyboard();
  $("f-query").value = "";
  resetSearchView();
  $("hero-title").textContent = form.title;
  $("f-year").value = form.year;
  $("f-genre").value = form.genre;
  $("chip-year").textContent = form.year || "Год не указан";
  $("chip-genre").textContent = form.genre;
  $("hero-chips").classList.toggle("hidden", !fromCatalog);
  document.querySelector(".hero-fields").classList.toggle("hidden", fromCatalog);
  setBlurBackground(
    document.body,
    backdropPreview(form.backdrop, form.poster, form.backdropPreview, form.posterPreview),
    form.backdrop,
    "--hero-preview",
    "--hero-image",
    "hero-image-loaded",
  );
  $("film-search").classList.add("hidden");
  $("film-hero").classList.remove("hidden");
  $("film-hero").classList.toggle("hero-contain", !form.backdrop || form.backdrop === form.poster);
  showStep(0); // обновить герой-фон и кнопку
}

function clearFilm() {
  closeSearchKeyboard();
  duplicatePendingMovie = null;
  duplicatePendingEntry = null;
  editingEntryId = null;
  editingOriginalDate = "";
  form.title = ""; form.year = ""; form.tmdbId = null;
  form.poster = ""; form.posterPreview = ""; form.backdrop = ""; form.backdropPreview = "";
  document.body.classList.remove("hero-image-loaded");
  document.body.style.setProperty("--hero-preview", "none");
  document.body.style.setProperty("--hero-image", "none");
  syncGenreAccent(null);
  $("film-search").classList.remove("hidden");
  $("film-hero").classList.add("hidden");
  $("hero-chips").classList.add("hidden");
  document.querySelector(".hero-fields").classList.remove("hidden");
  resetSearchView();
  showStep(0);
}

// ─── Шаг 2: слайдеры ─────────────────────────────────────────────

function paintSlider(range, color) {
  const min = Number(range.min);
  const max = Number(range.max);
  const value = Number(range.value);
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  range.style.setProperty("--slider-color", color);
  range.style.setProperty("--slider-fill", `${Math.max(0, Math.min(100, pct))}%`);
}

function buildSliders() {
  const box = $("sliders");
  const accent = "var(--genre-accent)", gold = "var(--gold)";

  const make = (name, value, personal, oninput) => {
    const wrap = el("div", "crit" + (personal ? " personal" : ""));
    const top = el("div", "crit-top");
    const label = el("div", "crit-name", name);
    const badge = el("div", "crit-badge", String(value));
    top.append(label, badge);
    const range = document.createElement("input");
    range.type = "range";
    range.className = "sc-slider";
    range.min = "1"; range.max = "10"; range.step = "1";
    range.value = String(value);
    range.setAttribute("aria-label", name);
    const color = personal ? gold : accent;
    paintSlider(range, color);
    range.addEventListener("input", () => {
      const previousFive = toFive(calcQuality(form.scores));
      badge.textContent = range.value;
      paintSlider(range, color);
      oninput(+range.value);
      const nextFive = toFive(calcQuality(form.scores));
      haptic("selection");
      ratingThresholdHaptic(previousFive, nextFive);
      updateStars("1");
    });
    wrap.append(top, range);
    box.append(wrap);
  };

  CRITERIA.forEach((c) =>
    make(c.label, form.scores[c.id], false, (v) => { form.scores[c.id] = v; }));
  make("Личное удовольствие («зашло»)", form.personal, true,
    (v) => { form.personal = v; });
}

// обновить карточку звёзд (suffix "1" — на шаге оценок, "2" — на итоге)
function updateStars(suffix) {
  const q = calcQuality(form.scores);
  const five = toFive(q);
  renderStars($("stars-shared"), five);
  $("stars-" + suffix + "-num").textContent = five + " из 5";
  let tag = verdict(q) + " · " + q.toFixed(1) + "/10";
  if (Math.abs(q - form.personal) >= 2) tag += " · зашло на " + form.personal;
  $("stars-" + suffix + "-tag").textContent = tag;
}

// ─── Главная кнопка ──────────────────────────────────────────────

function primaryAction() {
  if (step === 0) {
    if (!form.title) {
      $("query-err").classList.remove("hidden");
      $("f-query").classList.add("bad");
      return;
    }
    if (!form.tmdbId) {
      form.year = $("f-year").value.trim();
      form.genre = $("f-genre").value;
      syncGenreAccent(form.genre);
    }
    if (duplicatePendingEntry) {
      $("duplicate-dialog").showModal();
      haptic("impact", "medium");
      return;
    }
    haptic("impact", "soft");
    showStep(1);
  } else if (step === 1) {
    haptic("impact", "soft");
    showStep(2);
  } else if (step === 2) {
    form.liked = $("f-liked").value.trim();
    form.disliked = $("f-disliked").value.trim();
    form.moment = $("f-moment").value.trim();
    haptic("impact", "soft");
    showStep(3);
  } else {
    const review = $("e-review").value.trim();
    if (!review) {
      $("entry-err-text").textContent =
        "Вставь текст записи или нажми «Сохранить без записи».";
      $("entry-err").classList.remove("hidden");
      return;
    }
    saveEntry(review);
  }
}

async function saveEntry(review) {
  const entryId = editingEntryId || Date.now();
  const film = {
    id: entryId, entryId,
    title: form.title, year: form.year, genre: form.genre,
    tmdbId: form.tmdbId, movieId: form.tmdbId,
    poster: form.poster, posterPreview: form.posterPreview,
    backdrop: form.backdrop, backdropPreview: form.backdropPreview,
    scores: { ...form.scores },
    quality: calcQuality(form.scores),
    personal: form.personal,
    liked: form.liked, disliked: form.disliked, moment: form.moment,
    review,
    date: editingOriginalDate || new Date().toLocaleDateString("ru-RU"),
  };
  try {
    await store.save(film);
  } catch (e) {
    $("entry-err-text").textContent = "Не сохранилось: " + (e.message || e) + ". Попробуй ещё раз.";
    $("entry-err").classList.remove("hidden");
    return;
  }
  $("entry-err").classList.add("hidden");
  haptic("notification", "success");

  // сброс формы и переход в дневник
  form = emptyForm();
  editingEntryId = null;
  editingOriginalDate = "";
  $("f-query").value = ""; $("f-year").value = ""; $("f-genre").value = GENRES[0];
  $("f-liked").value = ""; $("f-disliked").value = ""; $("f-moment").value = "";
  syncFeelingCards();
  $("e-review").value = "";
  $("sliders").innerHTML = "";
  buildSliders();
  $("film-search").classList.remove("hidden");
  $("film-hero").classList.add("hidden");
  document.body.classList.remove("hero-image-loaded");
  document.body.style.setProperty("--hero-preview", "none");
  document.body.style.setProperty("--hero-image", "none");
  syncGenreAccent(null);
  showStep(0);
  showTab("diary");
}

// ─── Лента: персональные инсайты из дневника ─────────────────────

const GENRE_IN_SENTENCE = {
  "Хоррор": "хоррор", "Триллер": "триллер", "Драма": "драму",
  "Фантастика": "фантастику", "Боевик": "боевик", "Комедия": "комедию",
  "Детектив": "детектив", "Фэнтези": "фэнтези", "Анимация": "анимацию",
  "Документальный": "документальное кино", "Другое": "фильмы этого жанра",
};
const TASTE_WORDS = {
  plot: { high: "сюжет и сценарий", low: "к сюжету и сценарию" },
  chars: { high: "персонажей и актёрскую игру", low: "к персонажам и актёрской игре" },
  visual: { high: "визуал и режиссуру", low: "к визуалу и режиссуре" },
  sound: { high: "звук и музыку", low: "к звуку и музыке" },
  emotion: { high: "эмоциональное воздействие", low: "к эмоциональному воздействию" },
};

function filmTimestamp(film) {
  const id = Number(film.id);
  if (Number.isFinite(id) && id > 946684800000) return id;
  const parts = String(film.date || "").split(".").map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
  }
  return 0;
}

function daysWord(days) {
  const n10 = days % 10, n100 = days % 100;
  const word = n10 === 1 && n100 !== 11 ? "день" :
    n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? "дня" : "дней";
  return `${days} ${word}`;
}

function yearsWord(years) {
  if (years === 1) return "Год";
  const n10 = years % 10, n100 = years % 100;
  const word = n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? "года" : "лет";
  return `${years} ${word}`;
}

function filmsWord(count) {
  const n10 = count % 10, n100 = count % 100;
  if (n10 === 1 && n100 !== 11) return "фильм";
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "фильма";
  return "фильмов";
}

function feedInsights(films) {
  const now = Date.now();
  const insights = [];

  const averages = CRITERIA.map((criterion) => ({
    id: criterion.id,
    average: films.reduce((sum, film) => sum + Number(film.scores?.[criterion.id] || 0), 0) / films.length,
  })).sort((a, b) => b.average - a.average);
  const strongest = averages[0], strictest = averages[averages.length - 1];
  const spread = strongest.average - strictest.average;
  insights.push({
    type: "taste",
    score: 82,
    label: "По твоим оценкам",
    title: "Твой вкус",
    detail: spread < 0.5
      ? "Ты оцениваешь фильмы очень ровно — ни один критерий пока не перевешивает остальные."
      : `Выше всего ты ценишь ${TASTE_WORDS[strongest.id].high}, а строже всего относишься ${TASTE_WORDS[strictest.id].low}.`,
    action: "diary",
    actionLabel: "Посмотреть статистику",
  });

  const genres = new Map();
  films.forEach((film) => {
    if (!filmTimestamp(film)) return;
    const previous = genres.get(film.genre);
    if (!previous || filmTimestamp(film) > filmTimestamp(previous)) genres.set(film.genre, film);
  });
  if (genres.size > 1) {
    const oldestGenre = [...genres.entries()].map(([genre, film]) => ({
      genre, film, days: Math.floor((now - filmTimestamp(film)) / DAY_MS),
    })).sort((a, b) => b.days - a.days)[0];
    if (oldestGenre.days >= 45) insights.push({
      type: "genre",
      score: 88 + Math.min(24, oldestGenre.days / 30),
      genre: oldestGenre.genre,
      label: "Пора вернуться",
      title: `Ты давно не оценивал ${GENRE_IN_SENTENCE[oldestGenre.genre] || oldestGenre.genre.toLowerCase()}`,
      detail: `Последняя запись была ${daysWord(oldestGenre.days)} назад. Может, следующий фильм будет из этого жанра?`,
      action: "rate",
      actionLabel: "Выбрать фильм",
    });
  }

  const anniversaries = films.map((film) => {
    const timestamp = filmTimestamp(film);
    if (!timestamp) return null;
    const days = Math.floor((now - timestamp) / DAY_MS);
    const years = Math.max(1, Math.round(days / 365));
    return { film, days, years, distance: Math.abs(days - years * 365) };
  }).filter((item) => item && item.days >= 320 && item.distance <= 45)
    .sort((a, b) => a.distance - b.distance);
  if (anniversaries.length) {
    const anniversary = anniversaries[0];
    insights.push({
      type: "reminder",
      score: 105 - anniversary.distance / 3,
      genre: anniversary.film.genre,
      film: anniversary.film,
      label: "Вспомнить и сравнить",
      title: `${yearsWord(anniversary.years)} назад ты смотрел «${anniversary.film.title}»`,
      detail: `Тогда ты поставил ${toFive(anniversary.film.quality).toFixed(1)} из 5. Интересно, совпадёт ли оценка сейчас?`,
      action: "rerate",
      actionLabel: "Переоценить фильм",
    });
  }

  const byGenre = new Map();
  films.forEach((film) => {
    if (!byGenre.has(film.genre)) byGenre.set(film.genre, []);
    byGenre.get(film.genre).push(film);
  });
  [...byGenre.entries()].filter(([, entries]) => entries.length >= 3)
    .map(([genre, entries]) => ({
      genre,
      entries,
      best: [...entries].sort((a, b) => b.quality - a.quality)[0],
    }))
    .sort((a, b) => b.entries.length - a.entries.length || b.best.quality - a.best.quality)
    .slice(0, 2)
    .forEach(({ genre, entries, best }) => insights.push({
      type: "best",
      score: 70 + entries.length + best.quality / 10,
      genre,
      film: best,
      label: `${entries.length} ${filmsWord(entries.length)} в жанре`,
      title: `Лучшее у тебя в жанре «${genre}»`,
      detail: `«${best.title}» пока лидирует с оценкой ${toFive(best.quality).toFixed(1)} из 5.`,
      action: "film",
      actionLabel: "Открыть запись",
    }));

  return insights.sort((a, b) => b.score - a.score).slice(0, 5);
}

function feedCard(insight, index) {
  const card = el("button", `feed-card feed-card--${insight.type}`);
  card.type = "button";
  card.style.setProperty("--feed-index", index);
  card.style.setProperty("--feed-accent", insight.genre ? genreColor(insight.genre) : "var(--accent)");

  const copy = el("span", "feed-card-copy");
  copy.append(el("span", "feed-card-label", insight.label));
  copy.append(el("span", "feed-card-title", insight.title));
  copy.append(el("span", "feed-card-detail", insight.detail));
  const action = el("span", "feed-card-action", insight.actionLabel);
  action.append(el("i", "feed-arrow"));
  copy.append(action);
  card.append(copy);

  if (insight.film?.poster) {
    card.append(blurPicture(
      insight.film.posterPreview || microPreview(insight.film.poster, "w92"),
      insight.film.poster,
      "feed-poster",
      index < 2 ? "eager" : "lazy",
    ));
  }

  card.addEventListener("click", () => activateFeedCard(card, insight));
  return card;
}

function activateFeedCard(card, insight) {
  if (card.dataset.busy) return;
  card.dataset.busy = "true";
  card.classList.add("is-nudging");
  haptic("impact", "rigid");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => {
    if (insight.action === "rerate") startReevaluation(insight.film);
    else if (insight.action === "film") openDiaryFilm(insight.film);
    else showTab(insight.action);
    delete card.dataset.busy;
  }, reduced ? 0 : 120);
}

async function openDiaryFilm(film) {
  expandedId = film.id;
  await showTab("diary");
  const item = document.querySelector(`[data-film-id="${film.id}"]`);
  if (item) item.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "center",
  });
}

function startReevaluation(film) {
  rerateExistingEntry(film);
  window.scrollTo({ top: 0, behavior: "auto" });
}

async function renderFeed() {
  const list = $("feed-list");
  list.innerHTML = "";
  let films;
  try {
    films = await store.getAll();
  } catch (e) {
    list.append(el("div", "feed-error", "Не удалось собрать ленту. Попробуй открыть её ещё раз."));
    return;
  }

  if (films.length <= 2) {
    const empty = el("section", "feed-empty");
    empty.append(el("div", "feed-empty-mark", "•••"));
    empty.append(el("h2", "", films.length ? "Лента уже присматривается" : "Здесь появится твоя лента"));
    empty.append(el("p", "", films.length
      ? `Ещё ${3 - films.length} ${films.length === 1 ? "оценки" : "оценка"} — и дневник начнёт замечать твои привычки и любимые жанры.`
      : "Оцени несколько фильмов, и дневник начнёт находить закономерности в твоём вкусе."));
    const cta = el("button", "primary feed-empty-cta", films.length ? "Оценить ещё фильм" : "Оценить первый фильм");
    cta.type = "button";
    cta.addEventListener("click", () => {
      haptic("impact", "rigid");
      showTab("rate");
    });
    empty.append(cta);
    list.append(empty);
    return;
  }

  feedInsights(films).forEach((insight, index) => list.append(feedCard(insight, index)));
}

// ─── Дневник: статистика и записи ────────────────────────────────

async function renderDiary() {
  const list = $("diary-list");
  list.innerHTML = "";
  let films;
  try {
    films = await store.getAll();
  } catch (e) {
    list.append(el("div", "empty", "Не удалось загрузить дневник: " + (e.message || e)));
    return;
  }
  if (!films.length) {
    $("stats").classList.add("hidden");
    $("diary-feature").classList.add("hidden");
    list.append(el("div", "empty", "Дневник пока пуст. Оцени первый фильм на вкладке «Оценить»."));
    return;
  }
  $("stats").classList.remove("hidden");
  renderDiaryFeature(films[0]);
  renderStats(films);
  films.forEach((f) => list.append(filmItem(f)));
}

function renderDiaryFeature(film) {
  const box = $("diary-feature");
  box.innerHTML = "";
  box.style.setProperty("--film-accent", genreColor(film.genre));
  const featureBackdrop = originalBackdrop(film.backdrop, "w1280");
  const featurePreview = originalBackdrop(film.backdropPreview || film.backdrop, "w300");
  setBlurBackground(
    box,
    featurePreview || backdropPreview(film.backdrop, film.poster, film.backdropPreview, film.posterPreview),
    featureBackdrop || film.backdrop,
    "--feature-preview",
    "--feature-image",
    "is-image-loaded",
  );
  const copy = el("div", "diary-feature-copy");
  copy.append(el("span", "", "Последнее"));
  copy.append(el("h2", "", film.title));
  copy.append(el("div", "diary-feature-stars", starsText(film.quality)));
  copy.append(el("p", "", `${toFive(film.quality).toFixed(1)} из 5 · ${film.genre}`));
  box.append(copy);
  box.classList.remove("hidden");
}

function renderStats(films) {
  // плашки: сколько фильмов, средняя оценка (по 5-балльной), любимый жанр
  $("st-total").textContent = films.length;
  $("diary-praise").textContent = films.length <= 4
    ? "Начало положено!"
    : films.length <= 14
      ? `Ты оценил ${films.length} ${filmsWord(films.length)}. Отличная работа, критик!`
      : films.length <= 29
        ? `${films.length} ${filmsWord(films.length)} в дневнике — уже целая коллекция`
        : `${films.length} ${filmsWord(films.length)}. Ты знаешь толк в кино`;
  const avg = films.reduce((s, f) => s + toFive(f.quality), 0) / films.length;
  $("st-avg").textContent = (Math.round(avg * 10) / 10).toFixed(1);

  const byGenre = {};
  films.forEach((f) => { byGenre[f.genre] = (byGenre[f.genre] || 0) + 1; });
  const sorted = Object.entries(byGenre).sort((a, b) => b[1] - a[1]);
  $("st-genre").textContent = sorted[0][0];

  // распределение по звёздам 1–5
  const dist = $("dist");
  dist.innerHTML = "";
  const counts = [1, 2, 3, 4, 5].map(
    (star) => films.filter((f) => Math.round(toFive(f.quality)) === star).length);
  const maxCount = Math.max(1, ...counts);
  counts.forEach((c, i) => {
    const col = el("div", "dist-col");
    const bar = el("div", "dist-bar");
    bar.style.height = Math.max(4, (c / maxCount) * 100) + "%";
    col.append(bar, el("div", "dist-label", String(i + 1)));
    dist.append(col);
  });

  // топ-3 жанров
  const gb = $("genre-bars");
  gb.innerHTML = "";
  const maxGenre = sorted[0][1];
  sorted.slice(0, 3).forEach(([name, count]) => {
    const row = el("div");
    const top = el("div", "gb-top");
    top.append(el("div", "gb-name", name), el("div", "gb-count", String(count)));
    const track = el("div", "gb-track");
    const fill = el("div", "gb-fill");
    fill.style.width = (count / maxGenre) * 100 + "%";
    fill.style.backgroundColor = genreColor(name);
    track.append(fill);
    row.append(top, track);
    gb.append(row);
  });
}

function filmItem(f) {
  const item = el("div", "film");
  item.dataset.filmId = f.id;
  item.style.setProperty("--film-accent", genreColor(f.genre));
  const top = el("div", "film-top");
  const poster = f.poster
    ? blurPicture(f.posterPreview || microPreview(f.poster, "w92"), f.poster, "poster")
    : el("div", "poster", "🎬");
  top.append(poster);
  const info = el("div", "film-info");
  info.append(el("div", "film-title", f.title + (f.year ? ` (${f.year})` : "")));
  info.append(el("div", "film-meta", `${f.genre} · ${f.date}`));
  top.append(info);
  top.append(el("div", "film-score", "★ " + toFive(f.quality).toFixed(1)));
  top.addEventListener("click", () => {
    expandedId = expandedId === f.id ? null : f.id;
    renderDiary();
  });
  item.append(top);

  if (expandedId === f.id) {
    const detail = el("div", "film-detail");
    detail.append(el("div", "film-crit",
      CRITERIA.map((c) => `${c.label}: ${f.scores[c.id]}`).join(" · ") +
      ` · качество ${f.quality.toFixed(1)}/10 · зашло на ${f.personal}`));
    if (f.review) detail.append(el("div", "film-review", f.review));

    const actions = el("div", "film-actions");
    const exp = el("button", "linkbtn", "Экспорт текстом");
    exp.addEventListener("click", async () => {
      const text = `«${f.title}»${f.year ? ` (${f.year})` : ""}\n` +
        `${starsText(f.quality)} ${toFive(f.quality)}/5 · качество ${f.quality.toFixed(1)}/10 · зашло ${f.personal}/10` +
        (f.review ? `\n\n${f.review}` : "");
      exp.textContent = (await copyText(text)) ? "Скопировано ✓" : "Не удалось скопировать";
      setTimeout(() => { exp.textContent = "Экспорт текстом"; }, 2000);
    });
    const del = el("button", "linkbtn danger", "Удалить");
    del.addEventListener("click", async () => {
      if (!(await confirmAsk(`Удалить запись «${f.title}»?`))) return;
      await store.remove(f.id);
      expandedId = null;
      renderDiary();
    });
    actions.append(exp, del);
    detail.append(actions);
    item.append(detail);
  }
  return item;
}

// ─── Поля итогов, профиль и первый запуск ───────────────────────

function syncFeelingCards() {
  document.querySelectorAll(".feeling-card").forEach((card) => {
    const textarea = card.querySelector("textarea");
    card.classList.toggle("has-value", !!textarea.value.trim());
  });
}

function telegramUser() {
  return tg?.initDataUnsafe?.user || {};
}

function profileName() {
  const user = telegramUser();
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || profile.name || "Киноман";
}

function profileAvatar() {
  return telegramUser().photo_url || "";
}

function syncProfileAvatar() {
  const name = profileName();
  const initial = name.trim().charAt(0).toUpperCase() || "К";
  const avatar = profileAvatar();
  $("profile-avatar-fallback").textContent = initial;
  $("profile-avatar-image").classList.toggle("hidden", !avatar);
  if (avatar) {
    $("profile-avatar-image").src = avatar;
  } else {
    $("profile-avatar-image").removeAttribute("src");
  }
}

async function renderProfile() {
  $("profile-name").value = profileName();
  $("profile-bio").value = profile.bio || "";
  profileDraftFavorites = [...(profile.favorites || [])].map(String);
  $("profile-bio-count").textContent = $("profile-bio").value.length;
  syncProfileAvatar();
  await renderProfileFavorites();
  profileBaseline = profileDraftSnapshot();
  syncProfileDirty();
  window.scrollTo(0, 0);
}

function profileDraftSnapshot() {
  return JSON.stringify({
    bio: $("profile-bio").value.trim(),
    favorites: [...profileDraftFavorites].sort(),
  });
}

function syncProfileDirty() {
  const dirty = !!profileBaseline && profileDraftSnapshot() !== profileBaseline;
  $("btn-profile-save").classList.toggle("hidden", !dirty);
  $("btn-profile-save").disabled = !dirty;
}

async function renderProfileFavorites() {
  const grid = $("profile-favorites");
  grid.innerHTML = "";
  const films = await store.getAll();
  const selected = new Set(profileDraftFavorites);
  const favoriteFilms = films.filter((film) => selected.has(String(film.entryId || film.id))).slice(0, 4);
  favoriteFilms.forEach((film) => {
    const id = String(film.entryId || film.id);
    const button = el("button", "favorite-option");
    button.type = "button";
    button.dataset.entryId = id;
    button.classList.add("is-selected");
    if (film.poster) button.append(blurPicture(film.posterPreview, film.poster, "favorite-poster", "lazy"));
    else button.append(el("span", "favorite-poster favorite-placeholder", "🎬"));
    button.append(el("strong", "", film.title));
    button.append(el("i", "favorite-check", "✓"));
    button.addEventListener("click", openFavoritesPicker);
    grid.append(button);
  });
  for (let i = favoriteFilms.length; i < 4; i++) {
    const empty = el("button", "favorite-empty");
    empty.type = "button";
    empty.append(el("span", "", "+"), el("small", "", "Добавить любимый фильм"));
    empty.addEventListener("click", openFavoritesPicker);
    grid.append(empty);
  }
  grid.classList.toggle("is-empty", !films.length);
}

async function openFavoritesPicker() {
  const list = $("favorites-picker-list");
  list.innerHTML = "";
  const films = await store.getAll();
  const availableIds = new Set(films.map((film) => String(film.entryId || film.id)));
  const selected = new Set(profileDraftFavorites.filter((id) => availableIds.has(id)));
  profileDraftFavorites = [...selected];
  films.forEach((film) => {
    const id = String(film.entryId || film.id);
    const item = el("label", "favorites-picker-item");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(id);
    checkbox.setAttribute("aria-label", film.title);
    item.classList.toggle("is-selected", checkbox.checked);
    item.append(checkbox);
    if (film.poster) item.append(blurPicture(film.posterPreview, film.poster, "picker-poster", "lazy"));
    item.append(el("span", "", film.title), el("i", "", checkbox.checked ? "✓" : "+"));
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && selected.size >= 4) {
        checkbox.checked = false;
        haptic("notification", "warning");
        return;
      }
      if (checkbox.checked) selected.add(id);
      else selected.delete(id);
      item.classList.toggle("is-selected", checkbox.checked);
      item.querySelector("i").textContent = checkbox.checked ? "✓" : "+";
      profileDraftFavorites = [...selected];
      syncProfileDirty();
      haptic("selection");
    });
    list.append(item);
  });
  if (!$("favorites-dialog").open) $("favorites-dialog").showModal();
}

async function saveProfileFromForm() {
  profile = {
    ...profile,
    bio: $("profile-bio").value.trim(),
    favorites: [...profileDraftFavorites],
  };
  await saveProfileData(profile);
  syncProfileAvatar();
  haptic("notification", "success");
  const button = $("btn-profile-save");
  button.textContent = "Сохранено ✓";
  profileBaseline = profileDraftSnapshot();
  setTimeout(() => {
    button.textContent = "Сохранить профиль";
    syncProfileDirty();
  }, 650);
}

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const ctx = canvas.getContext("2d");
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const sx = (image.naturalWidth - side) / 2;
      const sy = (image.naturalHeight - side) / 2;
      ctx.drawImage(image, sx, sy, side, side, 0, 0, 160, 160);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    image.onerror = reject;
    image.src = url;
  });
}

const GENRE_ICONS = {
  "Хоррор": "☾", "Триллер": "⌁", "Драма": "◐", "Фантастика": "✦",
  "Боевик": "⚡", "Комедия": "☺", "Детектив": "⌕", "Фэнтези": "◇",
  "Анимация": "✿", "Документальный": "▣", "Другое": "•••",
};

function buildOnboarding() {
  const box = $("onboarding-genres");
  box.innerHTML = "";
  GENRES.filter((genre) => genre !== "Другое").forEach((genre) => {
    const chip = el("button", "genre-chip", `${GENRE_ICONS[genre]} ${genre}`);
    chip.type = "button";
    chip.addEventListener("click", () => {
      if (selectedOnboardingGenres.has(genre)) selectedOnboardingGenres.delete(genre);
      else selectedOnboardingGenres.add(genre);
      chip.classList.toggle("is-selected", selectedOnboardingGenres.has(genre));
      haptic("selection");
    });
    box.append(chip);
  });
}

function showOnboarding() {
  buildOnboarding();
  $("onboarding-step-1").classList.remove("hidden");
  $("onboarding-step-2").classList.add("hidden");
  $("onboarding").classList.remove("hidden");
  document.body.classList.add("modal-open");
}

async function finishOnboarding() {
  profile = {
    ...profile,
    onboarded: true,
    genres: [...selectedOnboardingGenres],
    frequency: selectedFrequency,
    name: profileName(),
  };
  await saveProfileData(profile);
  $("onboarding").classList.add("hidden");
  document.body.classList.remove("modal-open");
  syncProfileAvatar();
  recommendationsLoaded = false;
  loadRecommendations();
  haptic("notification", "success");
}

// ─── Запуск ──────────────────────────────────────────────────────
const PULL_REFRESH_THRESHOLD = 62;
let pullStartY = 0;
let pullCurrent = 0;
let pullTracking = false;
let pullRefreshing = false;
let pullMouseTracking = false;
let touchGuardStartY = 0;

function rubberbandPull(distance) {
  const dimension = Math.max(480, window.innerHeight);
  const constant = .46;
  return (distance * dimension * constant) / (dimension + constant * Math.abs(distance));
}

function canStartPull(target) {
  if (pullRefreshing || tab === "rate" || window.scrollY > 0) return false;
  if (document.body.classList.contains("modal-open") || document.body.classList.contains("search-active")) return false;
  return !target.closest("input, textarea, select, dialog, .overlay");
}

function setPullDistance(distance) {
  pullCurrent = Math.max(0, distance);
  document.body.style.setProperty("--pull-distance", `${pullCurrent.toFixed(2)}px`);
  document.body.classList.toggle("pull-active", pullCurrent > 0);
  document.body.classList.toggle("pull-armed", pullCurrent >= PULL_REFRESH_THRESHOLD);
}

function beginPull(clientY, target) {
  if (!canStartPull(target)) return;
  pullStartY = clientY;
  pullTracking = true;
  document.body.classList.remove("pull-settling");
}

function movePull(clientY) {
  if (!pullTracking) return false;
  const delta = clientY - pullStartY;
  if (delta <= 0) {
    setPullDistance(0);
    return false;
  }
  setPullDistance(rubberbandPull(delta));
  return pullCurrent > 3;
}

async function refreshVisibleTab() {
  if (tab === "feed") await renderFeed();
  else if (tab === "diary") await renderDiary();
  else if (tab === "profile") {
    syncProfileAvatar();
    await renderProfileFavorites();
  }
}

async function finishPull() {
  if (!pullTracking) return;
  pullTracking = false;
  const shouldRefresh = pullCurrent >= PULL_REFRESH_THRESHOLD;
  if (!shouldRefresh) {
    document.body.classList.add("pull-settling");
    setPullDistance(0);
    setTimeout(() => document.body.classList.remove("pull-settling"), 420);
    return;
  }

  pullRefreshing = true;
  document.body.classList.remove("pull-armed");
  document.body.classList.add("pull-refreshing", "pull-settling");
  setPullDistance(52);
  haptic("impact", "medium");
  try {
    await refreshVisibleTab();
    haptic("notification", "success");
  } finally {
    pullRefreshing = false;
    setPullDistance(0);
    setTimeout(() => {
      document.body.classList.remove("pull-refreshing", "pull-settling", "pull-active", "pull-armed");
    }, 420);
  }
}

document.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 1) return;
  touchGuardStartY = event.touches[0].clientY;
  beginPull(event.touches[0].clientY, event.target);
}, { passive: true });
document.addEventListener("touchmove", (event) => {
  if (event.touches.length !== 1) return;
  const clientY = event.touches[0].clientY;
  const innerScroller = event.target.closest("#results, .overlay, dialog");
  const innerCanMove = innerScroller && innerScroller.scrollTop > 0;
  const blocksTelegramCollapse = window.scrollY <= 0 && clientY - touchGuardStartY > 4 && !innerCanMove;
  if (movePull(clientY) || blocksTelegramCollapse) event.preventDefault();
}, { passive: false });
document.addEventListener("touchend", finishPull, { passive: true });
document.addEventListener("touchcancel", finishPull, { passive: true });

document.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  pullMouseTracking = true;
  beginPull(event.clientY, event.target);
});
document.addEventListener("mousemove", (event) => {
  if (!pullMouseTracking) return;
  if (movePull(event.clientY)) event.preventDefault();
});
document.addEventListener("mouseup", () => {
  if (!pullMouseTracking) return;
  pullMouseTracking = false;
  finishPull();
});


GENRES.forEach((g) => $("f-genre").append(new Option(g, g)));
buildSliders();

$("f-query").addEventListener("input", onQueryInput);
$("f-query").addEventListener("focus", () => setSearchMode(true));
$("btn-query-clear").addEventListener("click", clearSearchQuery);
$("btn-search-cancel").addEventListener("click", () => {
  $("f-query").value = "";
  closeSearchKeyboard();
  resetSearchView();
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncSearchViewport);
  window.visualViewport.addEventListener("scroll", syncSearchViewport);
}
$("btn-clear").addEventListener("click", clearFilm);
$("btn-hero-primary").addEventListener("click", () => $("btn-primary").click());
$("btn-close-rate").addEventListener("click", () => {
  closeSearchKeyboard();
  haptic("impact", "soft");
  showTab(rateReturnTab === "rate" ? "feed" : rateReturnTab);
});
$("btn-back").addEventListener("click", () => {
  haptic("impact", "soft");
  if (step === 1) clearFilm();
  else showStep(step - 1);
});
$("search-scrim").addEventListener("click", () => {
  $("f-query").value = "";
  closeSearchKeyboard();
  resetSearchView();
});
$("btn-primary").addEventListener("click", primaryAction);
$("btn-save-empty").addEventListener("click", () => saveEntry(""));

$("btn-copy").addEventListener("click", async () => {
  const ok = await copyText($("e-prompt").value);
  $("btn-copy").textContent = ok ? "Скопировано ✓" : "Не удалось — выдели текст вручную";
  setTimeout(() => { $("btn-copy").textContent = "Скопировать промпт"; }, 2000);
});

$("tab-rate").addEventListener("click", () => {
  if (tab !== "rate") haptic("selection");
  showTab("rate");
});
$("tab-feed").addEventListener("click", () => {
  if (tab !== "feed") haptic("selection");
  showTab("feed");
});
$("tab-diary").addEventListener("click", () => {
  if (tab !== "diary") haptic("selection");
  showTab("diary");
});
$("tab-profile").addEventListener("click", () => {
  if (tab !== "profile") haptic("selection");
  showTab("profile");
});
$("f-genre").addEventListener("change", () => syncGenreAccent($("f-genre").value));

["f-liked", "f-disliked", "f-moment"].forEach((id) => {
  $(id).addEventListener("input", syncFeelingCards);
});
document.addEventListener("pointerdown", (event) => {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
  if (event.target === active || event.target.closest("label")) return;
  active.blur();
});

$("btn-edit-existing").addEventListener("click", () => {
  $("duplicate-dialog").close();
  if (duplicatePendingEntry) editExistingEntry(duplicatePendingEntry, duplicatePendingMovie);
});
$("btn-rerate-existing").addEventListener("click", () => {
  $("duplicate-dialog").close();
  if (duplicatePendingEntry) rerateExistingEntry(duplicatePendingEntry, duplicatePendingMovie);
});
$("btn-cancel-duplicate").addEventListener("click", () => $("duplicate-dialog").close());
$("btn-favorites-done").addEventListener("click", async () => {
  $("favorites-dialog").close();
  await renderProfileFavorites();
  syncProfileDirty();
});

$("btn-profile-save").addEventListener("click", saveProfileFromForm);
$("profile-bio").addEventListener("input", () => {
  $("profile-bio-count").textContent = $("profile-bio").value.length;
  syncProfileDirty();
});
$("btn-onboarding-next").addEventListener("click", () => {
  if (!selectedOnboardingGenres.size) {
    $("onboarding-genres").classList.add("needs-choice");
    haptic("notification", "warning");
    return;
  }
  $("onboarding-step-1").classList.add("hidden");
  $("onboarding-step-2").classList.remove("hidden");
});
document.querySelectorAll("#onboarding-frequency button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedFrequency = button.dataset.frequency;
    document.querySelectorAll("#onboarding-frequency button").forEach((item) =>
      item.classList.toggle("is-selected", item === button));
    haptic("selection");
  });
});
$("btn-onboarding-finish").addEventListener("click", () => {
  if (!selectedFrequency) {
    $("onboarding-frequency").classList.add("needs-choice");
    haptic("notification", "warning");
    return;
  }
  finishOnboarding();
});

if (!inTelegram) $("storage-note").classList.remove("hidden");

async function initApp() {
  const resetResult = await applyResetRequest();
  profile = await loadProfile();
  selectedOnboardingGenres = new Set(profile.genres || []);
  selectedFrequency = profile.frequency || "";
  syncProfileAvatar();
  syncFeelingCards();
  showStep(0);
  await showTab("feed");
  if (!profile.onboarded) showOnboarding();
  if (resetResult) showResetNotice(resetResult);
}

initApp();
