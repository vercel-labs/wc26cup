import { eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Open demo: browser visitors chat anonymously. The deployment sits
    // behind Vercel deployment protection (team SSO), which is the actual
    // gate. Swap for Auth.js/Clerk if per-user identity is ever needed
    // (e.g. attributing web bets to real users).
    none(),
  ],
});
