import { comics } from "./data";
import type {
  AccountTab,
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

let filters: Filters = { type: "All", genre: "All", status: "All" };
let currentComic = "solo";
let currentChapter = 200;
let loggedIn = false;
const followed = new Set<string>(["solo"]);
let sortMode: SortMode = "latest";
let explorePage = 1;
let homeGenrePage = 1;
let homeGenreCurrent = "All";
const PAGE_SIZE = 10;

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
function comicBy(id: string) {
  return comics.find((c) => c.id === id) || comics[0];
}

function renderHomeSearchResults(): void {
  const input = document.getElementById("homeSearch") as HTMLInputElement | null;
  const box = document.getElementById("homeSearchResults");
  if (!input || !box) return;
  const q = (input.value || "").toLowerCase().trim();
  ($("homeSearchClear") as HTMLElement).hidden = !q;
  if (!q) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const list = comics
    .filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.genres.some((g) => g.toLowerCase().includes(q)) ||
        c.type.toLowerCase().includes(q),
    )
    .slice(0, 8);
  box.innerHTML =
    list
      .map(
        (c) =>
          `<div class="homeSearchResult" onclick="openComic('${c.id}');hideHomeSearchResults()"><div class="miniCover"></div><div><strong>${c.title}</strong><small>${c.type} · ${c.status} · ★ ${c.rating}</small></div></div>`,
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

function renderSearchResults(): void {
  const box = $("searchResults");
  const q = ((($("search") as HTMLInputElement).value || "") as string).toLowerCase().trim();
  if (!q) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const list = comics
    .filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.genres.some((g) => g.toLowerCase().includes(q)) ||
        c.type.toLowerCase().includes(q),
    )
    .slice(0, 8);
  box.innerHTML =
    list
      .map(
        (c) =>
          `<div class="searchResult" onclick="openComic('${c.id}');hideSearchResults()"><div class="miniCover"></div><div><strong>${c.title}</strong><small>${c.type} · ${c.status} · ★ ${c.rating}</small></div></div>`,
      )
      .join("") || '<div class="searchEmpty">No comics found.</div>';
  box.style.display = "block";
}
function hideSearchResults(): void {
  $("searchResults").style.display = "none";
}
function renderExplore(): void {
  const grid = $("exploreGrid");
  let list = comics.filter(
    (c) =>
      (filters.type === "All" || c.type === filters.type) &&
      (filters.genre === "All" || c.genres.includes(filters.genre)) &&
      (filters.status === "All" || c.status === filters.status),
  );
  const q = (($("search") as HTMLInputElement).value || "").toLowerCase().trim();
  if (q)
    list = list.filter(
      (c) => c.title.toLowerCase().includes(q) || c.genres.some((g) => g.toLowerCase().includes(q)),
    );
  if (sortMode === "rating") list.sort((a, b) => b.rating - a.rating);
  if (sortMode === "az") list.sort((a, b) => a.title.localeCompare(b.title));
  if (sortMode === "latest") list.sort((a, b) => b.chapters - a.chapters);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  explorePage = Math.min(Math.max(1, explorePage), pages);
  const slice = list.slice((explorePage - 1) * PAGE_SIZE, explorePage * PAGE_SIZE);
  grid.innerHTML =
    slice
      .map(
        (c, i) =>
          `<div class="card" onclick="openComic('${c.id}')"><div class="cover ${i % 5 === 1 ? "c2" : i % 5 === 2 ? "c3" : i % 5 === 3 ? "c4" : "c5"}"><span class="rank">${c.type}</span><div class="coverText">${c.title.replaceAll(" ", "<br>")}</div></div><div class="title">${c.title}</div><div class="meta">${c.type} · ${c.status} · <span class="star">★ ${c.rating}</span></div></div>`,
      )
      .join("") || '<div class="empty" style="grid-column:1/-1">No comics match these filters.</div>';
  renderPagination("explorePagination", explorePage, pages, "setExplorePage", list.length);
}
function renderHomeGenre(genre = "All"): void {
  const grid = $("genreResults");
  homeGenreCurrent = genre;
  const list = comics.filter((c) => genre === "All" || c.genres.includes(genre));
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  homeGenrePage = Math.min(Math.max(1, homeGenrePage), pages);
  const slice = list.slice((homeGenrePage - 1) * PAGE_SIZE, homeGenrePage * PAGE_SIZE);
  grid.innerHTML =
    slice
      .map(
        (c, i) =>
          `<div class="card" onclick="openComic('${c.id}')"><div class="cover ${i % 5 === 1 ? "c2" : i % 5 === 2 ? "c3" : i % 5 === 3 ? "c4" : "c5"}"><span class="rank">${c.type}</span><div class="coverText">${c.title.replaceAll(" ", "<br>")}</div></div><div class="title">${c.title}</div><div class="meta">${c.type} · <span class="star">★ ${c.rating}</span></div></div>`,
      )
      .join("") || '<div class="empty" style="grid-column:1/-1">No comics in this genre yet.</div>';
  renderPagination("genrePagination", homeGenrePage, pages, "setHomeGenrePage", list.length);
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

function openComic(id: string): void {
  currentComic = id;
  const c = comicBy(id);
  hideViews();
  $("detailView").classList.add("active");
  setNav("");
  $("detailTitle").textContent = c.title;
  $("detailGenre").textContent = c.type + " · " + c.genres.join(" · ");
  $("detailDesc").textContent = c.desc;
  $("detailRating").textContent = String(c.rating);
  $("detailRatingBig").textContent = String(c.rating);
  $("detailRatingCount").textContent = Math.round(parseFloat(c.readers) * 173).toLocaleString();
  $("detailChapters").textContent = String(c.chapters);
  $("detailReaders").textContent = c.readers;
  $("detailChips").innerHTML =
    c.genres.map((g) => `<span class="chip">${g}</span>`).join("") +
    `<span class="chip">${c.status}</span><span class="chip">${c.type}</span>`;
  $("detailCover").style.background = coverGradient(c.id);
  $("detailCover").dataset.title = c.title;
  $("followBtn").textContent = followed.has(id) ? "Following" : "Follow";
  buildChapters(c.chapters);
  scrollTop();
  history.pushState({ view: "detail", id }, "", "#comic-" + id);
}
function coverGradient(id: string): string {
  const maps: Record<string, string> = {
    solo: "linear-gradient(145deg,#641715,#111214 55%,#090909)",
    jjk: "linear-gradient(145deg,#26313d,#101214 50%,#641715)",
    bleach: "linear-gradient(145deg,#341716,#111,#a72d29)",
    mha: "linear-gradient(145deg,#24253b,#0b0c0e 55%,#6c1c1b)",
    onepiece: "linear-gradient(145deg,#4b2012,#101112 55%,#a72c29)",
  };
  return maps[id] || "linear-gradient(145deg,#2a2020,#101112)";
}
function buildChapters(total: number): void {
  const box = $("chapterList");
  box.className = "chapterScroll";
  box.innerHTML = "";
  const start = Math.max(1, total - 39);
  for (let n = total; n >= start; n--)
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="chapterRow" onclick="openReader(${n},'${currentComic}')"><div><strong>Chapter ${n}</strong><small>${n === total ? "Latest chapter" : "Updated recently"} · 5 min read</small></div><span class="chapterGo">Read →</span></div>`,
    );
}
function openReader(ch: number, id: string = currentComic): void {
  const enteringReader = !$("readerView").classList.contains("active");
  currentComic = id;
  currentChapter = Number(ch);
  const c = comicBy(id);
  hideViews();
  $("readerView").classList.add("active");
  setNav("");
  $("readerTitle").textContent = c.title + " · Chapter " + currentChapter;
  const sel = $("readerSelect");
  sel.innerHTML = "";
  for (let n = c.chapters; n >= Math.max(1, c.chapters - 19); n--)
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${n}" ${n === currentChapter ? "selected" : ""}>Chapter ${n}</option>`,
    );
  const r = $("readerChapters");
  r.innerHTML = "";
  for (let n = c.chapters; n >= Math.max(1, c.chapters - 29); n--)
    r.insertAdjacentHTML(
      "beforeend",
      `<div class="rCh ${n === currentChapter ? "active" : ""}" onclick="openReader(${n},'${id}')">Chapter ${n}</div>`,
    );
  const saved: Record<string, ReadingProgressEntry> = JSON.parse(
    localStorage.getItem("panpan-progress") || "{}",
  );
  const pct = saved[id + ":" + currentChapter]?.percent || 0;
  $("readerProgressBar").style.width = pct + "%";
  window.scrollTo({ top: 0, behavior: "instant" });
  scrollTop();
  history.pushState({ view: "reader", id, ch: currentChapter }, "", "#read-" + id + "-" + currentChapter);
  updateFullscreenButton();
  if (enteringReader && !document.fullscreenElement && document.documentElement.requestFullscreen)
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}
function changeChapter(v: string): void {
  openReader(Number(v), currentComic);
}
function openCurrentReader(): void {
  openReader(currentChapter, currentComic);
}
function prevChapter(): void {
  if (currentChapter > 1) openReader(currentChapter - 1, currentComic);
  else toast("Already at the first chapter.");
}
function nextChapter(): void {
  const max = comicBy(currentComic).chapters;
  if (currentChapter < max) openReader(currentChapter + 1, currentComic);
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
function accountTab(tab: AccountTab): void {
  document
    .querySelectorAll<HTMLElement>(".accountTab[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const p = $("accountPanel");
  if (tab === "overview")
    p.innerHTML = `<div class="eyebrow">Overview</div><h2>Welcome back, Irfan.</h2><p>Your demo reading profile at a glance.</p><div class="statCards"><div class="statCard"><b>8</b><span>Comics read</span></div><div class="statCard"><b>${followed.size}</b><span>Saved titles</span></div><div class="statCard"><b>198</b><span>Current chapter</span></div></div><div class="accountList"><div class="accountItem"><div><strong>Continue reading</strong><small>Solo Leveling · Chapter 198</small></div><button class="secondary" onclick="openReader(198,'solo')">Continue</button></div><div class="accountItem"><div><strong>Latest notification</strong><small>One Piece has a new chapter.</small></div><button class="secondary" onclick="accountTab('notifications')">View</button></div></div>`;
  if (tab === "profile")
    p.innerHTML = `<div class="eyebrow">Profile</div><h2>About you.</h2><p>Manage the public information shown on your demo profile.</p><div class="setting"><div><strong>Display name</strong><small>Irfan Demo</small></div><button class="secondary" onclick="toast('Demo profile editor opened.')">Edit</button></div><div class="setting"><div><strong>Email</strong><small>irfan@example.com</small></div><span class="typeBadge">EMAIL</span></div><div class="setting"><div><strong>Primary login</strong><small>Google</small></div><span class="statusBadge">CONNECTED</span></div><div class="setting"><div><strong>Public activity</strong><small>Show ratings and comments on your profile.</small></div><button class="toggle on" onclick="this.classList.toggle('on')"></button></div>`;
  if (tab === "library")
    p.innerHTML = `<div class="eyebrow">Library</div><h2>My library.</h2><p>Titles you follow are kept here.</p><div class="accountList">${
      [...followed]
        .map((id) => {
          const c = comicBy(id);
          return `<div class="accountItem"><div><strong>${c.title}</strong><small>${c.type} · ${c.status} · ★ ${c.rating}</small></div><button class="secondary" onclick="openComic('${id}')">Open</button></div>`;
        })
        .join("") || '<div class="empty">Your library is empty.</div>'
    }</div>`;
  if (tab === "history")
    p.innerHTML = `<div class="eyebrow">Reading</div><h2>Reading history.</h2><p>Demo progress saved for this session.</p><div class="accountList"><div class="accountItem"><div><strong>Solo Leveling</strong><small>Chapter 198 · 72% progress · Today</small></div><button class="secondary" onclick="openReader(198,'solo')">Continue</button></div><div class="accountItem"><div><strong>Jujutsu Kaisen</strong><small>Chapter 236 · Completed · Yesterday</small></div><button class="secondary" onclick="openReader(236,'jjk')">Open</button></div></div>`;
  if (tab === "notifications")
    p.innerHTML = `<div class="eyebrow">Notifications</div><h2>Stay updated.</h2><p>New chapters from followed titles appear here.</p><div class="accountList"><div class="accountItem"><div><strong>One Piece</strong><small>New chapter available · 12 min ago</small></div><span class="new">NEW</span></div><div class="accountItem"><div><strong>Solo Leveling</strong><small>You reached Chapter 198 · Today</small></div><span style="color:#777;font-size:12px">READ</span></div></div>`;
  if (tab === "settings")
    p.innerHTML = `<div class="eyebrow">Preferences</div><h2>Settings.</h2><p>Reader, appearance and notification preferences.</p><div class="setting"><div><strong>Auto next chapter</strong><small>Open the next chapter after finishing a reader page.</small></div><button class="toggle on" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>Chapter notifications</strong><small>Notify me when followed comics update.</small></div><button class="toggle on" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>Reduce animations</strong><small>Use simpler transitions on mobile.</small></div><button class="toggle" onclick="this.classList.toggle('on')"></button></div><div class="setting"><div><strong>Theme</strong><small>Switch between dark and light mode.</small></div><button class="secondary" onclick="toggleTheme()">Toggle theme</button></div><div class="setting"><div><strong>Reader preferences</strong><small>Open reader settings to customize page display.</small></div><button class="secondary" onclick="openCurrentReader()">Open reader</button></div>`;
  if (tab === "security")
    p.innerHTML = `<div class="eyebrow">Security</div><h2>Account security.</h2><p>Demo controls only. No real credentials are stored.</p><div class="setting"><div><strong>Connected login</strong><small>Google · Primary login</small></div><span style="color:var(--red);font-weight:850">CONNECTED</span></div><div class="setting"><div><strong>Active sessions</strong><small>Android · Current demo session</small></div><button class="secondary" onclick="toast('Demo session list opened.')">Manage</button></div><div class="setting"><div><strong>Delete demo account</strong><small>This only resets the local demo state.</small></div><button class="secondary" onclick="logout();toast('Demo account reset.')">Reset</button></div>`;
}
function toggleReaderSettings(): void {
  $("readerSettings").classList.toggle("open");
}
function setReaderMode(mode: ReaderMode): void {
  const page = $("readerView").querySelector<HTMLElement>(".comicPage");
  if (page) {
    page.style.maxWidth = mode === "single" ? "720px" : "100%";
    page.style.minHeight = mode === "continuous" ? "900px" : "760px";
  }
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
  if (!$("readerView").classList.contains("active")) return;
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const percent = Math.min(100, Math.round((window.scrollY / max) * 100));
  const key = currentComic + ":" + currentChapter;
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

const searchInput = $("search") as HTMLInputElement;
searchInput.addEventListener("input", () => {
  renderSearchResults();
  if ($("exploreView").classList.contains("active")) renderExplore();
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
  homeSearch.addEventListener("input", renderHomeSearchResults);
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
    const parts = s.replace("#read-", "").split("-");
    openReader(Number(parts.pop()), parts.join("-"));
  } else if (s.startsWith("#comic-")) openComic(s.replace("#comic-", ""));
  else if (s === "#explore") showExplore();
  else if (s === "#account") openAccount("overview");
  else if (s === "#faq") openFAQ();
  else if (s === "#about") openAbout();
  else if (s === "#legal") openLegal((e.state as { title?: string } | null)?.title || "Terms of Use");
  else goHome();
});
loadTheme();
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
});
