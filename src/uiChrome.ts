// Generic mobile-menu / drawer-tools behaviour. The selectors here
// (.menuPanel, .siteHeader .desktopLogin, etc.) don't currently exist in
// index.html's markup — this is defensive chrome carried over from the
// original template that no-ops until such elements are added.

function closePanpanMenu(): void {
  document.body.classList.remove("menu-open", "nav-open", "drawer-open");
  document.documentElement.classList.remove("menu-open", "nav-open", "drawer-open");
  document
    .querySelectorAll(".menuPanel.open,.menuPanel.active,.mobileMenu.open,.mobileMenu.active,.menuDrawer.open")
    .forEach((el) => {
      el.classList.remove("open", "active");
      el.setAttribute("aria-hidden", "true");
    });
  document
    .querySelectorAll('[aria-expanded="true"][data-menu],.hamburger[aria-expanded="true"],button[aria-expanded="true"]')
    .forEach((el) => {
      if (el.closest(".menuPanel,.mobileMenu,.menuDrawer")) return;
      el.setAttribute("aria-expanded", "false");
    });
}

document.addEventListener(
  "click",
  (e) => {
    const target = e.target as HTMLElement;
    const panel = target.closest(".menuPanel,.mobileMenu,.menuDrawer");
    const action = target.closest("a,button");
    if (!action) return;

    if (!panel || action.closest(".menuPanel,.mobileMenu,.menuDrawer")) {
      const isNavAction = action.matches("a[href],button[data-route],button[data-page],button[data-action]");
      if (isNavAction && !action.matches("[data-menu-toggle],.hamburger")) {
        setTimeout(closePanpanMenu, 0);
      }
    }
  },
  true,
);

// Keep Login and theme controls inside the hamburger when matching controls
// exist in the page markup.
document.addEventListener("DOMContentLoaded", () => {
  const panel = document.querySelector(".menuPanel,.mobileMenu,.menuDrawer");
  if (!panel) return;

  const login = document.querySelector(".siteHeader .desktopLogin,.siteHeader .headerLogin,.siteHeader .topLogin");
  const theme = document.querySelector(".siteHeader .desktopTheme,.siteHeader .headerTheme,.siteHeader .topTheme");

  [login, theme].forEach((el) => {
    if (el && !panel.contains(el)) panel.appendChild(el);
  });
});

let tools: HTMLDivElement | undefined;

function moveToolsToDrawer(): void {
  const drawer = document.getElementById("mobileDrawer");
  const actions = document.querySelector<HTMLElement>(".topbar .actions");
  const menuBtn = document.getElementById("mobileMenuBtn");
  const themeBtn = document.querySelector<HTMLElement>(".themeHeaderBtn");
  const loginBtn = document.getElementById("loginBtn");
  if (!drawer || !actions || !menuBtn || !themeBtn || !loginBtn) return;

  const mobile = window.matchMedia("(max-width: 900px)").matches;

  if (mobile) {
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "drawerTools";

      const themeWrap = document.createElement("div");
      themeWrap.className = "drawerTheme";
      const loginWrap = document.createElement("div");
      loginWrap.className = "drawerLoginWrap";

      themeWrap.appendChild(themeBtn);
      loginWrap.appendChild(loginBtn);
      tools.appendChild(themeWrap);
      tools.appendChild(loginWrap);
    }
    if (!drawer.contains(tools)) drawer.insertBefore(tools, drawer.firstChild);
    loginBtn.classList.add("drawerLogin");
  } else {
    if (tools && drawer.contains(tools)) tools.remove();
    loginBtn.classList.remove("drawerLogin");
    actions.insertBefore(themeBtn, loginBtn);
    actions.insertBefore(loginBtn, menuBtn);
  }
}

window.addEventListener("DOMContentLoaded", moveToolsToDrawer);
window.addEventListener("resize", moveToolsToDrawer);
