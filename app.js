// SYO — логика Telegram Mini App для личного пространства о кино.
// Оценка проходит в 4 шага: фильм → оценки → итог с заметками → запись.
// Хранение: облако Telegram (CloudStorage); вне Telegram — localStorage.

"use strict";

// ─── Telegram WebApp ─────────────────────────────────────────────

const tg = window.Telegram ? window.Telegram.WebApp : null;
// initData не пустой только внутри настоящего Telegram
const inTelegram = !!(tg && tg.initData);
let fullscreenUnavailable = false;

document.documentElement.classList.toggle("is-telegram", inTelegram);

function syncTelegramModeClass() {
  document.documentElement.classList.toggle(
    "is-telegram-fullscreen",
    inTelegram && !!tg?.isFullscreen,
  );
}

syncTelegramModeClass();

function lockTelegramVerticalSwipes() {
  if (!inTelegram || !tg || typeof tg.disableVerticalSwipes !== "function") return;
  try { tg.disableVerticalSwipes(); } catch (_) { /* старый клиент */ }
}

function requestAppFullscreen() {
  if (!inTelegram || !tg) return;

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
  if (inTelegram) {
    try {
      if (typeof tg.setHeaderColor === "function") tg.setHeaderColor("#060607");
      if (typeof tg.setBackgroundColor === "function") tg.setBackgroundColor("#060607");
      if (typeof tg.setBottomBarColor === "function") tg.setBottomBarColor("#060607");
    } catch (_) { /* старый клиент Telegram оставит системные цвета */ }
  }
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
  syncTelegramModeClass();
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
  {
    id: "plot",
    label: "Сюжет и сценарий",
    prompt: "Насколько история удерживала тебя?",
    anchors: ["Рассыпался", "Держал до конца"],
    feelings: ["Не сложился", "Буксовал", "Ровно", "Удерживал", "Затянул", "Не отпускал"],
  },
  {
    id: "chars",
    label: "Персонажи и игра",
    prompt: "Получилось ли поверить героям?",
    anchors: ["Не поверил", "Жил вместе с ними"],
    feelings: ["Не поверил", "Было условно", "Убедительно", "Близко", "Очень живо", "Полное попадание"],
  },
  {
    id: "visual",
    label: "Визуал и режиссура",
    prompt: "Как фильм работал через изображение?",
    anchors: ["Обычный", "Завораживающий"],
    feelings: ["Не цеплял", "Блекло", "Аккуратно", "Выразительно", "Завораживал", "Каждый кадр"],
  },
  {
    id: "sound",
    label: "Звук и музыка",
    prompt: "Что происходило со звуком и музыкой?",
    anchors: ["Не заметил", "Пробирал"],
    feelings: ["Мешал", "Терялся", "На месте", "Работал", "Пробирал", "Остался со мной"],
  },
  {
    id: "emotion",
    label: "Эмоциональное воздействие",
    prompt: "Что осталось после финальных титров?",
    anchors: ["Ничего не осталось", "Не отпускает"],
    feelings: ["Ничего", "Едва задело", "Спокойно", "Задело", "Не отпускает", "Осталось внутри"],
  },
];

const PERSONAL_CRITERION = {
  id: "personal",
  label: "Насколько тебе зашло?",
  prompt: "Насколько фильм оказался именно твоим?",
  anchors: ["Совсем не моё", "Попал точно в меня"],
  feelings: ["Не моё", "Скорее мимо", "Нейтрально", "Моё", "Очень моё", "Точно в меня"],
};

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

function movieStorageIdentity(film) {
  const movieId = Number(film?.movieId || film?.tmdbId);
  if (movieId) return `tmdb:${movieId}`;
  const title = normalizeTitle(String(film?.title || ""));
  return title ? `manual:${title}:${String(film?.year || "")}` : "";
}

function uniqueLatestFilms(films) {
  const seen = new Set();
  return films.filter((film) => {
    const identity = movieStorageIdentity(film);
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

const store = {
  async getAll({ includeDuplicates = false } = {}) {
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
    const sorted = films.sort((a, b) => b.entryId - a.entryId); // новые сверху
    if (includeDuplicates) return sorted;
    return uniqueLatestFilms(sorted);
  },
  async save(film) {
    const entryId = film.entryId || film.id;
    const k = "film_" + entryId, v = JSON.stringify({ ...film, id: entryId, entryId });
    if (useCloud) await cloud.set(k, v);
    else localStorage.setItem(k, v);

    const identity = movieStorageIdentity(film);
    if (!identity) return;
    try {
      const copies = await this.getAll({ includeDuplicates: true });
      await Promise.all(copies
        .filter((copy) => movieStorageIdentity(copy) === identity &&
          String(copy.entryId || copy.id) !== String(entryId))
        .map((copy) => this.remove(copy.entryId || copy.id)));
    } catch (_) { /* новая запись уже сохранена; старую копию просто скроет getAll */ }
  },
  async remove(id) {
    const k = "film_" + id;
    if (useCloud) await cloud.remove(k);
    else localStorage.removeItem(k);
  },
  async removeFilm(film) {
    const identity = movieStorageIdentity(film);
    if (!identity) return this.remove(film.entryId || film.id);
    const copies = await this.getAll({ includeDuplicates: true });
    await Promise.all(copies
      .filter((copy) => movieStorageIdentity(copy) === identity)
      .map((copy) => this.remove(copy.entryId || copy.id)));
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

function normalizeStoredFeedFact(value) {
  if (!value || typeof value !== "object") return null;
  const insight = typeof value.insight === "string" ? value.insight.trim() : "";
  if (!insight || insight.length > 600) return null;
  return {
    id: Number(value.id || value.generatedAt) || Date.now(),
    insight,
    reason: typeof value.reason === "string" ? value.reason.trim().slice(0, 260) : "",
    sourceTitle: typeof value.sourceTitle === "string" ? value.sourceTitle.trim().slice(0, 140) : "",
    sourceDirector: typeof value.sourceDirector === "string" ? value.sourceDirector.trim().slice(0, 100) : "",
    sourceMovieId: Number(value.sourceMovieId) || 0,
    posterTitle: typeof value.posterTitle === "string" ? value.posterTitle.trim().slice(0, 140) : "",
    posterMovieId: Number(value.posterMovieId) || 0,
    poster: typeof value.poster === "string" ? value.poster.trim().slice(0, 240) : "",
    posterPreview: typeof value.posterPreview === "string" ? value.posterPreview.trim().slice(0, 240) : "",
    generatedAt: Number(value.generatedAt) || Date.now(),
    filmsCount: Number(value.filmsCount) || 0,
    lastFilmId: String(value.lastFilmId || ""),
  };
}

async function loadFeedFacts() {
  let raw = "";
  try {
    if (useCloud) raw = (await cloud.getItems([AI_FEED_KEY]))[AI_FEED_KEY] || "";
    else raw = localStorage.getItem(AI_FEED_KEY) || "";
    if (!raw) return [];
    const saved = JSON.parse(raw);
    const values = Array.isArray(saved?.facts) ? saved.facts : saved?.insight ? [saved] : [];
    return values.map(normalizeStoredFeedFact).filter(Boolean)
      .sort((a, b) => b.generatedAt - a.generatedAt)
      .slice(0, MAX_FEED_FACTS);
  } catch (_) {
    return [];
  }
}

async function saveFeedFacts(values) {
  const facts = values.map(normalizeStoredFeedFact).filter(Boolean)
    .sort((a, b) => b.generatedAt - a.generatedAt)
    .slice(0, MAX_FEED_FACTS);
  let raw = JSON.stringify({ facts });
  while (raw.length > FEED_FACTS_STORAGE_LIMIT && facts.length > 1) {
    facts.pop();
    raw = JSON.stringify({ facts });
  }
  if (useCloud) await cloud.set(AI_FEED_KEY, raw);
  else localStorage.setItem(AI_FEED_KEY, raw);
}

async function applyResetRequest() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("reset") !== "1") return null;

  try {
    const removed = await store.clearAll();
    await saveFeedFacts([]);
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
  tmdbId: null, poster: "", posterPreview: "", backdrop: "", backdropPreview: "", overview: "",
  runtime: 0, director: "", tmdbRating: 0, tmdbVoteCount: 0,
  scores: { plot: 5, chars: 5, visual: 5, sound: 5, emotion: 5 },
  personal: 5,
  liked: "", disliked: "", moment: "",
  review: "",
});

let form = emptyForm();
let tab = "diary";  // "rate" | "feed" | "diary" | "profile"
let step = 0;       // 0 фильм · 1 оценки · 2 итог · 3 запись
let expandedId = null;
let searchTimer = null;
let searchController = null;
let searchBlurTimer = null;
let searchSkeletonTimer = null;
let renderedSearchMovies = [];
let selectingMovie = false;
let rateReturnTab = "diary";
let profileBaseline = "";
let layoutViewportHeight = Math.max(
  window.innerHeight,
  window.visualViewport?.height || 0,
  Number(tg?.viewportStableHeight || 0),
);
let viewportSyncFrame = 0;
let rateScrollResetFrame = 0;
let rateScrollResetTimer = 0;
let popularLoaded = false;
let recommendationsLoaded = false;
let recommendationPage = 1;
let popularMovies = [];
let popularAnimationFrame = 0;
let popularPosition = 0;
let activeStarsMorph = null;
let editingEntryId = null;
let editingOriginalDate = "";
let duplicatePendingMovie = null;
let duplicatePendingEntry = null;
let profile = {};
let profileReturnTab = "diary";
let profileDraftFavorites = [];
let selectedOnboardingGenres = new Set();
let selectedFrequency = "";
let reviewMode = "self";
let ratingCriterionIndex = 0;
let ratingConfirmed = new Set();
let lastSavedEntryId = null;
let diaryView = "history";

const STEP_TITLES = ["Фильм", "Оценка", "Впечатления", "Запись"];
const TAB_INDEX = { diary: 0, feed: 1, profile: 2, rate: 3 };
const SEARCH_CACHE = new Map();
const MOVIE_DETAILS_CACHE = new Map();
const DIRECTOR_MOVIES_CACHE = new Map();
const RECENT_MOVIES_KEY = "kino_recent_movies_v1";
const REVIEW_DRAFT_KEY = "kino_review_draft_v1";
const AI_FEED_KEY = "kino_ai_feed_v2";
const MAX_FEED_FACTS = 6;
const FEED_FACTS_STORAGE_LIMIT = 3900;
const AI_MIN_DRAFT_CHARS = 20;
const AI_REVIEW_ENDPOINT = String(
  document.querySelector('meta[name="kino-ai-endpoint"]')?.content || ""
).trim();
const AI_FEED_ENDPOINT = String(
  document.querySelector('meta[name="kino-ai-feed-endpoint"]')?.content || ""
).trim();
let geminiRequestController = null;
let aiFeedRequestController = null;
let feedRenderRevision = 0;
let overviewDisclosureFrame = 0;
let overviewExpanded = false;
let heroParallaxFrame = 0;
let heroShadeRevealFrame = 0;
let heroInterfaceRevealTimer = 0;

// ─── Черновик рецензии и Gemini ─────────────────────────────────

function reviewFilmKey() {
  return form.tmdbId ? `tmdb_${form.tmdbId}` : `${form.title.trim().toLocaleLowerCase("ru")}_${form.year}`;
}

function readReviewWorkspace() {
  try { return JSON.parse(localStorage.getItem(REVIEW_DRAFT_KEY) || "null"); }
  catch (_) { return null; }
}

function persistReviewWorkspace() {
  if (!form.title || (step !== 2 && step !== 3)) return;
  try {
    localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({
      filmKey: reviewFilmKey(),
      mode: reviewMode,
      liked: $("f-liked").value,
      disliked: $("f-disliked").value,
      moment: $("f-moment").value,
      editorText: $("e-review").value,
      updatedAt: Date.now(),
    }));
  } catch (_) { /* черновик — дополнительная страховка */ }
}

function clearReviewWorkspace() {
  try { localStorage.removeItem(REVIEW_DRAFT_KEY); }
  catch (_) { /* localStorage может быть недоступен */ }
}

function meaningfulDraftLength(value) {
  return value.replace(/\s/g, "").length;
}

function captureNotes() {
  form.liked = $("f-liked").value.trim();
  form.disliked = $("f-disliked").value.trim();
  form.moment = $("f-moment").value.trim();
}

function reviewDraftText() {
  return [
    form.liked ? `Понравилось: ${form.liked}` : "",
    form.disliked ? `Не понравилось: ${form.disliked}` : "",
    form.moment ? `Запомнилось: ${form.moment}` : "",
  ].filter(Boolean).join("\n");
}

function syncReviewChoiceState() {
  captureNotes();
  const draft = reviewDraftText();
  const meaningfulLength = meaningfulDraftLength(draft);
  const remaining = Math.max(0, AI_MIN_DRAFT_CHARS - meaningfulLength);
  $("btn-notes-ai").disabled = remaining > 0 || !!geminiRequestController;
  $("ai-draft-hint").textContent = remaining
    ? "Добавь ещё пару мыслей, чтобы помощник смог связать их в текст."
    : "Можно сохранить заметки как есть или попросить помочь с формулировкой.";
}

function prepareNotesWorkspace() {
  const saved = readReviewWorkspace();
  if (saved?.filmKey === reviewFilmKey()) {
    form.liked = saved.liked || "";
    form.disliked = saved.disliked || "";
    form.moment = saved.moment || "";
    form.review = saved.editorText || form.review || "";
    reviewMode = saved.mode === "ai" ? "ai" : "self";
    $("f-liked").value = form.liked;
    $("f-disliked").value = form.disliked;
    $("f-moment").value = form.moment;
    $("e-review").value = form.review;
    syncFeelingCards();
  }
  $("ai-request-status").textContent = "";
  $("ai-request-status").classList.remove("is-error");
  syncReviewChoiceState();
}

function syncReviewEditor() {
  if (!$("e-review").value && form.review) $("e-review").value = form.review;
  const fromAI = reviewMode === "ai";
  $("review-editor-source").textContent = fromAI ? "Черновик помощника" : "Твой черновик";
  $("review-editor-title").textContent = fromAI ? "Проверь формулировки" : "Твоя запись";
  $("review-editor-count").textContent = $("e-review").value.length;
}

function openReviewEditor(mode, text) {
  reviewMode = mode;
  form.review = text;
  $("e-review").value = text;
  showStep(3);
  persistReviewWorkspace();
  requestAnimationFrame(() => $("e-review").focus());
}

function startSelfReview() {
  captureNotes();
  const text = editingEntryId ? form.review || "" : "";
  haptic("impact", "soft");
  openReviewEditor("self", text);
}

function geminiErrorMessage(status, code) {
  if (status === 429 || code === "limit")
    return "Gemini временно недоступен: исчерпан бесплатный лимит. Попробуй позже или напиши запись сам.";
  if (status === 408 || code === "timeout")
    return "Gemini отвечает слишком долго. Черновик сохранён — попробуй ещё раз.";
  if (status === 503 || code === "unavailable")
    return "Gemini временно недоступен. Черновик сохранён — попробуй ещё раз.";
  if (code === "not_configured")
    return "Gemini ещё не подключён: укажи адрес Worker в index.html.";
  return "Не удалось создать запись. Черновик сохранён — попробуй ещё раз.";
}

async function generateReviewWithGemini() {
  captureNotes();
  const draft = reviewDraftText();
  if (meaningfulDraftLength(draft) < AI_MIN_DRAFT_CHARS) {
    syncReviewChoiceState();
    return;
  }
  if (!AI_REVIEW_ENDPOINT) {
    $("ai-request-status").textContent = geminiErrorMessage(0, "not_configured");
    $("ai-request-status").classList.add("is-error");
    haptic("notification", "warning");
    return;
  }

  persistReviewWorkspace();
  geminiRequestController = new AbortController();
  const timeout = setTimeout(() => geminiRequestController?.abort(), 15000);
  const button = $("btn-notes-ai");
  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", "Помощник оформляет запись");
  $("ai-request-status").classList.remove("is-error");
  $("ai-request-status").textContent = "Черновик сохранён. Обычно ответ занимает несколько секунд.";

  try {
    const response = await fetch(AI_REVIEW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
      signal: geminiRequestController.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.review) {
      const error = new Error(data.error || "request_failed");
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    const review = data.review.trim();
    haptic("notification", "success");
    openReviewEditor("ai", review);
  } catch (error) {
    const code = error.name === "AbortError" ? "timeout" : error.code;
    $("ai-request-status").textContent = geminiErrorMessage(error.status, code);
    $("ai-request-status").classList.add("is-error");
    haptic("notification", "error");
  } finally {
    clearTimeout(timeout);
    geminiRequestController = null;
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-label");
    if (step === 2) syncReviewChoiceState();
  }
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

// Пять одинаковых векторных по форме звёзд; заливка каждой — 0/50/100%.
function renderStars(container, five) {
  if (container.children.length !== 5) {
    container.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const star = el("div", "star");
      star.append(el("div", "fill"));
      container.append(star);
    }
  }
  for (let i = 0; i < 5; i++) {
    const v = five - i;
    const pct = v >= 1 ? 100 : v >= 0.5 ? 50 : 0;
    container.children[i].querySelector(".fill").style.setProperty("--star-fill", String(pct / 100));
    container.children[i].classList.toggle("has-fill", pct > 0);
  }

  container.classList.toggle("is-perfect", five === 5);
  container.classList.toggle("is-high", five >= 4.5);
  container.dataset.rating = String(five);
}

// ─── Переключение вкладок и шагов ────────────────────────────────

function syncTelegramSwipeBehavior(insideRating) {
  lockTelegramVerticalSwipes();
}

async function showTab(name) {
  const previousTab = tab;
  if (name === "rate" && previousTab !== "rate") rateReturnTab = previousTab;
  tab = name;
  if (name !== "feed") document.body.classList.remove("feed-has-hero");
  if (name !== "rate") closeSearchKeyboard();
  $("screen-rate").classList.toggle("hidden", name !== "rate");
  $("screen-feed").classList.toggle("hidden", name !== "feed");
  $("screen-diary").classList.toggle("hidden", name !== "diary");
  $("screen-profile").classList.toggle("hidden", name !== "profile");
  $("head-rate").classList.toggle("hidden", name !== "rate");
  $("head-feed").classList.toggle("hidden", name !== "feed");
  $("head-diary").classList.toggle("hidden", name !== "diary");
  $("head-profile").classList.toggle("hidden", name !== "profile");
  const showRateAction = name === "rate" &&
    (step === 1 || step === 3 || (step === 0 && !!form.title));
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

  if (name === "rate") {
    if (!popularLoaded) loadPopular();
    if (!recommendationsLoaded) loadRecommendations();
    if (step === 0 && !form.title) requestAnimationFrame(() => {
      const popularList = $("popular-list");
      if (popularList) popularList.scrollLeft = 0;
    });
  }
  scheduleHeroParallax();
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
  stars.classList.remove("is-relocating");
  activeStarsMorph = null;
  targetSlot.append(stars);
  if (!previousRect || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  stars.classList.add("is-relocating");
  const destination = starsVisualRect(stars);
  const previousCenterX = previousRect.left + previousRect.width / 2;
  const previousCenterY = previousRect.top + previousRect.height / 2;
  const destinationCenterX = destination.left + destination.width / 2;
  const destinationCenterY = destination.top + destination.height / 2;
  const dx = previousCenterX - destinationCenterX;
  const dy = previousCenterY - destinationCenterY;
  const scale = destination.width > 0 ? previousRect.width / destination.width : 1;
  const animation = stars.animate([
    { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`, opacity: 1 },
    { transform: "translate3d(0, 0, 0)", opacity: 1 },
  ], {
    duration: 360,
    easing: "cubic-bezier(.22, 1, .36, 1)",
  });
  activeStarsMorph = animation;
  const finish = () => {
    stars.classList.remove("is-relocating");
    if (activeStarsMorph === animation) activeStarsMorph = null;
  };
  animation.finished.then(finish, finish);
}

function syncRateHeader() {
  const selectedFilmHero = step === 0 && !!form.title;
  $("head-title").textContent = selectedFilmHero
    ? "Фильм"
    : editingEntryId && step === 2
      ? "Что изменилось?"
      : STEP_TITLES[step];
  $("head-sub").textContent = `${step + 1}/4`;
  $("head-film-compact").textContent = selectedFilmHero ? form.title : "";
  $("head-film-compact").setAttribute("aria-hidden", String(!selectedFilmHero));
  $("head-sub").classList.remove("hidden");
  $("progress").classList.remove("hidden");
  $("btn-back").setAttribute(
    "aria-label",
    step === 0 ? (form.title ? "Назад к выбору фильма" : "Выйти из оценки") : "Назад",
  );
}

function resetRateScrollPosition(afterKeyboard = false) {
  const reset = () => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  cancelAnimationFrame(rateScrollResetFrame);
  clearTimeout(rateScrollResetTimer);
  reset();
  rateScrollResetFrame = requestAnimationFrame(reset);
  if (afterKeyboard) rateScrollResetTimer = setTimeout(reset, 320);
}


function showStep(n) {
  const previousStep = step;
  const shouldMoveStars = (previousStep === 1 && n === 2) || (previousStep === 2 && n === 1);
  const previousStarsRect = shouldMoveStars ? starsVisualRect($("stars-shared")) : null;
  step = n;
  for (let i = 0; i <= 3; i++) $("step-" + i).classList.toggle("hidden", i !== n);
  syncRateHeader();
  $("progress").style.setProperty("--step-progress-scale", String((n + 1) / 4));
  syncAtmosphere();

  const primary = $("btn-primary");
  if (n !== 1) primary.disabled = false;
  primary.textContent = editingEntryId && n >= 2
    ? "Обновить запись"
    : n === 0 ? "Оценить фильм" : n === 1 ? "Далее" : "Сохранить запись";
  primary.classList.toggle("muted", n === 0 && !form.title);
  $("btn-save-empty").classList.add("hidden");
  const showRateAction = tab === "rate" && (n === 1 || n === 3 || (n === 0 && !!form.title));
  $("footer-action").classList.toggle("hidden", !showRateAction);
  document.body.classList.toggle("has-action", showRateAction);

  if (n === 1) {
    if (previousStep === 0) ratingCriterionIndex = 0;
    moveSharedStars($("stars-slot-rating"), previousStarsRect);
    $("rating-mode-label").textContent = editingEntryId ? "Меняешь оценку" : "Оцениваешь";
    $("rating-title").textContent = form.title;
    $("rating-meta").textContent = [form.year, visibleGenre(form.genre)].filter(Boolean).join(" · ");
    const posterWrap = $("rating-poster-wrap");
    const ratingImage = form.backdrop || form.poster;
    const ratingPreview = form.backdropPreview || form.posterPreview || microPreview(ratingImage, "w300");
    posterWrap.classList.toggle("hidden", !ratingImage);
    $("rating-film").classList.toggle("no-image", !ratingImage);
    $("rating-film").classList.toggle(
      "poster-only",
      (!form.backdrop || form.backdrop === form.poster) && !!form.poster,
    );
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
    syncRatingCriterion();
  }
  if (n === 2) {
    moveSharedStars($("stars-slot-final"), previousStarsRect);
    updateStars("2");
    syncTmdbComparison();
    prepareNotesWorkspace();
  }
  if (n === 3) {
    syncReviewEditor();
  }
  resetRateScrollPosition();
  scheduleHeroParallax();
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
  try {
    const recent = readRecentMovies().filter((item) => Number(item.id) !== Number(movie.id));
    recent.unshift(movie);
    localStorage.setItem(RECENT_MOVIES_KEY, JSON.stringify(recent.slice(0, 5)));
  } catch (_) { /* недавние фильмы — необязательный локальный кэш */ }
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

function syncKeyboardViewport() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const active = document.activeElement;
  const editingText = active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
  if (!editingText) {
    layoutViewportHeight = Math.max(
      window.innerHeight,
      viewportHeight,
      Number(tg?.viewportStableHeight || 0),
    );
  }
  const keyboardOpen = editingText && layoutViewportHeight - viewportHeight > 120;
  document.body.classList.toggle("keyboard-open", keyboardOpen);
  document.documentElement.classList.toggle("keyboard-open", keyboardOpen);
  return keyboardOpen;
}

function scheduleViewportSync() {
  if (viewportSyncFrame) return;
  viewportSyncFrame = requestAnimationFrame(() => {
    viewportSyncFrame = 0;
    syncKeyboardViewport();
    syncSearchViewport();
  });
}

function keepFocusedControlVisible(control) {
  if (control === $("f-query") || document.activeElement !== control) return;
  const viewport = window.visualViewport;
  const viewportTop = (viewport?.offsetTop || 0) + 12;
  const viewportBottom = viewportTop + (viewport?.height || window.innerHeight) - 24;
  const rect = control.getBoundingClientRect();
  let delta = 0;
  if (rect.bottom > viewportBottom) delta = rect.bottom - viewportBottom;
  else if (rect.top < viewportTop) delta = rect.top - viewportTop;
  if (Math.abs(delta) > 1) window.scrollBy({ top: delta, left: 0, behavior: "auto" });
}

function setSearchMode(active) {
  clearTimeout(searchBlurTimer);
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
  const ids = movie.genre_ids || (movie.genres || []).map((genre) => genre.id);
  const id = ids.find((genreId) => TMDB_GENRES[genreId]);
  return TMDB_GENRES[id] || "Другое";
}

function visibleGenre(genre) {
  const value = String(genre || "").trim();
  return value && value !== "Другое" ? value : "";
}

function directorsOf(movie) {
  return [...new Set((movie.credits?.crew || [])
    .filter((person) => person.job === "Director" && person.name)
    .map((person) => person.name.trim()))]
    .slice(0, 2)
    .join(", ");
}

function formatRuntime(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (!total) return "—";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

async function loadMovieDetails(movieId) {
  const id = Number(movieId);
  if (!id) return null;
  if (!MOVIE_DETAILS_CACHE.has(id)) {
    const request = tmdb(`/movie/${id}?append_to_response=credits`)
      .catch((error) => {
        MOVIE_DETAILS_CACHE.delete(id);
        throw error;
      });
    MOVIE_DETAILS_CACHE.set(id, request);
  }
  return MOVIE_DETAILS_CACHE.get(id);
}

async function loadDirectorMovies(personId) {
  const id = Number(personId);
  if (!id) return null;
  if (!DIRECTOR_MOVIES_CACHE.has(id)) {
    const request = tmdb(`/person/${id}/movie_credits`)
      .catch((error) => {
        DIRECTOR_MOVIES_CACHE.delete(id);
        throw error;
      });
    DIRECTOR_MOVIES_CACHE.set(id, request);
  }
  return DIRECTOR_MOVIES_CACHE.get(id);
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
    button.append(el("div", "movie-placeholder", "SYO"));
  }
  const info = el("span", "movie-card-info");
  info.append(el("strong", "", movie.title));
  info.append(el("small", "", [yearOf(movie), genreOf(movie)].filter(Boolean).join(" · ")));
  button.append(info);
  button.addEventListener("click", () => selectMovie(movie, button));
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

function mixRecommendationGroups(groups, ratedIds, limit = 20) {
  const queues = groups.map((group) => [...group]);
  const seen = new Set(ratedIds);
  const mixed = [];

  while (mixed.length < limit) {
    let addedInRound = false;
    for (const queue of queues) {
      let movie = null;
      while (queue.length && !movie) {
        const candidate = queue.shift();
        if (!candidate?.title || candidate.adult || seen.has(Number(candidate.id))) continue;
        movie = candidate;
      }
      if (!movie) continue;
      seen.add(Number(movie.id));
      mixed.push(movie);
      addedInRound = true;
      if (mixed.length >= limit) break;
    }
    if (!addedInRound) break;
  }
  return mixed;
}

function renderPopularMarquee(movies) {
  const container = $("popular-list");
  container.innerHTML = "";
  const selection = movies.slice(0, 12);
  selection.forEach((movie) => container.append(movieCard(movie, true)));
  cancelAnimationFrame(popularAnimationFrame);
  popularPosition = 0;
  requestAnimationFrame(() => {
    container.scrollLeft = 0;
    delete container.dataset.segmentWidth;
  });
}

function renderCatalogSkeleton() {
  const container = $("popular-list");
  container.innerHTML = "";
  for (let index = 0; index < 5; index++) {
    const card = el("div", "catalog-skeleton");
    card.setAttribute("aria-hidden", "true");
    card.append(el("i"), el("span"), el("small"));
    container.append(card);
  }
  container.setAttribute("aria-busy", "true");
}

function renderCatalogError() {
  const container = $("popular-list");
  container.innerHTML = "";
  const message = el("div", "catalog-error");
  message.append(
    el("strong", "", "Каталог пока не ответил"),
    el("span", "", "Можно найти фильм через поиск или добавить его вручную."),
  );
  container.append(message);
  container.setAttribute("aria-busy", "false");
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
        `Не удалось найти фильм «${query}». Проверь написание или добавь его вручную.`,
        { label: "Добавить вручную", run: () => addMovieManually(query) },
      );
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    clearTimeout(searchSkeletonTimer);
    renderSearchMessage(
      "Не удалось выполнить поиск",
      "Проверь подключение или добавь фильм вручную.",
      { label: "Добавить вручную", run: () => addMovieManually(query) },
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

function addMovieManually(title) {
  form = emptyForm();
  ratingConfirmed = new Set();
  form.title = title.trim();
  editingEntryId = null;
  editingOriginalDate = "";
  duplicatePendingMovie = null;
  duplicatePendingEntry = null;
  showSelectedMovie(false);
  haptic("impact", "soft");
}

async function loadPopular(forceRefresh = false) {
  if (!popularLoaded && !$("f-query").value.trim()) {
    renderCatalogSkeleton();
    $("popular").classList.remove("hidden");
  }
  try {
    let data = null;
    if (!forceRefresh) {
      try {
        const cached = JSON.parse(localStorage.getItem(TRENDING_CACHE_KEY) || "null");
        if (cached && Date.now() - cached.savedAt < DAY_MS) data = cached.data;
      } catch (_) { /* cache miss */ }
    }
    if (!data) {
      data = await tmdb("/trending/movie/day?page=1");
      localStorage.setItem(TRENDING_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    }
    popularMovies = data.results || [];
    renderPopularMarquee(popularMovies);
    $("popular-list").setAttribute("aria-busy", "false");
    popularLoaded = true;
    $("popular").classList.toggle("hidden", !!$("f-query").value.trim());
    if (document.body.classList.contains("search-active") && !$("f-query").value.trim())
      showSearchSuggestions();
  } catch (e) {
    popularLoaded = false;
    renderCatalogError();
    $("popular").classList.toggle("hidden", !!$("f-query").value.trim());
  }
}

async function loadRecommendations(refresh = false) {
  const list = $("recommended-list");
  const hadRecommendations = recommendationsLoaded && list.childElementCount > 0;
  if (refresh) recommendationPage = recommendationPage % 12 + 1;
  list.classList.toggle("is-refreshing", refresh);
  list.setAttribute("aria-busy", "true");
  try {
    const films = await store.getAll();
    const ratedIds = new Set(films.map((film) => Number(film.movieId || film.tmdbId)).filter(Boolean));
    const seeds = [...new Map(films
      .filter((film) => Number(film.movieId || film.tmdbId))
      .map((film) => [Number(film.movieId || film.tmdbId), film])).values()]
      .slice(0, 8);
    if (!seeds.length) {
      recommendationsLoaded = false;
      $("recommended").classList.add("hidden");
      return;
    }

    const start = (recommendationPage - 1) % seeds.length;
    const activeSeeds = Array.from(
      { length: Math.min(4, seeds.length) },
      (_, index) => seeds[(start + index) % seeds.length],
    );
    const apiPage = Math.floor((recommendationPage - 1) / seeds.length) % 3 + 1;
    const responses = await Promise.allSettled(activeSeeds.map((seed) => {
      const seedId = Number(seed.movieId || seed.tmdbId);
      return tmdb(`/movie/${seedId}/recommendations?page=${apiPage}`);
    }));
    const groups = responses
      .filter((response) => response.status === "fulfilled")
      .map((response) => response.value.results || []);
    const choices = mixRecommendationGroups(groups, ratedIds);

    renderRecommendations($("recommended-list"), choices);
    recommendationsLoaded = choices.length > 0;
    $("recommended").classList.toggle("hidden", !recommendationsLoaded || !!$("f-query").value.trim());
  } catch (_) {
    if (!hadRecommendations) $("recommended").classList.add("hidden");
  } finally {
    list.classList.remove("is-refreshing");
    list.setAttribute("aria-busy", "false");
  }
}

function applyCatalogMovie(movie) {
  form.title = movie.title;
  form.year = yearOf(movie);
  form.genre = genreOf(movie);
  form.tmdbId = movie.id;
  form.overview = (movie.overview || "").trim();
  form.runtime = Number(movie.runtime) || form.runtime || 0;
  form.director = directorsOf(movie) || form.director || "";
  form.tmdbRating = Number(movie.vote_average) || form.tmdbRating || 0;
  form.tmdbVoteCount = Number(movie.vote_count) || form.tmdbVoteCount || 0;
  form.poster = tmdbPoster(movie.poster_path, "w500");
  form.posterPreview = tmdbPoster(movie.poster_path, "w92");
  form.backdrop = movie.backdrop_path ? tmdbBackdrop(movie.backdrop_path, "w1280") : "";
  form.backdropPreview = movie.backdrop_path ? tmdbBackdrop(movie.backdrop_path, "w300") : "";
}

function revealSelectedMovie(sourceCard, render) {
  const source = sourceCard?.querySelector(".poster-media");
  const target = document.querySelector(".hero-media");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!source || !target || reduceMotion || typeof document.startViewTransition !== "function") {
    render(false);
    return;
  }

  source.style.viewTransitionName = "film-poster";
  target.style.viewTransitionName = "film-poster";
  const transition = document.startViewTransition(() => render(true));
  transition.finished.finally(() => {
    source.style.removeProperty("view-transition-name");
    target.style.removeProperty("view-transition-name");
  });
}

async function selectMovie(movie, sourceCard = null) {
  if (selectingMovie) return;
  selectingMovie = true;
  document.body.classList.add("movie-selecting");
  rememberMovie(movie);
  closeSearchKeyboard();
  try {
    const [films, details] = await Promise.all([
      store.getAll(),
      loadMovieDetails(movie.id).catch(() => null),
    ]);
    const existing = films.find((film) => Number(film.movieId || film.tmdbId) === Number(movie.id));
    duplicatePendingMovie = existing ? movie : null;
    duplicatePendingEntry = existing || null;
    editingEntryId = null;
    editingOriginalDate = "";
    ratingConfirmed = new Set();
    applyCatalogMovie(details
      ? { ...movie, ...details, overview: details.overview || movie.overview }
      : movie);
    syncGenreAccent(form.genre);
    haptic("impact", existing ? "medium" : "rigid");
    revealSelectedMovie(sourceCard, (insideViewTransition) =>
      showSelectedMovie(true, insideViewTransition));
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
    runtime: Number(film.runtime) || 0,
    director: film.director || "",
    tmdbRating: Number(film.tmdbRating) || 0,
    tmdbVoteCount: Number(film.tmdbVoteCount) || 0,
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
  ratingConfirmed = preserveNotes
    ? new Set([...CRITERIA.map((criterion) => criterion.id), PERSONAL_CRITERION.id])
    : new Set();
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
  editingEntryId = film.entryId || film.id;
  editingOriginalDate = film.date || "";
  fillFormFromEntry(film, false);
  if (movie) applyCatalogMovie(movie);
  showTab("rate");
  showSelectedMovie(!!form.tmdbId);
  showStep(1);
}

function scheduleOverviewDisclosure(reset = false) {
  if (reset) overviewExpanded = false;
  cancelAnimationFrame(overviewDisclosureFrame);
  const overview = $("hero-overview");
  const toggle = $("btn-overview-toggle");
  const copy = document.querySelector(".hero-copy");
  const hasDetails = !overview.classList.contains("hidden") ||
    !$("hero-director").classList.contains("hidden");
  copy.classList.toggle("details-open", overviewExpanded);
  toggle.classList.toggle("hidden", !hasDetails);
  toggle.setAttribute("aria-expanded", String(overviewExpanded));
  toggle.textContent = overviewExpanded ? "Скрыть подробности" : "Подробнее";
}

function scheduleHeroParallax() {
  if (heroParallaxFrame) return;
  heroParallaxFrame = requestAnimationFrame(() => {
    heroParallaxFrame = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scrollTop = Math.max(window.scrollY, document.documentElement.scrollTop || 0);
    const filmActive = tab === "rate" && step === 0 && !!form.title;
    const feedActive = tab === "feed" && !$("feed-hero").classList.contains("hidden");
    const filmY = !reducedMotion && filmActive ? Math.min(42, scrollTop * .16) : 0;
    const filmCopyY = !reducedMotion && filmActive ? Math.min(18, scrollTop * .08) : 0;
    const feedY = !reducedMotion && feedActive ? Math.min(28, scrollTop * .12) : 0;
    const filmCopyOpacity = !reducedMotion && filmActive
      ? Math.max(.82, 1 - scrollTop / 1000)
      : 1;
    const feedBrandOpacity = !reducedMotion && feedActive
      ? Math.max(0, 1 - scrollTop / 190)
      : 1;
    const root = document.documentElement.style;
    root.setProperty("--film-parallax-y", `${filmY.toFixed(1)}px`);
    root.setProperty("--film-copy-y", `${filmCopyY.toFixed(1)}px`);
    root.setProperty("--film-copy-opacity", filmCopyOpacity.toFixed(3));
    root.setProperty("--feed-parallax-y", `${feedY.toFixed(1)}px`);
    root.setProperty("--feed-brand-opacity", feedBrandOpacity.toFixed(3));
    document.body.classList.toggle("hero-scrolled", filmActive && scrollTop >= 80);
  });
}

function toggleOverview() {
  overviewExpanded = !overviewExpanded;
  document.querySelector(".hero-copy").classList.toggle("details-open", overviewExpanded);
  $("btn-overview-toggle").textContent = overviewExpanded
    ? "Скрыть подробности"
    : "Подробнее";
  $("btn-overview-toggle").setAttribute("aria-expanded", String(overviewExpanded));
  scheduleHeroParallax();
  haptic("selection");
}

function revealHeroShade(hero) {
  cancelAnimationFrame(heroShadeRevealFrame);
  heroShadeRevealFrame = 0;
  hero.classList.remove("is-revealed");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    hero.classList.add("is-revealed");
    return;
  }

  heroShadeRevealFrame = requestAnimationFrame(() => {
    heroShadeRevealFrame = 0;
    if (!hero.classList.contains("hidden")) hero.classList.add("is-revealed");
  });
}

function resetHeroShade() {
  cancelAnimationFrame(heroShadeRevealFrame);
  heroShadeRevealFrame = 0;
  $("film-hero").classList.remove("is-revealed");
}

function revealHeroInterface(hero) {
  clearTimeout(heroInterfaceRevealTimer);
  hero.classList.remove("hero-interface-entering");
  document.body.classList.remove("hero-interface-entering");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  hero.classList.add("hero-interface-entering");
  document.body.classList.add("hero-interface-entering");
  heroInterfaceRevealTimer = setTimeout(() => {
    hero.classList.remove("hero-interface-entering");
    document.body.classList.remove("hero-interface-entering");
    heroInterfaceRevealTimer = 0;
  }, 720);
}

function resetHeroInterface() {
  clearTimeout(heroInterfaceRevealTimer);
  heroInterfaceRevealTimer = 0;
  $("film-hero").classList.remove("hero-interface-entering");
  document.body.classList.remove("hero-interface-entering");
}

function showSelectedMovie(fromCatalog, insideViewTransition = false) {
  const keyboardWasOpen = document.body.classList.contains("keyboard-open");
  closeSearchKeyboard();
  $("f-query").value = "";
  resetSearchView();
  $("hero-title").textContent = form.title;
  $("f-year").value = form.year;
  $("f-genre").value = form.genre;
  const genre = visibleGenre(form.genre);
  $("chip-year").textContent = form.year;
  $("chip-year").classList.toggle("hidden", !form.year);
  $("chip-genre").textContent = genre;
  $("chip-genre").classList.toggle("hidden", !genre);
  $("chip-runtime").textContent = formatRuntime(form.runtime);
  $("chip-runtime").classList.toggle("hidden", !fromCatalog || !form.runtime);
  $("hero-chips").classList.toggle("hidden", !fromCatalog || (!form.year && !genre && !form.runtime));
  $("hero-director-name").textContent = form.director;
  $("hero-director").classList.toggle("hidden", !fromCatalog || !form.director);
  $("hero-overview").textContent = form.overview;
  $("hero-overview").classList.toggle("hidden", !fromCatalog || !form.overview);
  document.querySelector(".hero-fields").classList.toggle("hidden", fromCatalog);
  const heroImage = form.backdrop || form.poster;
  const heroPreview = form.backdrop
    ? backdropPreview(form.backdrop, form.poster, form.backdropPreview, form.posterPreview)
    : form.posterPreview || microPreview(form.poster, "w92");
  setBlurBackground(
    document.body,
    heroPreview,
    heroImage,
    "--hero-preview",
    "--hero-image",
    "hero-image-loaded",
  );
  $("film-search").classList.add("hidden");
  const hero = $("film-hero");
  resetHeroShade();
  resetHeroInterface();
  hero.classList.remove(
    "hidden",
    "hero-cinematic",
    "hero-poster",
    "hero-typographic",
    "hero-contain",
    "long-title",
  );
  const hasBackdrop = !!form.backdrop && form.backdrop !== form.poster;
  hero.classList.add(hasBackdrop ? "hero-cinematic" : form.poster ? "hero-poster" : "hero-typographic");
  hero.classList.toggle("long-title", form.title.length > 32);
  if (insideViewTransition) {
    hero.classList.add("is-revealed");
  } else {
    revealHeroShade(hero);
    revealHeroInterface(hero);
  }
  document.body.classList.toggle("hero-no-image", !heroImage);
  showStep(0); // обновить герой-фон и кнопку
  resetRateScrollPosition(keyboardWasOpen);
  scheduleHeroParallax();
  scheduleOverviewDisclosure(true);
}

function clearFilm() {
  closeSearchKeyboard();
  clearReviewWorkspace();
  duplicatePendingMovie = null;
  duplicatePendingEntry = null;
  editingEntryId = null;
  editingOriginalDate = "";
  ratingCriterionIndex = 0;
  ratingConfirmed = new Set();
  reviewMode = "self";
  form = emptyForm();
  $("f-query").value = "";
  $("f-year").value = "";
  $("f-genre").value = GENRES[0];
  $("f-liked").value = "";
  $("f-disliked").value = "";
  $("f-moment").value = "";
  $("e-review").value = "";
  $("sliders").innerHTML = "";
  buildSliders();
  syncFeelingCards();
  resetHeroShade();
  resetHeroInterface();
  document.body.classList.remove("hero-image-loaded");
  document.body.classList.remove("hero-no-image");
  document.body.style.setProperty("--hero-preview", "none");
  document.body.style.setProperty("--hero-image", "none");
  syncGenreAccent(null);
  $("film-search").classList.remove("hidden");
  $("film-hero").classList.add("hidden");
  $("hero-overview").classList.remove("is-collapsed");
  $("btn-overview-toggle").classList.add("hidden");
  overviewExpanded = false;
  document.body.classList.remove("hero-scrolled");
  scheduleHeroParallax();
  $("hero-chips").classList.add("hidden");
  document.querySelector(".hero-fields").classList.remove("hidden");
  resetSearchView();
  showStep(0);
}

function leaveRateFlow() {
  clearFilm();
  showTab(rateReturnTab === "rate" ? "diary" : rateReturnTab);
}

function requestRateExit() {
  closeSearchKeyboard();
  haptic("impact", "soft");
  if (!form.title) {
    leaveRateFlow();
    return;
  }
  $("exit-rate-dialog").showModal();
  document.body.classList.add("modal-open");
  haptic("notification", "warning");
}

function closeRateExitDialog() {
  if ($("exit-rate-dialog").open) $("exit-rate-dialog").close();
  document.body.classList.remove("modal-open");
}

// ─── Шаг 2: слайдеры ─────────────────────────────────────────────

function ratingCriterionAt(index = ratingCriterionIndex) {
  return index < CRITERIA.length ? CRITERIA[index] : PERSONAL_CRITERION;
}

function scoreFeeling(value, criterion) {
  const feelingIndex = value >= 10 ? 5 : value >= 9 ? 4 : value >= 7 ? 3
    : value >= 5 ? 2 : value >= 3 ? 1 : 0;
  return criterion.feelings[feelingIndex];
}

function scoreValueHaptic(previous, next) {
  if (previous === next) {
    haptic("selection");
    return;
  }
  if (next === 10) haptic("notification", "success");
  else if (next === 9) haptic("impact", "rigid");
  else if (next === 7) haptic("impact", "medium");
  else if (next === 5) haptic("impact", "light");
  else haptic("selection");
}

function nudgeCurrentScale() {
  const scale = document.querySelector(".crit:not([aria-hidden='true']) .score-scale");
  if (!scale) return;
  scale.classList.remove("needs-input");
  void scale.offsetWidth;
  scale.classList.add("needs-input");
  setTimeout(() => scale.classList.remove("needs-input"), 300);
  haptic("notification", "warning");
}

function criterionTrackOffset(index = ratingCriterionIndex) {
  const viewport = document.querySelector(".criteria-viewport");
  return viewport ? index * (viewport.clientWidth + 12) : 0;
}

function syncRatingCriterion() {
  const track = document.querySelector(".criteria-track");
  const cards = [...document.querySelectorAll(".crit")];
  if (!track || !cards.length) return;
  ratingCriterionIndex = Math.max(0, Math.min(cards.length - 1, ratingCriterionIndex));
  track.classList.remove("is-dragging");
  track.style.transform = `translate3d(-${criterionTrackOffset()}px, 0, 0)`;
  cards.forEach((card, index) => {
    const active = index === ratingCriterionIndex;
    card.setAttribute("aria-hidden", String(!active));
    card.toggleAttribute("inert", !active);
    card.querySelectorAll(".score-step").forEach((button) => {
      const current = button.classList.contains("is-current") ||
        button.classList.contains("is-preview-current");
      button.tabIndex = active && current ? 0 : -1;
    });
  });
  document.querySelectorAll(".criterion-dot").forEach((dot, index) => {
    const active = index === ratingCriterionIndex;
    const complete = ratingConfirmed.has(ratingCriterionAt(index).id);
    dot.classList.toggle("on", active);
    dot.classList.toggle("is-complete", complete);
    dot.setAttribute("aria-current", active ? "step" : "false");
  });
  const count = $("criterion-count");
  if (count) count.textContent = `${ratingCriterionIndex + 1} из ${cards.length}`;
  if (step === 1) {
    const confirmed = ratingConfirmed.has(ratingCriterionAt().id);
    $("btn-primary").disabled = !confirmed;
    $("btn-primary").textContent = !confirmed
      ? "Проведи по шкале"
      : ratingCriterionIndex === cards.length - 1
        ? "К впечатлениям"
        : "Продолжить";
  }
}

function moveRatingCriterion(nextIndex, allowUnconfirmed = false) {
  const total = CRITERIA.length + 1;
  const target = Math.max(0, Math.min(total - 1, nextIndex));
  if (target === ratingCriterionIndex) {
    syncRatingCriterion();
    return true;
  }
  const firstMissing = target > ratingCriterionIndex
    ? Array.from(
      { length: target - ratingCriterionIndex },
      (_, offset) => ratingCriterionIndex + offset,
    ).find((index) => !ratingConfirmed.has(ratingCriterionAt(index).id))
    : undefined;
  if (!allowUnconfirmed && firstMissing !== undefined) {
    ratingCriterionIndex = firstMissing;
    nudgeCurrentScale();
    syncRatingCriterion();
    return false;
  }
  ratingCriterionIndex = target;
  syncRatingCriterion();
  return true;
}

function setupCriterionSwipe(viewport, track) {
  let gesture = null;

  const finish = (event, cancelled = false) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const current = gesture;
    gesture = null;
    track.classList.remove("is-dragging");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (current.axis !== "x") {
      syncRatingCriterion();
      return;
    }

    const dx = current.lastX - current.startX;
    const duration = Math.max(1, performance.now() - current.startedAt);
    const velocity = Math.abs(dx) / duration;
    const shouldMove = !cancelled &&
      (Math.abs(dx) >= viewport.clientWidth * .22 || (Math.abs(dx) >= 48 && velocity >= .55));
    if (!shouldMove) {
      syncRatingCriterion();
      return;
    }

    const direction = dx < 0 ? 1 : -1;
    const moved = moveRatingCriterion(ratingCriterionIndex + direction);
    if (moved) haptic("impact", "soft");
  };

  viewport.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button > 0 || event.target.closest(".score-scale, .criterion-dot")) return;
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: performance.now(),
      axis: "",
      base: criterionTrackOffset(),
    };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 12)
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
    if (gesture.axis !== "x") return;
    event.preventDefault();
    const atStart = ratingCriterionIndex === 0 && dx > 0;
    const atEnd = ratingCriterionIndex === CRITERIA.length && dx < 0;
    const distance = (atStart || atEnd) ? dx * .22 : dx;
    track.classList.add("is-dragging");
    track.style.transform = `translate3d(${(-gesture.base + distance).toFixed(1)}px, 0, 0)`;
  });
  viewport.addEventListener("pointerup", (event) => finish(event));
  viewport.addEventListener("pointercancel", (event) => finish(event, true));
}

function buildSliders() {
  const box = $("sliders");
  box.innerHTML = "";

  const progress = el("div", "criteria-progress");
  const count = el("div", "criterion-count", "1 из 6");
  count.id = "criterion-count";
  count.setAttribute("aria-live", "polite");
  const dots = el("div", "criterion-dots");
  dots.setAttribute("aria-label", "Критерии оценки");
  progress.append(count, dots);

  const viewport = el("div", "criteria-viewport");
  const track = el("div", "criteria-track");
  viewport.append(track);
  box.append(progress, viewport);

  const make = (criterion, value, index, oninput) => {
    const personal = criterion.id === PERSONAL_CRITERION.id;
    const wrap = el("section", "crit" + (personal ? " personal" : ""));
    wrap.dataset.criterion = criterion.id;
    wrap.setAttribute("aria-label", `${criterion.label}, критерий ${index + 1} из ${CRITERIA.length + 1}`);
    const top = el("div", "crit-top");
    const labelGroup = el("div", "crit-label-group");
    const label = el("h3", "crit-name", criterion.label);
    const prompt = el("p", "crit-prompt", criterion.prompt);
    labelGroup.append(label, prompt);
    const badge = el("div", "crit-badge", `${value}/10`);
    const feeling = el("div", "crit-feeling");
    top.append(labelGroup, badge, feeling);
    const scale = el("div", "score-scale");
    scale.setAttribute("role", "radiogroup");
    scale.setAttribute("aria-label", `${criterion.label}: оценка от 1 до 10`);
    const anchors = el("div", "crit-scale");
    anchors.append(el("span", "", criterion.anchors[0]), el("span", "", criterion.anchors[1]));
    const hint = el("p", "crit-hint", "Проведи по шкале. Смахни экран, чтобы листать критерии.");

    const paint = (nextValue, options = {}) => {
      const confirmed = ratingConfirmed.has(criterion.id);
      const previous = Number(options.previous || nextValue);
      const direction = Math.sign(nextValue - previous);
      badge.textContent = `${nextValue}/10`;
      feeling.textContent = confirmed ? scoreFeeling(nextValue, criterion) : "Проведи по шкале";
      if (confirmed && previous !== nextValue &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        [feeling, badge].forEach((node, nodeIndex) => {
          if (typeof node.animate !== "function") return;
          node.getAnimations?.().forEach((animation) => animation.cancel());
          node.animate(
            [
              { opacity: .45, transform: `translateY(${direction > 0 ? 4 : -4}px)` },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: nodeIndex ? 110 : 150, easing: "cubic-bezier(.22,1,.36,1)" },
          );
        });
      }
      wrap.classList.toggle("is-unconfirmed", !confirmed);
      wrap.classList.toggle("score-high", confirmed && nextValue >= 7);
      wrap.classList.toggle("score-top", confirmed && nextValue >= 9);
      scale.dataset.value = String(nextValue);
      scale.classList.toggle("is-maximum", confirmed && nextValue === 10);
      scale.querySelectorAll(".score-step").forEach((button, buttonIndex) => {
        const stepValue = buttonIndex + 1;
        const inWave = options.wave && direction !== 0 &&
          (direction > 0
            ? stepValue > previous && stepValue <= nextValue
            : stepValue <= previous && stepValue >= nextValue);
        const delayIndex = direction > 0 ? stepValue - previous - 1 : previous - stepValue;
        button.style.setProperty("--fill-delay", inWave ? `${Math.max(0, delayIndex) * 18}ms` : "0ms");
        button.classList.toggle("is-filled", confirmed && stepValue <= nextValue);
        button.classList.toggle("is-preview-filled", !confirmed && stepValue <= nextValue);
        button.classList.toggle("is-current", confirmed && stepValue === nextValue);
        button.classList.toggle("is-preview-current", !confirmed && stepValue === nextValue);
        button.classList.toggle("is-near", !!options.dragging && Math.abs(stepValue - nextValue) === 1);
        button.setAttribute("aria-checked", String(confirmed && stepValue === nextValue));
        button.tabIndex = index === ratingCriterionIndex && stepValue === nextValue ? 0 : -1;
      });
      if (options.wave) setTimeout(() => {
        scale.querySelectorAll(".score-step").forEach((button) =>
          button.style.setProperty("--fill-delay", "0ms"));
      }, 230);
    };

    const setValue = (rawValue, options = {}) => {
      const nextValue = Math.max(1, Math.min(10, Math.round(rawValue)));
      const previous = Number(scale.dataset.value || value);
      const wasConfirmed = ratingConfirmed.has(criterion.id);
      if (wasConfirmed && previous === nextValue && options.source === "drag") return;
      ratingConfirmed.add(criterion.id);
      oninput(nextValue);
      paint(nextValue, {
        previous,
        wave: options.source === "tap" || options.source === "key",
        dragging: options.source === "drag",
      });
      if (!wasConfirmed || previous !== nextValue) scoreValueHaptic(previous, nextValue);
      updateStars("1");
      syncRatingCriterion();
    };

    for (let stepValue = 1; stepValue <= 10; stepValue++) {
      const button = el("button", "score-step");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", `${stepValue} из 10`);
      button.addEventListener("click", (event) => {
        if (scale.dataset.suppressClick === "true") {
          event.preventDefault();
          return;
        }
        setValue(stepValue, { source: "tap" });
      });
      button.addEventListener("keydown", (event) => {
        const keys = ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const current = Number(scale.dataset.value) || 5;
        const next = event.key === "Home" ? 1
          : event.key === "End" ? 10
            : Math.max(1, Math.min(10, current + (["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1)));
        setValue(next, { source: "key" });
        scale.querySelector(`.score-step[data-value="${next}"]`)?.focus();
      });
      button.dataset.value = String(stepValue);
      scale.append(button);
    }

    let scaleGesture = null;
    const valueFromPointer = (clientX) => {
      const rect = scale.getBoundingClientRect();
      return Math.max(1, Math.min(10, Math.floor(((clientX - rect.left) / rect.width) * 10) + 1));
    };
    const finishScaleGesture = (event) => {
      if (!scaleGesture || event.pointerId !== scaleGesture.pointerId) return;
      const moved = scaleGesture.moved;
      scaleGesture = null;
      scale.classList.remove("is-dragging");
      scale.classList.add("is-settling");
      if (scale.hasPointerCapture(event.pointerId)) scale.releasePointerCapture(event.pointerId);
      if (moved) {
        scale.dataset.suppressClick = "true";
        setTimeout(() => { scale.dataset.suppressClick = "false"; }, 0);
      }
      setTimeout(() => scale.classList.remove("is-settling"), 180);
      paint(Number(scale.dataset.value), { dragging: false });
    };
    scale.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button > 0) return;
      scaleGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        axis: "",
      };
      scale.setPointerCapture(event.pointerId);
      scale.classList.add("is-dragging");
    });
    scale.addEventListener("pointermove", (event) => {
      if (!scaleGesture || event.pointerId !== scaleGesture.pointerId) return;
      const dx = event.clientX - scaleGesture.startX;
      const dy = event.clientY - scaleGesture.startY;
      if (!scaleGesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 5)
        scaleGesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (scaleGesture.axis !== "x") return;
      scaleGesture.moved = true;
      event.preventDefault();
      setValue(valueFromPointer(event.clientX), { source: "drag" });
    });
    scale.addEventListener("pointerup", finishScaleGesture);
    scale.addEventListener("pointercancel", finishScaleGesture);

    paint(value);
    wrap.append(top, scale, anchors, hint);
    track.append(wrap);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "criterion-dot";
    dot.setAttribute("aria-label", `Перейти к критерию «${criterion.label}»`);
    dot.addEventListener("click", () => {
      if (moveRatingCriterion(index)) haptic("selection");
    });
    dots.append(dot);
  };

  CRITERIA.forEach((criterion, index) =>
    make(criterion, form.scores[criterion.id], index, (value) => {
      form.scores[criterion.id] = value;
    }));
  make(PERSONAL_CRITERION, form.personal, CRITERIA.length, (value) => {
    form.personal = value;
  });
  setupCriterionSwipe(viewport, track);
  syncRatingCriterion();
}

// обновить карточку звёзд (suffix "1" — на шаге оценок, "2" — на итоге)
function updateStars(suffix) {
  const confirmedQualityCriteria = CRITERIA.filter((criterion) => ratingConfirmed.has(criterion.id));
  const liveQuality = confirmedQualityCriteria.length
    ? Math.round(confirmedQualityCriteria.reduce(
      (sum, criterion) => sum + form.scores[criterion.id],
      0,
    ) / confirmedQualityCriteria.length * 10) / 10
    : 5;
  const q = suffix === "1" ? liveQuality : calcQuality(form.scores);
  const five = toFive(q);
  const previousFive = Number($("stars-shared").dataset.rating);
  renderStars($("stars-shared"), five);
  if (Number.isFinite(previousFive) && previousFive !== five) {
    const stars = $("stars-shared");
    stars.classList.remove("is-changing");
    void stars.offsetWidth;
    stars.classList.add("is-changing");
    setTimeout(() => stars.classList.remove("is-changing"), 220);
  }
  $("stars-shared").classList.toggle("is-preview", suffix === "1" && !confirmedQualityCriteria.length);
  $("stars-" + suffix + "-num").textContent = suffix === "2"
    ? `Твоя оценка — ${five} из 5`
    : `${five} из 5`;
  let tag = suffix === "1"
    ? ratingConfirmed.size
      ? `Пока ${verdict(q).toLocaleLowerCase("ru")}`
      : "Пока нейтрально"
    : `${verdict(q)} · среднее по критериям ${q.toFixed(1)}/10`;
  if (suffix === "2" && Math.abs(q - form.personal) >= 2) tag += " · зашло на " + form.personal;
  $("stars-" + suffix + "-tag").textContent = tag;
}

function syncTmdbComparison() {
  const node = $("tmdb-comparison");
  const rating = Number(form.tmdbRating);
  const votes = Number(form.tmdbVoteCount);
  if (!rating || !votes) {
    node.classList.add("hidden");
    return;
  }
  const five = (rating / 2).toLocaleString("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const voteLabel = new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(votes);
  node.textContent = `У зрителей TMDB — ${five} из 5 · ${voteLabel} оценок`;
  node.classList.remove("hidden");
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
    if (!ratingConfirmed.has(ratingCriterionAt().id)) {
      nudgeCurrentScale();
      return;
    }
    if (ratingCriterionIndex < CRITERIA.length) {
      haptic("impact", "soft");
      moveRatingCriterion(ratingCriterionIndex + 1);
    } else {
      haptic("impact", "soft");
      showStep(2);
    }
  } else if (step === 2) {
    return;
  } else {
    const review = $("e-review").value.trim();
    if (!review) {
      $("entry-err-text").textContent = "Напиши или отредактируй текст перед сохранением.";
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
    runtime: form.runtime,
    director: form.director,
    tmdbRating: form.tmdbRating,
    tmdbVoteCount: form.tmdbVoteCount,
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
    const message = "Не сохранилось. Попробуй ещё раз.";
    if (step === 2) {
      $("ai-request-status").textContent = message;
      $("ai-request-status").classList.add("is-error");
    } else {
      $("entry-err-text").textContent = message;
      $("entry-err").classList.remove("hidden");
    }
    return;
  }
  $("entry-err").classList.add("hidden");
  haptic("notification", "success");
  lastSavedEntryId = entryId;
  const saveButton = $("btn-primary");
  saveButton.textContent = "Сохранено";
  saveButton.classList.add("is-saved");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducedMotion) await new Promise((resolve) => setTimeout(resolve, 320));
  clearReviewWorkspace();
  recommendationsLoaded = false;
  recommendationPage = 1;

  // сброс формы и переход в дневник
  form = emptyForm();
  ratingConfirmed = new Set();
  editingEntryId = null;
  editingOriginalDate = "";
  $("f-query").value = ""; $("f-year").value = ""; $("f-genre").value = GENRES[0];
  $("f-liked").value = ""; $("f-disliked").value = ""; $("f-moment").value = "";
  syncFeelingCards();
  $("e-review").value = "";
  $("sliders").innerHTML = "";
  buildSliders();
  $("film-search").classList.remove("hidden");
  resetHeroShade();
  resetHeroInterface();
  $("film-hero").classList.add("hidden");
  document.body.classList.remove("hero-image-loaded");
  document.body.classList.remove("hero-no-image");
  document.body.style.setProperty("--hero-preview", "none");
  document.body.style.setProperty("--hero-image", "none");
  syncGenreAccent(null);
  showStep(0);
  $("tab-rate").classList.add("is-saved");
  await showTab("diary");
  setTimeout(() => {
    saveButton.classList.remove("is-saved");
    $("tab-rate").classList.remove("is-saved");
    document.querySelector(`[data-film-id="${lastSavedEntryId}"]`)?.classList.remove("is-new");
    lastSavedEntryId = null;
  }, reducedMotion ? 0 : 650);
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

function buildFeedStats(films) {
  const qualityOf = (film) => {
    const quality = Number(film.quality);
    return Number.isFinite(quality) ? Math.max(0, Math.min(10, quality)) : 0;
  };
  const averages = CRITERIA.map((criterion) => ({
    criterion: criterion.label,
    average: Number((films.reduce(
      (sum, film) => sum + Number(film.scores?.[criterion.id] || 0), 0
    ) / films.length).toFixed(1)),
  }));

  const byGenre = new Map();
  films.forEach((film) => {
    const genre = String(film.genre || "Другое").trim() || "Другое";
    if (!byGenre.has(genre)) byGenre.set(genre, []);
    byGenre.get(genre).push(film);
  });
  const genreGroups = [...byGenre.entries()].map(([genre, entries]) => {
    const latestTimestamp = entries.reduce(
      (latest, film) => Math.max(latest, filmTimestamp(film)), 0
    );
    const best = [...entries].sort((a, b) => qualityOf(b) - qualityOf(a))[0];
    return { genre, entries, latestTimestamp, best };
  });
  const mostFrequent = [...genreGroups].sort((a, b) =>
    b.entries.length - a.entries.length || b.latestTimestamp - a.latestTimestamp
  )[0];
  const longestAbsent = genreGroups.length > 1
    ? [...genreGroups].filter((group) => group.latestTimestamp)
      .sort((a, b) => a.latestTimestamp - b.latestTimestamp)[0]
    : null;
  const bestByGenre = [...genreGroups]
    .sort((a, b) => b.entries.length - a.entries.length ||
      qualityOf(b.best) - qualityOf(a.best))
    .slice(0, 2)
    .map((group) => ({
      genre: group.genre,
      title: group.best.title,
      rating: toFive(qualityOf(group.best)),
      filmsInGenre: group.entries.length,
    }));
  const latest = films[0];

  return {
    total: films.length,
    averages,
    ...(mostFrequent ? {
      mostFrequentGenre: { genre: mostFrequent.genre, count: mostFrequent.entries.length },
    } : {}),
    ...(longestAbsent ? {
      longestAbsentGenre: {
        genre: longestAbsent.genre,
        days: Math.max(0, Math.floor((Date.now() - longestAbsent.latestTimestamp) / DAY_MS)),
      },
    } : {}),
    bestByGenre,
    ...(latest ? {
      latestFilm: {
        title: latest.title,
        genre: latest.genre || "Другое",
        rating: toFive(qualityOf(latest)),
      },
    } : {}),
  };
}

function directorCreditOf(details) {
  return (details?.credits?.crew || []).find(
    (person) => person.job === "Director" && Number(person.id) && person.name
  ) || null;
}

function catalogSource(details, fallbackFilm, director) {
  const movieId = Number(details.id || fallbackFilm.movieId || fallbackFilm.tmdbId) || 0;
  const poster = details.poster_path
    ? tmdbPoster(details.poster_path, "w500")
    : (fallbackFilm.poster || "");
  return {
    id: movieId,
    title: details.title || fallbackFilm.title,
    originalTitle: details.original_title || "",
    year: Number(yearOf(details) || fallbackFilm.year),
    releaseDate: details.release_date || "",
    director: director?.name || directorsOf(details) || fallbackFilm.director || "",
    runtime: Number(details.runtime) || Number(fallbackFilm.runtime) || 0,
    budget: Number(details.budget) || 0,
    revenue: Number(details.revenue) || 0,
    productionCountries: (details.production_countries || []).map((country) => country.name).filter(Boolean),
    collection: details.belongs_to_collection?.name || "",
    tmdbRating: Number(details.vote_average) || 0,
    tmdbVoteCount: Number(details.vote_count) || 0,
    poster,
    posterPreview: details.poster_path
      ? tmdbPoster(details.poster_path, "w92")
      : (fallbackFilm.posterPreview || microPreview(poster, "w92")),
  };
}

function otherDirectorFilms(credits, sourceId, ratedIds) {
  const unique = new Map();
  (credits?.crew || []).forEach((movie) => {
    if (movie.job !== "Director" || !movie.title || Number(movie.id) === Number(sourceId) ||
        ratedIds.has(Number(movie.id))) return;
    const year = Number(yearOf(movie));
    if (!year) return;
    const previous = unique.get(movie.id);
    if (!previous || Number(movie.vote_count) > Number(previous.vote_count)) unique.set(movie.id, movie);
  });
  return [...unique.values()]
    .sort((a, b) => Number(b.vote_count || 0) - Number(a.vote_count || 0) ||
      Number(b.popularity || 0) - Number(a.popularity || 0))
    .slice(0, 6)
    .map((movie) => ({
      id: Number(movie.id) || 0,
      title: movie.title,
      year: Number(yearOf(movie)),
      poster: tmdbPoster(movie.poster_path, "w500"),
      posterPreview: tmdbPoster(movie.poster_path, "w92"),
    }));
}

async function buildFeedCatalogForFilm(film, ratedIds) {
  const movieId = Number(film.movieId || film.tmdbId);
  if (!movieId) return null;
  const details = await loadMovieDetails(movieId);
  if (!details) return null;
  const director = directorCreditOf(details);
  let related = [];
  if (director) {
    const credits = await loadDirectorMovies(director.id).catch(() => null);
    related = otherDirectorFilms(credits, movieId, ratedIds);
  }
  return {
    source: catalogSource(details, film, director),
    sourceMovieId: movieId,
    otherFilmsByDirector: related,
  };
}

async function buildFeedCatalog(films, facts = []) {
  const seeds = films.filter((film) => Number(film.movieId || film.tmdbId)).slice(0, 6);
  if (!seeds.length) return null;
  const ratedIds = new Set(films.map((film) => Number(film.movieId || film.tmdbId)).filter(Boolean));
  const usedSourceIds = new Set(facts.map((fact) => Number(fact.sourceMovieId)).filter(Boolean));
  const unseenSeeds = seeds.filter(
    (film) => !usedSourceIds.has(Number(film.movieId || film.tmdbId))
  );
  const candidates = unseenSeeds.length ? unseenSeeds : seeds;
  const start = Math.floor(Date.now() / DAY_MS) % candidates.length;

  for (let offset = 0; offset < candidates.length; offset++) {
    const film = candidates[(start + offset) % candidates.length];
    try {
      const catalog = await buildFeedCatalogForFilm(film, ratedIds);
      if (catalog) return catalog;
    } catch (_) {
      // Пробуем следующую запись: один недоступный фильм не должен ломать всю ленту.
    }
  }
  return null;
}

function feedFactArtwork(catalog, insight) {
  const normalizedInsight = normalizeTitle(insight || "");
  const mentionedFilm = [...(catalog.otherFilmsByDirector || [])]
    .sort((a, b) => normalizeTitle(b.title || "").length - normalizeTitle(a.title || "").length)
    .find((film) => {
      const title = normalizeTitle(film.title || "");
      return title.length >= 3 && normalizedInsight.includes(title);
    });
  const film = mentionedFilm || catalog.source || {};
  return {
    posterTitle: film.title || "",
    posterMovieId: Number(film.id || catalog.sourceMovieId) || 0,
    poster: film.poster || "",
    posterPreview: film.posterPreview || microPreview(film.poster || "", "w92"),
  };
}

async function hydrateFeedFactArtwork(facts, films) {
  const missing = facts.filter((fact) => !fact.poster && Number(fact.sourceMovieId));
  if (!missing.length) return facts;

  const ratedIds = new Set(films.map((film) => Number(film.movieId || film.tmdbId)).filter(Boolean));
  const filmsByMovieId = new Map(films.map(
    (film) => [Number(film.movieId || film.tmdbId), film]
  ));
  let changed = false;
  const hydrated = [];

  for (const fact of facts) {
    if (fact.poster || !Number(fact.sourceMovieId)) {
      hydrated.push(fact);
      continue;
    }
    const sourceFilm = filmsByMovieId.get(Number(fact.sourceMovieId));
    if (!sourceFilm) {
      hydrated.push(fact);
      continue;
    }
    try {
      const catalog = await buildFeedCatalogForFilm(sourceFilm, ratedIds);
      const artwork = catalog ? feedFactArtwork(catalog, fact.insight) : null;
      if (artwork?.poster) {
        hydrated.push({ ...fact, ...artwork });
        changed = true;
      } else hydrated.push(fact);
    } catch (_) {
      hydrated.push(fact);
    }
  }

  if (changed) {
    try { await saveFeedFacts(hydrated); } catch (_) { /* оформление факта необязательно */ }
  }
  return hydrated;
}

function feedCacheFilmId(films) {
  return String(films[0]?.entryId || films[0]?.id || "");
}

function shouldGenerateFeedFact(facts, films) {
  const latest = facts[0];
  if (!latest) return true;
  const age = Date.now() - Number(latest.generatedAt || 0);
  const diaryChanged = Number(latest.filmsCount) !== films.length ||
    String(latest.lastFilmId || "") !== feedCacheFilmId(films);
  return diaryChanged || age < 0 || age >= DAY_MS;
}

function feedFactReason(catalog) {
  const title = catalog.source?.title || "этот фильм";
  const director = catalog.source?.director || "";
  return director
    ? `${director} снял «${title}» — фильм, который ты оценил раньше.`
    : `«${title}» есть в твоём дневнике — поэтому этот факт появился в ленте.`;
}

function aiFeedCard(fact, index, films) {
  const linkedFilm = films.find(
    (film) => Number(film.movieId || film.tmdbId) === Number(fact.sourceMovieId)
  );
  const reason = fact.reason || (fact.sourceTitle
    ? `Этот факт связан с фильмом «${fact.sourceTitle}» из твоего дневника.`
    : "Этот факт связан с фильмом, который ты оценил раньше.");
  const posterFilm = fact.poster ? {
    title: fact.posterTitle || fact.sourceTitle,
    poster: fact.poster,
    posterPreview: fact.posterPreview,
  } : (linkedFilm || null);
  const card = feedCard({
    type: "ai-fact",
    label: "Киносвязь",
    title: fact.insight,
    detail: reason,
    film: linkedFilm || null,
    posterFilm,
    action: linkedFilm ? "film" : "diary",
    actionLabel: linkedFilm ? "Открыть запись" : "Открыть дневник",
  }, index);
  if (fact.posterTitle) card.dataset.posterTitle = fact.posterTitle;
  card.setAttribute("aria-label", `Киносвязь. ${fact.insight} Почему она здесь: ${reason}`);
  return card;
}

function insertAiFeedCards(list, facts, films, revision) {
  if (revision !== feedRenderRevision || list !== $("feed-list") || !list.isConnected) return;
  list.querySelectorAll(".feed-card--ai-fact").forEach((card) => card.remove());
  list.prepend(...facts.slice(0, MAX_FEED_FACTS).map(
    (fact, index) => aiFeedCard(fact, index, films)
  ));
}

async function maybeRenderAiFeedCard(films, list, revision) {
  if (!films.length) return;

  let facts = await loadFeedFacts();
  facts = await hydrateFeedFactArtwork(facts, films);
  if (revision !== feedRenderRevision) return;
  insertAiFeedCards(list, facts, films, revision);
  if (!shouldGenerateFeedFact(facts, films) || !AI_FEED_ENDPOINT) return;

  const catalog = await buildFeedCatalog(films, facts);
  if (revision !== feedRenderRevision || !catalog) return;

  const controller = new AbortController();
  aiFeedRequestController = controller;
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(AI_FEED_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stats: buildFeedStats(films),
        catalog,
        previousInsights: facts.slice(0, MAX_FEED_FACTS).map((fact) => fact.insight),
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    const insight = typeof data.insight === "string" ? data.insight.trim() : "";
    if (!response.ok || !insight || insight.length > 600) return;

    const now = Date.now();
    const repeatedIndex = facts.findIndex(
      (fact) => fact.insight.toLocaleLowerCase("ru") === insight.toLocaleLowerCase("ru")
    );
    if (repeatedIndex >= 0) {
      const updatedFacts = facts.map((fact, index) => index === repeatedIndex ? {
        ...fact,
        generatedAt: now,
        filmsCount: films.length,
        lastFilmId: feedCacheFilmId(films),
      } : fact);
      try { await saveFeedFacts(updatedFacts); } catch (_) { /* история необязательна */ }
      insertAiFeedCards(list, updatedFacts, films, revision);
      return;
    }

    const nextFact = {
      id: now,
      insight,
      reason: feedFactReason(catalog),
      sourceTitle: catalog.source?.title || "",
      sourceDirector: catalog.source?.director || "",
      sourceMovieId: Number(catalog.sourceMovieId) || 0,
      ...feedFactArtwork(catalog, insight),
      generatedAt: now,
      filmsCount: films.length,
      lastFilmId: feedCacheFilmId(films),
    };
    const nextFacts = [nextFact, ...facts].slice(0, MAX_FEED_FACTS);
    try { await saveFeedFacts(nextFacts); } catch (_) { /* история не блокирует ленту */ }
    insertAiFeedCards(list, nextFacts, films, revision);
  } catch (_) {
    // AI-факты необязательны: при сети, лимите или таймауте сохранённая лента остаётся как есть.
  } finally {
    clearTimeout(timeout);
    if (aiFeedRequestController === controller) aiFeedRequestController = null;
  }
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
  card.style.setProperty("--feed-index", Math.min(index, 4));
  card.style.setProperty("--feed-accent", insight.genre ? genreColor(insight.genre) : "var(--accent)");

  const copy = el("span", "feed-card-copy");
  copy.append(el("span", "feed-card-label", insight.label));
  copy.append(el("span", "feed-card-title", insight.title));
  copy.append(el("span", "feed-card-detail", insight.detail));
  const action = el("span", "feed-card-action", insight.actionLabel);
  action.append(el("i", "feed-arrow"));
  copy.append(action);
  card.append(copy);

  const posterFilm = insight.posterFilm || insight.film;
  if (posterFilm?.poster) {
    card.append(blurPicture(
      posterFilm.posterPreview || microPreview(posterFilm.poster, "w92"),
      posterFilm.poster,
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

function feedGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

function feedProfileName() {
  const user = telegramUser();
  return user.first_name || profile.name || user.username || "Киноман";
}

function renderFeedHero(film = null) {
  const hero = $("feed-hero");
  hero.innerHTML = "";
  hero.classList.toggle("hidden", !film);
  document.body.classList.toggle("feed-has-hero", !!film && tab === "feed");
  if (!film) return;

  const heroBackdrop = originalBackdrop(film.backdrop, "w1280") || film.poster;
  const heroPreview = originalBackdrop(film.backdropPreview || film.backdrop, "w300") ||
    film.posterPreview || microPreview(film.poster, "w92");
  setBlurBackground(
    hero,
    heroPreview,
    heroBackdrop,
    "--feed-hero-preview",
    "--feed-hero-image",
    "is-image-loaded",
  );

  const shade = el("div", "feed-hero-shade");
  shade.setAttribute("aria-hidden", "true");
  const brand = el("div", "feed-hero-brand", "SYO");

  const open = el("button", "feed-hero-open");
  open.type = "button";
  open.append(
    el("span", "feed-hero-greeting", `${feedGreeting()}, ${feedProfileName()}`),
    el("span", "feed-hero-label", "Из дневника"),
    el("strong", "feed-hero-title", film.title),
    el("span", "feed-hero-meta",
      [`${toFive(film.quality).toFixed(1)} из 5`, visibleGenre(film.genre)].filter(Boolean).join(" · ")),
  );
  open.addEventListener("click", () => {
    haptic("impact", "rigid");
    openDiaryFilm(film);
  });
  hero.append(shade, brand, open);
  scheduleHeroParallax();
}

async function renderFeed() {
  const revision = ++feedRenderRevision;
  aiFeedRequestController?.abort();
  aiFeedRequestController = null;
  const list = $("feed-list");
  list.innerHTML = "";
  let films;
  try {
    films = await store.getAll();
  } catch (e) {
    renderFeedHero();
    list.append(el("div", "feed-error", "Не удалось собрать ленту. Попробуй открыть её ещё раз."));
    return;
  }

  if (!films.length) {
    renderFeedHero();
    const empty = el("section", "feed-empty");
    empty.append(el("span", "feed-empty-kicker", "Пример будущих наблюдений"));
    empty.append(el("h2", "", "Дневник начнёт замечать связи"));
    empty.append(el("p", "", "После нескольких оценок здесь появятся закономерности, возвращения и фильмы с похожим ощущением."));
    const previews = el("div", "feed-preview-stack");
    [
      "Какие фильмы ты чаще оцениваешь выше",
      "К каким режиссёрам и жанрам возвращаешься",
      "Что оставляет у тебя похожее ощущение",
    ].forEach((text, index) => {
      const preview = el("article", "feed-preview");
      preview.append(el("span", "", `0${index + 1}`), el("strong", "", text));
      previews.append(preview);
    });
    empty.append(previews);
    const cta = el("button", "primary feed-empty-cta", "Оценить первый фильм");
    cta.type = "button";
    cta.addEventListener("click", () => {
      haptic("impact", "rigid");
      showTab("rate");
    });
    empty.append(cta);
    list.append(empty);
    return;
  }

  renderFeedHero(films[0]);

  if (films.length <= 2) {
    const starter = el("section", "feed-starter");
    starter.append(el("span", "feed-starter-mark", "Лента собирается"));
    starter.append(el("h2", "", "Уже есть что рассказать"));
    starter.append(el("p", "", `Ещё ${3 - films.length} ${films.length === 1 ? "оценки" : "оценка"} — и здесь появятся первые закономерности твоего вкуса.`));
    const cta = el("button", "feed-starter-action", "Оценить ещё фильм");
    cta.type = "button";
    cta.addEventListener("click", () => showTab("rate"));
    starter.append(cta);
    list.append(starter);
    void maybeRenderAiFeedCard(films, list, revision);
    return;
  }

  feedInsights(films).forEach((insight, index) => list.append(feedCard(insight, index)));
  void maybeRenderAiFeedCard(films, list, revision);
}

// ─── Дневник: статистика и записи ────────────────────────────────

async function hydrateDiaryMetadata(films) {
  const missing = films
    .filter((film) => Number(film.movieId || film.tmdbId) &&
      (!Number(film.runtime) || !film.director || !Number(film.tmdbRating)))
    .slice(0, 6);
  if (!missing.length) return null;

  const enriched = new Map();
  await Promise.all(missing.map(async (film) => {
    try {
      const details = await loadMovieDetails(film.movieId || film.tmdbId);
      if (!details) return;
      const updated = {
        ...film,
        runtime: Number(details.runtime) || Number(film.runtime) || 0,
        director: directorsOf(details) || film.director || "",
        tmdbRating: Number(details.vote_average) || Number(film.tmdbRating) || 0,
        tmdbVoteCount: Number(details.vote_count) || Number(film.tmdbVoteCount) || 0,
      };
      enriched.set(film.id, updated);
      await store.save(updated);
    } catch (_) { /* статистика остаётся доступной и без метаданных TMDB */ }
  }));
  return films.map((film) => enriched.get(film.id) || film);
}

async function renderDiary() {
  const list = $("diary-list");
  list.innerHTML = "";
  let films;
  try {
    films = await store.getAll();
  } catch (e) {
    $("diary-view-tabs").classList.add("hidden");
    list.append(el("div", "empty", "Не удалось загрузить дневник: " + (e.message || e)));
    return;
  }
  if (!films.length) {
    $("diary-view-tabs").classList.add("hidden");
    $("stats").classList.add("hidden");
    $("diary-feature").classList.add("hidden");
    const empty = el("section", "empty");
    empty.append(
      el("h2", "", "Здесь начнётся твоя история"),
      el("p", "", "После первой оценки появятся фильм, дата и мысли, к которым можно вернуться."),
    );
    const cta = el("button", "primary", "Оценить первый фильм");
    cta.type = "button";
    cta.addEventListener("click", () => showTab("rate"));
    empty.append(cta);
    list.append(empty);
    return;
  }
  $("diary-view-tabs").classList.remove("hidden");
  setDiaryView(diaryView, false);
  $("stats").classList.remove("hidden");
  renderDiaryFeature(films[0]);
  renderStats(films);
  films.forEach((f) => list.append(filmItem(f)));
  void hydrateDiaryMetadata(films).then((enriched) => {
    if (enriched && tab === "diary") renderStats(enriched);
  });
}

function setDiaryView(view, buzz = true) {
  diaryView = view === "stats" ? "stats" : "history";
  $("screen-diary").dataset.view = diaryView;
  const history = $("diary-tab-history");
  const stats = $("diary-tab-stats");
  history.classList.toggle("on", diaryView === "history");
  stats.classList.toggle("on", diaryView === "stats");
  history.setAttribute("aria-selected", String(diaryView === "history"));
  stats.setAttribute("aria-selected", String(diaryView === "stats"));
  if (buzz) haptic("selection");
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
  copy.append(el("span", "", "Последняя запись"));
  copy.append(el("h2", "", film.title));
  copy.append(el("div", "diary-feature-stars", `${toFive(film.quality).toFixed(1)} из 5`));
  copy.append(el("p", "", [visibleGenre(film.genre), film.date].filter(Boolean).join(" · ")));
  box.append(copy);
  const openLatest = () => {
    expandedId = film.id;
    renderDiary().then(() => {
      document.querySelector(`[data-film-id="${film.id}"]`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  };
  box.setAttribute("role", "button");
  box.setAttribute("tabindex", "0");
  box.setAttribute("aria-label", `Открыть последнюю запись: ${film.title}`);
  box.onclick = openLatest;
  box.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openLatest();
  };
  box.classList.remove("hidden");
}

function renderStats(films) {
  // плашки: сколько фильмов, средняя оценка, любимый жанр и время просмотра
  $("st-total").textContent = films.length;
  $("diary-praise").textContent = films.length <= 4
    ? `В дневнике уже ${films.length} ${filmsWord(films.length)}`
    : films.length <= 14
      ? `${films.length} ${filmsWord(films.length)} уже складываются в историю`
      : films.length <= 29
        ? `${films.length} ${filmsWord(films.length)} показывают первые привычки`
        : `${films.length} ${filmsWord(films.length)} уже описывают твой вкус`;
  const avg = films.reduce((s, f) => s + toFive(f.quality), 0) / films.length;
  $("st-avg").textContent = (Math.round(avg * 10) / 10).toFixed(1);

  const byGenre = {};
  films.forEach((f) => { byGenre[f.genre] = (byGenre[f.genre] || 0) + 1; });
  const sorted = Object.entries(byGenre).sort((a, b) => b[1] - a[1]);
  $("st-genre").textContent = sorted[0][0];
  const totalRuntime = films.reduce((sum, film) => sum + Math.max(0, Number(film.runtime) || 0), 0);
  $("st-runtime").textContent = formatRuntime(totalRuntime);

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
    track.append(fill);
    row.append(top, track);
    gb.append(row);
  });

  const byDirector = new Map();
  films.forEach((film) => {
    String(film.director || "").split(",").map((name) => name.trim()).filter(Boolean)
      .forEach((name) => {
        const current = byDirector.get(name) || { count: 0, quality: 0 };
        current.count += 1;
        current.quality += toFive(film.quality);
        byDirector.set(name, current);
      });
  });
  const directors = [...byDirector.entries()]
    .map(([name, data]) => ({ name, ...data, average: data.quality / data.count }))
    .sort((a, b) => b.count - a.count || b.average - a.average)
    .slice(0, 3);
  const directorCard = $("director-card");
  const directorBars = $("director-bars");
  directorBars.innerHTML = "";
  directorCard.classList.toggle("hidden", !directors.length);
  if (directors.length) {
    const maxDirectorCount = directors[0].count;
    directors.forEach((director) => {
      const row = el("div", "director-row");
      const copy = el("div", "director-copy");
      copy.append(
        el("div", "director-name", director.name),
        el("div", "director-meta", `${director.count} ${filmsWord(director.count)} · средняя ${director.average.toFixed(1)}`),
      );
      const track = el("div", "director-track");
      const fill = el("div", "director-fill");
      fill.style.width = `${(director.count / maxDirectorCount) * 100}%`;
      track.append(fill);
      row.append(copy, track);
      directorBars.append(row);
    });
  }
}

function filmItem(f) {
  const item = el("article", "film");
  item.dataset.filmId = f.id;
  item.classList.toggle("is-new", String(f.id) === String(lastSavedEntryId));
  item.style.setProperty("--film-accent", genreColor(f.genre));
  const top = el("button", "film-top");
  top.type = "button";
  top.setAttribute("aria-expanded", String(expandedId === f.id));
  top.setAttribute("aria-label", `${expandedId === f.id ? "Свернуть" : "Открыть"} запись о фильме «${f.title}»`);
  const poster = f.poster
    ? blurPicture(f.posterPreview || microPreview(f.poster, "w92"), f.poster, "poster")
    : el("div", "poster movie-placeholder", "SYO");
  top.append(poster);
  const info = el("div", "film-info");
  info.append(el("div", "film-title", f.title + (f.year ? ` (${f.year})` : "")));
  info.append(el("div", "film-meta", [visibleGenre(f.genre), f.date].filter(Boolean).join(" · ")));
  if (f.review) info.append(el("p", "film-excerpt", f.review));
  top.append(info);
  top.append(el("div", "film-score", toFive(f.quality).toFixed(1)));
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
      exp.textContent = (await copyText(text)) ? "Скопировано" : "Не удалось скопировать";
      setTimeout(() => { exp.textContent = "Экспорт текстом"; }, 2000);
    });
    const del = el("button", "linkbtn danger", "Удалить");
    del.addEventListener("click", async () => {
      if (!(await confirmAsk(`Удалить запись «${f.title}»?`))) return;
      try {
        await store.removeFilm(f);
        expandedId = null;
        await renderDiary();
        haptic("notification", "success");
      } catch (error) {
        const message = "Не удалось удалить запись. Попробуй ещё раз.";
        if (inTelegram && typeof tg.showAlert === "function") tg.showAlert(message);
        else window.alert(message);
        haptic("notification", "error");
      }
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

function setProfileBioEditing(editing) {
  $("profile-bio-view").classList.toggle("hidden", editing);
  $("profile-bio-editor").classList.toggle("hidden", !editing);
  $("btn-profile-bio-done").classList.toggle("hidden", !editing);
  if (editing) requestAnimationFrame(() => $("profile-bio").focus());
}

function syncProfileBioView() {
  const bio = $("profile-bio").value.trim();
  $("profile-bio-text").textContent = bio;
  $("btn-profile-bio-add").classList.toggle("hidden", !!bio);
  $("profile-bio-copy").classList.toggle("hidden", !bio);
}

async function renderProfile() {
  $("profile-name").textContent = profileName();
  $("profile-bio").value = profile.bio || "";
  profileDraftFavorites = [...(profile.favorites || [])].map(String);
  $("profile-bio-count").textContent = $("profile-bio").value.length;
  syncProfileBioView();
  setProfileBioEditing(false);
  syncProfileAvatar();
  const films = await store.getAll();
  renderProfileStats(films);
  await renderProfileFavorites(films);
  profileBaseline = profileDraftSnapshot();
  syncProfileDirty();
  window.scrollTo(0, 0);
}

function renderProfileStats(films) {
  $("profile-stat-total").textContent = films.length;
  if (!films.length) {
    $("profile-stat-avg").textContent = "—";
    $("profile-stat-genre").textContent = "—";
    $("profile-taste-summary").textContent =
      "Портрет появится после первых оценок: дневник заметит любимые жанры и то, к чему ты строже всего.";
    return;
  }
  const average = films.reduce((sum, film) => sum + toFive(film.quality), 0) / films.length;
  $("profile-stat-avg").textContent = average.toFixed(1);
  const genres = new Map();
  films.forEach((film) => genres.set(film.genre, (genres.get(film.genre) || 0) + 1));
  $("profile-stat-genre").textContent = [...genres.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  const strongest = CRITERIA.map((criterion) => ({
    label: criterion.label.toLocaleLowerCase("ru"),
    average: films.reduce((sum, film) =>
      sum + Number(film.scores?.[criterion.id] || 0), 0) / films.length,
  })).sort((a, b) => b.average - a.average)[0];
  const favoriteGenre = [...genres.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  $("profile-taste-summary").textContent =
    `Чаще всего в дневнике — ${favoriteGenre.toLocaleLowerCase("ru")}. ` +
    `Выше всего ты обычно оцениваешь: ${strongest.label}.`;
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

async function renderProfileFavorites(filmsInput = null) {
  const grid = $("profile-favorites");
  grid.innerHTML = "";
  const films = filmsInput || await store.getAll();
  const selected = new Set(profileDraftFavorites);
  const favoriteFilms = films.filter((film) => selected.has(String(film.entryId || film.id))).slice(0, 4);
  favoriteFilms.forEach((film) => {
    const id = String(film.entryId || film.id);
    const button = el("button", "favorite-option");
    button.type = "button";
    button.dataset.entryId = id;
    button.classList.add("is-selected");
    if (film.poster) button.append(blurPicture(film.posterPreview, film.poster, "favorite-poster", "lazy"));
    else button.append(el("span", "favorite-poster favorite-placeholder", "SYO"));
    button.append(el("strong", "", film.title));
    button.append(el("i", "favorite-check"));
    button.addEventListener("click", openFavoritesPicker);
    grid.append(button);
  });
  for (let i = favoriteFilms.length; i < 4; i++) {
    const empty = el("button", "favorite-empty");
    empty.type = "button";
    empty.append(el("span", "", "+"), el("small", "", "Добавить"));
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
    item.append(el("span", "", film.title), el("i", "picker-mark", checkbox.checked ? "" : "+"));
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && selected.size >= 4) {
        checkbox.checked = false;
        haptic("notification", "warning");
        return;
      }
      if (checkbox.checked) selected.add(id);
      else selected.delete(id);
      item.classList.toggle("is-selected", checkbox.checked);
      item.querySelector("i").textContent = checkbox.checked ? "" : "+";
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
  syncProfileBioView();
  setProfileBioEditing(false);
  haptic("notification", "success");
  const button = $("btn-profile-save");
  button.textContent = "Сохранено";
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

function buildOnboarding() {
  const box = $("onboarding-genres");
  box.innerHTML = "";
  GENRES.filter((genre) => genre !== "Другое").forEach((genre) => {
    const chip = el("button", "genre-chip", genre);
    chip.type = "button";
    chip.classList.toggle("is-selected", selectedOnboardingGenres.has(genre));
    chip.setAttribute("aria-pressed", String(selectedOnboardingGenres.has(genre)));
    chip.addEventListener("click", () => {
      if (selectedOnboardingGenres.has(genre)) selectedOnboardingGenres.delete(genre);
      else selectedOnboardingGenres.add(genre);
      chip.classList.toggle("is-selected", selectedOnboardingGenres.has(genre));
      chip.setAttribute("aria-pressed", String(selectedOnboardingGenres.has(genre)));
      $("btn-onboarding-next").disabled = selectedOnboardingGenres.size < 3;
      $("onboarding-genres").classList.remove("needs-choice");
      haptic("selection");
    });
    box.append(chip);
  });
  $("btn-onboarding-next").disabled = selectedOnboardingGenres.size < 3;
}

function setOnboardingActive(active) {
  document.body.classList.toggle("onboarding-open", active);
  document.querySelectorAll("#header, .app-screen, #footer").forEach((node) => {
    node.toggleAttribute("inert", active);
    node.setAttribute("aria-hidden", String(active));
  });
}

function showOnboarding() {
  buildOnboarding();
  $("onboarding-step-1").classList.remove("hidden");
  $("onboarding-step-2").classList.add("hidden");
  $("onboarding-step-3").classList.add("hidden");
  $("onboarding").setAttribute("aria-labelledby", "onboarding-title");
  if (!["trusted", "unexpected", "balanced"].includes(selectedFrequency)) selectedFrequency = "";
  document.querySelectorAll("#onboarding-frequency button").forEach((button) => {
    const selected = button.dataset.frequency === selectedFrequency;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("btn-onboarding-finish").disabled = !selectedFrequency;
  $("frequency-err").classList.add("hidden");
  $("onboarding").classList.remove("hidden");
  setOnboardingActive(true);
  requestAnimationFrame(() => $("onboarding-title").focus());
}

async function finishOnboarding() {
  if (selectedOnboardingGenres.size < 3 ||
      !["trusted", "unexpected", "balanced"].includes(selectedFrequency)) return false;
  profile = {
    ...profile,
    onboarded: true,
    genres: [...selectedOnboardingGenres],
    frequency: selectedFrequency,
    name: profileName(),
  };
  await saveProfileData(profile);
  $("onboarding").classList.add("hidden");
  setOnboardingActive(false);
  syncProfileAvatar();
  recommendationsLoaded = false;
  loadRecommendations();
  haptic("notification", "success");
  return true;
}

// ─── Запуск ──────────────────────────────────────────────────────
GENRES.forEach((g) => $("f-genre").append(new Option(g, g)));
buildSliders();

$("f-query").addEventListener("input", onQueryInput);
$("f-query").addEventListener("focus", () => {
  setSearchMode(true);
  resetRateScrollPosition();
});
$("btn-query-clear").addEventListener("click", clearSearchQuery);
$("btn-search-cancel").addEventListener("click", () => {
  $("f-query").value = "";
  closeSearchKeyboard();
  resetSearchView();
});
if (window.visualViewport) {
  ["resize", "scroll"].forEach((event) =>
    window.visualViewport.addEventListener(event, scheduleViewportSync));
  window.visualViewport.addEventListener("resize", () => scheduleOverviewDisclosure());
}
window.addEventListener("resize", () => {
  scheduleOverviewDisclosure();
  syncRatingCriterion();
});
window.addEventListener("scroll", scheduleHeroParallax, { passive: true });
window.addEventListener("orientationchange", () => setTimeout(() => {
  if (!(document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement)) syncKeyboardViewport();
}, 300));
$("btn-hero-primary").addEventListener("click", () => $("btn-primary").click());
$("btn-overview-toggle").addEventListener("click", toggleOverview);
$("btn-back").addEventListener("click", () => {
  haptic("impact", "soft");
  if (step === 0 && form.title) clearFilm();
  else if (step === 0) requestRateExit();
  else if (step === 1 && ratingCriterionIndex > 0) moveRatingCriterion(ratingCriterionIndex - 1);
  else if (step === 1) showStep(0);
  else showStep(step - 1);
});
$("search-scrim").addEventListener("click", () => {
  $("f-query").value = "";
  closeSearchKeyboard();
  resetSearchView();
});
$("btn-primary").addEventListener("click", primaryAction);
$("btn-save-empty").addEventListener("click", () => saveEntry(""));

$("btn-notes-ai").addEventListener("click", generateReviewWithGemini);
$("btn-notes-self").addEventListener("click", startSelfReview);
$("btn-notes-save").addEventListener("click", () => {
  captureNotes();
  saveEntry("");
});
$("e-review").addEventListener("input", () => {
  $("entry-err").classList.add("hidden");
  $("review-editor-count").textContent = $("e-review").value.length;
  form.review = $("e-review").value;
  persistReviewWorkspace();
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
$("diary-tab-history").addEventListener("click", () => setDiaryView("history"));
$("diary-tab-stats").addEventListener("click", () => setDiaryView("stats"));
$("f-genre").addEventListener("change", () => syncGenreAccent($("f-genre").value));

["f-liked", "f-disliked", "f-moment"].forEach((id) => {
  $(id).addEventListener("input", () => {
    syncFeelingCards();
    $("ai-request-status").textContent = "";
    $("ai-request-status").classList.remove("is-error");
    syncReviewChoiceState();
    persistReviewWorkspace();
  });
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
$("btn-exit-rate").addEventListener("click", () => {
  closeRateExitDialog();
  leaveRateFlow();
});
$("btn-stay-rate").addEventListener("click", closeRateExitDialog);
$("exit-rate-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeRateExitDialog();
});

$("btn-profile-save").addEventListener("click", saveProfileFromForm);
$("btn-profile-bio-add").addEventListener("click", () => setProfileBioEditing(true));
$("btn-profile-bio-edit").addEventListener("click", () => setProfileBioEditing(true));
$("btn-profile-bio-done").addEventListener("click", () => {
  syncProfileBioView();
  setProfileBioEditing(false);
  syncProfileDirty();
  haptic("selection");
});
$("profile-bio").addEventListener("input", () => {
  $("profile-bio-count").textContent = $("profile-bio").value.length;
  syncProfileDirty();
});
document.addEventListener("focusin", (event) => {
  syncKeyboardViewport();
  if (tab !== "rate" || !(event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) return;
  setTimeout(() => {
    if (syncKeyboardViewport()) keepFocusedControlVisible(event.target);
  }, 260);
});
document.addEventListener("focusout", () => setTimeout(syncKeyboardViewport, 320));
$("btn-onboarding-start").addEventListener("click", () => {
  $("onboarding-step-1").classList.add("hidden");
  $("onboarding-step-2").classList.remove("hidden");
  $("onboarding").setAttribute("aria-labelledby", "onboarding-genres-title");
  requestAnimationFrame(() => $("onboarding-genres-title").focus());
});
$("btn-onboarding-next").addEventListener("click", () => {
  if (selectedOnboardingGenres.size < 3) {
    $("onboarding-genres").classList.add("needs-choice");
    haptic("notification", "warning");
    return;
  }
  $("onboarding-genres").classList.remove("needs-choice");
  $("onboarding-step-2").classList.add("hidden");
  $("onboarding-step-3").classList.remove("hidden");
  $("onboarding").setAttribute("aria-labelledby", "onboarding-frequency-title");
  requestAnimationFrame(() => $("onboarding-frequency-title").focus());
});
document.querySelectorAll("#onboarding-frequency button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedFrequency = button.dataset.frequency;
    document.querySelectorAll("#onboarding-frequency button").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    $("btn-onboarding-finish").disabled = false;
    $("onboarding-frequency").classList.remove("needs-choice");
    $("frequency-err").classList.add("hidden");
    haptic("selection");
  });
});
$("btn-onboarding-finish").addEventListener("click", () => {
  if (!["trusted", "unexpected", "balanced"].includes(selectedFrequency)) {
    $("onboarding-frequency").classList.add("needs-choice");
    $("frequency-err").classList.remove("hidden");
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
  selectedFrequency = ["trusted", "unexpected", "balanced"].includes(profile.frequency)
    ? profile.frequency
    : "";
  syncProfileAvatar();
  syncFeelingCards();
  showStep(0);
  await showTab("diary");
  if (!profile.onboarded) showOnboarding();
  if (resetResult) showResetNotice(resetResult);
}

initApp();
