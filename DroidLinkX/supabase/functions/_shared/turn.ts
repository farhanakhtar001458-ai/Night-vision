import { env } from './env.ts';
import { hmacBase64 } from './crypto.ts';

export type TurnCredentials = { urls: string[]; username: string; credential: string; ttl: number };

/** TURN REST credentials: username = "<expiry unix>:<scope>", password = base64(HMAC-SHA1(secret, username)). */
export async function mintTurnCredentials(scope: string): Promise<TurnCredentials> {
  const ttl = env.turnTtlSeconds;
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${scope}`;
  const credential = env.turnSecret ? await hmacBase64(env.turnSecret, username, 'SHA-1') : '';
  return { urls: env.turnUrls, username, credential, ttl };
}

export async function iceServers(scope: string): Promise<{ iceServers: RTCIceServerLike[]; ttl: number }> {
  const turn = await mintTurnCredentials(scope);
  const servers: RTCIceServerLike[] = [{ urls: env.stunUrls }];
  if (turn.urls.length > 0 && turn.credential) {
    servers.push({ urls: turn.urls, username: turn.username, credential: turn.credential });
  }
  return { iceServers: servers, ttl: turn.ttl };
}

export type RTCIceServerLike = { urls: string[]; username?: string; credential?: string };

export function signalingConfig() {
  return {
    signalingUrl: env.signalingUrl,
    stunUrls: env.stunUrls,
    turnUrls: env.turnUrls,
    turnConfigured: env.turnUrls.length > 0 && Boolean(env.turnSecret),
  };
}
