import type { PredictionFollowUp, PredictionOwner } from "./bets.js";

interface AuthLike {
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly authenticator?: string;
  readonly principalId?: string;
}

export interface PredictionIdentity {
  readonly followUp: PredictionFollowUp;
  readonly mention: string;
  readonly owner: PredictionOwner;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function predictionIdentity(
  auth: AuthLike | null | undefined,
  sessionId: string | undefined,
): PredictionIdentity | null {
  if (!auth) return null;
  const attributes = auth.attributes ?? {};
  const displayName =
    stringValue(attributes.user_name) ??
    stringValue(attributes.full_name) ??
    stringValue(attributes.name) ??
    stringValue(attributes.email);

  if (auth.authenticator === "none") {
    if (!sessionId) return null;
    return {
      followUp: { kind: "pull_only", surface: "web" },
      mention: "you",
      owner: { kind: "web_session", sessionId },
    };
  }

  const principalId = stringValue(auth.principalId);
  if (!principalId) return null;

  if (auth.authenticator === "slack-webhook") {
    const userId = stringValue(attributes.user_id);
    const channelId = stringValue(attributes.channel_id);
    if (!userId || !channelId) return null;
    return {
      followUp: { channelId, kind: "slack", userId },
      mention: `<@${userId}>`,
      owner: { displayName, kind: "principal", principalId },
    };
  }

  if (auth.authenticator === "x-webhook") {
    const userId = stringValue(attributes.user_id);
    const threadId = stringValue(attributes.thread_id);
    if (!userId || !threadId) return null;
    return {
      followUp: { kind: "x", threadId, userId },
      mention: displayName ? `@${displayName.replace(/^@/u, "")}` : "you",
      owner: { displayName, kind: "principal", principalId },
    };
  }

  return {
    followUp: { kind: "pull_only", surface: "web" },
    mention: displayName ?? "you",
    owner: { displayName, kind: "principal", principalId },
  };
}

export function samePredictionOwner(left: PredictionOwner, right: PredictionOwner): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "principal"
    ? right.kind === "principal" && left.principalId === right.principalId
    : right.kind === "web_session" && left.sessionId === right.sessionId;
}
