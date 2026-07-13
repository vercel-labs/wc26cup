import { eveChannel } from "eve/channels/eve";
import { type AuthFn, localDev, vercelOidc } from "eve/channels/auth";
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
    // Anonymous browser access (`none()`) is intentionally NOT enabled: the X
    // webhook requires Vercel deployment protection to be OFF, so an anonymous
    // web channel would be wide open to abuse. Re-add `none()` only behind your
    // own gate (deployment protection, Auth.js/Clerk, etc.).
  ],
});
