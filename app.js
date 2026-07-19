// Кинодневник — логика мини-аппа (дизайн из Claude Design).
// Оценка проходит в 4 шага: фильм → оценки → итог с заметками → запись.
// Хранение: облако Telegram (CloudStorage); вне Telegram — localStorage.

"use strict";

// ─── Telegram WebApp ─────────────────────────────────────────────

const tg = window.Telegram ? window.Telegram.WebApp : null;
// initData не пустой только внутри настоящего Telegram
const inTelegram = !!(tg && tg.initData);

if (tg) {
  tg.ready();
  tg.expand(); // развернуть мини-апп на весь экран
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
  scores: { plot: 5, chars: 5, visual: 5, sound: 5, emotion: 5 },
  personal: 5,
  liked: "", disliked: "", moment: "",
});

let form = emptyForm();
let tab = "rate";   // "rate" | "diary"
let step = 0;       // 0 фильм · 1 оценки · 2 итог · 3 запись
let expandedId = null;

const STEP_TITLES = ["Фильм", "Оценки", "Итог", "Запись"];

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

function haptic(kind) {
  if (inTelegram && tg.HapticFeedback) {
    try { tg.HapticFeedback.notificationOccurred(kind); } catch (e) { /* не критично */ }
  }
}

// нарисовать звёзды с половинками: пять ★, у каждой золотая «заливка» 0/50/100%
function renderStars(container, five) {
  container.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const star = el("div", "star", "★");
    const v = five - i;
    const pct = v >= 1 ? 100 : v >= 0.5 ? 50 : 0;
    const fill = el("div", "fill", "★");
    fill.style.width = pct + "%";
    star.append(fill);
    container.append(star);
  }
}

// ─── Переключение вкладок и шагов ────────────────────────────────

function showTab(name) {
  tab = name;
  $("screen-rate").classList.toggle("hidden", name !== "rate");
  $("screen-diary").classList.toggle("hidden", name !== "diary");
  $("head-rate").classList.toggle("hidden", name !== "rate");
  $("head-diary").classList.toggle("hidden", name !== "diary");
  $("footer-action").classList.toggle("hidden", name !== "rate");
  $("tab-rate").classList.toggle("on", name === "rate");
  $("tab-diary").classList.toggle("on", name === "diary");
  document.body.classList.toggle("hero", name === "rate" && step === 0 && !!form.title);
  if (name === "diary") renderDiary();
}

function showStep(n) {
  step = n;
  for (let i = 0; i <= 3; i++) $("step-" + i).classList.toggle("hidden", i !== n);
  $("head-title").textContent = STEP_TITLES[n];
  $("head-sub").textContent = `Шаг ${n + 1} из 4`;
  const segs = $("progress").children;
  for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("on", i <= n);
  $("btn-back").classList.toggle("hidden", n === 0);
  document.body.classList.toggle("hero", n === 0 && !!form.title);

  const primary = $("btn-primary");
  primary.textContent =
    n === 0 ? "Далее" : n === 1 ? "Далее: итог" : n === 2 ? "Далее: запись" : "Сохранить запись";
  primary.classList.toggle("muted", n === 0 && !form.title);
  $("btn-save-empty").classList.toggle("hidden", n !== 3);

  if (n === 1) updateStars("1");
  if (n === 2) updateStars("2");
  if (n === 3) $("e-prompt").value = manualPrompt();
  window.scrollTo(0, 0);
}

// ─── Шаг 1: выбор фильма ─────────────────────────────────────────

function onQueryInput() {
  const q = $("f-query").value.trim();
  $("add-box").classList.toggle("hidden", q.length < 2);
  $("add-name").textContent = q;
  $("query-err").classList.add("hidden");
  $("f-query").classList.remove("bad");
}

function addFilm() {
  const q = $("f-query").value.trim();
  if (q.length < 2) return;
  form.title = q;
  $("f-query").value = "";
  $("add-box").classList.add("hidden");
  $("hero-title").textContent = form.title;
  $("film-search").classList.add("hidden");
  $("film-hero").classList.remove("hidden");
  showStep(0); // обновить герой-фон и кнопку
}

function clearFilm() {
  form.title = "";
  $("film-search").classList.remove("hidden");
  $("film-hero").classList.add("hidden");
  showStep(0);
}

// ─── Шаг 2: слайдеры ─────────────────────────────────────────────

function paintSlider(range, color) {
  const pct = (+range.value) * 10;
  range.style.background =
    `linear-gradient(90deg, ${color} 0%, ${color} ${pct}%, var(--line2) ${pct}%, var(--line2) 100%)`;
}

function buildSliders() {
  const box = $("sliders");
  const accent = "#6b5bd2", gold = "#97730a";

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
      badge.textContent = range.value;
      paintSlider(range, color);
      oninput(+range.value);
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
    form.year = $("f-year").value.trim();
    form.genre = $("f-genre").value;
    showStep(1);
  } else if (step === 1) {
    showStep(2);
  } else if (step === 2) {
    form.liked = $("f-liked").value.trim();
    form.disliked = $("f-disliked").value.trim();
    form.moment = $("f-moment").value.trim();
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
  haptic("success");

  // сброс формы и переход в дневник
  form = emptyForm();
  $("f-query").value = ""; $("f-year").value = ""; $("f-genre").value = GENRES[0];
  $("f-liked").value = ""; $("f-disliked").value = ""; $("f-moment").value = "";
  $("e-review").value = "";
  $("sliders").innerHTML = "";
  buildSliders();
  $("film-search").classList.remove("hidden");
  $("film-hero").classList.add("hidden");
  showStep(0);
  showTab("diary");
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
    list.append(el("div", "empty", "Дневник пока пуст. Оцени первый фильм на вкладке «Оценить»."));
    return;
  }
  $("stats").classList.remove("hidden");
  renderStats(films);
  films.forEach((f) => list.append(filmItem(f)));
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
    track.append(fill);
    row.append(top, track);
    gb.append(row);
  });
}

function filmItem(f) {
  const item = el("div", "film");
  const top = el("div", "film-top");
  top.append(el("div", "poster"));
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
$("f-query").addEventListener("keydown", (e) => { if (e.key === "Enter") addFilm(); });
$("btn-add").addEventListener("click", addFilm);
$("btn-clear").addEventListener("click", clearFilm);
$("btn-back").addEventListener("click", () => showStep(step - 1));
$("btn-primary").addEventListener("click", primaryAction);
$("btn-save-empty").addEventListener("click", () => saveEntry(""));

$("btn-copy").addEventListener("click", async () => {
  const ok = await copyText($("e-prompt").value);
  $("btn-copy").textContent = ok ? "Скопировано ✓" : "Не удалось — выдели текст вручную";
  setTimeout(() => { $("btn-copy").textContent = "Скопировать промпт"; }, 2000);
});

$("tab-rate").addEventListener("click", () => showTab("rate"));
$("tab-diary").addEventListener("click", () => showTab("diary"));

if (!inTelegram) $("storage-note").classList.remove("hidden");

showStep(0);
showTab("rate");
