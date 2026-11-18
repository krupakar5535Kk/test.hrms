# KMACCS HRMS — Smart Attendance, Biometrics & Working-Hour Payroll System

Human Resource Management System built for **Karthikeya Mutually Aided Cooperative Credit Society Limited (KMACCS)** featuring live selfie-based attendance with anti-spoofing liveness checks, strict 50-metre office geofencing, Admin verification workflows, field-force monitoring, and a deterministic working-hour payroll engine.

---

## Live Deployment (Vercel)

| Environment | URL | Status |
| :--- | :--- | :--- |
| **Primary Production Portal** | **[https://kmaccs-hrms-portal.vercel.app](https://kmaccs-hrms-portal.vercel.app)** | Live on Vercel |
| **Secondary Alias** | **[https://kmaccs-hrms.vercel.app](https://kmaccs-hrms.vercel.app)** | Live on Vercel |
| **API Health Endpoint** | **[https://kmaccs-hrms-portal.vercel.app/api/v1/health](https://kmaccs-hrms-portal.vercel.app/api/v1/health)** | Active (`200 OK`) |

---

## Technology Stack

### Frontend (`client/`)
| Technology | Purpose |
| :--- | :--- |
| **React 18** (`react`, `react-dom`) | Component-based UI for Admin Console & Employee Portal |
| **TypeScript 5.7** | Strict end-to-end static type safety |
| **Vite 6** | Fast development server & optimized production bundling |
| **Tailwind CSS 3.4** (`clsx`, `tailwind-merge`) | Enterprise utility-first styling and custom design tokens |
| **React Router v6** | Role-isolated protected routing (Admin vs. Employee portals) |
| **Recharts** | Interactive analytics and reporting visualizations |
| **Lucide React** | Crisp icon library across navigation, status badges, and modals |
| **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) | Browser-side live selfie capture & facial liveness detection |

### Backend (`server/` & `api/`)
| Technology | Purpose |
| :--- | :--- |
| **Node.js 22.x** | Serverless & server runtime environment |
| **Express.js 4.21** | REST API server, middleware pipeline & Authentication Broker |
| **TypeScript 5.7** | Strongly typed routes, services, and database mappers |
| **PostgreSQL (`pg` 8.x)** | Direct pooled Postgres queries with transaction-scoped RLS context |
| **Supabase JS (`@supabase/supabase-js`)** | Supabase Auth (GoTrue) integration & private storage signed URLs |
| **JOSE (`jose` 6.x)** | Cryptographic JWT & JWKS signature verification |
| **Helmet 8, CORS, Cookie & Rate Limiter** | HTTP security headers, dynamic CORS whitelist, `HttpOnly` refresh cookies & brute-force protection |
| **Vercel Serverless Adapter (`api/index.ts`)** | Serverless entrypoint bridging Vercel Functions to the Express app |

### Database, Authentication & Cloud Storage (`supabase/`)
| Technology | Purpose |
| :--- | :--- |
| **Supabase PostgreSQL (Cloud `ap-south-1`)** | Multi-tenant relational database with strict Row-Level Security (RLS) |
| **Supabase Auth (GoTrue) + Auth Broker** | Tri-partite login (`Organization Code + Indian Mobile + Password`) with synthetic auth identities |
| **Supabase Private Storage** | Encrypted private buckets (`attendance-selfies`, `face-enrollment`) with 30-day selfie retention & short-lived signed URLs |
| **SQL Migrations (`supabase/migrations/`)** | 14 versioned DDL migrations, stored procedures, and security policies |

### Biometrics & Anti-Spoofing Microservice (`liveness-service/`)
| Technology | Purpose |
| :--- | :--- |
| **Python + FastAPI 0.115 + Uvicorn** | High-performance anti-spoofing & liveness verification API |
| **ONNX Runtime + OpenCV + MediaPipe** | Passive spoof detection, print/replay defense & challenge-response verification |
| **Docker Compose** | Containerized deployment configuration (`docker-compose.liveness.yml`) |

### Shared Contracts & Deployment
| Technology | Purpose |
| :--- | :--- |
| **npm Workspaces (`@hrms/shared`)** | Shared TypeScript interfaces, API contracts, and validation schemas across frontend & backend |
| **Vercel** | Production hosting for React SPA static CDN + Express Serverless API (`vercel.json`) |

---

## Core Modules & Features

### Admin Console (10 Modules)
1. **Organization Overview** — Executive Command & Governance Center
2. **Employee Management** — Employee Directory, onboarding & activation workflows
3. **Sales & Recovery Teams** — Departments, designations & organizational structure
4. **Attendance & Approvals** — Selfie attendance verification queue with side-by-side reference vs. live selfie comparison, 50m geofence radar map, idempotent approval/rejection, and audit trail
5. **Field-Force Monitoring** — Live field-duty sessions & customer/recovery visit tracking
6. **Leave Approvals** — CL / SL / PL / LWP adjudication with audit remarks
7. **Payroll Management** — Deterministic working-hour payroll engine (64-bit integer paise precision)
8. **Reports & Exports** — Operational attendance & payroll reporting
9. **Settings, Geofence & Audit** — HQ geofence coordinates (`50m` perimeter, `≤ 30m` GPS accuracy) & immutable audit logs
10. **Security & Sessions** — Admin security, biometric governance & multi-device session revocation

### Employee Self-Service Portal
- **Smart Selfie Attendance** — Automatic capture of live selfie, GPS coordinates, GPS accuracy (`≤ 30m`), server-verified Haversine distance from HQ (`≤ 50m`), IST date/time, and instant `PENDING_ADMIN_REVIEW` queuing (no manual tampering or auto-approval).
- **Attendance History, Field Duty Logs, Leave Requests, Payroll Slips, Profile & Security Controls**.

### Architectural Governance Rules
- **Location Verification:** Strict **50-metre** office geofence and **≤ 30-metre** GPS accuracy verified server-side; face verification and location verification are enforced independently (a face match never overrides a failed location check).
- **Admin Approval Guardrails:** Outside-geofence submissions are recorded for audit transparency, and approval is strictly blocked by both UI and backend validation.
- **Working-Hour Payroll Precision:** Exact proportional working-hour calculation with `BIGINT` paise arithmetic and DEC-01 paid lunch & holiday credit rules.
- **Role & Tenant Isolation:** Dedicated Admin and Employee routes (`403 Forbidden` across role boundaries), zero client-supplied tenant UUIDs, and `HttpOnly` refresh cookies with in-memory access tokens.

---

## Monorepo Structure

```text
.
├── api/                         # Vercel Serverless Express entrypoint (api/index.ts)
├── client/                      # Frontend Workspace (React 18 + Vite + TypeScript + Tailwind)
│   ├── public/                  # Static assets & KMACCS brand intro video
│   └── src/
│       ├── components/          # UI primitives, BrandIntroScreen, SmartAttendanceModal, AdminReviewModal, GeofenceBoundaryMap
│       ├── context/             # AuthContext (in-memory access tokens + cookie refresh)
│       ├── layouts/             # AdminLayout & EmployeeLayout
│       ├── pages/               # Admin Console (10 pages), Employee Portal, Login & Account Activation
│       └── tests/               # Frontend domain & liveness capture unit tests
├── server/                      # Backend Workspace (Node.js + Express + TypeScript)
│   ├── src/
│   │   ├── app.ts               # Express app, Helmet, dynamic CORS & route mounting
│   │   ├── auth/                # Cryptographic JWT / JWKS verifier
│   │   ├── db/                  # Postgres pool & multi-tenant RLS transaction runner
│   │   ├── middleware/          # Auth guards, RBAC, rate limiter & error handler
│   │   ├── routes/v1/           # auth.ts, admin.ts, employee.ts, notifications.ts, health.ts
│   │   └── services/            # HRMS domain rules, record mappers, Supabase admin, face & liveness adapters
│   └── tests/                   # Backend unit, security & end-to-end integration tests
├── shared/                      # Shared TypeScript contracts & schemas (@hrms/shared)
├── supabase/                    # Supabase config & 14 PostgreSQL RLS/schema migrations
├── liveness-service/            # Python FastAPI anti-spoofing microservice
├── scripts/                     # Automated 12-scenario E2E verification & admin scripts
├── docs/                        # PRD baselines, SRS, ERD, API & Security specifications
├── vercel.json                  # Vercel build & SPA/API rewrite configuration
└── package.json                 # Root npm workspaces configuration
```

---

## Local Setup & Running

### Prerequisites
- **Node.js** `22.x`+ and **npm** `10+`
- **Supabase** project (PostgreSQL + Auth + Storage)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```
Fill in your Supabase URL, Postgres pool credentials, JWT/HMAC keys, and CORS settings in `server/.env`. *(Never commit real `.env` files.)*

### 3. Build All Workspaces
```bash
npm run build
```

### 4. Run Development Servers
```bash
# Run both Backend API (port 5000) and Frontend (port 5173)
npm run dev

# Or run individually
npm run dev:server
npm run dev:client
```

### 5. Run Verification Tests
```bash
# Run unit & typecheck suites across workspaces
npm test
npm run typecheck

# Run 12-scenario attendance & auth end-to-end verification
node scripts/test-all-12-scenarios.mjs
```

---

## Security Safeguards
- **Zero Committed Secrets:** `.env`, `.env.*`, and `.vercel/` are strictly excluded via `.gitignore`.
- **No Trust in Client Telemetry:** GPS distance, geofence pass/fail, and timestamps are always computed and enforced server-side.
- **Immutable Audit Trail:** Every attendance submission, Admin approval/rejection, and security action is recorded in `public.audit_logs`.
