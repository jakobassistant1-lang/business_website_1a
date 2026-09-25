# Navo on phones and tablets — plan (ticket #39)

_Written 2026-09-25. Status: approved to build by the owner's standing instruction ("create a comprehensive plan based on cited research before you start building"); the owner reviews on return and can redirect._

## 1. The question, from first principles

Not "how do we squeeze the desktop app onto a narrow screen" but "what does a student actually pull their phone out to do, and what should Navo be on that screen?"

## 2. What the research says

**Students use phones for quick checks, laptops for real work.**

- Learning House / Aslanian (2018 survey of online students, cited via [CAPPS](https://cappsonline.org/12790-2/)): 67% use mobile devices for online coursework; on the phone, 51% access course materials, 44% interact with the LMS, 40% complete assignments. Phones are "better suited for quick communications and smaller academic tasks, such as checking grades, messages, or due dates" ([EDUCAUSE Review, multi-year mobile learning study](https://er.educause.edu/articles/2023/1/the-evolving-landscape-of-students-mobile-learning-practices-in-higher-education)).
- University of Central Florida's Canvas mobile surveys ([UCF 2018 Canvas Mobile Apps Survey, Instructure Community](https://community.canvaslms.com/t5/Canvas-Mobile-Users/2018-UCF-Canvas-Mobile-Apps-Survey/ba-p/274116); [UCF Digital Learning research page](https://digitallearning.ucf.edu/msi/research/canvas/)): 96% of UCF students use the Canvas mobile app at least weekly; the app is about 20% of all Canvas traffic; students "mainly use the app for quick interactions" and still do submissions, quizzes and discussions on a desktop.
- Nielsen Norman Group, ["Large Devices Preferred for Important Tasks"](https://www.nngroup.com/articles/large-devices-important-tasks/) (2019): people rate computer activities as more important (4.03/5 vs 3.61/5) but mobile activities as easier (4.52/5 vs 3.96/5). They deliberately reserve high-stakes, input-heavy work for large screens. Design implication: the phone experience should be the easy, glanceable slice, not a miniature of everything.

**How phones are held and tapped.**

- Steven Hoober, ["How Do Users Really Hold Mobile Devices?"](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php) (1,333 observations): 49% one-handed, 36% cradled, 15% two-handed; "users change the way they're holding their phone very often". Primary actions must be reachable by a thumb; nothing critical should live only in a top corner.
- Nielsen Norman Group, ["Touch Targets on Touchscreens"](https://www.nngroup.com/articles/touch-target-size/): targets at least 1 cm × 1 cm with spacing; "the fat fingers are not the real culprit; the blame should lie on the tiny targets." Apple's HIG says 44 × 44 pt; Material says 48 dp.
- Navigation discoverability: hidden navigation (hamburger) is discovered about half as often as visible navigation (NN/G studies summarized in [thumb-zone and bottom-navigation guidance](https://parachutedesign.ca/blog/thumb-zone-ux/)); bottom tab bars with 3 to 5 destinations are the standard answer on phones; iPadOS adapts a tab bar into a sidebar when there is room ([Apple Human Interface Guidelines, Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)).

**What this means for Navo.** The phone version is a "glance and act" tool: what's next, what's due this week, tick it off, and a nudge toward the next test. Deep work (grade what-if modeling, syllabus-level study guides, the Gantt, admin boards, token onboarding) stays desktop-first and is either simplified or clearly marked "best on a laptop" on the phone. Tablets are closer to laptops: they keep the full feature set with a compact rail.

## 3. What the current app does at phone and tablet widths (code audit, 2026-09-25)

- The sidebar (`components/Sidebar.tsx`) is a fixed 256px column with no breakpoint behavior. At 375px the content column is 71px wide (263px if the student finds the collapse chevron). At 768px it is 464px.
- No `viewport` export, no safe-area insets, `h-screen` (100vh) instead of `dvh`, no horizontal-overflow guard on `<main>`.
- Inputs use 14px text, which triggers iOS zoom on focus. Buttons are about 40px; tabs about 28 to 32px; the done circle is 22px with a hover-only checkmark; the Undo button is about 24px.
- Fixed widths: Timeline needs 760px; Month is always seven columns with no scroll wrapper; the weighted grade row is 234px of fixed columns; Canvas assignment HTML is injected with no image or table constraints.
- Modals and popovers are centered boxes sized for desktop; the demo has its own non-collapsible sidebar; admin kanban uses HTML5 drag-and-drop, which does not fire on touch.
- Tests pin a number of component strings and structure (page access guard, undo toast wiring, sync-warning line, connections timestamps, single-source rules); the redesign must keep them passing.

## 4. Decisions

**Breakpoints.** Phone: below 768px (`md`). Tablet: 768 to 1023px. Desktop: 1024px and up (`lg`), unchanged.

**Shell.**
- Phone: no sidebar. A bottom tab bar with four visible destinations: **Today** (`/dashboard`), **Plan** (`/plan`), **Study** (`/study`), **Classes** (`/courses`). Labels always visible, 56px tall plus the safe-area inset, active tab in accent. A slim top bar with the page title and an account button that opens a bottom sheet holding Connections, Settings, Account, Admin (admins only), Replay demo, Log out. Visible tabs over a hamburger, per the discoverability research.
- Tablet: the existing sidebar in its collapsed icon-rail form (64px), always, with tooltips; the account menu unchanged.
- Everything under `<main>` gets bottom padding equal to the tab bar on phones, `overflow-x: hidden`, and `min-h-dvh`.

**Global touch rules.** A `.tap` utility (min 44 × 44px hit area) applied to every interactive control on phones; 16px input text below `md`; `touch-action: manipulation`; hover-only reveals become always-visible on devices without hover (`@media (hover: none)`); modals become bottom sheets below `md` (rounded top, max 85dvh, drag handle) through one shared `Sheet` component; popovers anchored to a row become sheets too.

**Per surface on the phone.**
- **Today (dashboard):** Focus card first, compact. Today list with 44px rows, always-visible done circle, undo toast with a full-size Undo button. "This week" collapses to the next three items with a "See plan" link. Catch-up becomes a count pill that opens a sheet. The AI summary collapses to one line, tap to expand. Progress dial shrinks into the header.
- **Plan:** the List (agenda) view is the phone default. Calendar Week/Month and Timeline are hidden below `md` and replaced by the agenda grouped by day with study blocks inline. Tablet and desktop keep all views.
- **Study:** hub rows unchanged. Per-test tools: a horizontally scrolling segmented control with 44px tabs; practice questions get full-width answer buttons.
- **Classes:** one-column cards. Class page: assignment list with the same rows as Today. Grade calculator on phones shows the current grade and the "what do I need" result; the what-if sliders stay behind the existing "Adjust" toggle with larger thumbs, and the fixed-width weighted row becomes a wrapping grid.
- **Assignment:** the Canvas brief gets a wrapper that constrains images and scrolls tables sideways. A sticky bottom action bar in the thumb zone: "Open in Canvas" and "Mark as done".
- **Connections / Settings / Account / Auth:** forms at full width with 16px inputs and 44px buttons. The token step stays, with the same guidance; it is the one flow students may prefer to finish on a laptop and the copy says so.
- **Demo:** the demo frame uses the same phone shell (tab bar instead of its fake sidebar); tour popovers attach below their target on phones.
- **Admin boards:** a one-line "Best on a laptop" note on phones; no touch drag-and-drop work now.
- **Home screen:** a web manifest, icons and theme color so "Add to Home Screen" gives an app-like icon and full-screen launch. Push notifications and offline are explicit follow-ups, not in this ticket.

**Not on the phone, by design:** Calendar Month grid, Timeline Gantt, what-if sliders by default, admin drag-and-drop.

## 5. Build plan

Stage 1, one task: **M1 shell and foundations** (Fable). Owns `app/layout.tsx` (viewport + manifest metadata), `app/(app)/layout.tsx`, `components/Sidebar.tsx`, new `components/MobileTabBar.tsx`, `components/MobileTopBar.tsx`, `components/AccountSheet.tsx`, `components/Sheet.tsx`, `app/globals.css`, `public/manifest.webmanifest` + icons, `tests/mobileShell.test.ts`.

Frozen interfaces from M1: `Sheet` props `{ open, onClose, title?, children }` rendering a bottom sheet below `md` and a centered dialog at `md` and up; the `.tap` utility; the `phone`/`tablet` rules above; `MobileTabBar` destinations and heights.

Stage 2, three parallel tasks after M1 lands:
- **M2 Today and Plan** (Opus): `components/DashboardView.tsx`, `PlanSurface.tsx`, `CalendarView.tsx`, `TimelineView.tsx`, `calendar/parts.tsx`, `UndoToast.tsx`.
- **M3 Classes, Assignment, Study** (Opus): `CourseGrid.tsx`, `CoursePage.tsx`, `GradeCalculator.tsx`, `CourseExclude.tsx`, `AssignmentPage.tsx`, `StudyView.tsx`, `StudyTools.tsx`, `NotesSection.tsx`.
- **M4 Forms, onboarding, admin** (Opus): `AuthFlow.tsx`, `ConnectionsForm.tsx`, `SchoolPicker.tsx`, `SettingsForm.tsx`, `AccountForm.tsx`, `DemoExperience.tsx`, `lib/tour/demoTour.ts`, `app/welcome/card/page.tsx`, `app/billing/*`, `KanbanBoard.tsx` note.

Verification: tsc, the suite, a production build, then the local bench at 375×812 and 768×1024 with screenshots of every surface in light and dark, plus a Fable reviewer per task with a UX and accessibility lens. Acceptance: no horizontal page scroll on any surface at 375px; every interactive control at least 44px; the four tab destinations reachable in one tap; Today, Plan (agenda), Study and Classes fully usable one-handed; tablets keep every desktop feature; all existing tests green.

## 6. Follow-ups deliberately out of scope

PWA push notifications for due-date nudges (the single most-used mobile LMS feature per the UCF data), offline cache of the plan, touch drag-and-drop on the admin board, and a native wrapper.
