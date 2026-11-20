import { PILOT_OWNER_SUBJECT } from '@rayfin-app/shared';
import { UserThrownError } from '@microsoft/fabric-user-data-functions';

export function requireOwner(accessToken: string): void {
  // The Functions gateway authenticates this invocation token before injecting the context.
  let claims: unknown;
  try { claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new UserThrownError('Owner authorization could not be established. Sign in again.'); }
  if (!claims || typeof claims !== 'object' || !('sub' in claims) || typeof claims.sub !== 'string') {
    throw new UserThrownError('Owner authorization could not be established. Sign in again.');
  }
  // Match the SDK's managed-host subject normalization to session.user.id and data policies.
  const subject = claims.sub.includes('/users/') ? claims.sub.split('/').filter(Boolean).at(-1) : claims.sub;
  if (subject !== PILOT_OWNER_SUBJECT) {
    throw new UserThrownError('This pilot is restricted to the configured app owner.');
  }
}
