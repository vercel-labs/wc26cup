interface AuthLike {
  authenticator?: string;
  principalId?: string;
  attributes?: Record<string, unknown>;
}

export interface BetIdentity {
  principalId: string;
  displayName: string | null;
  /** Present only for Slack sessions — enables the settlement announcement. */
  slack: { userId: string; channelId: string } | null;
  /** How to address the user in a reply: Slack mention when possible, else a name or "you". */
  mention: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Bet identity from any principal-based auth context. Slack contributes an
 * announcement target on top; every other authenticator (Vercel OIDC, custom)
 * works as long as a principalId is present.
 */
export function betIdentity(auth: AuthLike | null | undefined): BetIdentity | null {
  const principalId = str(auth?.principalId);
  if (!auth || !principalId) return null;

  const attributes = auth.attributes ?? {};
  const displayName =
    str(attributes.user_name) ?? str(attributes.full_name) ?? str(attributes.name) ?? str(attributes.email);

  const slackUserId = auth.authenticator === "slack-webhook" ? str(attributes.user_id) : null;
  const slackChannelId = auth.authenticator === "slack-webhook" ? str(attributes.channel_id) : null;
  const slack = slackUserId && slackChannelId ? { userId: slackUserId, channelId: slackChannelId } : null;

  return {
    principalId,
    displayName,
    slack,
    mention: slack ? `<@${slack.userId}>` : (displayName ?? "you"),
  };
}
