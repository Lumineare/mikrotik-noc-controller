# Interactive Floor Plan & Wi-Fi Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete interactive floor plan mapping, AP coordinate placement, signal coverage heatmap, and Wi-Fi channel collision/crowding analyzer for RS Anwar Medika.

**Architecture:**
- Backend (`app.py`): Multi-floor metadata and AP coordinates stored persistently in `floors.json`. Endpoints for floor management, file upload of blueprints (PNG/JPG/SVG) served via `/uploads`, and automated distance & channel collision analyzer.
- Frontend: New primary navigation mode `'map'` in Header. Interactive drag-and-drop canvas with pan/zoom, coverage radius visualizer (2.4GHz / 5GHz), AP markers with online telemetry, channel conflict warnings, and AI channel re-allocation advisor.

**Tech Stack:** FastAPI, Pydantic, SVG / Canvas HTML5, Lucide-React, React DnD / Pointer Events, Tailwind CSS (Clean Light Theme).

---

## Global Constraints
- Theme: Enterprise Clean Light Theme (`bg-slate-50`, `bg-white`, `border-slate-200/90`, `text-slate-900`).
- No external CDN dependencies: all icons and fonts strictly local.
- Coordinate system: Percentage-based `(x: 0-100%, y: 0-100%)` so maps scale responsively across all screen resolutions without losing placement precision.
- Zero breaking changes to existing router management or device workspace.

---

### Task 1: Backend Storage & Floor Plan Endpoints in `app.py`
**Files:**
- Modify: `C:/Users/admin/mikrotik-controller/app.py`
- Create: `C:/Users/admin/mikrotik-controller/floors.json`
- Create: `C:/Users/admin/mikrotik-controller/uploads/floor_1_blueprint.svg`
- Create: `C:/Users/admin/mikrotik-controller/uploads/floor_2_blueprint.svg`

- [ ] **Step 1: Create default architectural SVG blueprints for RS Anwar Medika**
  Generate clean, professional medical facility blueprints (Lantai 1: IGD, Poliklinik, Farmasi, Pendaftaran; Lantai 2: Rawat Inap, Ruang Operasi, ICU, Laboratorium).
- [ ] **Step 2: Initialize `floors.json` and upload directory**
  Create `uploads/` directory and mount `/uploads` in FastAPI `StaticFiles`.
- [ ] **Step 3: Implement Floor & Placement API Endpoints in `app.py`**
  - `GET /api/map/floors`
  - `POST /api/map/floors`
  - `DELETE /api/map/floors/{floor_id}`
  - `POST /api/map/floors/{floor_id}/placement`
  - `DELETE /api/map/placements/{device_id}`
  - `POST /api/map/upload-floor`
  - `GET /api/map/crowded-analysis/{floor_id}`
- [ ] **Step 4: Test endpoints via curl**

---

### Task 2: Frontend API Client & State Types
**Files:**
- Modify: `C:/Users/admin/mikrotik-controller/frontend/src/api.ts`

- [ ] **Step 1: Add types for `FloorPlan`, `ApPlacement`, `CrowdedAnalysis`**
- [ ] **Step 2: Add API functions to `api` object in `frontend/src/api.ts`**

---

### Task 3: Interactive Floor Canvas & Heatmap Component
**Files:**
- Create: `C:/Users/admin/mikrotik-controller/frontend/src/components/map/FloorMapView.tsx`
- Create: `C:/Users/admin/mikrotik-controller/frontend/src/components/map/HeatmapCanvas.tsx`
- Create: `C:/Users/admin/mikrotik-controller/frontend/src/components/map/ApMarker.tsx`
- Create: `C:/Users/admin/mikrotik-controller/frontend/src/components/map/ChannelAnalyzerDrawer.tsx`

- [ ] **Step 1: Implement `ApMarker.tsx`**
  Renders interactive AP pin with signal pulse, online status, channel pill, collision warning, and dragging handle.
- [ ] **Step 2: Implement `HeatmapCanvas.tsx`**
  Renders signal coverage radiuses (Green -45dBm to Red -80dBm) using HTML5 Canvas radial gradients with adjustable opacity and frequency band toggle (2.4G vs 5G).
- [ ] **Step 3: Implement `ChannelAnalyzerDrawer.tsx`**
  Displays channel density bar chart, detected co-channel conflicts, and AI channel optimization recommendations.
- [ ] **Step 4: Implement `FloorMapView.tsx`**
  Integrates Pan & Zoom canvas, floor switcher, upload modal, sidebar of unplaced devices, and placement persistence.

---

### Task 4: Integrate Floor Map into Main Navigation
**Files:**
- Modify: `C:/Users/admin/mikrotik-controller/frontend/src/App.tsx`
- Modify: `C:/Users/admin/mikrotik-controller/frontend/src/components/Header.tsx`

- [ ] **Step 1: Update `activeView` type to `'fleet' | 'device' | 'map'` in `App.tsx` and `Header.tsx`**
- [ ] **Step 2: Add "Denah & Heatmap" navigation button with MapPin icon to `Header.tsx`**
- [ ] **Step 3: Render `FloorMapView` when `activeView === 'map'` in `App.tsx`**

---

### Task 5: Build, Verify & End-to-End Test
- [ ] **Step 1: Run `npm run build` to verify TypeScript compile & Vite bundle**
- [ ] **Step 2: Verify in browser via `browser_exec`**
  Navigate to `http://localhost:8090`, switch to "Denah & Heatmap", place AP onto floor plan, test heatmap toggle, and inspect crowded channel analyzer.
