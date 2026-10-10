import { settleDueVeche } from "../src/lib/veche-finance";
import { flushVecheAnnouncements } from "../src/lib/veche-announcement";
import { refreshSignatureCalls } from "../src/lib/veche-signatures";
import { closeDuePolls } from "../src/lib/veche-polls";
import { pool } from "../src/lib/db";
import { telegramNotificationsEnabled } from "../src/lib/config";
import { expireStaleDeliveries, processNextNotificationDelivery } from "../src/lib/notification-delivery";
import { expireReceptionPublicationClaims, processNextReceptionPublication, processNextReceptionInvitation } from "../src/lib/reception-publication";
import { telegramReceptionConfig } from "../src/lib/config";

const POLL_INTERVAL_MS = 5000;
let stopping = false;
let wake: (() => void) | null = null;

function stop() {
  stopping = true;
  wake?.();
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

function waitForNextPoll(): Promise<void> {
  if (stopping) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { wake = null; resolve(); }, POLL_INTERVAL_MS);
    wake = () => { clearTimeout(timer); wake = null; resolve(); };
  });
}

async function main() {
  while (!stopping) {
    try {
      await refreshSignatureCalls(pool);
      await closeDuePolls(pool);
      await settleDueVeche(pool);
      await flushVecheAnnouncements();
      if (telegramReceptionConfig().publicationsEnabled) {
        await expireReceptionPublicationClaims(pool);
        await processNextReceptionPublication(pool);
      }
      if (telegramReceptionConfig().guardianInvitesEnabled) {
        await expireReceptionPublicationClaims(pool, "invitation");
        await processNextReceptionInvitation(pool);
      }
      for (const id of await expireStaleDeliveries(pool)) {
        console.log(JSON.stringify({ deliveryId: id, status: "unknown", errorCode: "claim_expired" }));
      }
      const result = await processNextNotificationDelivery(pool, telegramNotificationsEnabled());
      if (result) {
        console.log(JSON.stringify({ deliveryId: result.id, status: result.status, errorCode: result.errorCode ?? null }));
        continue;
      }
    } catch {
      // Never log exception objects: a network or DB error may contain credentials.
      console.error("Notification worker cycle failed");
    }
    await waitForNextPoll();
  }
  await pool.end();
}

main().catch(() => {
  console.error("Notification worker stopped unexpectedly");
  process.exitCode = 1;
});
