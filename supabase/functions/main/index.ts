import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts';

console.log('main function started');

const JWT_SECRET = Deno.env.get('JWT_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true';

let SUPABASE_JWT_KEYS: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
if (SUPABASE_URL) {
  try {
    SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', SUPABASE_URL));
  } catch (e) {
    console.error('Failed to fetch JWKS from SUPABASE_URL:', e);
  }
}

function getAuthToken(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) throw new Error('Missing authorization header');
  const [bearer, token] = authHeader.split(' ');
  if (bearer !== 'Bearer') throw new Error(`Auth header is not 'Bearer {token}'`);
  return token;
}

async function isValidLegacyJWT(jwt: string): Promise<boolean> {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not available for HS256 token verification');
    return false;
  }

  const encoder = new TextEncoder();
  const secretKey = encoder.encode(JWT_SECRET);
  try {
    await jose.jwtVerify(jwt, secretKey);
    return true;
  } catch (e) {
    console.error('Symmetric Legacy JWT verification error', e);
    return false;
  }
}

async function isValidJWT(jwt: string): Promise<boolean> {
  if (!SUPABASE_JWT_KEYS) {
    console.error('JWKS not available for ES256/RS256 token verification');
    return false;
  }
  try {
    await jose.jwtVerify(jwt, SUPABASE_JWT_KEYS);
    return true;
  } catch (e) {
    console.error('Asymmetric JWT verification error', e);
    return false;
  }
}

async function isValidHybridJWT(jwt: string): Promise<boolean> {
  const { alg: jwtAlgorithm } = jose.decodeProtectedHeader(jwt);

  if (jwtAlgorithm === 'HS256') return await isValidLegacyJWT(jwt);
  if (jwtAlgorithm === 'ES256' || jwtAlgorithm === 'RS256') return await isValidJWT(jwt);
  return false;
}

/** Funções chamadas pela Meta (webhook) ou sem JWT de usuário. */
const JWT_EXEMPT_SERVICES = new Set(['whatsapp-webhook']);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const serviceName = url.pathname.split('/')[1] || '';
  const skipJwt = JWT_EXEMPT_SERVICES.has(serviceName);

  if (req.method !== 'OPTIONS' && VERIFY_JWT && !skipJwt) {
    try {
      const token = getAuthToken(req);
      const ok = await isValidHybridJWT(token);
      if (!ok) {
        return new Response(JSON.stringify({ msg: 'Invalid JWT' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ msg: String(e) }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const { pathname } = url;
  const pathParts = pathname.split('/');

  if (!serviceName) {
    return new Response(JSON.stringify({ msg: 'missing function name in request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const servicePath = `/home/deno/functions/${serviceName}`;
  console.error(`serving the request with ${servicePath}`);

  const memoryLimitMb = 512;
  const workerTimeoutMs = 3 * 60 * 1000; // 3 min wall clock
  const cpuTimeSoftLimitMs = 10_000;
  const cpuTimeHardLimitMs = 60_000;
  const noModuleCache = false;
  const importMapPath = null;
  const envVarsObj = Deno.env.toObject();
  const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]] as [string, string]);

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      cpuTimeSoftLimitMs,
      cpuTimeHardLimitMs,
      noModuleCache,
      importMapPath,
      envVars,
    });
    return await worker.fetch(req);
  } catch (e) {
    return new Response(JSON.stringify({ msg: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

