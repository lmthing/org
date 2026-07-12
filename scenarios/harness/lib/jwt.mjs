/**
 * Gateway JWT minting.
 *
 * Production `POST /api/auth/login` is broken (Zitadel password grant is disabled — see
 * .issues/zitadel-password-login-disabled.md), so a test harness cannot obtain a session the
 * normal way. Instead we mint the same HS256 token the gateway itself issues, using the
 * `GATEWAY_JWT_SECRET` from the `lmthing-secrets` k8s secret. Token shape must match
 * cloud/gateway/src/lib/tokens.ts, because Envoy validates it at the edge and routes on `sub`.
 *
 * The secret is read from `.etc/.gateway-jwt-secret.b64` (gitignored). Mind the DOUBLE base64:
 * k8s `.data.<key>` is base64 of the env *value*, and that value is itself base64 of the signing
 * key (the gateway does `Buffer.from(process.env.GATEWAY_JWT_SECRET, 'base64')`). So the file must
 * hold the env value — i.e. pipe the k8s blob through `base64 -d` ONCE when fetching, and let this
 * module do the second decode:
 *
 *   ssh …@4.223.83.5 'kubectl get secret lmthing-secrets -n lmthing \
 *     -o jsonpath="{.data.GATEWAY_JWT_SECRET}" | base64 -d' > .etc/.gateway-jwt-secret.b64
 *
 * (A file that is 44 chars long is right; 60 means you skipped the `base64 -d` and every token
 * will 401.)
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { REPO_ROOT } from './paths.mjs';

const SECRET_FILE = `${REPO_ROOT}/.etc/.gateway-jwt-secret.b64`;

let cachedSecret = null;

/** Raw HMAC key (the base64 blob in k8s decodes to the signing key the gateway uses). */
function secret() {
  if (cachedSecret) return cachedSecret;
  let b64;
  try {
    b64 = readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    throw new Error(
      `missing ${SECRET_FILE} — fetch it from the cluster:\n` +
        `  ssh -i ~/GEANT/lmthing/devops/terraform/generated/lmthing-test-key.pem azureuser@4.223.83.5 \\\n` +
        `    'kubectl get secret lmthing-secrets -n lmthing -o jsonpath="{.data.GATEWAY_JWT_SECRET}"' \\\n` +
        `    > ${SECRET_FILE}`,
    );
  }
  cachedSecret = Buffer.from(b64, 'base64');
  return cachedSecret;
}

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url').replace(/=+$/, '');

function sign(payload) {
  const head = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  const sig = createHmac('sha256', secret()).update(head).digest('base64url').replace(/=+$/, '');
  return `${head}.${sig}`;
}

/**
 * Mint an access+refresh pair for a user id. `ttlSec` defaults to 12h — long enough for a full
 * scenario run, short enough to be harmless if it leaks into a log.
 */
export function mintSession(userId, email, ttlSec = 43_200) {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: sign({ email, sub: userId, iat: now, exp: now + ttlSec }),
    refreshToken: sign({ type: 'refresh', sub: userId, iat: now, exp: now + 2_592_000 }),
    expiresAt: (now + ttlSec) * 1000,
    userId,
    email,
    githubRepo: null,
    githubUsername: null,
  };
}
