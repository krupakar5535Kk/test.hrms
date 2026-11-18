/**
 * Controlled Initial Admin Provisioning Script (CLI Only — Never a public route or default seed)
 *
 * Usage:
 *   ORG_CODE=ORG001 ADMIN_PHONE=+919876543210 ADMIN_PASSWORD='<strong-secret>' ADMIN_NAME='Organization Admin' \
 *   npx tsx server/scripts/provision-admin.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  buildSyntheticEmail,
  normalizeIndianMobile,
} from '../src/services/hrmsDomain.js';
import {
  adminCreateGoTrueUser,
  adminUpdateGoTrueUser,
} from '../src/services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const p of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(__dirname, '../.env'),
]) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

async function main() {
  const orgCode = (process.env['ORG_CODE'] ?? 'ORG001').trim().toUpperCase();
  const rawPhone = process.env['ADMIN_PHONE'] ?? '';
  const adminPassword = process.env['ADMIN_PASSWORD'] ?? '';
  const adminName = (process.env['ADMIN_NAME'] ?? 'Organization Admin').trim();
  const dbAdminUrl =
    process.env['ADMIN_PROVISION_DB_URL'] ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

  const mobile = normalizeIndianMobile(rawPhone);
  if (!mobile) {
    console.error('ERROR: Provide valid Indian mobile via ADMIN_PHONE (e.g., +919876543210)');
    process.exit(1);
  }
  if (!adminPassword || adminPassword.length < 8) {
    console.error('ERROR: Provide ADMIN_PASSWORD (minimum 8 characters)');
    process.exit(1);
  }

  const pgPool = new pg.Pool({ connectionString: dbAdminUrl });

  try {
    const orgRes = await pgPool.query<{ id: string; name: string }>(
      'SELECT id, name FROM public.organizations WHERE organization_code = $1 LIMIT 1;',
      [orgCode]
    );
    const org = orgRes.rows[0];
    if (!org) {
      throw new Error(`Organization code '${orgCode}' not found in public.organizations`);
    }

    const existingUser = await pgPool.query<{ id: string; synthetic_email: string }>(
      'SELECT id, synthetic_email FROM public.users WHERE organization_id = $1 AND phone_number = $2 LIMIT 1;',
      [org.id, mobile.canonicalE164]
    );

    if (existingUser.rows[0]) {
      const uid = existingUser.rows[0].id;
      await adminUpdateGoTrueUser(uid, {
        password: adminPassword,
        appMetadata: {
          role: 'ADMIN',
          organization_id: org.id,
          organization_code: orgCode,
        },
        userMetadata: { full_name: adminName },
      });
      await pgPool.query(
        `UPDATE public.users
         SET is_active = TRUE, activated_at = COALESCE(activated_at, NOW()),
             phone_verified_at = COALESCE(phone_verified_at, NOW()),
             must_change_password = FALSE
         WHERE id = $1;`,
        [uid]
      );
      await pgPool.query(
        `INSERT INTO public.user_roles (organization_id, user_id, role, assigned_by)
         VALUES ($1, $2, 'ADMIN', NULL)
         ON CONFLICT (organization_id, user_id, role) DO NOTHING;`,
        [org.id, uid]
      );
      console.log(`Updated existing Admin account cleanly (${orgCode} / ${mobile.canonicalE164}, userId=${uid}). Note: Zero public.employees row created.`);
      return;
    }

    const userId = crypto.randomUUID();
    const syntheticEmail = buildSyntheticEmail(userId, org.id);

    await adminCreateGoTrueUser({
      id: userId,
      syntheticEmail,
      password: adminPassword,
      appMetadata: {
        role: 'ADMIN',
        organization_id: org.id,
        organization_code: orgCode,
      },
      userMetadata: { full_name: adminName },
    });

    await pgPool.query('BEGIN');
    await pgPool.query(
      `INSERT INTO public.users (
         id, organization_id, phone_number, synthetic_email,
         is_active, must_change_password, activated_at, phone_verified_at
       ) VALUES ($1, $2, $3, $4, TRUE, FALSE, NOW(), NOW());`,
      [userId, org.id, mobile.canonicalE164, syntheticEmail]
    );
    await pgPool.query(
      `INSERT INTO public.user_roles (organization_id, user_id, role, assigned_by)
       VALUES ($1, $2, 'ADMIN', NULL);`,
      [org.id, userId]
    );
    await pgPool.query(
      `INSERT INTO public.audit_logs (organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
       VALUES ($1, $2, 'ADMIN', 'ADMIN_ACCOUNT_PROVISIONED', 'USER', $2, 'Initial Admin provisioned via CLI script (strictly excluded from employees).');`,
      [org.id, userId]
    );
    await pgPool.query('COMMIT');

    console.log(`Provisioned Admin successfully (${orgCode} / ${mobile.canonicalE164}, userId=${userId}).`);
  } catch (err) {
    await pgPool.query('ROLLBACK').catch(() => {});
    console.error('Admin provisioning failed:', err);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
}

void main();
