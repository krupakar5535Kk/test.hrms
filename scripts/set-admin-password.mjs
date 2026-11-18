#!/usr/bin/env node
/**
 * scripts/set-admin-password.mjs
 * 
 * Direct administrative utility to establish or update the Primary Admin password
 * for KMACCS (ORG001 / +917816029162) on Cloud Supabase (HRMS-PAYROLL-5535).
 * 
 * Usage:
 *   node scripts/set-admin-password.mjs <your-new-password>
 *   node scripts/set-admin-password.mjs
 */

import readline from 'node:readline';
import { Pool } from 'pg';

const DB_HOST = process.env.DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com';
const DB_PORT = parseInt(process.env.DB_PORT || '6543', 10);
const DB_USER = process.env.DB_USER || 'hrms_app_user.klbgtuetbeoowciotjed';
const DB_PASSWORD = process.env.DB_PASSWORD || 'b7246aba5e246915dbe7022235c8e4ee4182fc9c68e83e813a6068ae7a8e2b04';
const DB_NAME = process.env.DB_NAME || 'postgres';

async function promptPassword() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question('Enter new Primary Admin password (min 8 chars): ', (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  let password = process.argv[2]?.trim();
  if (!password) {
    password = await promptPassword();
  }

  if (!password || password.length < 8) {
    console.error('Error: Password must be at least 8 characters in length.');
    process.exit(1);
  }

  console.log('Connecting to Cloud Supabase (HRMS-PAYROLL-5535)...');
  const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    console.log('Connected successfully. Establishing password for +917816029162...');

    // 1. Resolve ORG001
    const orgRes = await client.query("SELECT id FROM public.organizations WHERE organization_code = 'ORG001';");
    const orgId = orgRes.rows[0]?.id;
    if (!orgId) {
      throw new Error('Organization ORG001 not found.');
    }

    // 2. Establish password via database broker
    const res = await client.query(
      'SELECT hrms_internal.establish_initial_primary_admin_password($1::uuid, $2::text, $3::text) AS success;',
      [orgId, '+917816029162', password]
    );

    const success = res.rows[0]?.success;
    client.release();
    await pool.end();

    if (success) {
      console.log('✅ SUCCESS: Primary Admin password established directly in Cloud Supabase!');
      console.log('You can now log in at http://localhost:5173/admin/login with:');
      console.log('  Organization Code: ORG001');
      console.log('  Mobile Number:     +917816029162');
      console.log('  Password:          [Your password]');
    } else {
      console.log('ℹ️ Notice: Password was already established previously or account is not in initial setup state.');
    }
  } catch (err) {
    console.error('Failed to set password:', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();
