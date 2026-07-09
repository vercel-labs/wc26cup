import { eveChannel } from "eve/channels/eve";
import { type AuthFn, localDev, none, vercelOidc } from "eve/channels/auth";
import { requestTimeZoneAttributes } from "../lib/timezones.js";

function withRequestTimeZones(authenticate: AuthFn<Request>): AuthFn<Request> {
  return async (request) => {
    const auth = await authenticate(request);
    if (!auth) return auth;
    return {
      ...auth,
      attributes: {
        ...auth.attributes,
        ...requestTimeZoneAttributes(request.headers),
      },
    };
  };
}

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    withRequestTimeZones(vercelOidc()),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    withRequestTimeZones(localDev()),
    // Open demo: browser visitors chat anonymously. The deployment sits
    // behind Vercel deployment protection (team SSO), which is the actual
    // gate. Swap for Auth.js/Clerk if per-user identity is ever needed
    // (e.g. attributing web bets to real users).
    withRequestTimeZones(none()),
  ],
});
