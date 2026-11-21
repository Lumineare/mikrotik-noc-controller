# Enterprise Clean Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the MikroTik RS Anwar Medika Fleet Controller from an eye-straining pitch-black/neon theme to an Enterprise Clean Light theme (UniFi / Meraki style) across all 82 routers, dashboards, tabs, and modals.

**Architecture:** Update foundational Tailwind palette tokens (`noc.*`), base CSS body rules, and systematic component classes from dark backgrounds (`bg-[#05070a]`, `bg-slate-900`) to cool slate/white surfaces (`bg-slate-50`, `bg-white`, `border-slate-200`) with cobalt/emerald status semantics and crisp slate typography.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, FastAPI (zero-CDN offline).

**Spec:** `docs/superpowers/specs/2026-11-19-clean-light-theme-design.md`

## Global Constraints
- Offline zero-CDN requirement: keep bundled WOFF2 fonts (Inter & JetBrains Mono) and Lucide SVG icons.
- Socket API port 8728 and OmniRoute proxy functionality must remain 100% untouched.
- High contrast readability: all text must achieve strong contrast against light surfaces (minimum `text-slate-700` / `text-slate-900`).

## Review Focus
1. Text readability: verify no white/light gray text remains invisible on white card backgrounds (`text-slate-400` / `text-white` on `bg-white`).
2. Terminal & Code blocks: ensure JetBrains Mono terminal outputs and logs use an elegant slate/navy container (`bg-slate-900 text-slate-100` or `bg-slate-100 text-slate-800`) with legible syntax.
3. Status badges: verify Online, High CPU, and Offline pill tags are immediately recognizable with soft pastel backgrounds.
4. Input fields: ensure text inputs, selects, and checkboxes have crisp light borders (`border-slate-300`) with clear focus rings (`ring-blue-500`).
5. Modals: ensure backdrop blur uses gentle translucent dimming (`bg-slate-900/40 backdrop-blur-sm`) and solid white cards.

---

### Task 1: Core Design Tokens & Base CSS
**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces: Updated `noc.*` color tokens mapping to slate-50/white/slate-200/blue-600.

- [ ] **Step 1: Update `frontend/tailwind.config.js` with Clean Light palette tokens**
- [ ] **Step 2: Update `frontend/src/index.css` body styles and scrollbar colors to light slate**
- [ ] **Step 3: Run `npm run build` in `frontend/` to ensure config compiles cleanly**

---

### Task 2: NOC Gateway Login Page Overhaul
**Files:**
- Modify: `frontend/src/components/LoginPage.tsx`

**Interfaces:**
- Produces: Enterprise clean white card login screen for RS Anwar Medika NOC.

- [ ] **Step 1: Replace dark canvas and card styles with `bg-slate-100`, `bg-white`, `border-slate-200`, and `shadow-xl`**
- [ ] **Step 2: Update input fields with `bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400`**
- [ ] **Step 3: Update login button to royal cobalt blue (`bg-blue-600 hover:bg-blue-700 text-white`)**
- [ ] **Step 4: Verify build with `npm run build`**

---

### Task 3: Global Header & App Navigation
**Files:**
- Modify: `frontend/src/components/Header.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: Crisp white navbar with hospital branding, active technician badge, and clean action buttons.

- [ ] **Step 1: Update `Header.tsx` background to `bg-white/95 border-b border-slate-200 backdrop-blur-md`**
- [ ] **Step 2: Update user profile badge, search bar, and action buttons to light-theme styles**
- [ ] **Step 3: Update `App.tsx` main background wrapper to `bg-slate-50 text-slate-900`**
- [ ] **Step 4: Verify build with `npm run build`**

---

### Task 4: Modals & Dialogs (ConfirmModal, AlertModal, BatchScriptModal)
**Files:**
- Modify: `frontend/src/components/ConfirmModal.tsx`
- Modify: `frontend/src/components/AlertModal.tsx`
- Modify: `frontend/src/components/BatchScriptModal.tsx`

**Interfaces:**
- Produces: Clean light dialog cards with soft backdrop blur.

- [ ] **Step 1: Update `ConfirmModal.tsx` to use white modal container (`bg-white border-slate-200 text-slate-900`)**
- [ ] **Step 2: Update `AlertModal.tsx` to clean light card design**
- [ ] **Step 3: Update `BatchScriptModal.tsx` to clean white/slate layout**
- [ ] **Step 4: Verify build with `npm run build`**

---

### Task 5: Fleet Overview & Device Detail Cards
**Files:**
- Modify: `frontend/src/components/FleetDashboard.tsx`
- Modify: `frontend/src/components/DeviceDetail.tsx`

**Interfaces:**
- Produces: Cisco Meraki style router inventory table, metric summary cards, and detail headers.

- [ ] **Step 1: Update metric cards in `FleetDashboard.tsx` to white surfaces with subtle shadows and emerald/amber borders**
- [ ] **Step 2: Update router table headers and rows with `bg-white hover:bg-slate-50 border-slate-200 text-slate-800`**
- [ ] **Step 3: Update `DeviceDetail.tsx` subheader, tabs navigation, and hardware quick-stats**
- [ ] **Step 4: Verify build with `npm run build`**

---

### Task 6: Feature Tabs (AI Optimizer, Wireless, Interfaces, Network)
**Files:**
- Modify: `frontend/src/components/tabs/TabAiOptimizer.tsx`
- Modify: `frontend/src/components/tabs/TabWireless.tsx`
- Modify: other tabs in `frontend/src/components/tabs/` as needed

**Interfaces:**
- Produces: Clean light AI diagnostic cards, chat bubbles, wireless tables, and frequency badges.

- [ ] **Step 1: Update `TabAiOptimizer.tsx` health score gauge, recommendation cards, and chat bubbles**
- [ ] **Step 2: Update `TabWireless.tsx` SSID tables, client registration list, and security profile modals**
- [ ] **Step 3: Update remaining tabs (`TabOverview.tsx`, `TabInterfaces.tsx`, etc.) to light card patterns**
- [ ] **Step 4: Verify build with `npm run build`**

---

### Task 7: Full Build & Visual Validation
**Files:**
- Test: Live browser testing on `http://127.0.0.1:8090/`

- [ ] **Step 1: Run production build `npm run build` and ensure 0 errors**
- [ ] **Step 2: Test login page, fleet dashboard, wireless tab, and AI optimizer via `browser_exec`**
- [ ] **Step 3: Inspect visual hierarchy and contrast via `vision_analyze`**
