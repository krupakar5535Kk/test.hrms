# Vanguard HRMS — Enterprise Design System Master (MASTER.md)

> **SOURCE OF TRUTH:** This document governs all UI/UX implementations across the Vanguard HRMS application.
> Page-specific overrides are defined under `design-system/pages/[page-name].md`. If a page file does not exist, all rules in this Master file apply strictly.

---

## 1. Product Identity & Design Principles

### Product Classification
- **Domain:** Enterprise B2B SaaS — Human Resource Management, Smart Biometric Attendance & Hourly Payroll Governance.
- **Reference Standards:** Linear (information density, keyboard speed, micro-typography), Stripe (crisp 1px borders, tabular financial precision, clear hierarchy), Rippling (workforce lifecycle management), Deel (compliance-first payroll clarity).
- **Core Philosophy:** Clarity over decoration. Operational precision over aesthetic noise. Every component, badge, label, and pixel exists to serve a real human workflow without cognitive friction.

### Anti-Patterns Strictly Forbidden
- ❌ No generic AI dashboard templates or repetitive, purposeless card grids.
- ❌ No excessive gradients, ambient glows, or artificial glassmorphism blur layers.
- ❌ No oversized headings, inflated margins, or wasteful white space that forces unnecessary scrolling.
- ❌ No fake statistics, placeholder charts, or decorative illustrations without real data backing.
- ❌ No emojis as status icons or navigation indicators (strictly use SVG icons from `lucide-react`).
- ❌ No interactive pills or badges that masquerade as static labels, and no color-only status coding (always pair with text).

---

## 2. Color Palette & Semantic Tokens

### Core Foundation Neutrals
| Role | Hex | CSS Variable | Tailwind Class | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **App Canvas** | `#F8FAFC` | `--background` | `bg-slate-50` | Primary app background |
| **Surface Card** | `#FFFFFF` | `--card` | `bg-white` | Elevated panels, cards, data tables |
| **Text Primary** | `#0F172A` | `--foreground` | `text-slate-900` | Headings, primary values, active labels |
| **Text Secondary** | `#334155` | `--muted-foreground` | `text-slate-700` | Table data, descriptions, field labels |
| **Text Muted** | `#64748B` | `--text-muted` | `text-slate-500` | Helper text, secondary timestamps, subtitles |
| **Border Subtle** | `#E2E8F0` | `--border` | `border-slate-200` | Card borders, dividers, table gridlines |
| **Border Input** | `#CBD5E1` | `--input` | `border-slate-300` | Text inputs, dropdowns, checkboxes |
| **Surface Muted** | `#F1F5F9` | `--muted` | `bg-slate-100` | Table headers, chip backgrounds, disabled states |

### Semantic Status & Compliance Tokens
| Semantic Role | Token Fill | Token Text | Token Border | Usage in HRMS |
| :--- | :--- | :--- | :--- | :--- |
| **Compliant / Success** | `#ECFDF5` (`emerald-50`) | `#065F46` (`emerald-800`) | `#A7F3D0` (`emerald-200`) | Approved Attendance, Live Face Match, Present, Paid Payslip |
| **Pending / Attention** | `#FFFBEB` (`amber-50`) | `#92400E` (`amber-800`) | `#FDE68A` (`amber-200`) | Pending Admin Review, Verification Pending, Draft Payroll |
| **Violation / Error** | `#FFF1F2` (`rose-50`) | `#9F1239` (`rose-800`) | `#FECDD3` (`rose-200`) | Geofence Violation, Liveness Failed, Spoofing Suspected, Rejected |
| **Field Exception** | `#F0F9FF` (`sky-50`) | `#075985` (`sky-800`) | `#BAE6FD` (`sky-200`) | Outside Geofence (Approved Field Rep), Active Field Session |
| **Brand Primary** | `#4F46E5` (`indigo-600`) | `#FFFFFF` | `#4338CA` (`indigo-700`) | Primary CTAs, active tab underlines, brand badges |

### 2-Portal Visual Architecture
1. **Admin Governance Console (`/admin/*`)**:
   - Sidebar: Authoritative deep slate (`bg-slate-950`), border `border-slate-800`, crisp typography, emerald governance status badge, group section headers (`CORE`, `WORKFORCE`, `OPERATIONS`, `GOVERNANCE`).
   - Content: Crisp high-density slate-50 canvas, structured data tables, Maker-Checker review drawers, operational KPI bars.
2. **Employee Self-Service Workspace (`/employee/*`)**:
   - Sidebar: Clean light card surface (`bg-white`), border `border-slate-200`, approachable indigo accents.
   - Mobile: Responsive bottom navigation bar with full drawer sheet, large accessible punch targets (min 48px touch boundary), real-time camera feedback.

---

## 3. Typography & Data Presentation Scale

- **Primary Interface Font:** `Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`.
- **Numerical & Tabular Font:** `JetBrains Mono`, `ui-monospace`, with `font-variant-numeric: tabular-nums` strictly applied to:
  - Financial figures (e.g. `₹45,000.00`)
  - Times and shifts (e.g. `10:00:00`, `18:00:00`)
  - Working durations (e.g. `8h 15m (495 mins)`)
  - GPS coordinates (e.g. `12.9716° N, 77.5946° E`)
  - Verification scores & confidence percentages (e.g. `0.9450 / 94.5%`)
  - Identification codes (e.g. `EMP-SZ6094`, `ORG-BANGALORE`)

### Type Hierarchy
| Scale | Size / Line Height | Weight | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Display / Page Title** | `20px` / `26px` | SemiBold (600) | `-0.015em` | Page header titles |
| **Section Title** | `15px` / `20px` | SemiBold (600) | `-0.01em` | Card headers, modal titles |
| **Body / Table Primary**| `13px` / `18px` | Regular (400) / Medium (500) | Normal | Employee names, table cell content |
| **Secondary / Labels**  | `12px` / `16px` | Medium (500) | Normal | Form labels, input text, table headers |
| **Micro-Caption / Meta**| `11px` / `14px` | Medium (500) | `+0.02em` | Timestamps, secondary IDs, status notes |
| **Badge / Tag**         | `10.5px` / `13px`| SemiBold (600) | `+0.025em` | Status chips, category indicators |

---

## 4. Spacing, Layout & Density (Density Dial: 8/10)

- **Grid System:** 12-column responsive grid with 16px gutter (`gap-4` or `gap-5`).
- **Page Container:** `max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6`.
- **Spacing Tokens:**
  - `xs`: `2px` (micro-separators)
  - `sm`: `4px` (icon gaps, inline chips)
  - `md`: `8px` (button internal gap, input padding)
  - `lg`: `12px` (card content padding, list item gaps)
  - `xl`: `16px` (card padding, section spacing)
  - `2xl`: `24px` (grid gaps, modal body padding)
  - `3xl`: `32px` (page section dividers)

---

## 5. Component Specifications

### 5.1 Buttons (`<Button />`)
- **Primary:** `bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-3.5 py-2 rounded-lg shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 active:scale-[0.99]`.
- **Secondary:** `bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs px-3.5 py-2 rounded-lg border border-slate-300 shadow-xs transition-colors`.
- **Destructive:** `bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs px-3.5 py-2 rounded-lg shadow-xs transition-colors`.
- **Ghost:** `bg-transparent hover:bg-slate-100 text-slate-600 hover:text-slate-900 font-medium text-xs px-2.5 py-1.5 rounded-lg`.
- **States:** Disabled state uses `opacity-50 pointer-events-none`; Loading state displays inline `Loader2` spinner and locks width.

### 5.2 Form Inputs & Controls
- **Label:** `block text-xs font-medium text-slate-700 mb-1.5`. Mandatory indicators use a subtle rose asterisk `*`.
- **Input / Select:** `w-full h-9 px-3 py-1.5 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg shadow-xs placeholder:text-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors`.
- **Validation Error:** `border-rose-500 focus:border-rose-600 focus:ring-rose-500` with inline error message in `text-[11px] text-rose-600 mt-1 flex items-center gap-1`.

### 5.3 Data Tables & Grids
- **Container:** `overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs`.
- **Header:** Sticky `bg-slate-50/90 backdrop-blur-xs border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left`.
- **Row:** `border-b border-slate-100 hover:bg-slate-50/60 transition-colors h-11 text-xs text-slate-700 px-4 py-2.5`.
- **Actions Column:** Right-aligned icon buttons with clear tooltips and click areas.
- **Empty State:** Clean centered state with icon, clear title, explanatory paragraph, and primary action button.

### 5.4 Status Badges & Pills (`<Badge />`)
- **Structure:** `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border`.
- **Indicator:** Optional 6px solid circular dot preceding label text to guarantee immediate status comprehension.

### 5.5 Modals & Slide-Over Drawers (`<Dialog />`)
- **Backdrop:** `fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs animate-fade-in`.
- **Card:** `relative w-full rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden flex flex-col`.
- **Header:** `px-6 py-4 border-b border-slate-100 flex items-center justify-between`.
- **Body:** `p-6 overflow-y-auto max-h-[calc(85vh-120px)] space-y-4`.
- **Footer:** `px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5`.

---

## 6. Accessibility & Responsive Verification Checklist

- [ ] Minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text / borders against backgrounds.
- [ ] Keyboard focus ring offset (`focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1`).
- [ ] Interactive touch targets minimum `44x44px` on mobile/tablet screens.
- [ ] Semantic HTML: `<main>`, `<nav>`, `<header>`, `<aside>`, `<table>`, `<dialog>`.
- [ ] Screen sizes verified:
  - Mobile: `375px` — single column, bottom nav, full-width touch actions.
  - Tablet: `768px` — dual-column, collapsible sidebar.
  - Laptop: `1024px` — persistent sidebar, 3-column dashboard grids.
  - Desktop: `1440px` — full information density with zero layout shifting.
