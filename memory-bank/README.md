# Fullshot Pro - Memory Bank

Welcome to the **Fullshot Pro** Memory Bank. This directory serves as the single source of truth for any AI agent, developer, or assistant working on this codebase.

When resuming work on this repository, read these documents in the following order:

```
┌─────────────────────────────────────────────────────────────┐
│                       Reading Order                         │
├─────────────────────────────────────────────────────────────┤
│ 1. projectbrief.md    ─► Core goals, features & scope       │
│ 2. productContext.md  ─► Why it exists & UX workflow        │
│ 3. activeContext.md   ─► Current state, recent bug fixes    │
│                          & last stoppage point              │
│ 4. systemPatterns.md  ─► Architecture, data flow & patterns │
│ 5. techContext.md     ─► Tech stack, constraints & commands │
│ 6. progress.md        ─► Feature status & verification log  │
└─────────────────────────────────────────────────────────────┘
```

## Directory Map

- [`projectbrief.md`](projectbrief.md): High-level overview, objectives, browser support, and core success criteria.
- [`productContext.md`](productContext.md): The user problems solved (tall pages, SPAs, sticky header clutter, lack of offline clipboard export).
- [`activeContext.md`](activeContext.md): **Start here for immediate work**. Detailed report on the exact last stoppage point, recent fixes (independent circles, text scaling, stroke preview bubble, crop undo/redo), and active design invariants.
- [`systemPatterns.md`](systemPatterns.md): Technical architecture, Chrome MV3 message protocol, service worker lifecycle, content script scroll-detection, canvas drawing engine, and storage patterns.
- [`techContext.md`](techContext.md): Technical stack, Chrome APIs, permissions, development setup, and validation commands.
- [`progress.md`](progress.md): Granular capability matrix, test verification logs, and known browser boundaries.
