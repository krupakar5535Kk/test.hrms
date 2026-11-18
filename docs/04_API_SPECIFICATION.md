# API Architecture & Endpoint Specification

**System Designation:** HRMS Core REST API  
**Base URL:** `/api/v1`  
**Authentication Scheme:** Bearer Token (JWT via HTTP Authorization Header)  
**Encoding:** `application/json` (Multipart form-data for evidence/documents)  
**Document Version:** 1.6  
**PRD Reference:** PRD v1.9 Baseline (Incorporating Approved DEC-15 Option A, Amended DEC-01 Paid Lunch Policy, Paid Sundays & Public Holidays Model, and Approved DEC-14 Selfie Retention Ceiling)  

---

## 1. API Architecture & Standards

### 1.1 Uniform Response Envelope
Every API endpoint responds with a standardized JSON wrapper:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "timestamp": "2026-11-07T00:00:00.000Z",
    "requestId": "req_abc123"
  }
}
```

In error conditions:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "GEOFENCE_VIOLATION",
    "message": "Reported location is outside the authorized office geofence perimeter (50m proposed / 100m legacy baseline).",
    "details": {
      "distanceMeters": 142.5,
      "maxAllowedMeters": 50.0
    }
  },
  "meta": {
    "timestamp": "2026-11-07T00:00:00.000Z",
    "requestId": "req_err456"
  }
}
```

### 1.2 HTTP Status Code Matrix
- `200 OK`: Request succeeded with returned data payload.
- `201 Created`: Resource successfully created.
- `400 Bad Request`: Validation failure or schema violation.
- `401 Unauthorized`: Missing or invalid Bearer token.
- `403 Forbidden`: Authenticated user lacks RBAC permission or feature eligibility (e.g., `FIELD_ATTENDANCE_NOT_ELIGIBLE`).
- `404 Not Found`: Target entity not found.
- `409 Conflict`: Business rule collision (e.g. duplicate check-in, open punch exists, duplicate pending/approved field request, or locked payroll period).
- `422 Unprocessable Entity`: Verification check failed (e.g., GPS accuracy > 30m `GPS_ACCURACY_INSUFFICIENT`, outside office geofence `GEOFENCE_VIOLATION`, liveness/face mismatch, suspected GPS spoofing `GPS_SPOOFING_SUSPECTED`, missing field comment, or idempotency payload mismatch `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).
- `500 Internal Server Error`: Unhandled server exception.

### 1.3 Idempotency Semantics (Attendance Endpoints)
Attendance mutation endpoints (`/attendance/check-in`, `/attendance/check-out`, and proposed `/attendance/field-requests`) enforce strict idempotency semantics via the `Idempotency-Key` header:
1. **Same `Idempotency-Key` + Identical Payload:** Returns the original stored HTTP response (HTTP 200/201 replay) without re-executing business logic or creating duplicate events.
2. **Different `Idempotency-Key` + Duplicate Action:** Rejects with **HTTP 409 Conflict** (`ATTENDANCE_ALREADY_CHECKED_IN` or `ATTENDANCE_ALREADY_COMPLETED`).
3. **Same `Idempotency-Key` + Different Payload:** Rejects with **HTTP 422 Unprocessable Entity** (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).

---

## 2. Authentication & Credential Lifecycle

*(Full security rationale, GoTrue precision controls, approved `PO-01` Scheme 3, approved `PO-02` Indian-only mobile normalization, approved `PO-03` self-service Mobile OTP password recovery, approved Initial Account Activation Policy, approved `PO-04` authentication login rate limiting, approved `PO-05` HttpOnly refresh cookie/CSRF/CORS policy, approved `PO-06` GoTrue config alignment [`jwt_expiry = 900`, `enable_signup = false`, `minimum_password_length = 8`, `enable_confirmations = false`, Express broker only], approved `PO-07` Concurrent Device Session Policy [`user_sessions` / `revoked_sessions` / `tokens_valid_after_epoch`], and remaining open `DEC-10` commercial SMS gateway decision are documented in [`docs/09_AUTHENTICATION_BROKER_ARCHITECTURE.md`](file:///Users/mac/Desktop/HRMS/docs/09_AUTHENTICATION_BROKER_ARCHITECTURE.md).)*

### 2.1 Employee/Admin Login (DEC-13 & DEC-09 Approved; PO-04 Rate Limiting Approved)
- **Endpoint:** `POST /api/v1/auth/login`
- **Access:** Public (Protected per approved **`PO-04` (`2026-11-10`)**: `5` failed login attempts per account key within a rolling `15-minute` window + temporary throttling [never permanent account lockout] + additional IP-based rate limiting using verified `trust proxy` configuration; atomic shared counters across backend instances using keyed `HMAC-SHA256` of normalized org identity + canonical E.164 phone)
- **Security & Brokerage Rule:**
  1. Organization code identifies the tenant before authentication. The backend resolves the organization internally via `resolve_organization_by_code()`, verifying `is_active = true`, and scopes authentication to that tenant. Browser-supplied tenant UUIDs are never trusted or accepted. Employees never enter or see email addresses.
  2. Under **DEC-09**, **approved `PO-01` (Scheme 3, 2026-11-10)**, and **approved `PO-02` (Indian Mobile Normalization, 2026-11-10)**, Express acts as an Authentication Broker for Supabase Auth. The backend authoritatively normalizes `phoneNumber` before lookup, provisioning, uniqueness checks, and login (Phase 1 Indian mobile numbers only: accepts `9876543210`, `919876543210`, or `+919876543210` with spaces/hyphens stripped and national first digit `[6-9]`; converts strictly to canonical `+91XXXXXXXXXX`; rejects international numbers, trunk `0`, landlines, short codes, malformed values, and arbitrary prefixes without silent truncation; never trusts client-supplied normalized strings) and invokes `hrms_internal.resolve_login_identity(orgId, phone)` (proposed for future Migration `00004` under dedicated non-login read-only owner `hrms_auth_lookup_owner`), returning the immutable UUID synthetic email `<immutable_uuid>@auth.hrms.internal` stored in `public.users.synthetic_email` (which stays unchanged when an employee's mobile number is updated). The lookup enforces active org, active user, and `activated_at IS NOT NULL` inside PostgreSQL, returning strictly `{ user_id, synthetic_email }` (0 rows otherwise; zero `account_exists` or status flags). Failed authentication returns a generic `401 INVALID_CREDENTIALS` error without revealing whether an organization or phone number exists. `synthetic_email` remains strictly internal—never exposed in employee-facing UI, API responses, logs, error messages, or payslips.
  3. Express authenticates against Supabase Auth GoTrue (`signInWithPassword` via stateless server client) and cryptographically verifies the issued JWT via JWKS (`verifySupabaseToken`), extracting `sub` and verified GoTrue `session_id` UUID claim. Under **approved `PO-07` (`2026-11-10`)** and **Task `2.2B.9C`**, Express enters `withTenantTransaction(orgId, ..., sub)` (`READ WRITE`), calls `hrms_internal.issue_tx_challenge()` (`hrms_context_verifier`) -> `(tx_xid, challenge_nonce)`, signs `p_tx_proof` (`op = 'CREATE_SESSION'`, `target_id = session_id`), and calls `hrms_internal.create_user_session(p_tx_proof, ...)` (`hrms_session_manager`) to mint an independent session in `public.user_sessions` (no arbitrary initial device limit; stores `gotrue_session_id`, keyed `refresh_token_hmac`, parsed `device_summary`, and masked `approx_ip`, never plaintext refresh tokens). Supabase Auth is the sole password and JWT authority; no custom password hashes or capability tickets exist.
  4. The verified Supabase Auth user ID (`auth.users.id`) maps 1:1 to `public.users.id`.
  5. Authentication failures at any stage apply pre-DB rate limits (`PO-04` account + IP counters applied equally to unknown organizations/mobiles), anti-enumeration timing mitigation (local dummy bcrypt + calibrated padding without claiming exact GoTrue constant-time equality), and return uniform generic `HTTP 401 INVALID_CREDENTIALS`. Upon successful `200 OK` authentication, clear/reset the account-scoped failure counter **without resetting IP rate-limit counters**. Append non-secret security events (`LOGIN_FAILURE`, `LOGIN_RATE_LIMITED`, `LOGIN_SUCCESS`, `SESSION_CREATED`) to `audit_logs`.
- **Request Payload:**
```json
{
  "organizationCode": "ACME",
  "phoneNumber": "9876543210",
  "password": "UserChosenPassword123!"
}
```
*(Accepts both camelCase `organizationCode` / `phoneNumber` and snake_case `organization_code` / `phone_number`)*
- **Response `200 OK` (`PO-05` Approved — Access Token ONLY in JSON; Refresh Token strictly via `Set-Cookie: __Host-hrms_refresh_token=...; HttpOnly; Secure; Path=/; SameSite=...` + CSRF initialization; `AuthTokens` in `shared/src/auth/contracts.ts` updated in Task `2.2C`/`2.2D` to omit `refreshToken` from JSON):**
```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "eyJhbGciOi...",
      "expiresIn": 900,
      "tokenType": "Bearer"
    },
    "organization": {
      "id": "org-uuid-1",
      "code": "ACME",
      "name": "Acme Technologies"
    },
    "user": {
      "id": "u-uuid-1",
      "phoneNumber": "+919876543210",
      "roles": ["EMPLOYEE"],
      "mustChangePassword": false
    },
    "employee": {
      "id": "emp-uuid-1",
      "employeeCode": "EMP001",
      "firstName": "Rahul",
      "lastName": "Sharma",
      "officeId": "off-uuid-1"
    }
  }
}
```
- **Response `401 Unauthorized` (Uniform Anti-Enumeration Error across unknown org, unknown phone, inactive/unactivated user, and wrong password):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid organization code, phone number, or password."
  }
}
```
- **Response `429 Too Many Requests` (Generic Rate-Limit Error — `PO-04` Approved; includes `Retry-After` header ONLY when a reliable retry timestamp is available from the shared atomic store):**
```json
{
  "success": false,
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Too many login attempts. Please wait and try again later."
  }
}
```

### 2.2 Secure Employee Account Activation (Approved Policy — Admin Link / QR Code + Mobile OTP)
*(Approved under Task 2.2B.5 / 2.2B.5A / 2.2B.5B / 2.2B.5C — 2026-11-10. Employees activate their accounts via two-factor verification: Admin-generated secure link / QR code containing a URL fragment `#token=...` shared out-of-band + mobile SMS OTP. Employees choose their own permanent password. Administrators never create, view, or know an employee's permanent password. Employees never enter or see an email address, preserving `PO-01` Scheme 3 `<immutable_uuid>@auth.hrms.internal`. Tokens are never logged in browser analytics or error reporting. Cross-system completion executes via a single-flight transition without holding PostgreSQL locks across GoTrue network calls. Production SMS delivery and Indian DLT registration remain open under `DEC-10`.)*

#### 2.2.1 Request Activation OTP (`POST /api/v1/auth/activate/request-otp`)
- **Access:** Public (Pre-DB rate-limited and timing-mitigated).
- **Behavior:** Accepts `{ organizationCode, phoneNumber, activationToken }`. The frontend extracts `activationToken` from the URL fragment (`/auth/activate#token=...`), strips the fragment from the browser bar immediately, and transmits the token over TLS 1.3 / HTTPS. Normalizes `phoneNumber` server-side per `PO-02` (`+91XXXXXXXXXX`). Validates that `activationToken` matches an active, non-expired, unconsumed row in `public.account_activation_tokens` (`token_hash = SHA-256(activationToken)`), that the account is active (`is_active = TRUE`) and unactivated (`activated_at IS NULL`), and that provisioning is valid. Dispatches a CSPRNG numeric OTP to the registered mobile number via `ISmsOtpDispatcher` (dev mock/console sink; `DEC-10` pending for commercial gateway). Low-entropy numeric OTP is stored strictly as a keyed `HMAC-SHA256` digest in proposed `public.password_reset_otps` (`purpose = 'ACTIVATION_OTP'`) with `OTP_HMAC_PEPPER` held exclusively in server RAM.
- **Request Payload:**
```json
{
  "organizationCode": "ACME",
  "phoneNumber": "9876543210",
  "activationToken": "<43-char-base64url-256bit-token>"
}
```
- **Response `202 Accepted` (Uniform Anti-Enumeration):**
```json
{
  "success": true,
  "data": {
    "accepted": true,
    "message": "If the activation details are valid and eligible, a verification code has been sent to your registered mobile number."
  }
}
```

#### 2.2.2 Complete Account Activation (`POST /api/v1/auth/activate`)
- **Access:** Public (Pre-DB rate-limited and timing-mitigated).
- **Security & Reliability Rule (User-Scoped Single-Flight State Machine — No Automatic Safe Retry Under Uncertainty):** The employee supplies `organizationCode`, canonical `phoneNumber`, `activationToken`, `otp`, and chooses their own `newPassword` ($\ge 8$ chars + complexity policy). To eliminate both same-token and cross-token GoTrue password overwrites, **Express enforces a user-level operation lock on `public.users.activation_lock_state` (`auth_user_id` scope) and NEVER holds a PostgreSQL transaction lock open across GoTrue network calls**.
  - **Phase 1 (User-Scoped Single-Flight Claim — Short TX 1, `<5ms`):** Lock both `public.users` (`id = authUserId`) and `account_activation_tokens` (`id = token.id`) via `FOR UPDATE`. If `users.activation_lock_state IN ('IN_FLIGHT', 'QUARANTINED_MANUAL_RECOVERY')`, **reject concurrently (`409 ACTIVATION_LOCKED_PENDING_RECOVERY`) — never issue a second GoTrue write or permit automatic retry**. Validate `token.status = 'ACTIVE'`, token SHA-256 hash, and keyed HMAC OTP via `crypto.timingSafeEqual`, generate unique `opId = crypto.randomUUID()`, set `users.activation_lock_state = 'IN_FLIGHT'`, `activation_lock_op_id = opId`, `activation_lock_started_at = NOW()` AND `token.status = 'COMMITTING'`, `committing_op_id = opId`, `committing_started_at = NOW()`, and commit immediately, releasing all database locks.
  - **Phase 2 (Bounded HTTP Call — Atomic GoTrue Credential + Operation Marker Update):** Enforce client timeout (`AbortController`, e.g. `10s`; explicitly noting **client timeout/abort does NOT prove GoTrue stopped processing on the server**) and call `supabaseAdmin.auth.admin.updateUserById(authUserId, { password: newPassword, app_metadata: { hrms_activation_op_id: opId } })`.
  - **Phase 3A (Confirmed GoTrue Commit -> Local Finalization — Short TX 2, `<5ms`):** Only when GoTrue returns synchronous `200 OK` with `app_metadata.hrms_activation_op_id === opId` (or reconciliation detects exact match): update `public.users` (`activated_at = NOW()`, `phone_verified_at = NOW()`, `must_change_password = FALSE`, `activation_lock_state = 'NONE'`, `activation_lock_op_id = NULL`), mark token `'CONSUMED'` (`used_at = NOW()`), burn OTP (`used_at = NOW()`), and commit *(leaving already-completed `account_provisioning_requests.status = 'COMPLETED'` untouched)*. Revoke placeholder sessions, append `ACCOUNT_ACTIVATED` to `audit_logs`, and return `200 OK`.
  - **Phase 3B / 3C (Verified Pre-Commit Rejection vs User-Scoped Quarantine):** Express releases `users.activation_lock_state = 'NONE'` and `token.status = 'ACTIVE'` **ONLY** on a specifically identified GoTrue pre-commit validation error: HTTP `422 Unprocessable Entity` with JSON `error_code === 'weak_password'` (proven to abort before `db.Transaction` commits). All other `4xx` (`408`, `429`, `400`, gateway errors), `5xx`, timeouts, aborts, and network disconnects remain in `IN_FLIGHT`. During the wait window, if `admin.getUserById(authUserId)` shows `app_metadata.hrms_activation_op_id === opId`, reconciliation completes Phase 3A. If the marker remains absent past the wait window (never treated as proof of failure), reconciliation transitions **`public.users.activation_lock_state = 'QUARANTINED_MANUAL_RECOVERY'`** and **`account_activation_tokens.status = 'INVALIDATED' ('UNCERTAIN_PROVIDER_OUTCOME')`**, emitting `USER_ACTIVATION_QUARANTINED` in `audit_logs` and requiring controlled manual SRE/`SUPER_ADMIN` recovery (`POST /api/v1/admin/users/:userId/clear-activation-quarantine`) before Admin reissue can proceed. **Fully automatic safe retry is NOT technically possible with GoTrue.**
- **Request Payload:**
```json
{
  "organizationCode": "ACME",
  "phoneNumber": "9876543210",
  "activationToken": "<43-char-base64url-256bit-token>",
  "otp": "482910",
  "newPassword": "EmployeePrivatePassword456!"
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "activated": true,
    "message": "Account activated. Please log in with your chosen password."
  }
}
```
- **Failure `400` / `401` (Uniform Anti-Enumeration Payload):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_ACTIVATION_REQUEST",
    "message": "Invalid, expired, or already used activation details. Please verify your entries or contact your administrator."
  }
}
```

#### 2.2.3 Admin Reissue Activation Link / QR (`POST /api/v1/admin/users/:userId/reissue-activation`)
- **Access:** `ADMIN`, `SUPER_ADMIN` (Same-tenant only; `ADMIN` strictly blocked from `SUPER_ADMIN`; caller cannot reissue own account).
- **Behavior:** Re-generates a single-use 256-bit activation token and QR code URL with a URL fragment (`#token=...`) for an employee whose previous link expired (default 24h) or was lost before activation (`activated_at IS NULL`). **User-Lock Guard:** Strictly validates `public.users.activation_lock_state = 'NONE'` under `FOR UPDATE` — immediately rejects (`409 USER_ACTIVATION_QUARANTINED` or `409 ACTIVATION_IN_PROGRESS`) if an earlier GoTrue operation is in-flight or quarantined, preventing any new token or password write while an earlier remote request could still complete. Exposed **only to authenticated, authorized same-tenant administrators**. Automatically invalidates any existing unconsumed `'ACTIVE'` token (`invalidated_at = NOW(), invalidated_reason = 'REISSUED_BY_ADMIN'`). Returns the URL and QR code image payload once to the Admin for out-of-band delivery. Never logs plaintext tokens or hashes in application logs, error trackers, or telemetry. Appends `ACTIVATION_TOKEN_REISSUED` event to `audit_logs` with mandatory `reason`.
- **Request Payload:**
```json
{
  "reason": "Employee requested fresh activation link; previous onboarding token expired."
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "userId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "activationUrl": "https://app.hrms.internal/auth/activate#token=<fresh-43-char-token>",
    "qrCodeDataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...",
    "expiresAt": "2026-11-11T17:30:00.000Z"
  }
}
```

#### 2.2.4 Controlled Quarantine Clear (`POST /api/v1/admin/users/:userId/clear-activation-quarantine`)
- **Access:** `SUPER_ADMIN` / SRE Incident Governance (Same-tenant; strictly blocked from standard `ADMIN` and self-unlock).
- **Behavior:** Clears `public.users.activation_lock_state = 'QUARANTINED_MANUAL_RECOVERY'` -> `'NONE'` **only** after verifying upstream proxy/GoTrue logs confirm the prior stalled request (`activation_lock_op_id`) terminated without committing and `admin.getUserById()` confirms `hrms_activation_op_id` is absent. Requires mandatory `incidentTicket` and `reason` ($\ge 20$ chars); writes immutable `ACTIVATION_QUARANTINE_CLEARED` audit event before permitting Admin reissue.

### 2.3 Password Rotation & Self-Service Mobile OTP Recovery (`PO-03` Approved — 2026-11-10)
*(Employees enter `Organization Code`, registered Indian `Mobile Number`, `OTP`, and `newPassword`; employee-facing flows never request or expose email addresses, `synthetic_email`, or Supabase Auth IDs. Concrete SMS gateway provider/DLT integration remains unresolved under open `DEC-10`, and concrete OTP numeric tuning defaults remain subject to operational confirmation.)*

- **`POST /api/v1/auth/reset-password/request-otp`** *(Public; pre-DB tuple/IP rate-limited, cooldown-gated, and timing-equalized)*
  - **Behavior:** Accepts `{ organizationCode, phoneNumber }`. Normalizes `phoneNumber` server-side per approved `PO-02` (`+91XXXXXXXXXX` only; rejects non-Indian/invalid phone formats with `400 VALIDATION_ERROR`). Enforces pre-DB resend cooldown & throttling buckets keyed via HMAC before inspecting DB eligibility (`o.is_active = TRUE AND u.is_active = TRUE AND u.activated_at IS NOT NULL AND u.phone_verified_at IS NOT NULL`). When eligible and outside cooldown, supersedes any prior unconsumed OTP, persists a CSPRNG OTP strictly as a keyed `HMAC-SHA256` digest in proposed `public.password_reset_otps` (`OTP_HMAC_PEPPER` never stored in DB), dispatches via hexagonal `ISmsOtpDispatcher` (`DEC-10` pending), and appends a non-secret `PASSWORD_RESET_OTP_REQUESTED` audit event.
  - **Response (`202 Accepted` — Identical regardless of organization/phone/verification state, preventing account enumeration):**
    ```json
    {
      "success": true,
      "data": {
        "accepted": true,
        "message": "If the organization code and mobile number match an eligible account, an OTP will be sent shortly."
      }
    }
    ```

- **`POST /api/v1/auth/reset-password/confirm`** *(Public; pre-DB rate-limited and timing-mitigated)*
  - **Behavior:** Accepts `{ organizationCode, phoneNumber, otp, newPassword }`. Authoritatively normalizes `phoneNumber` (`PO-02`) and validates `newPassword` strength. Inside a short (`<5ms`) PostgreSQL transaction (`SECURITY DEFINER`), acquires `FOR UPDATE` on the active OTP row, verifies phone snapshot parity, expiry, and attempt limit, checks keyed HMAC via `crypto.timingSafeEqual` in Express memory, and **atomically burns the single-use OTP (`used_at = NOW()`) before calling GoTrue** (preventing replay and concurrent reuse; failed guesses increment `failed_attempts` and burn permanently at `max_attempts`). Updates the employee's password via `supabaseAdmin.auth.admin.updateUserById(authUserId, { password: newPassword })` (preserving `DEC-09` & `PO-01` Scheme 3; never using Supabase native phone auth), clears `must_change_password = FALSE`, enters `withTenantTransaction(otp.organization_id, ..., otp.user_id)`, calls `issue_tx_challenge()`, signs `p_tx_proof` (`op = 'OTP_REVOKE_ALL'`, `target_id = otpChallengeId`), and invokes `hrms_internal.otp_revoke_all_user_sessions(p_tx_proof, otpChallengeId)` (`hrms_session_manager` validates `p_tx_proof` via `hrms_context_verifier` AND atomically sets `public.password_reset_otps.sessions_revoked_at = NOW()` for a freshly consumed `PASSWORD_RESET_OTP` record before revoking all `user_sessions` and advancing `tokens_valid_after_epoch`) alongside GoTrue global session termination [live-verified in Task `2.2H`], and logs `PASSWORD_RESET_COMPLETED` + `PASSWORD_CHANGE_SESSIONS_REVOKED` without OTPs, passwords, or `synthetic_email`.
  - **Success `200 OK`:** `{ "success": true, "data": { "passwordReset": true, "message": "Your password has been reset. Please log in with your new password." } }` *(Requires subsequent login via `POST /api/v1/auth/login`; zero tokens or internal IDs returned.)*
  - **Failure `400` / `401` (Uniform Anti-Enumeration Payload):** `{ "success": false, "error": { "code": "INVALID_RESET_REQUEST", "message": "Invalid or expired recovery details. Please check your entries or request a new OTP." } }`

- **`POST /api/v1/auth/change-password`** *(Authenticated; full active session)* — Accepts `{ currentPassword, newPassword }`. Express derives acting user strictly from `req.user.authUserId` (`resolveTenantContext`), verifies `currentPassword` against GoTrue before invoking `admin.updateUserById`, obtains `(txXid, challengeNonce)` via `issue_tx_challenge()`, calls `hrms_internal.revoke_own_all_sessions(p_tx_proof, 'PASSWORD_CHANGE', ...)` (`op = 'REVOKE_OWN_ALL'`, `hrms_session_manager`, zero `p_actor_user_id`) + GoTrue global `signOut`, clears any `__Host-hrms_refresh_token` cookie (`Max-Age=0`), requires fresh login across all devices, and logs immutable `PASSWORD_CHANGE` + `PASSWORD_CHANGE_SESSIONS_REVOKED` audit events.
- **`POST /api/v1/auth/first-login-change`** *(Authenticated; allowed when `activated_at IS NOT NULL AND mustChangePassword: true`)* — Rotates password for accounts explicitly flagged for forced rotation prior to unlocking operational attendance/payroll endpoints, performing identical signed global session revocation (`PASSWORD_CHANGE_SESSIONS_REVOKED`) and requiring fresh login.
- **Admin-Assisted Lost-Mobile Recovery Alternative *(Proposed — Operational Approval Workflow NOT Finalized)*:**
  - When an employee loses access to their registered mobile number, Admins **never** create, view, or learn any password. Strict same-tenant RBAC (`ADMIN` blocked from `SUPER_ADMIN` targets; self-reset prohibited) applies. Detailed operational governance—choosing between out-of-band Maker-Checker mobile re-binding followed by standard `PO-03` OTP vs Maker-Checker issuance of a separate 256-bit single-use opaque reset token (`POST /api/v1/admin/users/:userId/reset-password` -> separate 256-bit token confirmation path)—remains an **open, unfinalized operational workflow** awaiting formal sign-off.

### 2.4 Session Refresh, Logout & Verified Identity Context (`PO-05` & `PO-07` Approved — 2026-11-10)
*(Strictly requires verified allowlisted `Origin` + `X-CSRF-Token` on cookie-authenticated endpoints; never returns `refreshToken` in JSON bodies; always omits token internals from errors; enforces `PO-07` multi-device session revocation, `hrms_session_manager` `NOBYPASSRLS` separation, `hrms_context_verifier` transaction-bound signed `p_tx_proof`, and zero caller-supplied `p_actor_user_id`.)*
- **`POST /api/v1/auth/refresh`** *(Cookie-authenticated + CSRF-protected)* — Validates `Origin` against explicit `CORS_ALLOWED_ORIGINS` allowlist (`403 CSRF_ORIGIN_REJECTED` if missing, `null`, malformed, or unlisted) and validates signed `X-CSRF-Token` before reading `__Host-hrms_refresh_token` strictly from the `HttpOnly` cookie (rejects any JSON body refresh token). Computes keyed `HMAC-SHA256`, calls `issue_tx_challenge()` inside a `READ WRITE` transaction, signs `p_tx_proof` (`op = 'LOOKUP_REFRESH_HMAC'`, `target_id = incomingHmac`), and executes `hrms_internal.lookup_session_by_refresh_hmac(p_tx_proof, incomingHmac)` (`hrms_session_manager`). Then enters `withTenantTransaction(orgId, ..., session.user_id)` (`app.current_org_id` + `app.current_user_id` scoped strictly to verified cookie possession), obtains a fresh per-transaction `(txXid, challengeNonce)`, acquires a bounded per-session coordination lock across instances to serialize legitimate concurrent tab refreshes, verifies pre-GoTrue active/non-revoked session state under `FORCE RLS`, and invokes GoTrue rotation (`enable_refresh_token_rotation = true`; GoTrue and PostgreSQL are non-atomic). On success after verifying new JWT `sub === session.user_id`, executes `hrms_internal.rotate_user_session(rotateTxProof, ...)`, emits the rotated cookie, appends `SESSION_REFRESHED` to `audit_logs`, and returns JSON `{ tokens: { accessToken, expiresIn: 900, tokenType: "Bearer" } }` (**zero `refreshToken` in JSON**). On detected token reuse (stale outside grace window or GoTrue reuse failure), calls `hrms_internal.revoke_compromised_session_family(revokeTxProof, ...)` revoking **only that compromised token family** (`user_sessions.revoked_at = NOW(), revoked_reason = 'REFRESH_REUSE_DETECTED'`, inserts `gotrue_session_id` into `revoked_sessions`, leaves sibling healthy device sessions active and `tokens_valid_after_epoch` untouched), clears `__Host-hrms_refresh_token` (`Max-Age=0`), logs `REFRESH_TOKEN_REUSE_DETECTED` to `audit_logs`, and returns uniform `401 INVALID_REFRESH_SESSION`.
- **`POST /api/v1/auth/logout`** *(Cookie/CSRF + `Origin`-protected)* — Validates `Origin` + `X-CSRF-Token`, resolves verified cookie session via `lookup_session_by_refresh_hmac(p_tx_proof, incomingHmac)` (and verified JWT when present), enters `withTenantTransaction(orgId, ..., verifiedUserId)`, obtains fresh `(txXid, challengeNonce)` + signed `p_tx_proof`, and accepts `{ scope: "local" | "global" }`:
  - `scope: "local"`: Calls `hrms_internal.revoke_user_session(p_tx_proof, sessionId, jwtExp)` (`op = 'REVOKE_SESSION'`) revoking strictly the current cookie session (`'USER_REVOKED_SESSION'`, inserts `gotrue_session_id` into `revoked_sessions`, never advances `tokens_valid_after_epoch`), invokes GoTrue `admin.signOut(..., 'local')`, clears `__Host-hrms_refresh_token` (`Max-Age=0`), and logs `SESSION_REVOKED` without disturbing sibling devices.
  - `scope: "global"`: Calls `hrms_internal.revoke_own_all_sessions(p_tx_proof, 'USER_GLOBAL_LOGOUT', ...)` (`op = 'REVOKE_OWN_ALL'`) marking **all** active `user_sessions` for that calling user revoked, advancing `tokens_valid_after_epoch`, inserting current `gotrue_session_id` into `revoked_sessions`, invoking GoTrue global `signOut`, clearing `__Host-hrms_refresh_token` (`Max-Age=0`), and logging `ALL_SESSIONS_REVOKED`.
- **`GET /api/v1/auth/me`** *(Authenticated via `Authorization: Bearer <accessToken>` ONLY)* — Does not consume refresh cookies or rotate tokens; executes `resolveTenantContext` Step 1 (`resolve_auth_user_tenant(sub)` -> `withTenantTransaction` setting `app.current_org_id` + `app.current_user_id` post-JWT verification -> `issue_tx_challenge()` + signed `p_tx_proof` `op = 'VERIFY_SESSION'`) -> Step 2 (`verify_authenticated_session_and_roles(p_tx_proof, session_id, iat)` under `hrms_session_manager` `FORCE RLS` + `hrms_context_verifier`), updates `last_activity_at` (debounced `>= 60s`), and returns verified authenticated context derived strictly from verified access JWT `sub` and DB tenant resolution (never exposes internal `synthetic_email`, passwords, or refresh tokens, and never trusts browser `x-organization-id` headers).

### 2.5 Concurrent Device Session Management (`PO-07` Approved — 2026-11-10; Tasks 2.2B.9A–C Hardened)
*(Phase 1 allows simultaneous login across multiple devices with zero arbitrary device cap. Every endpoint below sets `app.current_org_id` and `app.current_user_id` ONLY via `requireAuth` (`verifySupabaseToken`) -> `resolveTenantContext`, obtains a single-use `pg_current_xact_id()` + `challenge_nonce` via `issue_tx_challenge()`, invokes `hrms_session_manager` (`NOLOGIN NOBYPASSRLS`) routines with **signed `p_tx_proof` (`hrms_context_verifier`) and zero caller-supplied `p_actor_user_id`** under `FORCE RLS`, re-verifies actor org membership and `user_roles` in DB, and **never** trusts browser `x-organization-id`/`userId` headers or exposes refresh tokens, HMAC digests, access tokens, `synthetic_email`, or raw GoTrue session internals.)*

- **`GET /api/v1/auth/sessions`** *(Authenticated Employee / Admin / Super Admin — Own Sessions Only)*
  - **Behavior:** Invokes `hrms_internal.list_active_user_sessions(p_tx_proof, currentGotrueSessionId)` (`op = 'LIST_SESSIONS'`, `target_id = verifiedUserId`), which validates `p_tx_proof`, derives actor strictly from verified `public.auth_user_id()` inside `public.current_org_id()`, re-verifies active user/org membership in DB, and returns active unrevoked sessions (`revoked_at IS NULL AND expires_at > NOW()`) ordered by `lastActivityAt DESC`. An employee can never inspect another user's sessions.
  - **Response `200 OK`:**
    ```json
    {
      "success": true,
      "data": {
        "sessions": [
          {
            "id": "sess-uuid-1",
            "isCurrent": true,
            "deviceSummary": "Chrome 141 · Android",
            "approximateIp": "203.0.113.0/24",
            "createdAt": "2026-11-10T09:15:00.000Z",
            "lastActivityAt": "2026-11-10T18:40:12.000Z",
            "expiresAt": "2026-11-17T09:15:00.000Z"
          }
        ]
      }
    }
    ```

- **`DELETE /api/v1/auth/sessions/:sessionId`** *(Authenticated Employee / Admin / Super Admin — Own Individual Session)*
  - **Behavior:** Invokes `hrms_internal.revoke_user_session(p_tx_proof, sessionId, jwtExp)` (`op = 'REVOKE_SESSION'`, `target_id = sessionId`) validating `p_tx_proof` and deriving actor strictly from verified `public.auth_user_id()` inside `public.current_org_id()` (`404 SESSION_NOT_FOUND` if missing, already revoked, or owned by another user/tenant). Marks only that single `user_sessions` row revoked (`'USER_REVOKED_SESSION'`, `revoked_by_user_id = v_actor_id`) and inserts its `gotrue_session_id` into `public.revoked_sessions` **without advancing `tokens_valid_after_epoch` or affecting the employee's other active sessions**. If `isCurrent` is `true`, invokes `admin.signOut(currentJwt, 'local')` and clears `__Host-hrms_refresh_token` (`Max-Age=0`). Appends `SESSION_REVOKED` to `audit_logs`.
  - **Response `200 OK`:** `{ "success": true, "data": { "revokedSessionId": "sess-uuid-2", "isCurrent": false, "message": "Session revoked." } }`

- **`POST /api/v1/auth/sessions/revoke-all`** *(Authenticated Employee / Admin / Super Admin — Sign Out All Own Devices)*
  - **Behavior:** Invokes `hrms_internal.revoke_own_all_sessions(p_tx_proof, 'USER_GLOBAL_LOGOUT', currentGotrueSessionId, jwtExp)` (`op = 'REVOKE_OWN_ALL'`, `target_id = verifiedUserId`) validating `p_tx_proof` and deriving target strictly from verified `public.auth_user_id()` inside `public.current_org_id()` (zero target user parameter). Atomically revokes **all** non-revoked own `user_sessions`, advances `public.users.tokens_valid_after_epoch`, inserts caller's `gotrue_session_id` into `public.revoked_sessions`, invokes GoTrue global revocation (`admin.signOut(currentJwt, 'global')`), clears `__Host-hrms_refresh_token` (`Max-Age=0`), and appends `ALL_SESSIONS_REVOKED` to `audit_logs`. Requires fresh `POST /api/v1/auth/login` across all devices.
  - **Response `200 OK`:** `{ "success": true, "data": { "revokedCount": 3, "message": "All active sessions have been signed out." } }`

- **`POST /api/v1/admin/users/:userId/sessions/revoke-all`** *(Authorized Same-Tenant `ADMIN` / `SUPER_ADMIN` Only)*
  - **Authorization Rules:** Express and `hrms_internal.admin_revoke_all_user_sessions(p_tx_proof, targetUserId, 'ADMIN_REVOKED_ALL')` (`op = 'ADMIN_REVOKE_ALL'`, `target_id = targetUserId`) validate `p_tx_proof` (`hrms_context_verifier`), derive the acting administrator strictly from verified `public.auth_user_id()` inside `public.current_org_id()` (never caller `p_actor_user_id`), re-verify actor active org/user membership and `public.user_roles` role (`ADMIN` or `SUPER_ADMIN`), enforce target `targetUserId` same-tenant membership, and **strictly block standard `ADMIN` from revoking a `SUPER_ADMIN` user's sessions (`403 FORBIDDEN` / `SQLSTATE 42501`)**; requires mandatory `reason` ($\ge 10$ characters). *(Interactive Admin deactivation uses the same signed proof + hierarchy check with `'ACCOUNT_DEACTIVATED'`; OTP recovery uses signed `otp_revoke_all_user_sessions` verified against fresh single-use `password_reset_otps.sessions_revoked_at IS NULL`.)*
  - **Behavior:** Marks all non-revoked `user_sessions` for `targetUserId` revoked (`revoked_by_user_id = v_actor_id`), advances target user's `tokens_valid_after_epoch` (immediately blocking all active access JWTs across all target devices in `resolveTenantContext`), triggers GoTrue session termination (live verification of Admin global signout/ban behavior in Task `2.2H`), and appends `ADMIN_SESSIONS_REVOKED` to `audit_logs`.
  - **Request Payload:** `{ "reason": "Employee reported lost company phone; preclear all active sessions." }`
  - **Response `200 OK`:** `{ "success": true, "data": { "targetUserId": "u-uuid-2", "revokedCount": 2, "message": "All sessions for the selected user have been revoked." } }`

---

## 3. Smart Attendance Endpoints

### 3.1 Standard Office Check-In (Geofenced + Selfie Verification — ALL Employees)
- **Endpoint:** `POST /api/v1/attendance/check-in`
- **Access:** `EMPLOYEE` *(Mandatory for ALL employees—including Sales Team members—when attending the office. Outside-geofence punches never auto-convert to field attendance.)*
- **Content-Type:** `multipart/form-data`
- **Request Fields:**
  - `latitude`: `17.439929` (Numeric)
  - `longitude`: `78.376822` (Numeric)
  - `accuracyMeters`: `12.5` (Numeric)
  - `deviceTimestamp`: `2026-11-07T10:04:12.000Z` (ISO8601)
  - `selfie`: Binary JPEG/WebP image file
- **Business Logic:**
  1. **DEC-02 Single Session Guard:** Check if `attendance_days` record exists for `(employee_id, today)`. If `first_check_in_at IS NOT NULL`, immediately reject with HTTP 409 Conflict:
     ```json
     {
       "success": false,
       "error": {
         "code": "ATTENDANCE_ALREADY_CHECKED_IN",
         "message": "Employee has already checked in for today. Under DEC-02, multiple daily check-ins are not supported."
       }
     }
     ```
  2. Validate GPS accuracy $\le 30\text{m}$ (if $> 30\text{m}$, reject `422 GPS_ACCURACY_INSUFFICIENT` prompting employee to retry).
  3. Evaluate GPS anti-spoofing rules (server-authoritative timestamp, velocity/anomaly checks; reject or flag suspected spoofing per Security §3.1/§3.3).
  4. Compute Haversine distance to assigned office coordinates and validate $\le \text{office.geofence\_radius\_meters}$ (`100m` legacy baseline; **proposed `50m` pending formal PO approval under `PO-ATT-GEOFENCE-50M`**). Reject outside-perimeter attempts with `422 GEOFENCE_VIOLATION`.
  5. Invoke `IFaceVerificationProvider.verifyFace(selfie, employee.referenceId)` + live camera liveness verification.
  6. **Automatic Approval Condition:** ONLY when **both** office geofence verification and face/liveness verification pass (match score $\ge 0.85$ and liveness verified):
     - Atomically insert `attendance_event` (`CHECK_IN`, `VERIFIED`). Database constraint `UNIQUE(attendance_day_id, event_type)` ensures idempotent protection against retry race conditions.
     - Upsert `attendance_days` record for today (`first_check_in_at`).
     - If time $> 10:10\text{ AM}$, mark `is_late: true` (descriptive only, zero fine).
  7. If face match fails: Increment attempt count. On the 3rd failed attempt, set `verification_status: PENDING_REVIEW` (`Verification Pending`), retain failed probe evidence in private storage bucket, and notify Admin. `Verification Pending` is **not** attendance approval, yields **0 payable attendance credit**, and requires successful identity verification via an authorized Admin-supervised process before attendance can be credited. Offline submissions (`is_offline_sync: true`) also route strictly to `PENDING_REVIEW`.
- **Response `200 OK` (Verified):**
```json
{
  "success": true,
  "data": {
    "status": "VERIFIED",
    "checkInTime": "2026-11-07T10:04:15.000Z",
    "isLate": false,
    "distanceMeters": 24.2,
    "message": "Check-in successful. Welcome to work!"
  }
}
```

### 3.2 Standard Office Check-Out (Geofenced + Selfie Verification — ALL Employees)
- **Endpoint:** `POST /api/v1/attendance/check-out`
- **Access:** `EMPLOYEE` *(Mandatory for ALL employees—including Sales Team members—when checking out from the office.)*
- **Content-Type:** `multipart/form-data`
- **Request Fields:**
  - `latitude`: `17.439930`
  - `longitude`: `78.376820`
  - `accuracyMeters`: `8.2`
  - `deviceTimestamp`: `2026-11-07T18:05:00.000Z`
  - `selfie`: Binary JPEG file
- **Business Logic & Deterministic Evaluation Order:**
  1. **Step 1: Check-Out Already Exists Guard:** If `last_check_out_at IS NOT NULL` on `attendance_days`, immediately reject with HTTP 409 Conflict:
     ```json
     {
       "success": false,
       "error": {
         "code": "ATTENDANCE_ALREADY_COMPLETED",
         "message": "Attendance for today is already completed. Multiple daily check-outs are not permitted under DEC-02."
       }
     }
     ```
  2. **Step 2: Missing Check-In Guard:** If no `attendance_days` record exists or `first_check_in_at IS NULL`, immediately reject with HTTP 409 Conflict:
     ```json
     {
       "success": false,
       "error": {
         "code": "CHECK_OUT_WITHOUT_CHECK_IN",
         "message": "Cannot check out without an active, verified check-in for today."
       }
     }
     ```
     *Note on Unpaired Check-Outs:* Normal employee check-out attempts without a valid check-in are strictly rejected here. An unpaired check-out can never be submitted via this endpoint; it can only arise through exceptional administrative manual entry, legacy import, or system recovery. All such records are flagged with `requires_admin_review = true` and yield 0 payable minutes until resolved by an Admin.
  3. **Step 3: Verification & Execution:** Verify GPS accuracy $\le 30\text{m}$ (retry otherwise), anti-spoofing rules, office geofence ($\le \text{office.geofence\_radius\_meters}$: `100m` legacy baseline / **proposed `50m` pending formal PO approval**; outside-geofence punches rejected), and selfie liveness + 1:1 face match (both geofence and biometric checks must pass for auto-approval).
  4. Atomically insert `attendance_event` (`CHECK_OUT`, `VERIFIED`). Database constraint `UNIQUE(attendance_day_id, event_type)` ensures idempotent protection against retry race conditions.
  5. Calculate payable working minutes via Amended DEC-01 Paid Lunch formulation:
     - Gross Elapsed Working Minutes = `CheckOut - CheckIn`.
     - Approved Actual Working Minutes = Elapsed Minutes - Unapproved Post-18:00 Minutes.
     - Paid Lunch Minutes = 60 minutes (Paid lunch credited on scheduled working days with qualifying attendance; **not deducted**; full-day absence receives 0m under proposed default `UNASSIGNED-PO-ABSENCE-LUNCH`, and partial attendance is governed by open decision `UNASSIGNED-PO-LUNCH-ELIGIBILITY`).
     - Payable Working Minutes = Approved Actual Working Minutes + Paid Lunch Minutes.
  6. If check-out $< 17:50\text{ PM}$, mark `is_early_departure: true`. Update `attendance_days` record (`last_check_out_at`, `net_payable_minutes`).
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "status": "VERIFIED",
    "checkOutTime": "2026-11-07T18:05:00.000Z",
    "grossElapsedMinutes": 481,
    "approvedActualWorkingMinutes": 420,
    "paidLunchMinutes": 60,
    "netPayableMinutes": 480,
    "netPayableHours": 8.0,
    "isEarlyDeparture": false,
    "pendingPost18Minutes": 5,
    "lunchCalculationRule": "DEC-01 Amended Paid Lunch Policy (60m Credit)",
    "sessionPolicy": "DEC-02 Single Daily Attendance Pair",
    "message": "Check-out successful. Attendance completed for today!"
  }
}
```

### 3.3 Admin Attendance Review & Corrections
- **Endpoint:** `GET /api/v1/attendance/pending-reviews`
- **Access:** `ADMIN`, `SUPER_ADMIN`
- **Query Params:** `officeId`, `date`, `status`
- **Endpoint:** `POST /api/v1/attendance/corrections`
- **Access:** `ADMIN`, `SUPER_ADMIN` (Strictly prohibited for `EMPLOYEE`)
- **Request Payload:**
```json
{
  "employeeId": "emp-uuid-1",
  "attendanceDate": "2026-11-06",
  "actionType": "CHECK_OUT",
  "correctedTimestamp": "2026-11-06T18:00:00.000Z",
  "reason": "Employee device battery died before checkout; verified via office exit CCTV."
}
```
- **Business Logic:**
  1. Validate caller identity has `ADMIN` or `SUPER_ADMIN` role.
  2. Validate `reason` is present and non-empty (minimum 10 characters).
  3. Snapshot existing attendance day state into `previous_state` JSON.
  4. Apply timestamp correction and recompute approved actual working minutes, 60-minute paid lunch credit, and net payable minutes for the single daily interval.
  5. Insert immutable record into `attendance_corrections` with acting `created_by` (Admin UUID), `previous_state`, and `updated_state`.
  6. Preserve original attendance events and evidence without modification or deletion.
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "correctionId": "corr-uuid-1",
    "employeeId": "emp-uuid-1",
    "attendanceDate": "2026-11-06",
    "correctedTimestamp": "2026-11-06T18:00:00.000Z",
    "approvedActualWorkingMinutes": 420,
    "paidLunchMinutes": 60,
    "netPayableMinutes": 480,
    "netPayableHours": 8.0,
    "reason": "Employee device battery died before checkout; verified via office exit CCTV.",
    "correctedBy": "admin-user-uuid",
    "correctedAt": "2026-11-07T09:15:00.000Z"
  }
}
```

### 3.4 Sales Team Field Attendance Exception Endpoints *(PROPOSED — Pending `PO-ATT-FIELD-SALES`)*

#### 3.4.1 Submit Field Attendance Request (Sales Team ONLY — Explicit `CHECK_IN` or `CHECK_OUT`)
- **Endpoint:** `POST /api/v1/attendance/field-requests`
- **Access:** `EMPLOYEE` *(Server strictly checks `employees.department_id -> departments.allow_field_attendance = TRUE`. Normal non-Sales employees never see this screen and receive `403 FIELD_ATTENDANCE_NOT_ELIGIBLE` if invoked directly.)*
- **Content-Type:** `multipart/form-data` + required `Idempotency-Key` header
- **Request Fields (Both Field `CHECK_IN` and Field `CHECK_OUT` Must Submit Complete Evidence Independently):**
  - `requestType`: `"CHECK_IN"` | `"CHECK_OUT"` *(Required explicit enum; DEC-02 limits each field-work day to max 1 `CHECK_IN` and 1 `CHECK_OUT`)*
  - `latitude`: `17.482104` (Numeric — captured at customer/field site)
  - `longitude`: `78.391455` (Numeric — captured at customer/field site)
  - `accuracyMeters`: `14.0` (Numeric — must satisfy $\le 30.0\text{m}$; $> 30\text{m}$ rejected `422 GPS_ACCURACY_INSUFFICIENT`)
  - `deviceTimestamp`: `2026-11-10T10:08:00.000Z` (ISO8601)
  - `comment`: `"Client product demo at Banjara Hills regional showroom"` (Mandatory non-empty explanation $\ge 10$ trimmed chars required separately on both `CHECK_IN` and `CHECK_OUT`; `422` if missing/blank)
  - `selfie`: Live camera JPEG/WebP capture required separately on both `CHECK_IN` and `CHECK_OUT` (gallery/file picker uploads rejected)
- **Business Logic:**
  1. **Sales Eligibility Gate:** Reject non-Sales employees (`403 FIELD_ATTENDANCE_NOT_ELIGIBLE`). Do **not** evaluate the 50m office geofence pass/fail rejection rule.
  2. **DEC-02 Conflict, Duplicate & Check-In-Before-Check-Out Rules:**
     - Reject (`409 ATTENDANCE_ALREADY_CHECKED_IN` / `ATTENDANCE_ALREADY_COMPLETED` / `FIELD_ATTENDANCE_ALREADY_PENDING`) if an active `attendance_events` row or `PENDING_REVIEW`/`APPROVED` field request already exists for `(employeeId, serverDate, requestType)` (`uq_field_req_active_emp_day_type`).
     - Enforce **check-in-before-check-out**: if `requestType === "CHECK_OUT"` and neither an existing `CHECK_IN` in `attendance_events` nor an active `PENDING_REVIEW`/`APPROVED` `CHECK_IN` field request exists for today, immediately reject (`409 CHECK_OUT_WITHOUT_CHECK_IN`).
  3. **GPS Accuracy, Telemetry Preservation & Anti-Spoofing:** Require `accuracyMeters <= 30.0`. Calculate true Haversine `distanceFromOfficeMeters` against assigned office coordinates and store both raw coordinates and factual `isWithinOfficeGeofence` (`false` when outside perimeter — **never discarded or falsified**). Apply impossible-travel / spoof checks (`is_spoof_suspected`).
  4. **Mandatory Biometric Gate & 3-Attempt `Verification Pending` Rule:** Enforce live camera liveness verification + 1:1 face matching (max 3 consecutive automated attempts). Attempts 1–2 failing face match or liveness failures return `422` prompting retry. On the 3rd failed face attempt, preserve the **`Verification Pending`** rule by storing the probe evidence in private Supabase Storage bucket `attendance-evidence`, setting `biometricVerified = false` (`status = 'PENDING_REVIEW'`), and notifying Admin. **`Verification Pending` is NOT attendance approval, grants zero attendance/payable credit, and CANNOT be approved by Admin.**
  5. **Strict Pending State (Zero Auto-Approval):** Create `field_attendance_requests` with `status = 'PENDING_REVIEW'`. Does **not** create an `attendance_events` row and does **not** mark employee `Present`.
- **Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "requestId": "far-uuid-1",
    "requestType": "CHECK_IN",
    "status": "PENDING_REVIEW",
    "attendanceDate": "2026-11-10",
    "serverTimestamp": "2026-11-10T10:08:02.000Z",
    "distanceFromOfficeMeters": 8420.5,
    "isWithinOfficeGeofence": false,
    "biometricVerified": true,
    "message": "Field attendance request submitted for Admin review."
  }
}
```

#### 3.4.2 View Own Field Attendance Requests (Sales Team Self-View)
- **Endpoint:** `GET /api/v1/attendance/field-requests/my`
- **Access:** `EMPLOYEE` *(Sales Team members view own `CHECK_IN` / `CHECK_OUT` request statuses `PENDING_REVIEW` / `APPROVED` / `REJECTED`, biometric verification status, comment, rejection reason, and submission timestamp; zero public image URLs).*

#### 3.4.3 Admin Review Queue & Independent Decision (`APPROVE` / `REJECT`)
- **Queue Endpoint:** `GET /api/v1/attendance/field-requests`
- **Access:** `ADMIN`, `SUPER_ADMIN` *(Each `CHECK_IN` and `CHECK_OUT` request appears as an independent review item; same-tenant RLS scoped; filters: `status`, `requestType`, `date`, `employeeId`, `officeId`)*
- **Returned Inspection Context:** Employee identity & verified Sales department, `requestType` (`CHECK_IN` / `CHECK_OUT`), employee `comment`, 15-minute `createSignedUrl` token for private selfie + enrollment reference comparison (logged to `audit_logs`), `livenessScore` / `faceMatchConfidence` / `isLivenessVerified` / `biometricVerified` / `verificationAttemptCount` flags, captured field `(latitude, longitude)`, `accuracyMeters`, `distanceFromOfficeMeters`, `serverTimestamp`, spoof flags, and **existing `attendance_days` / `attendance_events` records for `(employeeId, attendanceDate)`**.
- **Decision Endpoint:** `POST /api/v1/attendance/field-requests/:requestId/review`
- **Access:** `ADMIN`, `SUPER_ADMIN` *(Prohibited for `EMPLOYEE`; Admins cannot review their own field request)*
- **Request Payload:**
```json
{
  "decision": "APPROVED",
  "remarks": "Verified customer visit schedule with regional manager.",
  "rejectionReason": null
}
```
*(When `"decision": "REJECTED"`, non-empty `rejectionReason` of $\ge 10$ characters is mandatory -> `422` otherwise.)*
- **Reconciliation, Biometric Lock & Payroll Integrity Rules:**
  1. Executes inside transaction acquiring `FOR SHARE` on covering `payroll_periods` (rejects `409 PAYROLL_PERIOD_LOCKED` if `is_closed = TRUE`) and `FOR UPDATE` on `attendance_days` + `field_attendance_requests`.
  2. **Strict Biometric Approval Lock (`APPROVE` Forbidden on Failed Verification):** If `decision === "APPROVED"` and (`!isLivenessVerified` OR `!biometricVerified`), immediately reject with **`422 BIOMETRIC_VERIFICATION_REQUIRED`** (also enforced by PostgreSQL `chk_field_req_approve_requires_biometrics`). `Verification Pending` grants **zero** attendance/payable credit; failed biometric verification requires **successful identity verification through an authorized Admin-supervised process** before any attendance can be credited.
  3. **On `APPROVE`:** Enforces DEC-02 independently per `request_type`: verifies no existing `attendance_events` conflicts on `(attendance_day_id, request_type)` (rejects `409` rather than overwriting immutable raw events) and requires a verified `CHECK_IN` event in `attendance_events` before approving `CHECK_OUT` (`409 CHECK_OUT_WITHOUT_CHECK_IN` if morning `CHECK_IN` is not yet verified/approved). Marks request `APPROVED` (`reviewed_by`, `reviewed_at`), creates **exactly one** corresponding immutable `attendance_events` row (`is_field_attendance = true`, `is_within_geofence = false`, preserving actual field coordinates and request's original `server_timestamp`), attaches existing `attendance_evidence` row to the event, recomputes `attendance_days` using the **standard working-hour/payroll engine only** (zero separate field attendance calculation or payroll mechanism), and appends `audit_logs`.
  4. **On `REJECT`:** Marks request `REJECTED` (`reviewed_by`, `reviewed_at`, `rejection_reason`), appends `audit_logs`, creates **zero** `attendance_events`, and leaves `attendance_days` to normal attendance resolution rules (does **not** automatically force `ABSENT` if another valid office punch, Admin correction, or approved leave exists).

---

## 4. Biometric Face Enrollment Endpoints

### 4.1 Admin-Supervised Face Enrollment
- **Endpoint:** `POST /api/v1/biometrics/enroll`
- **Access:** `ADMIN`, `SUPER_ADMIN`
- **Content-Type:** `multipart/form-data`
- **Payload:** `employeeId`, `referencePhoto` (JPEG), `consentAcknowledged: true`
- **Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "enrollmentId": "bio-uuid-1",
    "employeeId": "emp-uuid-1",
    "qualityScore": 0.98,
    "isApproved": true,
    "message": "Biometric face reference enrolled and activated."
  }
}
```

---

## 5. Leave Management Endpoints

### 5.1 Employee Leave Application
- **Endpoint:** `POST /api/v1/leaves/apply`
- **Access:** `EMPLOYEE`
- **Payload:**
```json
{
  "leaveTypeCode": "CL",
  "startDate": "2026-11-12",
  "endDate": "2026-11-12",
  "totalDays": 1.0,
  "reason": "Family function"
}
```
- **Business Rule Check:** Checks available balance. Note: Reminds employee that under current company policy, CL/SL/PL days contribute 0 payable hours and 0 salary.

### 5.2 Admin Leave Review
- **Endpoint:** `PUT /api/v1/leaves/:applicationId/review`
- **Access:** `ADMIN`, `SUPER_ADMIN`
- **Payload:**
```json
{
  "status": "APPROVED",
  "remarks": "Approved as per team schedule."
}
```

---

## 6. Payroll Engine Endpoints

### 6.1 Preview/Compile Monthly Payroll Batch
- **Endpoint:** `POST /api/v1/payroll/compile-batch`
- **Access:** `ADMIN`, `SUPER_ADMIN`
- **Payload:**
```json
{
  "year": 2026,
  "month": 11
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "payrollPeriod": {
      "year": 2026,
      "month": 11,
      "calendarDays": 30,
      "standardMonthlyHours": 240.0,
      "standardMonthlyMinutes": 14400
    },
    "batchSummary": {
      "totalEmployees": 10,
      "totalGrossPaise": 25000000,
      "totalNetPaise": 25000000
    },
    "items": [
      {
        "employeeCode": "EMP001",
        "name": "Rahul Sharma",
        "monthlySalaryReference": 25000.00,
        "calendarDays": 30,
        "dailyRate": 833.333333,
        "hourlyRate": 104.166667,
        "approvedPayableHours": 240.0,
        "paidSundaysHours": 32.0,
        "paidHolidaysHours": 8.0,
        "earnedSalary": 25000.00,
        "allowances": 0.00,
        "deductions": 0.00,
        "netSalary": 25000.00
      }
    ]
  }
}
```
*Note on Precision:* Monetary amounts (`totalGrossPaise`, `totalNetPaise`, `monthlySalaryReference`, `earnedSalary`, `netSalary`) are stored as exact 64-bit integer paise (`BIGINT`). Derived rates (`dailyRate`, `hourlyRate`) are fractional values reported with `NUMERIC(14,6)` decimal precision for payslip display. However, `NUMERIC(14,6)` is not exact rational arithmetic; authoritative accumulated earnings calculation evaluates exact rational numerator/denominator arithmetic: $\text{segment\_earnings\_paise} = \frac{\text{payable\_minutes} \times \text{salary\_reference\_paise}}{\text{calendar\_days} \times 480}$, summed unrounded across DEC-15 segments and rounded once to integer paise. Calendar days are strictly validated against the actual payroll period and never use a static 30-day default. At the database tier, referential integrity and tenant safety of calendar days across `payroll_periods`, `payroll_runs`, and `payroll_items` are enforced declaratively via chained tenant-safe composite foreign keys. Final net settlement rounding is an open decision under `DEC-05` (Net Salary Rounding Rule).
```

### 6.2 Submit Payroll Batch for Approval
- **Endpoint:** `POST /api/v1/payroll/runs/:runId/submit`
- **Access:** `ADMIN`
- **State Transition:** `DRAFT` $\rightarrow$ `SUBMITTED_FOR_APPROVAL`

### 6.3 Super Admin Batch Approval / Rejection
- **Endpoint:** `POST /api/v1/payroll/runs/:runId/approve`
- **Access:** `SUPER_ADMIN` (Exclusively)
- **Business Effect:** Locks payroll batch as immutable, generates official payslips, and publishes them to employees.

### 6.4 Record Disbursement Payment
- **Endpoint:** `POST /api/v1/payroll/items/:payrollItemId/payment`
- **Access:** `ADMIN`, `SUPER_ADMIN`
- **Payload:**
```json
{
  "paymentStatus": "PAID",
  "paymentMode": "NEFT",
  "paymentDate": "2026-12-02",
  "transactionReference": "NEFT1982736412",
  "amountPaidPaise": 2464300,
  "remarks": "Salary credited successfully."
}
```
