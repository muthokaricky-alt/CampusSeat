# CampusSeat UX and motion notes (Phase 3)

How the redesign applies each animation principle and UX law, and where to find it in the code.
Visual identity kept on purpose: blue accent (`--primary`), Bricolage Grotesque for headings, Figtree for text,
light and dark modes. The ui-ux-pro-max design search suggested a purple/orange palette with Inter and
Playfair; it was not adopted because the current palette already passes WCAG AA and changing the brand
brings no usability gain. Its structural advice was adopted: one hero-centric landing with a single primary
action, a 300-450 ms staggered list reveal, and "avoid confusing registration".

## Animation principles

| Principle | Where | How |
| --- | --- | --- |
| Anticipation | `pages/EventDetail.jsx` `press()` | "Reserve my seat" squashes to 96% on press before anything happens. |
| Squash and stretch | same button; ticket entrance | Press squash then springs back (`back.out(3)`); the registration card enters slightly squashed vertically (`scaleY 0.92`) and stretches to full height. |
| Staging (focus) | booking confirmation | Only the ticket moves; the rest of the page stays still. Parts appear in reading order: header, details + QR, tear line, reference, actions. |
| Pose to pose | booking confirmation timeline | Defined key poses (dropped in, header, details, tear line drawn, actions) joined by short tweens. |
| Follow-through | ticket entrance | `back.out(1.6)` overshoots slightly and settles. |
| Secondary action | booking success | Sparks (React Bits ClickSpark) and the seat meter sliding down accompany the main ticket motion. |
| Exaggerated feedback | success and failure | Spark burst on success; on failure the button gives a short shake (6 px, 5 half-cycles) and the error appears beside it. |
| Snappy timing | everywhere | 150-250 ms for feedback (buttons, chips, card hover), 400 ms for list reveals, about 600 ms for the full confirmation. Only `transform` and `opacity` animate. |

## UX laws

| Law | Where | How |
| --- | --- | --- |
| Fitts's law | `styles.css` `.btn.lg/.xl`, `.chip`, `.card-cta`, `.mobile-book-bar`, nav links on phones | Main actions are 48-56 px tall; chips, card actions and nav links at least 40-44 px; on phones the booking button sits at the bottom of the screen within thumb reach. |
| Hick's law | `pages/Events.jsx` chips; `pages/admin/AdminUsers.jsx` row menu | Four one-tap filters instead of a form; dates hidden behind "Dates". Admin user rows show one "Actions" menu instead of four buttons (Unlock stays visible when it is needed). |
| Miller's law | `pages/Events.jsx` groups; `pages/MyBookings.jsx` | Events chunked into "This week" and "Coming up"; My bookings into Coming up, Waitlist and Past (past collapsed). The booking panel shows one "Booking as" summary instead of three fields. |
| Doherty threshold (< 400 ms) | `EventDetail.jsx` optimistic seat count; skeletons in `components/ui.jsx` | The seat meter drops the moment you tap (rolled back if the server says no); skeleton cards with the final layout appear immediately while data loads; lazy pages show skeletons, not blank screens. |
| Postel's law | `pages/Auth.jsx` Register; backend validators | Names are trimmed with repeated spaces collapsed, emails trimmed and lower-cased, student numbers upper-cased; mistakes are explained on leaving a field, not while typing. |
| Frequency of use | landing, event cards, booking panel | The most common job (book a seat) is one tap from an event page and two from the list; every card has its own "Reserve a seat" button; the account details are pre-filled and editable (FR4 kept). |

## Motion and performance rules

- `src/motion/index.js`: every animation calls `loadGsap()`, which returns `null` under `prefers-reduced-motion`, so the final state shows with no movement. `styles.css` also disables CSS transitions, the skeleton shimmer and the Vanta backdrop under reduced motion.
- Lenis smooth scrolling (`motion/SmoothScroll.jsx`) runs only on public pages, never in the admin panel, and never with reduced motion. Touch scrolling stays native.
- Vanta (`components/HeroBackdrop.jsx`) runs only on the landing hero, only on screens of at least 768 px with a fine pointer, only without reduced motion or data saver, and only while the hero is on screen. three.js and Vanta are fetched after the hero is visible and the browser is idle. A static gradient is always underneath.
- Route-level code splitting: the landing page ships in the main bundle (90.6 kB gz JavaScript); every other page, and each admin page, is its own chunk. GSAP (27 kB gz) loads on first animation, Lenis (5 kB) on public pages, three.js + Vanta (157 kB) only for the desktop hero.
- Content-Security-Policy stays strict (`script-src 'self'`, no `unsafe-inline` or `unsafe-eval` for scripts). GSAP, Lenis, three.js and Vanta use neither `eval` nor inline scripts; the QR code is an SVG served by the API (same origin).
- Responses are gzip-compressed; hashed build files are cached for a year, `index.html` is always revalidated.

## Accessibility

- WCAG AA contrast checked for every token pair in both themes (lowest: 4.6:1 for success badges in light mode). Placeholders use full-strength muted text.
- Visible focus ring (`:focus-visible`, 3 px amber) everywhere, including the hero's dark background (yellow ring).
- Skip link kept; after each navigation focus moves to the new page's heading (`App.jsx` `RouteFocus`).
- Booking result announced to screen readers (`role="status"`); the seat count is a polite live region; lists mark `aria-busy` while loading; filter chips are a `radiogroup`.
- Icon-only and repeated actions have labels ("Reserve a seat: Career Fair 2026", "Actions for Jane Doe").

## Measured (local production build, Lighthouse 12, mobile profile, median of 3)

Performance 92, Accessibility 100, Best Practices 100, SEO 100. First Contentful Paint about 2.0 s,
Largest Contentful Paint about 2.1 s, Cumulative Layout Shift 0 to 0.056 (font swap in the header on phones).
Before Phase 3: Performance 78, Accessibility 100, Best Practices 100, SEO 91.

## Third-party code

- React Bits ClickSpark, copied as source into `src/components/reactbits/` with its licence (MIT + Commons Clause: free to use inside an application).
- GSAP 3.15.1, Lenis 1.3.27, Vanta 0.5.24 with three.js 0.134.0 (the last three.js line Vanta supports), pinned exactly.
