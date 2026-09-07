import { logOut, onAuthChange, signIn, signUp } from "./auth";
import { firebaseConfigured } from "./firebaseConfig";
import { applyI18n, getLang, setLang, t } from "./i18n";
import {
  fetchChapterPages,
  fetchChapters,
  fetchGenres,
  fetchLatestPool,
  fetchList,
  fetchMangaDetail,
  fetchTrendingAllTime,
  quickSearch,
} from "./komiku";
import type {
  AccountTab,
  ChapterEntry,
  Comic,
  CommentRow,
  FilterKey,
  Filters,
  ReadingProgressEntry,
  SortMode,
} from "./types";
import type { User } from "firebase/auth";

// The markup in index.html is static and every id referenced here is
// guaranteed to exist, so `$` is typed to return a non-null HTMLElement
// rather than forcing an optional-chain at every call site.
function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

// Solo Leveling — used only to seed the demo's "already following one
// title" starting state with a manga slug that actually exists on Komiku.
const SEED_FOLLOWED_ID = "solo-leveling-id";

let filters: Filters = { type: "All", genre: "All", status: "All" };
let currentComic = "";
let currentChapterId: string | null = null;
let currentUser: User | null = null;
let authMode: "signin" | "signup" = "signin";
const followed = new Set<string>([SEED_FOLLOWED_ID]);
let sortMode: SortMode = "latest";
let explorePage = 1;
let homeGenrePage = 1;
let homeGenreCurrent = "All";
let latestPage = 1;
let latestType: Filters["type"] = "All";
const PAGE_SIZE = 10;
const COMMENTS_PAGE_SIZE = 10;
// Each thread (a manga's reviews, or one chapter's comments) is fetched
// once and cached whole; "load more" just reveals more of the cached,
// already-sorted array rather than hitting the network again.
const commentThreads = new Map<string, CommentRow[]>();
let detailVisibleCount = COMMENTS_PAGE_SIZE;
let readerVisibleCount = COMMENTS_PAGE_SIZE;

// Comic detail and chapter-list lookups hit the network, so cache them for
// the lifetime of the page (re-opening a comic or paging prev/next chapter
// shouldn't refetch what we already have).
const mangaCache = new Map<string, Comic>();
const chaptersCache = new Map<string, ChapterEntry[]>();
let trendingTop: Comic | null = null;

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function hideViews(): void {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
}
function scrollTop(): void {
  window.scrollTo({ top: 0, behavior: "instant" });
}
function toast(msg: string): void {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout((window as unknown as { __toast?: number }).__toast);
  (window as unknown as { __toast?: number }).__toast = window.setTimeout(
    () => t.classList.remove("show"),
    2200,
  );
}
function goHome(): void {
  closeMobileMenu();
  hideViews();
  $("homeView").classList.add("active");
  setNav("home");
  scrollTop();
  history.replaceState({ view: "home" }, "", "#home");
}
function showExplore(): void {
  closeMobileMenu();
  hideViews();
  $("exploreView").classList.add("active");
  setNav("explore");
  applyFilters();
  scrollTop();
  history.pushState({ view: "explore" }, "", "#explore");
}
function setNav(which: "home" | "explore" | "library" | "account" | ""): void {
  $("navHome").classList.toggle("active", which === "home");
  $("navExplore").classList.toggle("active", which === "explore");
  document
    .querySelectorAll<HTMLElement>(".bottomNavItem")
    .forEach((b) => b.classList.toggle("active", b.dataset.nav === which));
}
async function comicBy(id: string): Promise<Comic> {
  const cached = mangaCache.get(id);
  if (cached) return cached;
  const comic = await fetchMangaDetail(id);
  mangaCache.set(id, comic);
  return comic;
}
async function getChaptersFor(mangaId: string): Promise<ChapterEntry[]> {
  const cached = chaptersCache.get(mangaId);
  if (cached) return cached;
  const list = await fetchChapters(mangaId);
  chaptersCache.set(mangaId, list);
  return list;
}

function cardHtml(c: Comic, rank?: number): string {
  const cover = c.cover
    ? `<img src="${c.cover}" alt="" loading="lazy">`
    : `<div class="coverText">${c.title.replaceAll(" ", "<br>")}</div>`;
  return `<div class="card" onclick="openComic('${c.id}')"><div class="cover">${rank ? `<span class="rank">#${rank}</span>` : `<span class="rank">${c.type}</span>`}${cover}</div><div class="title">${c.title}</div><div class="meta">${c.type} · ${c.status} · <span class="star">★ ${c.rating}</span></div></div>`;
}

async function renderSearchResults(): Promise<void> {
  const box = $("searchResults");
  const q = (($("search") as HTMLInputElement).value || "").trim();
  if (!q) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const list = await quickSearch(q);
  box.innerHTML =
    list
      .map(
        (c) =>
          `<div class="searchResult" onclick="openComic('${c.id}');hideSearchResults()"><div class="miniCover">${c.cover ? `<img src="${c.cover}" alt="">` : ""}</div><div><strong>${c.title}</strong><small>${c.type} · ${c.status} · ★ ${c.rating}</small></div></div>`,
      )
      .join("") || `<div class="searchEmpty">${t("no_comics_found")}</div>`;
  box.style.display = "block";
}
function hideSearchResults(): void {
  $("searchResults").style.display = "none";
}
function toggleMobileSearch(): void {
  closeMobileMenu();
  const open = $("searchWrap").classList.toggle("mobileOpen");
  if (open) ($("search") as HTMLInputElement).focus();
  else hideSearchResults();
}

let exploreRequestId = 0;
async function renderExplore(): Promise<void> {
  const grid = $("exploreGrid");
  const q = (($("search") as HTMLInputElement).value || "").trim();
  const requestId = ++exploreRequestId;
  grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("loading")}</div>`;
  try {
    const { comics, total } = await fetchList({
      offset: (explorePage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      sort: sortMode,
      type: filters.type,
      genre: filters.genre,
      status: filters.status,
      title: q || undefined,
    });
    if (requestId !== exploreRequestId) return;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    explorePage = Math.min(Math.max(1, explorePage), pages);
    grid.innerHTML =
      comics.map((c) => cardHtml(c)).join("") ||
      `<div class="empty" style="grid-column:1/-1">${t("no_comics_match_filters")}</div>`;
    renderPagination("explorePagination", explorePage, pages, "setExplorePage", total);
  } catch {
    if (requestId !== exploreRequestId) return;
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("failed_load_comics")}</div>`;
  }
}
let homeGenreRequestId = 0;
async function renderHomeGenre(genre = "All"): Promise<void> {
  const grid = $("genreResults");
  homeGenreCurrent = genre;
  const requestId = ++homeGenreRequestId;
  grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("loading")}</div>`;
  try {
    const { comics, total } = await fetchList({
      offset: (homeGenrePage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      sort: "latest",
      genre,
    });
    if (requestId !== homeGenreRequestId) return;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    homeGenrePage = Math.min(Math.max(1, homeGenrePage), pages);
    grid.innerHTML =
      comics.map((c) => cardHtml(c)).join("") ||
      `<div class="empty" style="grid-column:1/-1">${t("no_comics_in_genre")}</div>`;
    renderPagination("genrePagination", homeGenrePage, pages, "setHomeGenrePage", total);
  } catch {
    if (requestId !== homeGenreRequestId) return;
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("failed_load_comics")}</div>`;
  }
}
let genreChipsRendered = false;
const GENRE_VISIBLE_COUNT = 18;
async function renderGenreChips(): Promise<void> {
  if (genreChipsRendered) return;
  genreChipsRendered = true;
  try {
    const genres = await fetchGenres();
    const extra = genres.length - GENRE_VISIBLE_COUNT;
    const homeBox = document.getElementById("homeGenres");
    if (homeBox) {
      homeBox.insertAdjacentHTML(
        "beforeend",
        genres
          .map(
            (g, i) =>
              `<span class="genre${i >= GENRE_VISIBLE_COUNT ? " genreExtra" : ""}" ${i >= GENRE_VISIBLE_COUNT ? "hidden" : ""} onclick="setHomeGenre('${g.slug}',this)">${escapeHtml(g.title)}</span>`,
          )
          .join("") +
          (extra > 0
            ? `<span class="genre genreMore" onclick="toggleGenreMore(this,'homeGenres')">${t("show_more_prefix")}${extra}${t("show_more_suffix")}</span>`
            : ""),
      );
    }
    const exploreBox = document.getElementById("exploreGenreButtons");
    if (exploreBox) {
      exploreBox.insertAdjacentHTML(
        "beforeend",
        genres
          .map(
            (g, i) =>
              `<button class="filterBtn${i >= GENRE_VISIBLE_COUNT ? " genreExtra" : ""}" ${i >= GENRE_VISIBLE_COUNT ? "hidden" : ""} data-filter="genre" data-value="${g.slug}" onclick="filterBy('genre','${g.slug}')">${escapeHtml(g.title)}</button>`,
          )
          .join("") +
          (extra > 0
            ? `<button class="filterBtn genreMore" onclick="toggleGenreMore(this,'exploreGenreButtons')">${t("show_more_prefix")}${extra}${t("show_more_suffix")}</button>`
            : ""),
      );
    }
  } catch {
    genreChipsRendered = false;
  }
}
function toggleGenreMore(btn: HTMLElement, containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  const isExpanding = container.querySelector(".genreExtra[hidden]") !== null;
  container.querySelectorAll<HTMLElement>(".genreExtra").forEach((el) => {
    el.hidden = !isExpanding;
  });
  const count = container.querySelectorAll(".genreExtra").length;
  btn.textContent = isExpanding ? t("show_less") : `${t("show_more_prefix")}${count}${t("show_more_suffix")}`;
}
function setHomeGenre(genre: string, btn: HTMLElement): void {
  document.querySelectorAll("#genres .genre").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  homeGenrePage = 1;
  renderHomeGenre(genre);
}
function renderPagination(
  id: string,
  page: number,
  pages: number,
  handler: "setExplorePage" | "setHomeGenrePage" | "setLatestPage" | "setTrendingPage" | "setTrendingTodayPage",
  total: number,
): void {
  const box = document.getElementById(id);
  if (!box) return;
  if (pages <= 1) {
    box.innerHTML = "";
    return;
  }
  let out = `<button ${page === 1 ? "disabled" : ""} onclick="${handler}(${page - 1})">‹</button>`;
  const max = 8;
  const first = Math.max(1, Math.min(page - 3, pages - max + 1));
  const last = Math.min(pages, first + max - 1);
  if (first > 1)
    out += `<button onclick="${handler}(1)">1</button>${first > 2 ? '<span class="pageInfo">…</span>' : ""}`;
  for (let p = first; p <= last; p++)
    out += `<button class="${p === page ? "active" : ""}" onclick="${handler}(${p})">${p}</button>`;
  if (last < pages)
    out += `${last < pages - 1 ? '<span class="pageInfo">…</span>' : ""}<button onclick="${handler}(${pages})">${pages}</button>`;
  out += `<button ${page === pages ? "disabled" : ""} onclick="${handler}(${page + 1})">›</button><span class="pageInfo">${total} ${t("comics_suffix")}</span>`;
  box.innerHTML = out;
}
function setExplorePage(page: number): void {
  explorePage = page;
  renderExplore();
  scrollTop();
}
function setHomeGenrePage(page: number): void {
  homeGenrePage = page;
  renderHomeGenre(homeGenreCurrent);
  document.getElementById("genres")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function setLatestPage(page: number): void {
  latestPage = page;
  renderLatestUpdates();
  document.getElementById("latest")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function setLatestType(type: string, btn: HTMLElement): void {
  document.querySelectorAll("#latestTypeFilter .genre").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  latestType = type as Filters["type"];
  latestPage = 1;
  renderLatestUpdates();
}

// /rekomendasi + /komik-populer together give enough titles to paginate,
// but neither supports a page param on its own — fetched once per session
// and paged through client-side instead of re-fetching per page.
let trendingAllTimePool: Comic[] | null = null;
let trendingAllTimePage = 1;
async function renderTrending(): Promise<void> {
  const grid = document.getElementById("trendingGrid");
  if (!grid) return;
  grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("loading")}</div>`;
  try {
    if (!trendingAllTimePool) {
      trendingAllTimePool = await fetchTrendingAllTime();
      trendingTop = trendingAllTimePool[0] ?? null;
    }
    const pool = trendingAllTimePool;
    const pages = Math.max(1, Math.ceil(pool.length / PAGE_SIZE));
    trendingAllTimePage = Math.min(Math.max(1, trendingAllTimePage), pages);
    const start = (trendingAllTimePage - 1) * PAGE_SIZE;
    grid.innerHTML =
      pool
        .slice(start, start + PAGE_SIZE)
        .map((c, i) => cardHtml(c, start + i + 1))
        .join("") || `<div class="empty" style="grid-column:1/-1">${t("no_comics_right_now")}</div>`;
    renderPagination("trendingPagination", trendingAllTimePage, pages, "setTrendingPage", pool.length);
  } catch {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("failed_load_trending")}</div>`;
  }
}
function setTrendingPage(page: number): void {
  trendingAllTimePage = page;
  renderTrending();
  document.getElementById("trendingGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// View-ranked titles first (see src/views.ts), backfilled with recently
// updated ones so the pool is never empty on a cold start (no views
// recorded yet today). Fetched once per session, then paged client-side.
const TRENDING_TODAY_POOL_SIZE = 30;
let trendingTodayPool: Comic[] | null = null;
let trendingTodayPage = 1;
async function renderTrendingToday(): Promise<void> {
  const grid = document.getElementById("trendingTodayTrack");
  if (!grid) return;
  grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("loading")}</div>`;
  try {
    if (!trendingTodayPool) {
      let list: Comic[] = [];
      if (firebaseConfigured) {
        const { fetchTopViewedToday } = await import("./views");
        const ids = await fetchTopViewedToday(TRENDING_TODAY_POOL_SIZE);
        const found = await Promise.all(ids.map((id) => comicBy(id).catch(() => null)));
        list = found.filter((c): c is Comic => c !== null);
      }
      if (list.length < TRENDING_TODAY_POOL_SIZE) {
        const seen = new Set(list.map((c) => c.id));
        const recent = await fetchLatestPool(40);
        for (const c of recent) {
          if (list.length >= TRENDING_TODAY_POOL_SIZE) break;
          if (!seen.has(c.id)) {
            list.push(c);
            seen.add(c.id);
          }
        }
      }
      trendingTodayPool = list;
    }
    const pool = trendingTodayPool;
    const pages = Math.max(1, Math.ceil(pool.length / PAGE_SIZE));
    trendingTodayPage = Math.min(Math.max(1, trendingTodayPage), pages);
    const start = (trendingTodayPage - 1) * PAGE_SIZE;
    grid.innerHTML =
      pool
        .slice(start, start + PAGE_SIZE)
        .map((c, i) => cardHtml(c, start + i + 1))
        .join("") || `<div class="empty" style="grid-column:1/-1">${t("no_comics_right_now")}</div>`;
    renderPagination("trendingTodayPagination", trendingTodayPage, pages, "setTrendingTodayPage", pool.length);
  } catch {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("failed_load_trending")}</div>`;
  }
}
function setTrendingTodayPage(page: number): void {
  trendingTodayPage = page;
  renderTrendingToday();
  document.getElementById("trendingTodayTrack")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
let latestRequestId = 0;
async function renderLatestUpdates(): Promise<void> {
  const grid = document.getElementById("latestGrid");
  if (!grid) return;
  const requestId = ++latestRequestId;
  grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("loading")}</div>`;
  try {
    const { comics, total } = await fetchList({
      offset: (latestPage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      sort: "latest",
      type: latestType,
    });
    if (requestId !== latestRequestId) return;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    latestPage = Math.min(Math.max(1, latestPage), pages);
    grid.innerHTML =
      comics.map((c) => cardHtml(c)).join("") ||
      `<div class="empty" style="grid-column:1/-1">${t("no_comics_match_filter")}</div>`;
    renderPagination("latestPagination", latestPage, pages, "setLatestPage", total);
  } catch {
    if (requestId !== latestRequestId) return;
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${t("failed_load_comics")}</div>`;
  }
}
async function renderContinueReading(): Promise<void> {
  const box = document.getElementById("continueReading");
  if (!box) return;
  const saved: Record<string, ReadingProgressEntry> = JSON.parse(
    localStorage.getItem("panpan-progress") || "{}",
  );
  const entries = Object.entries(saved).sort((a, b) => b[1].updated - a[1].updated);
  if (entries.length === 0) {
    box.innerHTML = `<div class="empty">${t("not_started_reading")}</div>`;
    return;
  }
  const [mangaId] = entries[0][0].split("::");
  try {
    const c = await comicBy(mangaId);
    box.innerHTML = `<div class="row" style="cursor:pointer" onclick="openComic('${c.id}')"><div class="thumb">${c.cover ? `<img src="${c.cover}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:7px">` : ""}</div><div><strong>${c.title}</strong><small>${Math.round(entries[0][1].percent)}% ${t("reading_progress")}</small></div><span class="new">${t("continue_badge")}</span></div>`;
  } catch {
    box.innerHTML = `<div class="empty">${t("not_started_reading")}</div>`;
  }
}
function startReading(): void {
  if (trendingTop) openComic(trendingTop.id);
  else showExplore();
}

function openFAQ(): void {
  hideViews();
  $("faqView").classList.add("active");
  setNav("");
  scrollTop();
  history.pushState({ view: "faq" }, "", "#faq");
}
function openAbout(): void {
  hideViews();
  $("aboutView").classList.add("active");
  setNav("");
  scrollTop();
  history.pushState({ view: "about" }, "", "#about");
}

function openLegal(title: string): void {
  hideViews();
  $("legalView").classList.add("active");
  setNav("");
  $("legalTitle").textContent = title + ".";
  const map: Record<string, string> = {
    "Terms of Use": "Rules for using Panpan Comics safely and responsibly.",
    "Privacy Policy": "How a production version should explain data collection and privacy.",
    "Copyright & DMCA": "Rights-holder reporting and content licensing information.",
    "Community Guidelines": "Standards for comments, ratings and reader behavior.",
    "Content & Age Rating": "Content labels, mature themes and age-gating guidance.",
    "Contact & Support": "Where readers can get help with accounts, bugs and reports.",
  };
  $("legalLead").textContent = map[title] || "Panpan Comics information and policies.";
  scrollTop();
  history.pushState({ view: "legal", title }, "", "#legal");
}

function filterBy(key: FilterKey, value: string): void {
  if (key === "type") filters.type = value as Filters["type"];
  else if (key === "genre") filters.genre = value;
  else filters.status = value as Filters["status"];
  explorePage = 1;
  document
    .querySelectorAll(`[data-filter="${key}"]`)
    .forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.value === value));
  applyFilters();
}
function setExploreGenre(g: string): void {
  showExplore();
  filterBy("genre", g);
}
function applyFilters(): void {
  sortMode = ((document.getElementById("sortSelect") as HTMLSelectElement | null)?.value as
    | SortMode
    | undefined) || sortMode;
  explorePage = 1;
  renderExplore();
}

let openComicRequestId = 0;
async function openComic(id: string): Promise<void> {
  currentComic = id;
  const requestId = ++openComicRequestId;
  hideViews();
  $("detailView").classList.add("active");
  setNav("");
  $("detailTitle").textContent = t("loading");
  $("detailGenre").textContent = "";
  $("detailDesc").textContent = "";
  $("detailChips").innerHTML = "";
  $("detailCover").style.backgroundImage = "";
  $("chapterList").innerHTML = "";
  scrollTop();
  history.pushState({ view: "detail", id }, "", "#comic-" + id);

  if (firebaseConfigured) {
    import("./views")
      .then(({ trackView }) => trackView(id))
      .catch(() => {});
  }

  try {
    const [c, chapters] = await Promise.all([comicBy(id), getChaptersFor(id)]);
    if (requestId !== openComicRequestId) return;
    $("detailTitle").textContent = c.title;
    $("detailGenre").textContent = c.type + " · " + c.genres.join(" · ");
    $("detailDesc").textContent = c.desc;
    loadRatingSummary(id);
    // c.chapters is chapters.length from the same fetch — the true count.
    // (Showing chapters[0]'s chapter *number* instead used to display "0"
    // whenever the newest chapter happened to be numbered 0, e.g. a
    // prologue, even though the title clearly has chapters.)
    $("detailChapters").textContent = String(chapters.length || c.chapters);
    $("detailReaders").textContent = c.readers;
    $("detailChips").innerHTML =
      c.genres.map((g) => `<span class="chip">${g}</span>`).join("") +
      `<span class="chip">${c.status}</span><span class="chip">${c.type}</span>`;
    if (c.cover) {
      $("detailCover").style.backgroundImage = `url("${c.cover}")`;
      $("detailCover").style.backgroundSize = "cover";
      $("detailCover").style.backgroundPosition = "center";
    }
    $("detailCover").dataset.title = c.title;
    $("followBtn").textContent = followed.has(id) ? t("following") : t("follow");
    buildChapters(chapters, id);
    loadComments("detail", true);
  } catch {
    if (requestId !== openComicRequestId) return;
    $("detailTitle").textContent = t("failed_load_comic");
  }
}
function buildChapters(entries: ChapterEntry[], mangaId: string): void {
  const box = $("chapterList");
  box.className = "chapterScroll";
  if (entries.length === 0) {
    box.innerHTML = `<div class="empty">${t("no_chapters")}</div>`;
    return;
  }
  box.innerHTML = entries
    .map(
      (e, i) =>
        `<div class="chapterRow" onclick="openReader('${e.id}','${mangaId}')"><div><strong>${e.label}</strong><small>${i === 0 ? t("latest_chapter_label") : t("updated_label")} · ${new Date(e.publishAt).toLocaleDateString()}</small></div><span class="chapterGo">${t("read_arrow")}</span></div>`,
    )
    .join("");
}
let openReaderRequestId = 0;
async function openReader(chapterId: string, id: string = currentComic): Promise<void> {
  const enteringReader = !$("readerView").classList.contains("active");
  currentComic = id;
  currentChapterId = chapterId;
  const requestId = ++openReaderRequestId;
  hideViews();
  $("readerView").classList.add("active");
  setNav("");
  $("readerTitle").textContent = t("loading");
  $("readerSelect").innerHTML = "";
  $("readerChapters").innerHTML = "";
  $("readerView").querySelector(".page")!.innerHTML = `<div class="empty">${t("loading_pages")}</div>`;
  window.scrollTo({ top: 0, behavior: "instant" });
  scrollTop();
  // Only the first entry into the reader is a real navigation (one history
  // step, so the phone's back button/swipe returns straight to the comic).
  // Switching chapters from inside the reader (prev/next, the chapter list,
  // the <select>) replaces that same entry instead of pushing a new one —
  // otherwise every chapter visited would need its own back press to get
  // past, which reads as "back doesn't work".
  const hash = "#read-" + id + "::" + chapterId;
  if (enteringReader) history.pushState({ view: "reader", id, chapterId }, "", hash);
  else history.replaceState({ view: "reader", id, chapterId }, "", hash);

  try {
    const [c, chapters] = await Promise.all([comicBy(id), getChaptersFor(id)]);
    if (requestId !== openReaderRequestId) return;
    const entry = chapters.find((e) => e.id === chapterId);
    // Komiku sometimes serves a title's chapters under a different slug than
    // its detail page (see ChapterEntry.readerSlug), so this can't be
    // fetched in parallel with the chapter list above — it needs `entry`.
    const pages = await fetchChapterPages(entry?.readerSlug ?? id, chapterId);
    if (requestId !== openReaderRequestId) return;
    $("readerTitle").textContent = c.title + " · " + (entry?.label ?? t("chapter_fallback"));

    const sel = $("readerSelect") as HTMLSelectElement;
    sel.innerHTML = chapters
      .map((e) => `<option value="${e.id}" ${e.id === chapterId ? "selected" : ""}>${e.label}</option>`)
      .join("");

    $("readerChapters").innerHTML = chapters
      .map((e) => `<div class="rCh ${e.id === chapterId ? "active" : ""}" onclick="openReader('${e.id}','${id}')">${e.label}</div>`)
      .join("");

    const page = $("readerView").querySelector(".page") as HTMLElement;
    page.innerHTML =
      pages.map((url) => `<img class="comicPage" src="${url}" alt="" loading="lazy">`).join("") ||
      `<div class="empty">${t("no_pages_available")}</div>`;

    const saved: Record<string, ReadingProgressEntry> = JSON.parse(
      localStorage.getItem("panpan-progress") || "{}",
    );
    const pct = saved[id + "::" + chapterId]?.percent || 0;
    $("readerProgressBar").style.width = pct + "%";
    loadComments("reader", true);
  } catch {
    if (requestId !== openReaderRequestId) return;
    $("readerTitle").textContent = t("failed_load_chapter");
    ($("readerView").querySelector(".page") as HTMLElement).innerHTML =
      `<div class="empty">${t("failed_load_pages")}</div>`;
  }
}
function changeChapter(v: string): void {
  openReader(v, currentComic);
}
function openCurrentReader(): void {
  if (currentChapterId) openReader(currentChapterId, currentComic);
  else toast(t("toast_no_reader_open"));
}
async function prevChapter(): Promise<void> {
  const list = chaptersCache.get(currentComic);
  if (!list || !currentChapterId) return;
  const idx = list.findIndex((e) => e.id === currentChapterId);
  if (idx >= 0 && idx < list.length - 1) openReader(list[idx + 1].id, currentComic);
  else toast(t("toast_first_chapter"));
}
async function nextChapter(): Promise<void> {
  const list = chaptersCache.get(currentComic);
  if (!list || !currentChapterId) return;
  const idx = list.findIndex((e) => e.id === currentChapterId);
  if (idx > 0) openReader(list[idx - 1].id, currentComic);
  else toast(t("toast_latest_chapter"));
}
function goBackFromDetail(): void {
  history.back();
}
function toggleFollow(): void {
  if (!requireLogin()) return;
  if (followed.has(currentComic)) {
    followed.delete(currentComic);
    toast(t("toast_removed_library"));
  } else {
    followed.add(currentComic);
    toast(t("toast_added_library"));
  }
  $("followBtn").textContent = followed.has(currentComic) ? t("following") : t("follow");
}

function setAuthMode(mode: "signin" | "signup"): void {
  authMode = mode;
  const nameField = $("authName") as HTMLInputElement;
  nameField.hidden = mode === "signin";
  nameField.required = mode === "signup";
  $("authEyebrow").textContent = mode === "signin" ? t("auth_login_eyebrow") : t("auth_signup_eyebrow");
  $("authHeading").textContent = mode === "signin" ? t("auth_login_heading") : t("auth_signup_heading");
  $("authSubmitBtn").textContent = mode === "signin" ? t("auth_submit_signin") : t("auth_submit_signup");
  $("authSwitchPrompt").textContent = mode === "signin" ? t("auth_switch_prompt_signin") : t("auth_switch_prompt_signup");
  $("authSwitchLink").textContent = mode === "signin" ? t("auth_switch_link_signin") : t("auth_switch_link_signup");
}
function toggleAuthMode(): void {
  setAuthMode(authMode === "signin" ? "signup" : "signin");
  $("authError").hidden = true;
}
function openLogin(): void {
  closeMobileMenu();
  if (!firebaseConfigured) {
    toast(t("toast_login_not_set_up"));
    return;
  }
  setAuthMode("signin");
  $("authError").hidden = true;
  ($("authForm") as HTMLFormElement).reset();
  $("loginModal").classList.add("open");
}
function closeLogin(): void {
  $("loginModal").classList.remove("open");
}
async function submitAuth(e: Event): Promise<void> {
  e.preventDefault();
  const errorBox = $("authError");
  errorBox.hidden = true;
  const email = ($("authEmail") as HTMLInputElement).value.trim();
  const password = ($("authPassword") as HTMLInputElement).value;
  const name = ($("authName") as HTMLInputElement).value.trim();
  if (!email) {
    errorBox.textContent = t("auth_error_email");
    errorBox.hidden = false;
    return;
  }
  if (password.length < 8) {
    errorBox.textContent = t("auth_error_password");
    errorBox.hidden = false;
    return;
  }
  if (authMode === "signup" && !name) {
    errorBox.textContent = t("auth_error_name");
    errorBox.hidden = false;
    return;
  }
  const btn = $("authSubmitBtn") as HTMLButtonElement;
  btn.disabled = true;
  try {
    if (authMode === "signup") await signUp(name, email, password);
    else await signIn(email, password);
    closeLogin();
    toast(authMode === "signup" ? t("toast_account_created") : t("toast_signed_in"));
  } catch (err) {
    errorBox.textContent = err instanceof Error ? err.message : t("auth_error_generic");
    errorBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
}
async function logout(): Promise<void> {
  await logOut();
  toast(t("toast_signed_out"));
}
function requireLogin(): boolean {
  if (!currentUser) {
    openLogin();
    return false;
  }
  return true;
}
let ratingRequestId = 0;
function renderRatingStars(filled: number): void {
  document.querySelectorAll<HTMLButtonElement>("#detailRatingStars .starBtn").forEach((btn) => {
    btn.classList.toggle("filled", Number(btn.dataset.star) <= filled);
  });
}
async function loadRatingSummary(mangaId: string): Promise<void> {
  const requestId = ++ratingRequestId;
  renderRatingStars(0);
  $("detailRatingBig").textContent = "–";
  $("detailRatingCount").textContent = "0";
  if (!firebaseConfigured) return;
  const { fetchRatingSummary } = await import("./ratings");
  const { average, count, userStars } = await fetchRatingSummary(mangaId, currentUser?.uid);
  if (requestId !== ratingRequestId) return;
  $("detailRatingBig").textContent = count ? average.toFixed(1) : "–";
  $("detailRating").textContent = count ? average.toFixed(1) : "0";
  $("detailRatingCount").textContent = String(count);
  renderRatingStars(userStars ?? Math.round(average));
}
async function rateComic(stars: number): Promise<void> {
  if (!requireLogin()) return;
  if (!firebaseConfigured) {
    toast(t("toast_ratings_not_set_up"));
    return;
  }
  try {
    const { submitRating } = await import("./ratings");
    await submitRating(currentComic, currentUser!.uid, stars);
    toast(t("toast_rating_thanks"));
    loadRatingSummary(currentComic);
  } catch {
    toast(t("toast_rating_failed"));
  }
}
function commentHtml(row: CommentRow): string {
  const when = new Date(row.created_at).toLocaleDateString();
  return `<div class="comment"><p>${escapeHtml(row.body)}</p><b>${escapeHtml(row.name)}</b><small>${when}</small></div>`;
}
function commentLoadMoreBtn(containerId: string): HTMLButtonElement | null {
  return document
    .getElementById(containerId)
    ?.parentElement?.querySelector<HTMLButtonElement>(".loadMoreBtn") ?? null;
}
function threadKey(kind: "reader" | "detail"): string {
  const chapterId = kind === "reader" ? currentChapterId : null;
  return currentComic + "::" + (chapterId ?? "detail");
}
function renderVisibleComments(kind: "reader" | "detail"): void {
  const containerId = kind === "detail" ? "detailComments" : "readerComments";
  const rows = commentThreads.get(threadKey(kind)) ?? [];
  const visible = kind === "detail" ? detailVisibleCount : readerVisibleCount;
  $(containerId).innerHTML =
    rows.length === 0
      ? `<div class="empty">${t("no_comments_yet")}</div>`
      : rows.slice(0, visible).map(commentHtml).join("");
  const btn = commentLoadMoreBtn(containerId);
  if (btn) {
    const done = rows.length === 0 || visible >= rows.length;
    btn.textContent = done ? t("all_comments_loaded") : t("load_more_comments");
    btn.disabled = done;
    btn.style.opacity = done ? ".55" : "";
  }
}
async function loadComments(kind: "reader" | "detail", reset: boolean): Promise<void> {
  if (!reset) {
    renderVisibleComments(kind);
    return;
  }
  const containerId = kind === "detail" ? "detailComments" : "readerComments";
  const chapterId = kind === "reader" ? currentChapterId : null;
  if (kind === "detail") detailVisibleCount = COMMENTS_PAGE_SIZE;
  else readerVisibleCount = COMMENTS_PAGE_SIZE;
  $(containerId).innerHTML = firebaseConfigured
    ? `<div class="empty">${t("loading")}</div>`
    : `<div class="empty">${t("toast_comments_not_set_up")}</div>`;
  if (!firebaseConfigured) return;
  try {
    const { fetchThread } = await import("./comments");
    commentThreads.set(threadKey(kind), await fetchThread(currentComic, chapterId));
  } catch {
    $(containerId).innerHTML = `<div class="empty">${t("failed_load_comments")}</div>`;
    return;
  }
  renderVisibleComments(kind);
}
function loadMoreComments(containerId: string): void {
  const kind = containerId === "detailComments" ? "detail" : "reader";
  if (kind === "detail") detailVisibleCount += COMMENTS_PAGE_SIZE;
  else readerVisibleCount += COMMENTS_PAGE_SIZE;
  renderVisibleComments(kind);
}
async function submitComment(kind: "reader" | "detail"): Promise<void> {
  if (!requireLogin()) return;
  if (!firebaseConfigured) {
    toast(t("toast_comments_not_set_up"));
    return;
  }
  const prefix = kind === "reader" ? "reader" : "detail";
  const text = ($(prefix + "Comment") as HTMLTextAreaElement).value.trim();
  if (!text) {
    toast(t("toast_write_comment"));
    return;
  }
  const user = currentUser!;
  const name = user.displayName || user.email || t("reader_fallback_name");
  try {
    const { postComment } = await import("./comments");
    const row = await postComment({
      manga_id: currentComic,
      chapter_id: kind === "reader" ? currentChapterId : null,
      uid: user.uid,
      name,
      body: text,
    });
    const key = threadKey(kind);
    commentThreads.set(key, [row, ...(commentThreads.get(key) ?? [])]);
    if (kind === "detail") detailVisibleCount++;
    else readerVisibleCount++;
    renderVisibleComments(kind);
    toast(kind === "reader" ? t("toast_comment_posted") : t("toast_review_posted"));
    ($(prefix + "Comment") as HTMLTextAreaElement).value = "";
  } catch {
    toast(t("toast_post_failed"));
  }
}
function escapeHtml(v: string): string {
  return v.replace(
    /[&<>'"]/g,
    (c) =>
      (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" } as Record<string, string>
      )[c],
  );
}
function openAccount(tab?: AccountTab): void {
  closeMobileMenu();
  if (!currentUser) {
    openLogin();
    return;
  }
  hideViews();
  $("accountView").classList.add("active");
  setNav(tab === "library" ? "library" : "account");
  updateAccountSidebar();
  accountTab(tab || "overview");
  scrollTop();
  history.pushState({ view: "account", tab: tab || "overview" }, "", "#account");
}
function updateAccountSidebar(): void {
  const displayName = currentUser?.displayName || currentUser?.email || t("reader_fallback_name");
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "R";
  $("accountAvatar").textContent = initials;
  $("accountName").textContent = displayName;
  $("accountEmail").textContent = currentUser?.email || "—";
}
async function accountTab(tab: AccountTab): Promise<void> {
  document
    .querySelectorAll<HTMLElement>(".accountTab[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const p = $("accountPanel");
  const displayName = currentUser?.displayName || t("reader_fallback_name");
  if (tab === "overview")
    p.innerHTML = `<div class="eyebrow">${t("overview_eyebrow")}</div><h2>${t("overview_welcome_prefix")}${escapeHtml(displayName)}.</h2><p>${t("overview_desc")}</p><div class="statCards"><div class="statCard"><b>${followed.size}</b><span>${t("overview_saved_titles")}</span></div></div><div class="accountList"><div class="accountItem"><div><strong>${t("overview_latest_notif")}</strong><small>${t("overview_check_notif")}</small></div><button class="secondary" onclick="accountTab('notifications')">${t("view_label")}</button></div></div>`;
  if (tab === "profile")
    p.innerHTML = `<div class="eyebrow">${t("profile_eyebrow")}</div><h2>${t("profile_heading")}</h2><p>${t("profile_desc")}</p><div class="setting"><div><strong>${t("profile_display_name")}</strong><small>${escapeHtml(displayName)}</small></div></div><div class="setting"><div><strong>${t("profile_email")}</strong><small>${escapeHtml(currentUser?.email || "—")}</small></div><span class="typeBadge">${t("badge_email")}</span></div><div class="setting"><div><strong>${t("profile_signed_in_with")}</strong><small>${t("profile_email_password")}</small></div><span class="statusBadge">${t("badge_connected")}</span></div>`;
  if (tab === "library") {
    p.innerHTML = `<div class="eyebrow">${t("tab_library")}</div><h2>${t("library_heading")}</h2><p>${t("library_desc")}</p><h3 style="margin:24px 0 12px">${t("library_following")}</h3><div class="grid" id="libraryList">${t("loading")}</div><h3 style="margin:32px 0 12px">${t("library_history")}</h3><div class="accountList" id="historyList">${t("loading")}</div>`;
    const ids = [...followed];
    const comicsList = await Promise.all(ids.map((id) => comicBy(id).catch(() => null)));
    const list = document.getElementById("libraryList");
    if (list)
      list.innerHTML =
        comicsList
          .filter((c): c is Comic => c !== null)
          .map((c) => cardHtml(c))
          .join("") || `<div class="empty" style="grid-column:1/-1">${t("library_empty")}</div>`;

    const HISTORY_LIMIT = 20;
    const saved: Record<string, ReadingProgressEntry> = JSON.parse(
      localStorage.getItem("panpan-progress") || "{}",
    );
    const entries = Object.entries(saved)
      .sort((a, b) => b[1].updated - a[1].updated)
      .slice(0, HISTORY_LIMIT);
    const rows = await Promise.all(
      entries.map(async ([key, progress]) => {
        const [mangaId, chapterId] = key.split("::");
        try {
          const c = await comicBy(mangaId);
          return `<div class="accountItem"><div><strong>${c.title}</strong><small>${Math.round(progress.percent)}% ${t("reading_progress")}</small></div><button class="secondary" onclick="openReader('${chapterId}','${mangaId}')">${t("continue_label")}</button></div>`;
        } catch {
          return "";
        }
      }),
    );
    const historyList = document.getElementById("historyList");
    if (historyList) historyList.innerHTML = rows.join("") || `<div class="empty">${t("history_empty")}</div>`;
  }
  if (tab === "notifications")
    p.innerHTML = `<div class="eyebrow">${t("notif_eyebrow")}</div><h2>${t("notif_heading")}</h2><p>${t("notif_desc")}</p><div class="accountList"><div class="empty">${t("notif_demo_notice")}</div></div>`;
  if (tab === "settings")
    p.innerHTML = `<div class="eyebrow">${t("tab_settings")}</div><h2>${t("settings_heading")}</h2><p>${t("settings_desc")}</p><div class="setting"><div><strong>${t("setting_auto_next")}</strong><small>${t("setting_auto_next_desc")}</small></div><button class="toggle on" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>${t("setting_chapter_notif")}</strong><small>${t("setting_chapter_notif_desc")}</small></div><button class="toggle on" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>${t("setting_reduce_anim")}</strong><small>${t("setting_reduce_anim_desc")}</small></div><button class="toggle" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>${t("setting_theme")}</strong><small>${t("setting_theme_desc")}</small></div><button class="secondary" onclick="toggleTheme()">${t("theme_aria")}</button></div><div class="setting"><div><strong>${t("continue_reading")}</strong><small>${t("setting_continue_desc")}</small></div><button class="secondary" onclick="openCurrentReader()">${t("open_reader_btn")}</button></div>`;
  if (tab === "security")
    p.innerHTML = `<div class="eyebrow">${t("tab_security")}</div><h2>${t("security_heading")}</h2><p>${t("security_desc")}</p><div class="setting"><div><strong>${t("security_connected_login")}</strong><small>${t("profile_email_password")}</small></div><span style="color:var(--red);font-weight:850">${t("badge_connected")}</span></div><div class="setting"><div><strong>${t("sign_out_label")}</strong><small>${t("sign_out_desc")}</small></div><button class="secondary" onclick="logout()">${t("sign_out_label")}</button></div>`;
}
function saveReadingProgress(): void {
  if (!$("readerView").classList.contains("active") || !currentChapterId) return;
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const percent = Math.min(100, Math.round((window.scrollY / max) * 100));
  const key = currentComic + "::" + currentChapterId;
  const saved: Record<string, ReadingProgressEntry> = JSON.parse(
    localStorage.getItem("panpan-progress") || "{}",
  );
  saved[key] = { percent, updated: Date.now() };
  localStorage.setItem("panpan-progress", JSON.stringify(saved));
  const bar = document.getElementById("readerProgressBar");
  if (bar) bar.style.width = percent + "%";
}
window.addEventListener("scroll", saveReadingProgress, { passive: true });
function toggleTheme(): void {
  const light = document.body.classList.toggle("light");
  localStorage.setItem("panpan-theme", light ? "light" : "dark");
  toast(light ? t("toast_light_mode") : t("toast_dark_mode"));
}
function loadTheme(): void {
  const saved = localStorage.getItem("panpan-theme");
  if (saved === "light") document.body.classList.add("light");
}
function toggleMobileMenu(): void {
  const d = $("mobileDrawer");
  const b = $("mobileMenuBtn");
  const open = d.classList.toggle("open");
  b.innerHTML = open
    ? '<svg class="svgIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>'
    : '<svg class="svgIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>';
  b.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  d.setAttribute("aria-hidden", open ? "false" : "true");
}
function closeMobileMenu(): void {
  const d = document.getElementById("mobileDrawer");
  if (!d) return;
  d.classList.remove("open");
  const b = $("mobileMenuBtn");
  b.innerHTML = '<svg class="svgIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>';
  b.setAttribute("aria-label", "Open menu");
  d.setAttribute("aria-hidden", "true");
}
document.addEventListener(
  "pointerdown",
  (e) => {
    const drawer = document.getElementById("mobileDrawer");
    if (!drawer || !drawer.classList.contains("open")) return;
    const target = e.target as HTMLElement;
    if (target.closest("#mobileDrawer") || target.closest("#mobileMenuBtn")) return;
    closeMobileMenu();
  },
  true,
);

const debouncedExplore = debounce(() => renderExplore(), 300);
const debouncedSearch = debounce(() => renderSearchResults(), 300);

const searchInput = $("search") as HTMLInputElement;
searchInput.addEventListener("input", () => {
  debouncedSearch();
  if ($("exploreView").classList.contains("active")) debouncedExplore();
});
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".searchWrap, .mobileSearchBtn")) {
    hideSearchResults();
    $("searchWrap").classList.remove("mobileOpen");
  }
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = $("searchResults").querySelector<HTMLElement>(".searchResult");
    if (first) first.click();
    else showExplore();
  }
});
window.addEventListener("popstate", (e) => {
  const s = location.hash;
  if (s.startsWith("#read-")) {
    const [mangaId, chapterId] = s.replace("#read-", "").split("::");
    if (mangaId && chapterId) openReader(chapterId, mangaId);
    else goHome();
  } else if (s.startsWith("#comic-")) openComic(s.replace("#comic-", ""));
  else if (s === "#explore") showExplore();
  else if (s === "#account") openAccount("overview");
  else if (s === "#faq") openFAQ();
  else if (s === "#about") openAbout();
  else if (s === "#legal") openLegal((e.state as { title?: string } | null)?.title || "Terms of Use");
  else goHome();
});
function renderBuildVersion(): void {
  const el = document.getElementById("buildVersion");
  if (!el) return;
  const d = new Date(__BUILD_TIME__);
  el.textContent = `· Build ${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function refreshLoginButton(): void {
  const btn = $("loginBtn") as HTMLButtonElement;
  btn.textContent = currentUser ? t("logout") : t("login");
  btn.onclick = currentUser ? logout : openLogin;
}
function toggleLang(): void {
  setLang(getLang() === "id" ? "en" : "id");
  refreshLoginButton();
}

loadTheme();
applyI18n();
renderBuildVersion();
renderGenreChips();
renderTrendingToday();
renderTrending();
renderLatestUpdates();
renderContinueReading();
renderExplore();
renderHomeGenre("All");

onAuthChange((user) => {
  currentUser = user;
  refreshLoginButton();
  if (!user && $("accountView").classList.contains("active")) goHome();
});

// The markup still relies on inline `onclick="fn(...)"` handlers, so the
// functions those handlers call need to exist on `window` (ES modules do
// not leak declarations into global scope the way a classic <script> did).
Object.assign(window, {
  goHome,
  showExplore,
  openComic,
  openReader,
  changeChapter,
  prevChapter,
  nextChapter,
  goBackFromDetail,
  toggleFollow,
  openLogin,
  closeLogin,
  submitAuth,
  toggleAuthMode,
  logout,
  loadMoreComments,
  submitComment,
  openAccount,
  accountTab,
  toggleMobileMenu,
  closeMobileMenu,
  toggleTheme,
  openFAQ,
  openAbout,
  openLegal,
  filterBy,
  setExploreGenre,
  applyFilters,
  setHomeGenre,
  toggleGenreMore,
  toggleMobileSearch,
  setTrendingPage,
  setTrendingTodayPage,
  setExplorePage,
  setHomeGenrePage,
  setLatestPage,
  setLatestType,
  hideSearchResults,
  openCurrentReader,
  startReading,
  rateComic,
  toggleLang,
});
