# HRMS + Smart Attendance + Working-Hour Payroll SaaS

An enterprise-grade, multi-tenant Human Resource Management System engineered with strict proportional working-hour payroll, GPS geofencing, selfie liveness verification, single daily attendance session enforcement, and tri-partite login security.

---

## 1. Architectural Highlights

- **Proportional Working-Hour Model & Monetary Precision:** Salary is proportional to approved payable working hours based on calendar-day monthly distribution ($D_{\text{month}} \times 8.0\text{ hours}$). Zero arbitrary half-day deductions and zero monetary late-arrival fines. Monetary amounts (`base_monthly_salary`, `earned_salary`, `allowances`, `deductions`, `net_salary`) maintain exact 64-bit integer paise (`BIGINT`) precision. Derived rates (`daily_rate`, `hourly_rate`, `minute_rate`) may be stored as `NUMERIC(14,6)` for fractional display, but authoritative calculation evaluates exact rational numerator/denominator arithmetic: $\text{segment\_earnings\_paise} = \frac{\text{payable\_minutes} \times \text{salary\_reference\_paise}}{\text{calendar\_days} \times 480}$, summed unrounded and rounded once to integer paise. Calendar days are strictly validated against the actual payroll period without static 30-day defaults. Mandatory whole-rupee net rounding has been removed and registered as open decision `DEC-05` (Net Salary Rounding Rule).
- **DEC-01 Amended Paid Lunch Policy:** Confirmed 1:00 PM – 2:00 PM lunch window is **PAID**. Contributes 60 payable minutes on scheduled working days (Daily Payable Hours = Approved Actual Working Hours + 1 Paid Lunch Hour). Lunch is **not deducted** from salary. Full day yields exactly 8.0 payable hours (480 minutes). Zero lunch credit on full-day absence is cataloged as a proposed engineering design default under `UNASSIGNED-PO-ABSENCE-LUNCH` (pending formal PO confirmation); partial-day qualification rules are cataloged under open decision `UNASSIGNED-PO-LUNCH-ELIGIBILITY`.
- **Paid Sundays & Public Holidays:** Sundays and recognized public holidays automatically receive an **8.0-hour paid credit (480 minutes)** in the monthly calculation. Overlap between Sunday and public holiday credits exactly 8.0 hours.
- **DEC-15 Approved Option A Proration:** Mid-period salary changes apply the salary reference effective on each specific calendar date based on the month's calendar-day divisor. Continuous salary segments are evaluated at full internal precision, summed unrounded across all segments, and rounded once to the nearest integer paisa: $\text{Gross Paise} = \text{ROUND\_HALF\_UP}\left(\sum \text{unrounded\_segment\_earnings\_paise}\right)$.
- **Critical Technical Blocker (`BLOCKER-ACTUAL-WORK-MEASUREMENT`):** A single check-in/check-out pair captures elapsed attendance, not active productive work. Productive working time is not currently measurable under baseline punches. Equating presence with work or assuming computer inactivity is non-work is technically invalid. Illustrative measurement alternatives (active task logging, desktop monitoring, supervisor timesheet approval) represent possible approaches requiring separate evaluation and explicit approval; no surveillance or monitoring method is selected or recommended as an approved architecture. Implementation of automated deductions is blocked pending architectural design.
- **DEC-02 Approved Daily Session Lifecycle:** Enforces a strict maximum of one Check-In and one Check-Out pair per employee per scheduled working day ($\le 1$). Absence and approved leave remain valid business states. Includes Admin dual-workflow corrections and deterministic check-out order.
- **DEC-13 Approved Login Architecture:** Tri-partite login identifier requiring **Organization Code + Phone Number + Password**. The Organization Code resolves the tenant internally before credential verification; client-supplied organization UUIDs are strictly untrusted.
- **DEC-09 Approved Supabase Auth Broker:** Supabase Auth is single password authority; Express translates credentials to synthetic email identities.
- **DEC-14 Approved Biometric Lifecycle:** Strict 30-day maximum ceiling on daily attendance selfies with 4-tier deletion coverage, subject to legal review before production. Retention-clock starting point (device capture time vs. trusted server receipt time) is an unresolved policy and architectural clarification.

---

## 2. Monorepo Structure

```text
.
├── .env.example              # Environment variables template (placeholders only)
├── .gitignore                # Git ignore configuration
├── .nvmrc                    # Node.js target version (26)
├── .prettierrc               # Prettier code formatting rules
├── package.json              # Monorepo root npm workspaces configuration
├── tsconfig.base.json        # Base TypeScript strict compiler options
│
├── client/                   # Frontend Workspace (React + Vite + TypeScript + Tailwind)
│   ├── index.html            # Vite entrypoint HTML
│   ├── package.json          # Frontend dependencies and build scripts
│   ├── postcss.config.js     # PostCSS configuration
│   ├── tailwind.config.js    # Tailwind CSS config with shadcn/ui design tokens
│   ├── tsconfig.json         # Client TypeScript configuration
│   ├── vite.config.ts        # Vite build tool and API proxy configuration
│   └── src/
│       ├── main.tsx          # React application root
│       ├── App.tsx           # Router configuration and global ErrorBoundary
│       ├── index.css         # Tailwind directives and CSS variables
│       ├── components/
│       │   ├── common/       # ErrorBoundary, LoadingSpinner, NotFound
│       │   └── layout/       # AppShell responsive layout
│       └── pages/            # HomePage (Status Dashboard), LoginPage (DEC-13)
│
├── server/                   # Backend Workspace (Node.js + Express + TypeScript)
│   ├── .env.example          # Server environment template
│   ├── package.json          # Backend dependencies and runtime scripts
│   ├── tsconfig.json         # Server TypeScript configuration
│   ├── tests/                # Server unit and integration tests
│   └── src/
│       ├── app.ts            # Express app configuration & middleware
│       ├── index.ts          # Server listener and graceful shutdown handlers
│       ├── config/           # Environment validation (env.ts)
│       ├── middleware/       # errorHandler.ts, requestValidator.ts
│       ├── routes/v1/        # API v1 routes: health.ts, auth.ts
│       └── utils/            # Structured logger (logger.ts)
│
├── shared/                   # Shared Workspace (@hrms/shared)
│   ├── package.json          # Shared package specification
│   ├── tsconfig.json         # Shared TypeScript composite configuration
│   └── src/
│       ├── index.ts          # Barrel export
│       ├── api/              # Standardized ApiResponse & ApiErrorResponse
│       ├── auth/             # DEC-13 Login contracts & validation schemas
│       └── types/            # Core domain interfaces (User, Employee, Org)
│
└── docs/                     # Approved Specifications & Baselines
    ├── PRD_v1.9.md           # Current Amended PRD Baseline with Open Policy Blockers
    ├── PRD_v1.8.md           # Historical Approved Baseline (DEC-09 Supabase Auth)
    ├── PRD_v1.7.md           # Historical Approved Baseline (DEC-13 Login Architecture)
    ├── PRD_v1.6.md           # Historical Approved Baseline (DEC-02 Refinements)
    ├── PRD_v1.5.md           # Historical Baseline (DEC-02 Initial)
    ├── PRD_v1.4.md           # Historical Baseline (DEC-01 Lunch Clipping)
    ├── 01_PRD_GAP_ANALYSIS_AND_RTM.md
    ├── 02_SOFTWARE_REQUIREMENTS_SPECIFICATION_SRS.md
    ├── 03_DATABASE_SCHEMA_AND_ERD.md
    ├── 04_API_SPECIFICATION.md
    ├── 05_ROLE_PERMISSION_MATRIX.md
    ├── 06_UI_UX_ARCHITECTURE.md
    ├── 07_SECURITY_ARCHITECTURE.md
    └── 08_ROADMAP_AND_TESTING_STRATEGY.md
```

---

## 3. Environment Prerequisites

- **Node.js:** Target Node.js 26 Active LTS (`>=26.0.0`). Check with `node -v`.
- **npm:** npm 10+ (`>=10.0.0`). Check with `npm -v`.
- **Operating System:** macOS (Intel `x86_64` or Apple Silicon `arm64`) / Linux / Windows WSL2.

### Local Installation Instructions (if Node.js is missing):
```bash
# Option 1: Standalone User-Local Installation (Installed in ~/.local/node without root/sudo)
# Ensure ~/.local/node/bin is on your PATH in ~/.zshrc and ~/.zprofile:
export PATH="$HOME/.local/node/bin:$PATH"

# Option 2: Using Homebrew (macOS)
brew install node

# Option 3: Using nvm (Node Version Manager)
nvm install 26
nvm use 26
```

---

## 4. Setup & Running the Application

### 1. Install Dependencies
```bash
# From monorepo root
npm install
```

### 2. Configure Environment Variables
```bash
# Copy root template
cp .env.example .env

# Copy server template
cp server/.env.example server/.env
```

### 3. Build Shared Library & Workspaces
```bash
# Build shared library first, followed by server and client
npm run build
```

### 4. Run Development Servers
```bash
# Run both backend API (port 5000) and frontend (port 5173) concurrently
npm run dev

# Or run backend individually
npm run dev:server

# Or run frontend individually
npm run dev:client
```

### 5. Verify the Health Endpoint
```bash
curl http://localhost:5000/api/v1/health
```
Expected response:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "hrms-api",
    "version": "1.0.0",
    "environment": "development",
    "timestamp": "2026-11-07T...",
    "uptimeSeconds": 12,
    "memory": { "rssMb": 45.2, "heapUsedMb": 18.5 }
  }
}
```

### 6. Test the DEC-13 Login Endpoint (Scaffold Demonstration)
```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "organizationCode": "DEMO",
    "phoneNumber": "9876543210",
    "password": "Password123!"
  }'
```

> [!NOTE]
> **Scaffold vs. Production Authentication Notice:**
> The current login handler in `server/src/routes/v1/auth.ts` is explicitly a **Task 1.1 development scaffold fixture**. It validates payload schemas, demonstrates anti-enumeration response codes (401 on non-demo credentials, 400 on validation errors), and returns mock token responses for `DEMO` credentials. **It is NOT production authentication.** Production Supabase Auth integration, cryptographic password hashing, user session issuance, and PostgreSQL database queries will be implemented in **Task 1.2**.

### 7. Run Test & Typecheck Suites
```bash
# Run automated tests across all workspaces (shared, server, client)
npm test

# Run strict TypeScript compiler verification across all workspaces
npm run typecheck
```

---

## 5. Security & Isolation Safeguards

- **Task 1.1 Mock Authentication Scope:** The demo login route is strictly a development scaffold to verify HTTP request/response contracts and DEC-13 payload validation. It does not replace real authentication.
- **No Live Database Alterations:** This milestone establishes scaffolding, shared contracts, and application foundations. No migrations or queries have been executed on live Supabase instances.
- **Tenant Context Protection:** Frontends cannot provide raw `organization_id` UUIDs to authenticate or query data. All tenant scoping is derived securely on the server via `organization_code` pre-resolution.
- **Zero Committed Secrets:** All credential values in `.env.example` are placeholders. Real keys must never be committed.
