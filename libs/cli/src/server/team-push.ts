/**
 * Pod → gateway: "tell these people something happened."
 *
 * The pod does not talk to Web Push or FCM itself, and should not. Those need
 * long-lived credentials (VAPID keys, a Firebase service account) and a store of
 * every device subscription a user has. A team pod is a per-team workload that
 * scales to zero and whose env an editor can rewrite (`PUT /api/compute/env`) —
 * the wrong place for either. The gateway already holds the user table and the
 * secrets, so it owns the delivery and this is a one-way call into it.
 *
 * Reached at the in-cluster service address, the same convention as `backup.ts`
 * and `report-bug.ts`. Authenticated with a shared secret the gateway injects as
 * a CONTAINER env var on team pods (not into the editable `user-env` secret, for
 * the same reason `LMTHING_TEAM_MODE` is not) — without it the call is simply
 * not made, so a pod that was never granted the secret cannot ask the gateway to
 * notify anyone.
 *
 * Everything here is best-effort and fire-and-forget. A notification that does
 * not arrive is a notification that does not arrive; it must never turn a
 * delivered message into a failed one.
 */

import type { Channel, ChannelMessage } from './team-channels.js';

const GATEWAY_URL =
  process.env['LMTHING_GATEWAY_URL'] || 'http://gateway.lmthing.svc.cluster.local:3000';

/** How long to wait on the gateway before giving up on a notification. */
const PUSH_TIMEOUT_MS = 5000;

/** The body the gateway's `POST /api/push/send` accepts. */
export interface PushRequest {
  teamId: string;
  userIds: string[];
  title: string;
  body: string;
  /** Where clicking the notification should land. */
  url: string;
  /** Collapses same-channel notifications on the device instead of stacking them. */
  tag: string;
}

/**
 * What a notification says.
 *
 * A DM is titled by the person, a channel by the channel — that is the first
 * thing a reader needs in order to decide whether to open it. The body is the
 * message, truncated: a notification is a pointer, and a wall of text on a lock
 * screen is neither readable nor private.
 */
export function pushPayload(
  channel: Channel,
  message: ChannelMessage,
  senderName: string,
  teamId: string,
): Omit<PushRequest, 'userIds'> {
  const isDm = channel.kind === 'dm';
  const body = message.text.length > 140 ? `${message.text.slice(0, 139)}…` : message.text;
  return {
    teamId,
    title: isDm ? senderName : `${senderName} in #${channel.name}`,
    body,
    // Deep-links straight into the conversation, which is the only thing anybody
    // wants from tapping one of these.
    url: `/team/${teamId}/channels?channel=${encodeURIComponent(channel.id)}`,
    // One live notification per channel per device: a channel someone is typing
    // in should not produce a column of them.
    tag: `${teamId}:${channel.id}`,
  };
}

/**
 * Ask the gateway to notify these members. Resolves to whether the request was
 * accepted — never rejects.
 */
export async function sendPushRequest(request: PushRequest): Promise<boolean> {
  const secret = process.env['LMTHING_PUSH_SECRET'];
  if (!secret || !request.userIds.length) return false;

  try {
    const res = await fetch(`${GATEWAY_URL}/api/push/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Not a user's token: this call is the POD acting on behalf of a team,
        // and there may be no user in the room at all (THING can be the sender).
        'x-lmthing-pod-secret': secret,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    // Gateway down, DNS blip, timeout. The message is already delivered to
    // everyone with the surface open, and the badge is already raised for
    // everyone else — this only costs the buzz.
    return false;
  }
}
