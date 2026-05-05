# Ing 2026 Admissions Tracker

A static, single-page web application for tracking master's degree (navazující magisterské) admissions to Czech universities for the 2026/2027 academic year.

## What it does

- Tracks **7 submitted applications** across 5 Czech universities (ČZU, VŠE, ZČU, UHK, TUL)
- Builds a **master timeline** merging all admission deadlines with the NEWTON University bachelor schedule
- **Detects conflicts** between admission events and bachelor exam / SZZ periods
- Shows **next actions** with smart reminders (configurable profiles: hard, prep, watch)
- Calculates school-specific scores (FEK CB formula, TUL exam condition based on GPA)
- Provides a **decision flow** with keep-alive vs. hard-commit recommendations
- Makes the **clean sequence** explicit: target ČZU PAAN + UHK AI, soft-drop VŠE now, then release backups as their triggers are confirmed
- Generates **appeal/review paths** where officially documented
- Incorporates ČZU PEF's 2026 waiver of the master's entrance exam and the resulting enrolment/document path
- Cites all source documents per school

## Tracked universities

| # | Short label | University | Faculty | Program | Form |
|---|-------------|-----------|---------|---------|------|
| 1 | ČZU PAAN-k | Česká zemědělská univerzita v Praze | Provozně-ekonomická fakulta | Podnikání a administrativa | kombinovaná |
| 2 | UHK AI-k | Univerzita Hradec Králové | Fakulta informatiky a managementu | Aplikovaná informatika | kombinovaná |
| 3 | ČZU EAMN-k | Česká zemědělská univerzita v Praze | Provozně-ekonomická fakulta | Ekonomika a management | kombinovaná |
| 4 | ZČU FEK PEM-k | Západočeská univerzita v Plzni | Fakulta ekonomická | Podniková ekonomika a management | kombinovaná |
| 5 | UHK IM-k | Univerzita Hradec Králové | Fakulta informatiky a managementu | Informační management | kombinovaná |
| 6 | EF TUL MPP-k | Technická univerzita v Liberci | Ekonomická fakulta | Management podnikových procesů | kombinovaná |
| 7 | VŠE FM Management-k | Vysoká škola ekonomická v Praze | Fakulta managementu | Management | kombinovaná |

## Project structure

```
.
├── index.html          # Entry point
├── app.js              # Application logic (rendering, calculations, timeline)
├── styles.css          # Styles
├── data/
│   ├── config.js       # All application data, deadlines, and live state
│   └── sources.js      # Source document registry
└── docs/               # Source documents (admission rules, schedules)
    ├── application.md
    ├── Newton Bachelor.html
    ├── ČZU PEF - podminky ing.md / .pdf
    ├── CZU PEF - prominuti prijimaci zkousky ing.md / .pdf
    ├── VŠE FM - podminky-ing-26-27.md / .pdf
    ├── ZČU FEK - pravidla ing.md / .pdf
    ├── UHK FIM - pravidla ing.md / .pdf
    ├── UHK FIM - priloha.md / .pdf
    ├── UHK FIM - harmonogram 2026.md / .pdf
    └── EF TUL - pravidla ing.md / .pdf
```

## How to use

### Run locally

No build step required. Open `index.html` directly in a browser, or use any static file server:

```bash
# Python
python -m http.server 8000

# Node.js (npx)
npx serve .

# VS Code Live Server extension also works
```

Then open `http://localhost:8000` in your browser.

### Update your data

All live state is in `data/config.js`. Update these fields as events unfold:

- **`liveState.decision`** — set to `"accepted"`, `"rejected"`, `"conditional"`, or `"withdrawn"` when you receive a decision
- **`liveState.decisionDate`** — date of the decision (triggers appeal deadline calculations)
- **`liveState.exactExamDate`** — confirmed exam slot (generates derived events like result dates)
- For ČZU PEF, `exactExamDate` is intentionally unused after ND 5/2026 because the entrance exam is waived.
- **`liveState.taskState.*`** — mark tasks as `true` when completed
- **`meta.cleanSequence.tasks`** — the strategic drop plan, including trigger, suggested due date, and deadline for each release step
- **`liveState.weightedAverage`** — your GPA (drives FEK CB score and TUL exam/no-exam logic)
- **`liveState.extras.*`** — bonus flags for FEK scoring (field bonus, thesis award, internship)

The tracker re-renders everything from this config on page load — no database or server needed.

### Override today's date

For testing or planning ahead, set `meta.todayOverride` in `data/config.js` to a date string (e.g., `"2026-06-01"`). Set it to `null` to use the real current date.

## Requirements

- A modern browser with ES module support (Chrome, Firefox, Safari, Edge — all current versions)
- No dependencies, no build tools, no npm

## License

Private project — not open-sourced.
