// Кинодневник — логика мини-аппа (дизайн из Claude Design).
// Оценка проходит в 4 шага: фильм → оценки → итог с заметками → запись.
// Хранение: облако Telegram (CloudStorage); вне Telegram — localStorage.

"use strict";

// ─── Telegram WebApp ─────────────────────────────────────────────

const tg = window.Telegram ? window.Telegram.WebApp : null;
// initData не пустой только внутри настоящего Telegram
const inTelegram = !!(tg && tg.initData);
let fullscreenUnavailable = false;

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
  requestAppFullscreen();

  if (typeof tg.onEvent === "function" && tg.isVersionAtLeast("8.0")) {
    tg.onEvent("fullscreenFailed", (event) => {
      if (!event || event.error !== "ALREADY_FULLSCREEN") fullscreenUnavailable = true;
      tg.expand();
    });
  }
}

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
// Для доставки и аккуратной обрезки изображений нужен только cloud name.
// API secret здесь намеренно не используется: фронтенд GitHub Pages публичный.
const CLOUDINARY_FETCH = "https://res.cloudinary.com/eqqg0ktm/image/fetch/";
const TMDB_GENRES = {
  27: "Хоррор", 53: "Триллер", 18: "Драма", 878: "Фантастика",
  28: "Боевик", 35: "Комедия", 9648: "Детектив", 14: "Фэнтези",
  16: "Анимация", 99: "Документальный",
};

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
      try { films.push(JSON.parse(r)); } catch (e) { /* битую запись пропускаем */ }
    }
    return films.sort((a, b) => b.id - a.id); // новые сверху
  },
  async save(film) {
    const k = "film_" + film.id, v = JSON.stringify(film);
    if (useCloud) await cloud.set(k, v);
    else localStorage.setItem(k, v);
  },
  async remove(id) {
    const k = "film_" + id;
    if (useCloud) await cloud.remove(k);
    else localStorage.removeItem(k);
  },
};

// ─── Состояние ───────────────────────────────────────────────────

const emptyForm = () => ({
  title: "", year: "", genre: GENRES[0],
  tmdbId: null, poster: "", posterPreview: "", backdrop: "", backdropPreview: "",
  scores: { plot: 5, chars: 5, visual: 5, sound: 5, emotion: 5 },
  personal: 5,
  liked: "", disliked: "", moment: "",
});

let form = emptyForm();
let tab = "feed";   // "rate" | "feed" | "diary"
let step = 0;       // 0 фильм · 1 оценки · 2 итог · 3 запись
let expandedId = null;
let searchTimer = null;
let searchController = null;
let searchBlurTimer = null;
let searchLayoutBottom = window.visualViewport
  ? window.visualViewport.offsetTop + window.visualViewport.height
  : window.innerHeight;
let popularLoaded = false;

const STEP_TITLES = ["Фильм", "Оценки", "Ну как?", "Запись"];
const TAB_INDEX = { rate: 0, feed: 1, diary: 2 };

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
  return url ? url.replace(/\/(?:w\d+|h\d+|original)\//, `/${size}/`) : "";
}

function cloudinaryImage(source, transformations) {
  return source ? `${CLOUDINARY_FETCH}${transformations}/${encodeURI(source)}` : "";
}

function cloudinarySource(url) {
  if (!url || !url.startsWith(CLOUDINARY_FETCH)) return "";
  const sourceAt = url.indexOf("/https://", CLOUDINARY_FETCH.length);
  return sourceAt < 0 ? "" : decodeURI(url.slice(sourceAt + 1));
}

function tmdbPoster(path, width, height, quality = "auto:good") {
  const source = path ? TMDB_IMG + "original" + path : "";
  return cloudinaryImage(source,
    `f_auto,q_${quality},c_fill,g_auto,w_${width},h_${height}`);
}

function tmdbBackdrop(path, width, quality = "auto:good") {
  const source = path ? TMDB_IMG + "original" + path : "";
  return cloudinaryImage(source, `f_auto,q_${quality},c_limit,w_${width}`);
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
    const fallback = cloudinarySource(preview || target);
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
    const fallback = cloudinarySource(target);
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
  }

  // Вся группа реагирует на итоговую оценку одинаково: чем она выше,
  // тем звёзды крупнее и ярче. Значения ниже 1 остаются на минимуме 0.9.
  const strength = Math.max(0, Math.min(1, (five - 1) / 4));
  const scale = 0.9 + strength * 0.25;
  const red = Math.round(201 + (245 - 201) * strength);
  const green = Math.round(168 + (185 - 168) * strength);
  const blue = Math.round(118 + (66 - 118) * strength);
  container.style.setProperty("--stars-scale", scale.toFixed(3));
  container.style.setProperty("--stars-color", `rgb(${red}, ${green}, ${blue})`);
  container.classList.toggle("is-perfect", five === 5);
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

async function showTab(name) {
  const previousTab = tab;
  const changed = previousTab !== name;
  const nextScreen = $("screen-" + name);
  tab = name;
  if (name !== "rate") closeSearchKeyboard();
  $("screen-rate").classList.toggle("hidden", name !== "rate");
  $("screen-feed").classList.toggle("hidden", name !== "feed");
  $("screen-diary").classList.toggle("hidden", name !== "diary");
  $("head-rate").classList.toggle("hidden", name !== "rate");
  $("head-feed").classList.toggle("hidden", name !== "feed");
  $("head-diary").classList.toggle("hidden", name !== "diary");
  $("footer-action").classList.toggle("hidden", name !== "rate");
  $("tab-rate").classList.toggle("on", name === "rate");
  $("tab-feed").classList.toggle("on", name === "feed");
  $("tab-diary").classList.toggle("on", name === "diary");
  document.querySelector(".tabbar").style.setProperty("--tab-index", TAB_INDEX[name]);
  document.body.classList.toggle("has-action", name === "rate");
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

  if (name === "rate" && !popularLoaded) loadPopular();
  if (name === "feed") return renderFeed();
  if (name === "diary") return renderDiary();
}

function syncAtmosphere() {
  const insideFilm = tab === "rate" && !!form.title;
  document.body.classList.toggle("immersive", insideFilm);
  document.body.classList.toggle("hero", insideFilm && step === 0);
}

function showStep(n) {
  step = n;
  for (let i = 0; i <= 3; i++) $("step-" + i).classList.toggle("hidden", i !== n);
  $("head-title").textContent = STEP_TITLES[n];
  $("head-sub").textContent = `Шаг ${n + 1} из 4`;
  const segs = $("progress").children;
  for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("on", i <= n);
  $("btn-back").classList.toggle("hidden", n === 0);
  syncAtmosphere();

  const primary = $("btn-primary");
  primary.textContent =
    n <= 1 ? "Далее" : n === 2 ? "Записать" : "Сохранить запись";
  primary.classList.toggle("muted", n === 0 && !form.title);
  $("btn-save-empty").classList.toggle("hidden", n !== 3);

  if (n === 1) {
    $("rating-title").textContent = form.title;
    $("rating-meta").textContent = [form.year, form.genre].filter(Boolean).join(" · ");
    const posterWrap = $("rating-poster-wrap");
    posterWrap.classList.toggle("hidden", !form.poster);
    if (form.poster) setBlurPicture(
      posterWrap,
      $("rating-poster-preview"),
      $("rating-poster"),
      form.posterPreview || microPreview(form.poster, "w92"),
      form.poster,
    );
    updateStars("1");
  }
  if (n === 2) updateStars("2");
  if (n === 3) $("e-prompt").value = manualPrompt();
  window.scrollTo(0, 0);
}

// ─── Шаг 1: выбор фильма ─────────────────────────────────────────

function onQueryInput() {
  const q = $("f-query").value.trim();
  $("query-err").classList.add("hidden");
  $("f-query").classList.remove("bad");
  clearTimeout(searchTimer);
  if (searchController) searchController.abort();
  if (!q) {
    resetSearchView();
    return;
  }
  $("popular").classList.add("hidden");
  $("results").classList.remove("hidden");
  if (q.length < 2) {
    $("results").setAttribute("aria-busy", "false");
    $("results").innerHTML = '<div class="catalog-state">Введи ещё одну букву</div>';
    return;
  }
  $("results").setAttribute("aria-busy", "true");
  $("results").innerHTML = '<div class="catalog-state">Ищу фильмы…</div>';
  searchTimer = setTimeout(() => searchMovies(q), 350);
}

function resetSearchView() {
  clearTimeout(searchTimer);
  searchTimer = null;
  if (searchController) searchController.abort();
  searchController = null;
  $("results").innerHTML = "";
  $("results").classList.add("hidden");
  $("results").setAttribute("aria-busy", "false");
  $("popular").classList.remove("hidden");
}

function syncSearchViewport() {
  if (!document.body.classList.contains("search-active")) return;
  const viewport = window.visualViewport;
  const inputBottom = $("f-query").getBoundingClientRect().bottom;
  const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const available = Math.max(150, viewportBottom - inputBottom - 12);
  const keyboardInset = Math.max(0, searchLayoutBottom - viewportBottom);
  document.documentElement.style.setProperty("--search-results-height", `${available}px`);
  document.documentElement.style.setProperty("--keyboard-inset", `${keyboardInset}px`);
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
  if (active) {
    requestAnimationFrame(() => {
      syncSearchViewport();
      $("f-query").scrollIntoView({ block: "start", behavior: "auto" });
    });
  } else {
    document.documentElement.style.removeProperty("--search-results-height");
    document.documentElement.style.removeProperty("--keyboard-inset");
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
    const posterWidth = compact ? 216 : 88;
    const posterHeight = compact ? 308 : 124;
    button.append(blurPicture(
      tmdbPoster(movie.poster_path, 20, compact ? 29 : 28, "auto:low"),
      tmdbPoster(movie.poster_path, posterWidth, posterHeight),
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
  movies.slice(0, popular ? 8 : 6).forEach((movie) => container.append(movieCard(movie, popular)));
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
    renderMovies($("results"), movies);
    if (corrected) $("results").prepend(el("div", "catalog-hint", "Похоже, в названии опечатка — вот ближайшие фильмы"));
    if (!movies.length) $("results").append(el("div", "catalog-state", "Ничего не найдено"));
    const manual = el("button", "manual-add", `Добавить «${query}» вручную`);
    manual.type = "button";
    manual.addEventListener("click", () => selectManual(query));
    $("results").append(manual);
  } catch (e) {
    if (e.name === "AbortError") return;
    $("results").innerHTML = "";
    $("results").append(el("div", "catalog-state", "TMDB недоступен — можно добавить вручную"));
    const manual = el("button", "manual-add", `Добавить «${query}» вручную`);
    manual.type = "button";
    manual.addEventListener("click", () => selectManual(query));
    $("results").append(manual);
  } finally {
    if (searchController === controller) searchController = null;
    if ($("f-query").value.trim() === query) $("results").setAttribute("aria-busy", "false");
  }
}

async function loadPopular() {
  try {
    const data = await tmdb("/movie/popular?page=1");
    renderMovies($("popular-list"), data.results || [], true);
    popularLoaded = true;
    $("popular").classList.toggle("hidden", !!$("f-query").value.trim());
  } catch (e) {
    $("popular").classList.add("hidden");
  }
}

function selectMovie(movie) {
  form.title = movie.title;
  form.year = yearOf(movie);
  form.genre = genreOf(movie);
  form.tmdbId = movie.id;
  form.poster = tmdbPoster(movie.poster_path, 420, 600);
  form.posterPreview = tmdbPoster(movie.poster_path, 20, 30, "auto:low");
  form.backdrop = movie.backdrop_path
    ? tmdbBackdrop(movie.backdrop_path, 1280)
    : form.poster;
  form.backdropPreview = movie.backdrop_path
    ? tmdbBackdrop(movie.backdrop_path, 48, "auto:low")
    : form.posterPreview;
  syncGenreAccent(form.genre);
  haptic("impact", "rigid");
  showSelectedMovie(true);
}

function selectManual(title) {
  form.title = title;
  form.year = "";
  form.genre = GENRES[0];
  form.tmdbId = null;
  form.poster = "";
  form.posterPreview = "";
  form.backdrop = "";
  form.backdropPreview = "";
  syncGenreAccent(form.genre);
  haptic("impact", "rigid");
  showSelectedMovie(false);
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
  showStep(0); // обновить герой-фон и кнопку
}

function clearFilm() {
  closeSearchKeyboard();
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
  renderStars($("stars-" + suffix), five);
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
  const film = {
    id: Date.now(),
    title: form.title, year: form.year, genre: form.genre,
    tmdbId: form.tmdbId,
    poster: form.poster, posterPreview: form.posterPreview,
    backdrop: form.backdrop, backdropPreview: form.backdropPreview,
    scores: { ...form.scores },
    quality: calcQuality(form.scores),
    personal: form.personal,
    liked: form.liked, disliked: form.disliked, moment: form.moment,
    review,
    date: new Date().toLocaleDateString("ru-RU"),
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
  $("f-query").value = ""; $("f-year").value = ""; $("f-genre").value = GENRES[0];
  $("f-liked").value = ""; $("f-disliked").value = ""; $("f-moment").value = "";
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

const DAY_MS = 24 * 60 * 60 * 1000;
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
  const fresh = emptyForm();
  form = {
    ...fresh,
    title: film.title, year: film.year || "", genre: film.genre || GENRES[0],
    tmdbId: film.tmdbId || null,
    poster: film.poster || "", posterPreview: film.posterPreview || "",
    backdrop: film.backdrop || "", backdropPreview: film.backdropPreview || "",
    scores: { ...fresh.scores, ...(film.scores || {}) },
    personal: Number(film.personal || 5),
  };
  $("f-liked").value = ""; $("f-disliked").value = ""; $("f-moment").value = "";
  $("e-review").value = "";
  $("sliders").innerHTML = "";
  buildSliders();
  syncGenreAccent(form.genre);
  showTab("rate");
  showSelectedMovie(!!film.tmdbId);
  showStep(1);
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

  const intro = el("div", "feed-intro");
  intro.append(el("p", "", `На основе ${films.length} ${filmsWord(films.length)} в твоём дневнике`));
  list.append(intro);
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
  setBlurBackground(
    box,
    backdropPreview(film.backdrop, film.poster, film.backdropPreview, film.posterPreview),
    film.backdrop,
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

// ─── Запуск ──────────────────────────────────────────────────────

GENRES.forEach((g) => $("f-genre").append(new Option(g, g)));
buildSliders();

$("f-query").addEventListener("input", onQueryInput);
$("f-query").addEventListener("focus", () => setSearchMode(true));
$("f-query").addEventListener("blur", () => {
  searchBlurTimer = setTimeout(() => {
    if (document.activeElement !== $("f-query")) setSearchMode(false);
  }, 160);
});
$("f-query").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && $("f-query").value.trim().length >= 2) selectManual($("f-query").value.trim());
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncSearchViewport);
  window.visualViewport.addEventListener("scroll", syncSearchViewport);
}
$("btn-clear").addEventListener("click", clearFilm);
$("btn-back").addEventListener("click", () => {
  haptic("impact", "soft");
  showStep(step - 1);
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
$("f-genre").addEventListener("change", () => syncGenreAccent($("f-genre").value));

if (!inTelegram) $("storage-note").classList.remove("hidden");

showStep(0);
showTab("feed");
