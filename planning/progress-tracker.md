# Implementation Progress Tracker

> **Purpose: Agent Working Memory.**
>
> This file is the live context dump for any AI agent (or developer) actively working on a module. When you pick up a task from [`delivery.md`](./delivery.md), you write your working state here — what's in progress, what's blocked, what decisions were made mid-session, and what the next step is.
>
> This is **not** a task list. The task list is in [`delivery.md`](./delivery.md).
>
> Think of this file as the sticky note on the desk — specific to the current working sessions,
> updated each time a new module is picked up, while preserving the history of previous sessions.

---

## How to Use This File

1. **Before starting a module** — write the module name, the task ref from `delivery.md`, and the first step you're about to take.
2. **While working** — update status, log any mid-session decisions or blockers that aren't covered by `build.md`.
3. **When handing off or pausing** — leave the exact next step so the next session (or agent) can resume without re-reading everything.
4. **When the module is done** — mark it complete and clear working state. The permanent record goes into `progress-tracker.md`'s completion log below.

---

## Current Working Session

**Module:** Module Name / Number
**Task Ref:** `delivery.md` → Phase / Module / Task Number
**Status:** ✅ Complete / ⏳ In Progress / ❌ Blocked
**Date:** Full Date

### What Was Done

- Step by step breakdown of what was done.
- Tasks are discussed here in detail, so the next agent can pick up where you left off without reading the entire task breakdown document.


### Mid-Session Decisions

- Offload your entire reasoning and decisions made while working on this module here. 
- The objective is to give agents and developers a clear understanding of your thought process and the decisions you made while working on this module.
- This is so they can get the full required context to continue where you left off with deterministic consistency.

### Next Step

- Name here the following step according to `delivery.md` which we must take on next.

---

## Completion Log

| Date | Task | Notes |
| :--- | :--- | :--- |
| Full Date | Task Name / Number (according to `delivery.md`) | Implementation Status |
