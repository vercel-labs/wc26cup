import { z } from "zod";

type XFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type XEnvironment = Readonly<Record<string, string | undefined>>;

export interface XVerificationClient {
  isVerified(userId: string): Promise<boolean>;
}

const BearerResponseSchema = z.object({
  access_token: z.string().min(1),
});

const UserLookupResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    verified: z.boolean(),
    verified_type: z.string().optional(),
  }),
});

const XUserIdSchema = z
  .string()
  .regex(/^\d+$/u, "X user id must contain only digits");

function configured(environment: XEnvironment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value ? value : undefined;
}

function required(environment: XEnvironment, name: string): string {
  const value = configured(environment, name);
  if (!value) {
    throw new Error(`Missing required X credential: ${name}`);
  }
  return value;
}

function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json();
}

export function createXVerificationClient({
  environment = process.env,
  fetch: fetchX = fetch,
}: {
  readonly environment?: XEnvironment;
  readonly fetch?: XFetch;
} = {}): XVerificationClient {
  const apiBaseUrl = (
    configured(environment, "X_API_BASE_URL") ?? "https://api.x.com"
  ).replace(/\/+$/u, "");
  let bearerPromise: Promise<string> | undefined;

  async function resolveBearer(): Promise<string> {
    const supplied = configured(environment, "X_BEARER_TOKEN");
    if (supplied) {
      return supplied;
    }

    const consumerKey = required(environment, "X_CONSUMER_KEY");
    const consumerSecret = required(environment, "X_CONSUMER_SECRET");
    const basic = Buffer.from(
      `${oauthEncode(consumerKey)}:${oauthEncode(consumerSecret)}`,
    ).toString("base64");
    const response = await fetchX(`${apiBaseUrl}/oauth2/token`, {
      body: "grant_type=client_credentials",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(
        `X app bearer request failed with status ${response.status}`,
      );
    }
    const parsed = BearerResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success) {
      throw new Error("Invalid X app bearer response");
    }
    return parsed.data.access_token;
  }

  async function bearer(): Promise<string> {
    bearerPromise ??= resolveBearer().catch((error: unknown) => {
      bearerPromise = undefined;
      throw error;
    });
    return bearerPromise;
  }

  return {
    async isVerified(rawUserId) {
      const userId = XUserIdSchema.parse(rawUserId);
      const url = new URL(`${apiBaseUrl}/2/users/${encodeURIComponent(userId)}`);
      // `verified` alone is the legacy (pre-2023) blue check and reads false for
      // X Premium/business/government accounts; request `verified_type` too and
      // treat any non-`none` type as verified.
      url.searchParams.set("user.fields", "verified,verified_type");
      const response = await fetchX(url, {
        headers: { Authorization: `Bearer ${await bearer()}` },
      });
      if (!response.ok) {
        throw new Error(`X user lookup failed with status ${response.status}`);
      }
      const parsed = UserLookupResponseSchema.safeParse(
        await responseJson(response),
      );
      if (!parsed.success) {
        throw new Error("Invalid X user lookup response");
      }
      const { id, verified, verified_type: verifiedType } = parsed.data.data;
      return id === userId && (verified || (verifiedType ?? "none") !== "none");
    },
  };
}
