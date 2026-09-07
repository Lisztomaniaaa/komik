// Minimal UI-string i18n (not a full framework) — Komiku's comic content is
// already Indonesian on its own (see README), so this only translates the
// site's own chrome (nav, buttons, headings, toasts, account/auth text).
// Indonesian is the default; English is the only other option for now.
// FAQ/About/Legal long-form copy is intentionally left English-only in this
// first pass (see README) rather than risk a rushed legal-text translation.
export type Lang = "id" | "en";

const STORAGE_KEY = "panpan-lang";

const dict = {
  nav_home: { id: "Beranda", en: "Home" },
  nav_explore: { id: "Jelajah", en: "Explore" },
  nav_latest: { id: "Terbaru", en: "Latest" },
  nav_genres: { id: "Genre", en: "Genres" },
  nav_account: { id: "Akun", en: "Account" },
  nav_library: { id: "Koleksi", en: "Library" },
  search_placeholder: { id: "Cari komik...", en: "Search comics..." },
  search_aria: { id: "Cari", en: "Search" },
  theme_aria: { id: "Ganti tema", en: "Toggle theme" },
  lang_aria: { id: "Ganti bahasa", en: "Change language" },
  menu_aria: { id: "Buka menu", en: "Open menu" },
  login: { id: "Masuk", en: "Login" },
  logout: { id: "Keluar", en: "Logout" },
  drawer_menu: { id: "MENU", en: "MENU" },

  hero_eyebrow: { id: "Baca kisah berikutnya", en: "Read your next story" },
  hero_title_pre: { id: "Selami ", en: "Dive into " },
  hero_title_span: { id: "dunia epik.", en: "epic worlds." },
  hero_desc: {
    id: "Temukan manga, manhwa, dan manhua dalam satu pengalaman baca yang bersih. Ikuti chapter baru, simpan favorit, dan lanjutkan membaca di mana saja.",
    en: "Discover manga, manhwa and webcomics in one clean reading experience. Follow new chapters, save favorites and keep reading wherever you are.",
  },
  hero_start: { id: "Mulai membaca →", en: "Start reading →" },
  hero_explore: { id: "Jelajah sekarang", en: "Explore now" },

  trending_today: { id: "Trending hari ini", en: "Trending today" },
  view_all: { id: "Lihat semua →", en: "View all →" },
  continue_reading: { id: "Lanjutkan membaca", en: "Continue reading" },
  library_link: { id: "Koleksi →", en: "Library →" },
  latest_updates: { id: "Update terbaru", en: "Latest updates" },
  browse_genre: { id: "Jelajah genre", en: "Browse by genre" },
  explore_all: { id: "Jelajah semua →", en: "Explore all →" },
  top_trending: { id: "Paling populer", en: "Top trending" },
  filter_all: { id: "Semua", en: "All" },
  show_more_prefix: { id: "Lihat ", en: "Show " },
  show_more_suffix: { id: " lainnya", en: " more" },
  show_less: { id: "Lihat lebih sedikit", en: "Show less" },

  discover_eyebrow: { id: "Temukan", en: "Discover" },
  discover_title: { id: "Jelajah komik.", en: "Explore comics." },
  discover_desc: { id: "Temukan bacaan baru berdasarkan jenis dan genre.", en: "Find something new by type and genre." },
  filter_type: { id: "Jenis", en: "Type" },
  filter_genre: { id: "Genre", en: "Genre" },
  sort_latest: { id: "Update terbaru", en: "Latest update" },
  sort_az: { id: "A–Z", en: "A–Z" },

  back: { id: "Kembali", en: "Back" },
  back_to_comic: { id: "ke komik", en: "to comic" },
  back_to_home: { id: "ke beranda", en: "to home" },
  stat_rating: { id: "Rating", en: "Rating" },
  stat_chapters: { id: "Chapter", en: "Chapters" },
  stat_readers: { id: "Pembaca", en: "Readers" },
  follow: { id: "Ikuti", en: "Follow" },
  following: { id: "Diikuti", en: "Following" },
  reader_rating: { id: "Rating pembaca", en: "Reader rating" },
  rating_tap_hint: { id: "ketuk bintang untuk menilai", en: "Tap a star to rate" },
  rating_unit: { id: "rating", en: "ratings" },
  chapters_heading: { id: "Chapter", en: "Chapters" },
  chapters_latest_first: { id: "Terbaru dulu", en: "Latest first" },
  comments_reviews: { id: "Komentar & ulasan", en: "Comments & reviews" },
  reader_discussion: { id: "Diskusi pembaca", en: "Reader discussion" },
  leave_review: { id: "Tulis ulasan.", en: "Leave a review." },
  review_placeholder: { id: "Ceritakan pengalamanmu...", en: "Write your experience..." },
  post_review: { id: "Kirim ulasan", en: "Post review" },
  load_more_comments: { id: "Muat komentar lainnya", en: "Load more comments" },

  chapter_comments: { id: "Komentar chapter", en: "Chapter comments" },
  discuss_chapter: { id: "Diskusikan chapter ini", en: "Discuss this chapter" },
  leave_comment: { id: "Tulis komentar.", en: "Leave a comment." },
  comment_placeholder: { id: "Tulis tentang chapter ini...", en: "Write about this chapter..." },
  post_comment: { id: "Kirim komentar", en: "Post comment" },
  prev: { id: "Sebelumnya", en: "Prev" },
  list_label: { id: "Daftar", en: "List" },
  next: { id: "Selanjutnya", en: "Next" },

  account_center: { id: "Pusat akun", en: "Account center" },
  account_title: { id: "Akun kamu.", en: "Your account." },
  account_desc: { id: "Kelola profil, koleksi, riwayat baca, dan preferensi kamu.", en: "Manage your profile, library, reading history and preferences." },
  tab_overview: { id: "Ringkasan", en: "Overview" },
  tab_library: { id: "Koleksi saya", en: "My library" },
  tab_profile: { id: "Profil", en: "Profile" },
  tab_notifications: { id: "Notifikasi", en: "Notifications" },
  tab_settings: { id: "Pengaturan", en: "Settings" },
  tab_security: { id: "Keamanan", en: "Security" },

  auth_login_eyebrow: { id: "Masuk", en: "Login" },
  auth_signup_eyebrow: { id: "Buat akun", en: "Create account" },
  auth_login_heading: { id: "Selamat datang kembali.", en: "Welcome back." },
  auth_signup_heading: { id: "Gabung ke KomikVibe.", en: "Join KomikVibe." },
  auth_subtext: { id: "Masuk untuk mengikuti komik dan menulis komentar.", en: "Sign in to follow comics and leave comments." },
  auth_name_placeholder: { id: "Nama tampilan", en: "Display name" },
  auth_email_placeholder: { id: "Email", en: "Email" },
  auth_password_placeholder: { id: "Kata sandi (min. 8 karakter)", en: "Password (min. 8 characters)" },
  auth_submit_signin: { id: "Masuk", en: "Sign in" },
  auth_submit_signup: { id: "Buat akun", en: "Create account" },
  auth_switch_prompt_signin: { id: "Belum punya akun?", en: "No account yet?" },
  auth_switch_prompt_signup: { id: "Sudah punya akun?", en: "Already have an account?" },
  auth_switch_link_signin: { id: "Buat sekarang", en: "Create one" },
  auth_switch_link_signup: { id: "Masuk", en: "Sign in" },

  footer_tagline: { id: "Baca. Temukan. Ikuti kisah berikutnya.", en: "Read. Discover. Follow your next story." },
  footer_terms: { id: "Ketentuan", en: "Terms" },
  footer_privacy: { id: "Privasi", en: "Privacy" },
  footer_copyright: { id: "Hak cipta / DMCA", en: "Copyright / DMCA" },
  footer_community: { id: "Komunitas", en: "Community" },
  footer_content_policy: { id: "Kebijakan konten", en: "Content policy" },
  footer_support: { id: "Dukungan", en: "Support" },
  footer_faq: { id: "FAQ", en: "FAQ" },
  footer_about: { id: "Tentang", en: "About" },

  loading: { id: "Memuat…", en: "Loading…" },
  toast_login_not_set_up: { id: "Login belum diatur.", en: "Login isn't set up yet." },
  toast_ratings_not_set_up: { id: "Rating belum diatur.", en: "Ratings aren't set up yet." },
  toast_rating_thanks: { id: "Terima kasih sudah menilai!", en: "Thanks for rating!" },
  toast_rating_failed: { id: "Rating gagal disimpan, coba lagi.", en: "Couldn't save your rating, try again." },
  toast_signed_in: { id: "Berhasil masuk.", en: "Signed in." },
  toast_signed_out: { id: "Berhasil keluar.", en: "Signed out." },
  toast_account_created: { id: "Akun berhasil dibuat.", en: "Account created." },
  toast_added_library: { id: "Ditambahkan ke koleksi.", en: "Added to library." },
  toast_removed_library: { id: "Dihapus dari koleksi.", en: "Removed from library." },
  toast_light_mode: { id: "Mode terang aktif.", en: "Light mode enabled." },
  toast_dark_mode: { id: "Mode gelap aktif.", en: "Dark mode enabled." },
  toast_latest_chapter: { id: "Ini chapter terbaru.", en: "You are at the latest chapter." },
  toast_no_reader_open: { id: "Kamu belum membuka reader.", en: "You have not opened a reader yet." },
  toast_first_chapter: { id: "Ini sudah chapter pertama.", en: "Already at the first chapter." },
  toast_comments_not_set_up: { id: "Komentar belum diatur.", en: "Comments aren't set up yet." },
  toast_write_comment: { id: "Tulis komentar dulu.", en: "Please write a comment." },
  toast_comment_posted: { id: "Komentar kamu berhasil dikirim.", en: "Your comment was posted." },
  toast_review_posted: { id: "Ulasan kamu berhasil dikirim.", en: "Your review was posted." },
  toast_post_failed: { id: "Gagal mengirim — coba lagi.", en: "Failed to post — please try again." },
  auth_error_email: { id: "Masukkan email kamu.", en: "Please enter your email." },
  auth_error_password: { id: "Kata sandi minimal 8 karakter.", en: "Password must be at least 8 characters." },
  auth_error_name: { id: "Masukkan nama tampilan.", en: "Please enter a display name." },
  auth_error_generic: { id: "Terjadi kesalahan.", en: "Something went wrong." },
  reader_fallback_name: { id: "Pembaca", en: "Reader" },
  failed_load_comments: { id: "Gagal memuat komentar.", en: "Failed to load comments." },

  library_heading: { id: "Koleksi saya.", en: "My library." },
  library_desc: { id: "Judul yang kamu ikuti, dan sejauh mana kamu membaca.", en: "Titles you follow, and where you left off." },
  library_following: { id: "Diikuti", en: "Following" },
  library_history: { id: "Riwayat baca", en: "Reading history" },
  library_empty: { id: "Koleksi kamu masih kosong — ikuti komik untuk melihatnya di sini.", en: "Your library is empty — follow a comic to see it here." },
  history_empty: { id: "Belum ada riwayat baca.", en: "No reading history yet." },
  no_chapters: { id: "Tidak ada chapter bahasa Indonesia atau Inggris untuk komik ini.", en: "No Indonesian or English chapters found for this comic." },
  reading_progress: { id: "progres", en: "progress" },
  continue_label: { id: "Lanjutkan", en: "Continue" },

  overview_eyebrow: { id: "Ringkasan", en: "Overview" },
  overview_welcome_prefix: { id: "Selamat datang kembali, ", en: "Welcome back, " },
  overview_desc: { id: "Ringkasan profil bacaan kamu.", en: "Your reading profile at a glance." },
  overview_saved_titles: { id: "Judul tersimpan", en: "Saved titles" },
  overview_latest_notif: { id: "Notifikasi terbaru", en: "Latest notification" },
  overview_check_notif: { id: "Cek tab notifikasi.", en: "Check the notifications tab." },
  view_label: { id: "Lihat", en: "View" },

  profile_eyebrow: { id: "Profil", en: "Profile" },
  profile_heading: { id: "Tentang kamu.", en: "About you." },
  profile_desc: { id: "Informasi publik yang ditampilkan di profil kamu.", en: "Public information shown on your profile." },
  profile_display_name: { id: "Nama tampilan", en: "Display name" },
  profile_email: { id: "Email", en: "Email" },
  profile_signed_in_with: { id: "Masuk dengan", en: "Signed in with" },
  profile_email_password: { id: "Email & kata sandi", en: "Email & password" },
  badge_email: { id: "EMAIL", en: "EMAIL" },
  badge_connected: { id: "TERHUBUNG", en: "CONNECTED" },

  notif_eyebrow: { id: "Notifikasi", en: "Notifications" },
  notif_heading: { id: "Tetap up to date.", en: "Stay updated." },
  notif_desc: { id: "Chapter baru dari judul yang kamu ikuti muncul di sini.", en: "New chapters from followed titles appear here." },
  notif_demo_notice: { id: "Ini demo — notifikasi belum dilacak secara live.", en: "This is a demo — notifications are not tracked live." },

  settings_heading: { id: "Pengaturan.", en: "Settings." },
  settings_desc: { id: "Preferensi reader, tampilan, dan notifikasi.", en: "Reader, appearance and notification preferences." },
  setting_auto_next: { id: "Chapter berikutnya otomatis", en: "Auto next chapter" },
  setting_auto_next_desc: { id: "Buka chapter berikutnya setelah selesai membaca halaman.", en: "Open the next chapter after finishing a reader page." },
  setting_chapter_notif: { id: "Notifikasi chapter", en: "Chapter notifications" },
  setting_chapter_notif_desc: { id: "Beri tahu saya saat komik yang diikuti update.", en: "Notify me when followed comics update." },
  setting_reduce_anim: { id: "Kurangi animasi", en: "Reduce animations" },
  setting_reduce_anim_desc: { id: "Gunakan transisi lebih sederhana di mobile.", en: "Use simpler transitions on mobile." },
  setting_theme: { id: "Tema", en: "Theme" },
  setting_theme_desc: { id: "Beralih antara mode gelap dan terang.", en: "Switch between dark and light mode." },
  setting_continue_desc: { id: "Lanjutkan dari chapter terakhir yang kamu buka.", en: "Jump back into the last chapter you opened." },
  open_reader_btn: { id: "Buka reader", en: "Open reader" },

  security_heading: { id: "Keamanan akun.", en: "Account security." },
  security_desc: { id: "Kelola cara kamu masuk.", en: "Manage how you're signed in." },
  security_connected_login: { id: "Login terhubung", en: "Connected login" },
  sign_out_label: { id: "Keluar", en: "Sign out" },
  sign_out_desc: { id: "Akhiri sesi kamu di perangkat ini.", en: "End your session on this device." },
  not_started_reading: { id: "Kamu belum mulai membaca apa pun.", en: "You have not started reading anything yet." },
  continue_badge: { id: "LANJUTKAN", en: "CONTINUE" },
  no_comics_match_filters: { id: "Tidak ada komik yang cocok dengan filter ini.", en: "No comics match these filters." },
  no_comics_match_filter: { id: "Tidak ada komik yang cocok dengan filter ini.", en: "No comics match this filter." },
  failed_load_comics: { id: "Gagal memuat komik dari Komiku.", en: "Failed to load comics from Komiku." },
  no_comics_in_genre: { id: "Belum ada komik di genre ini.", en: "No comics in this genre yet." },
  no_comics_right_now: { id: "Belum ada komik saat ini.", en: "No comics right now." },
  failed_load_trending: { id: "Gagal memuat komik trending.", en: "Failed to load trending comics." },
  failed_load_comic: { id: "Gagal memuat komik ini.", en: "Failed to load this comic." },
  loading_pages: { id: "Memuat halaman…", en: "Loading pages…" },
  no_pages_available: { id: "Tidak ada halaman untuk chapter ini.", en: "No pages available for this chapter." },
  failed_load_chapter: { id: "Gagal memuat chapter ini.", en: "Failed to load this chapter." },
  failed_load_pages: { id: "Gagal memuat halaman dari Komiku.", en: "Failed to load pages from Komiku." },
  no_comments_yet: { id: "Belum ada komentar — jadilah yang pertama menulis.", en: "No comments yet — be the first to write one." },
  latest_chapter_label: { id: "Chapter terbaru", en: "Latest chapter" },
  updated_label: { id: "Diperbarui", en: "Updated" },
  read_arrow: { id: "Baca →", en: "Read →" },
  chapter_fallback: { id: "Chapter", en: "Chapter" },
  all_comments_loaded: { id: "Semua komentar sudah dimuat", en: "All comments loaded" },
  comics_suffix: { id: "komik", en: "comics" },
  no_comics_found: { id: "Tidak ada komik ditemukan.", en: "No comics found." },
} satisfies Record<string, Record<Lang, string>>;

type Key = keyof typeof dict;

let currentLang: Lang = localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "id";

export function getLang(): Lang {
  return currentLang;
}

export function t(key: Key): string {
  return dict[key][currentLang];
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  applyI18n();
}

export function applyI18n(): void {
  document.documentElement.lang = currentLang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder as Key);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const label = t(el.dataset.i18nTitle as Key);
    el.title = label;
    el.setAttribute("aria-label", label);
  });
  const langBtn = document.getElementById("langBtn");
  if (langBtn) langBtn.textContent = currentLang.toUpperCase();
}
