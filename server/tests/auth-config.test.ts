import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as cookie from 'cookie';
import { loadEnvConfig } from '../src/config/env.js';

function withEnvOverrides(overrides: Record<string, string | undefined>, fn: () => void): void {
  const backup = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    backup.set(key, process.env[key]);
    const val = overrides[key];
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, prev] of backup.entries()) {
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }
}

describe('Auth Environment & Cookie Configuration Validation (Task 2.2C Step 1)', () => {
  it('loads valid authentication configuration from server environment', () => {
    const cfg = loadEnvConfig();
    assert.ok(cfg.SUPABASE_URL.startsWith('http'));
    assert.equal(cfg.SESSION_TOKEN_HMAC_KEY.length >= 64, true);
    assert.equal(cfg.OTP_HMAC_PEPPER.length >= 64, true);
    assert.equal(cfg.RATE_LIMIT_HMAC_KEY.length >= 64, true);
    assert.equal(cfg.TX_CONTEXT_HMAC_KEY.length >= 64, true);
    assert.match(
      cfg.TX_CONTEXT_HMAC_KEY_ID,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    assert.equal(cfg.CSRF_HMAC_SECRET.length >= 64, true);
    assert.ok(cfg.CORS_ALLOWED_ORIGINS.length >= 1);
    assert.equal(typeof cfg.COOKIE_SECURE, 'boolean');
    assert.ok(['Lax', 'Strict', 'None'].includes(cfg.COOKIE_SAMESITE));
    assert.ok(['memory', 'redis'].includes(cfg.RATE_LIMIT_BACKEND));
  });

  it('rejects malformed SUPABASE_URL and production placeholder Supabase keys', () => {
    withEnvOverrides({ SUPABASE_URL: 'not-a-url' }, () => {
      assert.throws(() => loadEnvConfig(), /Invalid SUPABASE_URL/);
    });
    withEnvOverrides({ SUPABASE_URL: 'ftp://example.com' }, () => {
      assert.throws(() => loadEnvConfig(), /http or https/);
    });
    withEnvOverrides(
      { NODE_ENV: 'production', SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder' },
      () => {
        assert.throws(() => loadEnvConfig(), /must be real keys in production/);
      }
    );
  });

  it('rejects short/non-hex HMAC keys and invalid TX_CONTEXT_HMAC_KEY_ID UUID', () => {
    withEnvOverrides({ SESSION_TOKEN_HMAC_KEY: 'too-short' }, () => {
      assert.throws(() => loadEnvConfig(), /SESSION_TOKEN_HMAC_KEY must be a 64-character hex string/);
    });
    withEnvOverrides({ TX_CONTEXT_HMAC_KEY_ID: 'not-a-uuid' }, () => {
      assert.throws(() => loadEnvConfig(), /TX_CONTEXT_HMAC_KEY_ID must be a valid UUID/);
    });
  });

  it('rejects wildcard, trailing-slash, or empty CORS_ALLOWED_ORIGINS', () => {
    withEnvOverrides({ CORS_ALLOWED_ORIGINS: '*' }, () => {
      assert.throws(() => loadEnvConfig(), /without wildcards/);
    });
    withEnvOverrides({ CORS_ALLOWED_ORIGINS: 'https://app.example.com/' }, () => {
      assert.throws(() => loadEnvConfig(), /without wildcards or trailing slashes/);
    });
    withEnvOverrides({ CORS_ALLOWED_ORIGINS: '' }, () => {
      assert.throws(() => loadEnvConfig(), /at least one origin URL/);
    });
  });

  it('validates cookie security flags and requires Secure=true when SameSite=None', () => {
    withEnvOverrides({ COOKIE_SECURE: 'maybe' }, () => {
      assert.throws(() => loadEnvConfig(), /COOKIE_SECURE must be 'true' or 'false'/);
    });
    withEnvOverrides({ COOKIE_SAMESITE: 'InvalidMode' }, () => {
      assert.throws(() => loadEnvConfig(), /COOKIE_SAMESITE must be one of/);
    });
    withEnvOverrides({ COOKIE_SAMESITE: 'None', COOKIE_SECURE: 'false' }, () => {
      assert.throws(() => loadEnvConfig(), /COOKIE_SAMESITE=None requires COOKIE_SECURE=true/);
    });
  });

  it('rejects wildcard TRUST_PROXY=true and invalid RATE_LIMIT_BACKEND', () => {
    withEnvOverrides({ TRUST_PROXY: 'true' }, () => {
      assert.throws(() => loadEnvConfig(), /never wildcard "true"/);
    });
    withEnvOverrides({ RATE_LIMIT_BACKEND: 'sqlite' }, () => {
      assert.throws(() => loadEnvConfig(), /RATE_LIMIT_BACKEND must be one of/);
    });
  });

  it('parses and serializes __Host- refresh cookie cleanly with cookie package', () => {
    const serialized = cookie.serialize('__Host-hrms_refresh_token', 'opaque-token-sample', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 604800,
    });
    assert.ok(serialized.includes('HttpOnly'));
    assert.ok(serialized.includes('Secure'));
    assert.ok(serialized.includes('Path=/'));
    assert.ok(serialized.includes('SameSite=Lax'));

    const parsed = cookie.parse('foo=bar; __Host-hrms_refresh_token=opaque-token-sample');
    assert.equal(parsed['__Host-hrms_refresh_token'], 'opaque-token-sample');
  });
});
