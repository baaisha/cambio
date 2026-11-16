import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';

const owner = 'shreyasjain';
const issuers = [`https://oidc.vercel.com/${owner}`, 'https://oidc.vercel.com'];
const keys = new Map(issuers.map(issuer => [issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`), { timeoutDuration: 5000 })]));

/** Only this production Vercel project may supply the client IP used for rate limits. */
export async function verifiedRelayIp(headers: Headers, testKey?: JWTVerifyGetKey): Promise<string | null> {
  const token = headers.get('x-cambio-relay-token');
  if (!token) return null;
  if (token.length > 16000) throw new Error('Invalid relay identity');
  const issuer = decodeJwt(token).iss;
  if (!issuer || !issuers.includes(issuer)) throw new Error('Invalid relay issuer');
  await jwtVerify(token, testKey ?? keys.get(issuer)!, {
    algorithms: ['RS256'], issuer, audience: `https://vercel.com/${owner}`,
    subject: `owner:${owner}:project:cambio:environment:production`, requiredClaims: ['exp', 'iat'], clockTolerance: 5,
  });
  const ip = headers.get('x-cambio-client-ip');
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) throw new Error('Invalid relay client');
  return ip;
}
