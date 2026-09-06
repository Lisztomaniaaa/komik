import {
  fetchChapterPages,
  fetchChapters,
  fetchLatestUpdates,
  fetchList,
  fetchMangaDetail,
  fetchPopular,
  quickSearch,
} from "./mangadex";
import type {
  AccountTab,
  ChapterEntry,
  Comic,
  FilterKey,
  Filters,
  ReaderBackground,
  ReaderMode,
  ReadingProgressEntry,
  SortMode,
} from "./types";

// The markup in index.html is static and every id referenced here is
// guaranteed to exist, so `$` is typed to return a non-null HTMLElement
// rather than forcing an optional-chain at every call site.
function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

// Solo Leveling — used only to seed the demo's "already following one
// title" starting state with a manga id that actually exists on MangaDex.
const SEED_FOLLOWED_ID = "32d76d19-8a05-4db0-9fc2-e0b0648fe9d0";

let filters: Filters = { type: "All", genre: "All", status: "All" };
let currentComic = "";
let currentChapterId: string | null = null;
let loggedIn = false;
const followed = new Set<string>([SEED_FOLLOWED_ID]);
let sortMode: SortMode = "latest";
let explorePage = 1;
let homeGenrePage = 1;
let homeGenreCurrent = "All";
const PAGE_SIZE = 10;

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
function setNav(which: "home" | "explore" | ""): void {
  $("navHome").classList.toggle("active", which === "home");
  $("navExplore").classList.toggle("active", which === "explore");
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

async function renderHomeSearchResults(): Promise<void> {
  const input = document.getElementById("homeSearch") as HTMLInputElement | null;
  const box = document.getElementById("homeSearchResults");
  if (!input || !box) return;
  const q = (input.value || "").trim();
  ($("homeSearchClear") as HTMLElement).hidden = !q;
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
          `<div class="homeSearchResult" onclick="openComic('${c.id}');hideHomeSearchResults()"><div class="miniCover">${c.cover ? `<img src="${c.cover}" alt="">` : ""}</div><div><strong>${c.title}</strong><small>${c.type} · ${c.status} · ★ ${c.rating}</small></div></div>`,
      )
      .join("") || '<div class="homeSearchEmpty">No comics found.</div>';
  box.style.display = "block";
}
function hideHomeSearchResults(): void {
  const b = document.getElementById("homeSearchResults");
  if (b) b.style.display = "none";
}
function clearHomeSearch(): void {
  const i = document.getElementById("homeSearch") as HTMLInputElement | null;
  if (!i) return;
  i.value = "";
  ($("homeSearchClear") as HTMLElement).hidden = true;
  hideHomeSearchResults();
  i.focus();
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
      .join("") || '<div class="searchEmpty">No comics found.</div>';
  box.style.display = "block";
}
function hideSearchResults(): void {
  $("searchResults").style.display = "none";
}

let exploreRequestId = 0;
async function renderExplore(): Promise<void> {
  const grid = $("exploreGrid");
  const q = (($("search") as HTMLInputElement).value || "").trim();
  const requestId = ++exploreRequestId;
  grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Loading…</div>';
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
      '<div class="empty" style="grid-column:1/-1">No comics match these filters.</div>';
    renderPagination("explorePagination", explorePage, pages, "setExplorePage", total);
  } catch {
    if (requestId !== exploreRequestId) return;
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Failed to load comics from MangaDex.</div>';
  }
}
let homeGenreRequestId = 0;
async function renderHomeGenre(genre = "All"): Promise<void> {
  const grid = $("genreResults");
  homeGenreCurrent = genre;
  const requestId = ++homeGenreRequestId;
  grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Loading…</div>';
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
      '<div class="empty" style="grid-column:1/-1">No comics in this genre yet.</div>';
    renderPagination("genrePagination", homeGenrePage, pages, "setHomeGenrePage", total);
  } catch {
    if (requestId !== homeGenreRequestId) return;
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Failed to load comics from MangaDex.</div>';
  }
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
  handler: "setExplorePage" | "setHomeGenrePage",
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
  out += `<button ${page === pages ? "disabled" : ""} onclick="${handler}(${page + 1})">›</button><span class="pageInfo">${total} comics</span>`;
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

async function renderTrending(): Promise<void> {
  const grid = document.getElementById("trendingGrid");
  if (!grid) return;
  try {
    const list = await fetchPopular(5);
    trendingTop = list[0] ?? null;
    grid.innerHTML = list.map((c, i) => cardHtml(c, i + 1)).join("");
  } catch {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Failed to load trending comics.</div>';
  }
}
async function renderLatestUpdates(): Promise<void> {
  const list = document.getElementById("latestList");
  if (!list) return;
  try {
    const comics = await fetchLatestUpdates(3);
    list.innerHTML = comics
      .map(
        (c) =>
          `<div class="row" style="cursor:pointer" onclick="openComic('${c.id}')"><div class="thumb">${c.cover ? `<img src="${c.cover}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:7px">` : ""}</div><div><strong>${c.title}</strong><small>Chapter ${c.chapters}</small></div><span class="new">NEW</span></div>`,
      )
      .join("");
  } catch {
    list.innerHTML = '<div class="empty">Failed to load latest updates.</div>';
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
    box.innerHTML = '<div class="empty">You have not started reading anything yet.</div>';
    return;
  }
  const [mangaId] = entries[0][0].split("::");
  try {
    const c = await comicBy(mangaId);
    box.innerHTML = `<div class="row" style="cursor:pointer" onclick="openComic('${c.id}')"><div class="thumb">${c.cover ? `<img src="${c.cover}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:7px">` : ""}</div><div><strong>${c.title}</strong><small>${Math.round(entries[0][1].percent)}% progress</small></div><span class="new">CONTINUE</span></div>`;
  } catch {
    box.innerHTML = '<div class="empty">You have not started reading anything yet.</div>';
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
  $("detailTitle").textContent = "Loading…";
  $("detailGenre").textContent = "";
  $("detailDesc").textContent = "";
  $("detailChips").innerHTML = "";
  $("detailCover").style.backgroundImage = "";
  $("chapterList").innerHTML = "";
  scrollTop();
  history.pushState({ view: "detail", id }, "", "#comic-" + id);

  try {
    const [c, chapters] = await Promise.all([comicBy(id), getChaptersFor(id)]);
    if (requestId !== openComicRequestId) return;
    $("detailTitle").textContent = c.title;
    $("detailGenre").textContent = c.type + " · " + c.genres.join(" · ");
    $("detailDesc").textContent = c.desc;
    $("detailRating").textContent = String(c.rating);
    $("detailRatingBig").textContent = String(c.rating);
    $("detailRatingCount").textContent = c.readers;
    // MangaDex's lastChapter attribute is frequently blank even when chapters
    // exist, so prefer the actually-fetched chapter feed when it's available.
    const latestChapterNumber = chapters[0]?.chapterNumber ?? c.chapters;
    $("detailChapters").textContent = String(latestChapterNumber);
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
    $("followBtn").textContent = followed.has(id) ? "Following" : "Follow";
    buildChapters(chapters, id);
  } catch {
    if (requestId !== openComicRequestId) return;
    $("detailTitle").textContent = "Failed to load this comic.";
  }
}
function buildChapters(entries: ChapterEntry[], mangaId: string): void {
  const box = $("chapterList");
  box.className = "chapterScroll";
  if (entries.length === 0) {
    box.innerHTML = '<div class="empty">No Indonesian or English chapters found for this comic.</div>';
    return;
  }
  box.innerHTML = entries
    .map(
      (e, i) =>
        `<div class="chapterRow" onclick="openReader('${e.id}','${mangaId}')"><div><strong>${e.label}</strong><small>${i === 0 ? "Latest chapter" : "Updated"} · ${new Date(e.publishAt).toLocaleDateString()}</small></div><span class="chapterGo">Read →</span></div>`,
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
  $("readerTitle").textContent = "Loading…";
  $("readerSelect").innerHTML = "";
  $("readerChapters").innerHTML = "";
  $("readerView").querySelector(".page")!.innerHTML = '<div class="empty">Loading pages…</div>';
  window.scrollTo({ top: 0, behavior: "instant" });
  scrollTop();
  history.pushState({ view: "reader", id, chapterId }, "", "#read-" + id + "::" + chapterId);
  updateFullscreenButton();
  if (enteringReader && !document.fullscreenElement && document.documentElement.requestFullscreen)
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});

  try {
    const [c, chapters, pages] = await Promise.all([
      comicBy(id),
      getChaptersFor(id),
      fetchChapterPages(chapterId),
    ]);
    if (requestId !== openReaderRequestId) return;
    const entry = chapters.find((e) => e.id === chapterId);
    $("readerTitle").textContent = c.title + " · " + (entry?.label ?? "Chapter");

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
      '<div class="empty">No pages available for this chapter.</div>';

    const saved: Record<string, ReadingProgressEntry> = JSON.parse(
      localStorage.getItem("panpan-progress") || "{}",
    );
    const pct = saved[id + "::" + chapterId]?.percent || 0;
    $("readerProgressBar").style.width = pct + "%";
  } catch {
    if (requestId !== openReaderRequestId) return;
    $("readerTitle").textContent = "Failed to load this chapter.";
    ($("readerView").querySelector(".page") as HTMLElement).innerHTML =
      '<div class="empty">Failed to load pages from MangaDex.</div>';
  }
}
function changeChapter(v: string): void {
  openReader(v, currentComic);
}
function openCurrentReader(): void {
  if (currentChapterId) openReader(currentChapterId, currentComic);
  else toast("You have not opened a reader yet.");
}
async function prevChapter(): Promise<void> {
  const list = chaptersCache.get(currentComic);
  if (!list || !currentChapterId) return;
  const idx = list.findIndex((e) => e.id === currentChapterId);
  if (idx >= 0 && idx < list.length - 1) openReader(list[idx + 1].id, currentComic);
  else toast("Already at the first chapter.");
}
async function nextChapter(): Promise<void> {
  const list = chaptersCache.get(currentComic);
  if (!list || !currentChapterId) return;
  const idx = list.findIndex((e) => e.id === currentChapterId);
  if (idx > 0) openReader(list[idx - 1].id, currentComic);
  else toast("You are at the latest chapter.");
}
function goBackFromDetail(): void {
  history.back();
}
function toggleFollow(): void {
  if (followed.has(currentComic)) {
    followed.delete(currentComic);
    toast("Removed from library.");
  } else {
    followed.add(currentComic);
    toast("Added to library.");
  }
  $("followBtn").textContent = followed.has(currentComic) ? "Following" : "Follow";
}

function openLogin(): void {
  closeMobileMenu();
  $("loginModal").classList.add("open");
}
function closeLogin(): void {
  $("loginModal").classList.remove("open");
}
function demoLogin(provider: string): void {
  loggedIn = true;
  localStorage.setItem("panpan-demo-login", "1");
  closeLogin();
  $("loginBtn").textContent = "Logout";
  $("loginBtn").onclick = logout;
  toast("Logged in as Irfan Demo via " + provider);
}
function logout(): void {
  loggedIn = false;
  localStorage.removeItem("panpan-demo-login");
  $("loginBtn").textContent = "Login";
  $("loginBtn").onclick = openLogin;
  toast("Logged out of demo account.");
}
function requireLogin(): boolean {
  if (!loggedIn) {
    $("loginRequired").classList.add("open");
    return false;
  }
  return true;
}
function closeRequiredLogin(): void {
  $("loginRequired").classList.remove("open");
}
function loadMoreComments(containerId: string, btn: HTMLButtonElement): void {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.querySelectorAll<HTMLElement>(".extraComment[hidden]").forEach((el) => (el.hidden = false));
  btn.textContent = "All comments loaded";
  btn.disabled = true;
  btn.style.opacity = ".55";
}
function pickStar(btn: HTMLElement, n: number): void {
  const parent = btn.parentElement as HTMLElement;
  [...parent.children].forEach((b, i) => b.classList.toggle("on", i < n));
  parent.dataset.rating = String(n);
}
function submitComment(kind: "reader" | "detail"): void {
  if (!requireLogin()) return;
  const prefix = kind === "reader" ? "reader" : "detail";
  const name = ($(prefix + "Name") as HTMLInputElement).value.trim();
  const text = ($(prefix + "Comment") as HTMLTextAreaElement).value.trim();
  const stars = $(prefix + "Stars").dataset.rating;
  if (!name || !text || !stars) {
    toast("Please choose a rating, name and comment.");
    return;
  }
  const target = $(kind === "reader" ? "readerComments" : "detailComments");
  const card = document.createElement("div");
  card.className = "comment";
  card.innerHTML = `<div class="stars">${"★".repeat(Number(stars))}${"☆".repeat(5 - Number(stars))}</div><p>${escapeHtml(text)}</p><b>${escapeHtml(name)}</b><small>Just now · Demo account</small>`;
  target.prepend(card);
  toast("Your " + (kind === "reader" ? "comment" : "review") + " was posted.");
  ($(prefix + "Name") as HTMLInputElement).value = "";
  ($(prefix + "Comment") as HTMLTextAreaElement).value = "";
  $(prefix + "Stars").dataset.rating = "";
  $(prefix + "Stars")
    .querySelectorAll("button")
    .forEach((b) => b.classList.remove("on"));
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
  if (!loggedIn) {
    openLogin();
    return;
  }
  hideViews();
  $("accountView").classList.add("active");
  accountTab(tab || "overview");
  scrollTop();
  history.pushState({ view: "account", tab: tab || "overview" }, "", "#account");
}
async function accountTab(tab: AccountTab): Promise<void> {
  document
    .querySelectorAll<HTMLElement>(".accountTab[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const p = $("accountPanel");
  if (tab === "overview")
    p.innerHTML = `<div class="eyebrow">Overview</div><h2>Welcome back, Irfan.</h2><p>Your demo reading profile at a glance.</p><div class="statCards"><div class="statCard"><b>${followed.size}</b><span>Saved titles</span></div></div><div class="accountList"><div class="accountItem"><div><strong>Latest notification</strong><small>Check the notifications tab.</small></div><button class="secondary" onclick="accountTab('notifications')">View</button></div></div>`;
  if (tab === "profile")
    p.innerHTML = `<div class="eyebrow">Profile</div><h2>About you.</h2><p>Manage the public information shown on your demo profile.</p><div class="setting"><div><strong>Display name</strong><small>Irfan Demo</small></div><button class="secondary" onclick="toast('Demo profile editor opened.')">Edit</button></div><div class="setting"><div><strong>Email</strong><small>irfan@example.com</small></div><span class="typeBadge">EMAIL</span></div><div class="setting"><div><strong>Primary login</strong><small>Google</small></div><span class="statusBadge">CONNECTED</span></div><div class="setting"><div><strong>Public activity</strong><small>Show ratings and comments on your profile.</small></div><button class="toggle on" onclick="this.classList.toggle('on')"></button></div>`;
  if (tab === "library") {
    p.innerHTML = `<div class="eyebrow">Library</div><h2>My library.</h2><p>Titles you follow are kept here.</p><div class="accountList" id="libraryList">Loading…</div>`;
    const ids = [...followed];
    const comicsList = await Promise.all(ids.map((id) => comicBy(id).catch(() => null)));
    const list = document.getElementById("libraryList");
    if (list)
      list.innerHTML =
        comicsList
          .filter((c): c is Comic => c !== null)
          .map(
            (c) =>
              `<div class="accountItem"><div><strong>${c.title}</strong><small>${c.type} · ${c.status} · ★ ${c.rating}</small></div><button class="secondary" onclick="openComic('${c.id}')">Open</button></div>`,
          )
          .join("") || '<div class="empty">Your library is empty.</div>';
  }
  if (tab === "history")
    p.innerHTML = `<div class="eyebrow">Reading</div><h2>Reading history.</h2><p>Demo progress saved for this session.</p><div class="accountList" id="historyList">Loading…</div>`;
  if (tab === "history") {
    const saved: Record<string, ReadingProgressEntry> = JSON.parse(
      localStorage.getItem("panpan-progress") || "{}",
    );
    const entries = Object.entries(saved).sort((a, b) => b[1].updated - a[1].updated);
    const rows = await Promise.all(
      entries.map(async ([key, progress]) => {
        const [mangaId, chapterId] = key.split("::");
        try {
          const c = await comicBy(mangaId);
          return `<div class="accountItem"><div><strong>${c.title}</strong><small>${Math.round(progress.percent)}% progress</small></div><button class="secondary" onclick="openReader('${chapterId}','${mangaId}')">Continue</button></div>`;
        } catch {
          return "";
        }
      }),
    );
    const list = document.getElementById("historyList");
    if (list) list.innerHTML = rows.join("") || '<div class="empty">No reading history yet.</div>';
  }
  if (tab === "notifications")
    p.innerHTML = `<div class="eyebrow">Notifications</div><h2>Stay updated.</h2><p>New chapters from followed titles appear here.</p><div class="accountList"><div class="empty">This is a demo — notifications are not tracked live.</div></div>`;
  if (tab === "settings")
    p.innerHTML = `<div class="eyebrow">Preferences</div><h2>Settings.</h2><p>Reader, appearance and notification preferences.</p><div class="setting"><div><strong>Auto next chapter</strong><small>Open the next chapter after finishing a reader page.</small></div><button class="toggle on" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>Chapter notifications</strong><small>Notify me when followed comics update.</small></div><button class="toggle on" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>Reduce animations</strong><small>Use simpler transitions on mobile.</small></div><button class="toggle" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>Theme</strong><small>Switch between dark and light mode.</small></div><button class="secondary" onclick="toggleTheme()">Toggle theme</button></div><div class="setting"><div><strong>Reader preferences</strong><small>Open reader settings to customize page display.</small></div><button class="secondary" onclick="openCurrentReader()">Open reader</button></div>`;
  if (tab === "security")
    p.innerHTML = `<div class="eyebrow">Security</div><h2>Account security.</h2><p>Demo controls only. No real credentials are stored.</p><div class="setting"><div><strong>Connected login</strong><small>Google · Primary login</small></div><span style="color:var(--red);font-weight:850">CONNECTED</span></div><div class="setting"><div><strong>Active sessions</strong><small>Android · Current demo session</small></div><button class="secondary" onclick="toast('Demo session list opened.')">Manage</button></div><div class="setting"><div><strong>Delete demo account</strong><small>This only resets the local demo state.</small></div><button class="secondary" onclick="logout();toast('Demo account reset.')">Reset</button></div>`;
}
function toggleReaderSettings(): void {
  $("readerSettings").classList.toggle("open");
}
function setReaderMode(mode: ReaderMode): void {
  $("readerView")
    .querySelectorAll<HTMLElement>(".comicPage")
    .forEach((page) => {
      page.style.maxWidth = mode === "single" ? "720px" : "100%";
    });
  const select = document.getElementById("readerMode") as HTMLSelectElement | null;
  if (select) select.value = mode;
  localStorage.setItem("panpan-reader-mode", mode);
  toast("Reader mode: " + mode);
}
function setReaderBackground(mode: ReaderBackground): void {
  const page = $("readerView").querySelector<HTMLElement>(".page");
  if (!page) return;
  page.style.background = mode === "white" ? "#fff" : mode === "dark" ? "#17181a" : "#050505";
  localStorage.setItem("panpan-reader-bg", mode);
}
function setReaderBrightness(v: string): void {
  $("readerView").style.filter = `brightness(${Number(v) / 100})`;
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
  toast(light ? "Light mode enabled." : "Dark mode enabled.");
}
function loadTheme(): void {
  const saved = localStorage.getItem("panpan-theme");
  if (saved === "light") document.body.classList.add("light");
}
function updateFullscreenButton(): void {
  const b = document.getElementById("readerFullscreenBtn");
  if (!b) return;
  const active = !!document.fullscreenElement;
  b.innerHTML = active
    ? '<svg class="svgIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5"></path></svg><span>Exit fullscreen</span>'
    : '<svg class="svgIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"></path></svg><span>Fullscreen</span>';
}
async function toggleReaderFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    toast("Fullscreen is not available in this browser.");
  }
  updateFullscreenButton();
}
function leaveReaderFullscreen(): void {
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
document.addEventListener("fullscreenchange", updateFullscreenButton);
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
const debouncedHomeSearch = debounce(() => renderHomeSearchResults(), 300);
const debouncedSearch = debounce(() => renderSearchResults(), 300);

const searchInput = $("search") as HTMLInputElement;
searchInput.addEventListener("input", () => {
  debouncedSearch();
  if ($("exploreView").classList.contains("active")) debouncedExplore();
});
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".searchWrap")) hideSearchResults();
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = $("searchResults").querySelector<HTMLElement>(".searchResult");
    if (first) first.click();
    else showExplore();
  }
});
const homeSearch = document.getElementById("homeSearch") as HTMLInputElement | null;
if (homeSearch) {
  homeSearch.addEventListener("input", debouncedHomeSearch);
  homeSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = $("homeSearchResults").querySelector<HTMLElement>(".homeSearchResult");
      if (first) first.click();
      else showExplore();
    }
  });
  $("homeSearchClear").addEventListener("click", clearHomeSearch);
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".homeSearchWrap")) hideHomeSearchResults();
  });
}
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
loadTheme();
renderTrending();
renderLatestUpdates();
renderContinueReading();
renderExplore();
renderHomeGenre("All");

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
  demoLogin,
  logout,
  closeRequiredLogin,
  loadMoreComments,
  pickStar,
  submitComment,
  openAccount,
  accountTab,
  toggleReaderSettings,
  setReaderMode,
  setReaderBackground,
  setReaderBrightness,
  toggleReaderFullscreen,
  leaveReaderFullscreen,
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
  setExplorePage,
  setHomeGenrePage,
  hideHomeSearchResults,
  hideSearchResults,
  clearHomeSearch,
  openCurrentReader,
  startReading,
});
