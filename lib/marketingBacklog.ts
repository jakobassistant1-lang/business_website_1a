// Canonical marketing backlog — the launch/marketing tickets seeded into the
// AdminTask board under board = "marketing" (a separate lane from the build board).
// PURE DATA (no Prisma) so it stays unit-testable; the DB seed lives in
// lib/marketingSeed.ts. After the first open the DB is the source of truth.
//
// Mapping to the shared board: column = status (backlog | todo | doing | done),
// size = ticketSize (small | medium | large). These tickets carry no goal/subgoal
// hierarchy (that's a build-board concept), so the Hierarchy/Burndown pages — which
// only read board "build" — never show them.

import type { KanbanStatus, TicketSize } from "./kanban";

export interface MarketingTicket {
  number: number;
  title: string;
  scope: string; // → description
  size: TicketSize;
  status: KanbanStatus;
}

export const MARKETING_BACKLOG: MarketingTicket[] = [
  // ── Done (already built/written this session) ──────────────────────────────
  {
    number: 1,
    title: "Build the marketing website",
    scope:
      "Full site with simple, easy-to-read copy: hero, trust bar, before/after Canvas demo, features, how-it-works, security, final CTA. Built, verified, and pushed.",
    size: "large",
    status: "done",
  },
  {
    number: 2,
    title: "Pricing & FAQ pages",
    scope: "Pricing and FAQ each live as their own page (/pricing, /faq).",
    size: "medium",
    status: "done",
  },
  {
    number: 3,
    title: '"Your info is safe" wording',
    scope: "Security section (read-only access, we don't sell your data) written across the site.",
    size: "medium",
    status: "done",
  },
  {
    number: 4,
    title: "Terms of Service page",
    scope: "Built at /terms, linked in the footer. Template — still needs a lawyer's review and your details.",
    size: "large",
    status: "done",
  },
  {
    number: 5,
    title: "First 3 blog posts",
    scope:
      "Blog page built with 3 posts: 'Never miss a Canvas deadline,' 'What's actually due on Canvas,' 'Plan your week in 5 minutes.'",
    size: "medium",
    status: "done",
  },

  // ── To Do (this week + next — the launch work) ─────────────────────────────
  {
    number: 6,
    title: "Answer the 4 product questions",
    scope: "Lock the answers to the 4 big product questions so all the copy can finally match. (You)",
    size: "small",
    status: "todo",
  },
  {
    number: 7,
    title: "Set up website tracking",
    scope: "Add tracking so we can see how many people visit and how many leave their email.",
    size: "medium",
    status: "todo",
  },
  {
    number: 8,
    title: "Write 2 homepage headlines to test",
    scope: "Write 2 short homepage headlines and run them against each other to see which wins.",
    size: "small",
    status: "todo",
  },
  {
    number: 9,
    title: "Add an 'enter your email' step",
    scope: "Add a clean spot on the site where students can drop their email to get an invite.",
    size: "medium",
    status: "todo",
  },
  {
    number: 10,
    title: "Write 2 more blog posts",
    scope: "Finish the set of 5 (3 are already done). (I draft)",
    size: "small",
    status: "todo",
  },
  {
    number: 11,
    title: "Plan 10 TikTok videos + Reddit approach",
    scope: "Plan 10 short TikTok ideas and a helpful, no-spam way to show up on Reddit.",
    size: "medium",
    status: "todo",
  },
  {
    number: 12,
    title: "Pick 1 college + student-helper guide + share link",
    scope: "Pick one college, write a short guide for student helpers, and give them a link to share.",
    size: "medium",
    status: "todo",
  },
  {
    number: 13,
    title: "Write 3 welcome emails",
    scope: "Write the 3 short emails a new student gets after they sign up.",
    size: "medium",
    status: "todo",
  },
  {
    number: 14,
    title: "Put the headline test + email step live",
    scope: "Ship the headline test and the email step onto the site. (I build)",
    size: "medium",
    status: "todo",
  },
  {
    number: 15,
    title: "Get 3–5 student helpers spreading the word",
    scope: "Find 3 to 5 students who like the app and will tell their friends. (You)",
    size: "medium",
    status: "todo",
  },
  {
    number: 16,
    title: "Post the TikTok videos + be helpful on Reddit",
    scope: "Run the 2-week content sprint. (You/team)",
    size: "large",
    status: "todo",
  },
  {
    number: 17,
    title: "Turn on the 3 welcome emails",
    scope: "Switch the welcome email sequence on. (Setup)",
    size: "small",
    status: "todo",
  },
  {
    number: 18,
    title: "Start a small online group",
    scope: "Start a Discord or subreddit for early users. (You)",
    size: "small",
    status: "todo",
  },
  // Added by the marketing agent — launch essentials the original list was missing.
  {
    number: 19,
    title: "Test the signup flow end to end",
    scope: "Sign up as a fake new student and fix every spot where someone could get stuck or confused.",
    size: "medium",
    status: "todo",
  },
  {
    number: 20,
    title: "Help new users hit their first plan fast",
    scope: "Walk a new student from 'connected Canvas' to 'here's my plan today' with as few clicks as possible.",
    size: "medium",
    status: "todo",
  },
  {
    number: 21,
    title: "Write 3 signup goals to track",
    scope: "Pick the few numbers that mean it's working, like emails left, accounts made, and first plan seen.",
    size: "small",
    status: "todo",
  },
  {
    number: 22,
    title: "Make Canvas connect feel safe",
    scope: "Add short plain words at the connect step that say their login stays theirs and is not shared.",
    size: "medium",
    status: "todo",
  },
  {
    number: 23,
    title: "Make sure welcome emails reach inboxes",
    scope: "Send test emails to Gmail and Outlook and confirm they land in the inbox, not spam.",
    size: "small",
    status: "todo",
  },
  {
    number: 24,
    title: "Catch the people who leave without signing up",
    scope: "Save the emails of folks who start but don't finish, and send one gentle nudge.",
    size: "medium",
    status: "todo",
  },
  {
    number: 25,
    title: "Ask each new user how they heard about us",
    scope: "Add one small question at signup so we know which path is bringing students in.",
    size: "small",
    status: "todo",
  },

  // ── Backlog (week 2 + later — prove it, then scale) ────────────────────────
  {
    number: 26,
    title: "Check the numbers",
    scope: "Look at the signup numbers and see what's working and what's not. (I review)",
    size: "medium",
    status: "backlog",
  },
  {
    number: 27,
    title: "Did students tell their friends?",
    scope: "Check if real students are inviting friends on their own, or if we need to make it easier. (Together)",
    size: "small",
    status: "backlog",
  },
  {
    number: 28,
    title: "Scale or fix the loop",
    scope: "If word-of-mouth is working, push harder; if it's not, fix the weak step. (You + me)",
    size: "large",
    status: "backlog",
  },
  {
    number: 29,
    title: "Collect the first real reviews",
    scope: "Ask happy early users for honest reviews we can show once we have real ones. (Community)",
    size: "medium",
    status: "backlog",
  },
  {
    number: 30,
    title: "Write a 1-page summary",
    scope: "Write a 1-page summary of what worked and what's next. (I draft)",
    size: "small",
    status: "backlog",
  },
  {
    number: 31,
    title: "Build the parent (paid) version + legal",
    scope: "Build the paid parent tier and add the legal pages it needs. (Prep)",
    size: "large",
    status: "backlog",
  },
  {
    number: 32,
    title: "Add a Privacy Policy page",
    scope: "The Terms reference one — you'll need it before launch. (I draft, template)",
    size: "medium",
    status: "backlog",
  },
  {
    number: 33,
    title: "Paid ads + app store (later)",
    scope: "Once word-of-mouth proves it works, try paid ads and a real app-store listing. (Later)",
    size: "large",
    status: "backlog",
  },
  // Added by the marketing agent.
  {
    number: 34,
    title: "Give students an easy way to invite a friend",
    scope: "Add a simple 'share with a classmate' link so happy users can pass it on.",
    size: "medium",
    status: "backlog",
  },
  {
    number: 35,
    title: 'Write what to say when people ask "what is this?"',
    scope: "Make 3 short lines the team and helpers can copy-paste to explain Navo in seconds.",
    size: "small",
    status: "backlog",
  },
  {
    number: 36,
    title: "List the app where students search",
    scope: "Make a clean Google Business / app-store style listing with a clear name, shots, and one-line promise.",
    size: "medium",
    status: "backlog",
  },
  {
    number: 37,
    title: "Make a launch-day checklist",
    scope: "Write the simple list of things to flip on, post, and watch the morning we open to everyone.",
    size: "medium",
    status: "backlog",
  },
  {
    number: 38,
    title: "Set up a way to hear bug reports",
    scope: "Give early users one easy place to tell us when something breaks or feels off.",
    size: "small",
    status: "backlog",
  },
  {
    number: 39,
    title: "Take clean screenshots for sharing",
    scope: "Capture a few simple shots of the daily plan to use on the site, posts, and the listing.",
    size: "small",
    status: "backlog",
  },
  {
    number: 40,
    title: 'Plan one "exam week" content push',
    scope: "Line up a few posts and a blog tip for the busy weeks when students need a plan most.",
    size: "medium",
    status: "backlog",
  },
];
