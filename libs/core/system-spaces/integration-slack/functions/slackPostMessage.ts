/**
 * Post a message to a Slack channel (POST /chat.postMessage on the Slack Web API).
 *
 * The gateway pins the base to `https://slack.com/api`, so the path is the leading-slash method
 * name. Slack accepts a JSON body for chat.postMessage.
 *
 * @param channel  Channel id (e.g. "C0123ABCD") or, for some workspaces, a #name. Prefer an id —
 *                 resolve names via slackListChannels first.
 * @param text     Message text (Slack mrkdwn is supported).
 * @returns The Slack response envelope: { ok: boolean; ts?: string; channel?: string; error?: string; message?: any }
 */
export async function slackPostMessage(channel: string, text: string): Promise<any> {
  const r = await callConnection('slack', {
    method: 'POST',
    path: '/chat.postMessage',
    body: { channel, text },
  });
  return r.data;
}
