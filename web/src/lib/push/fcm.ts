import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type TokenMessage } from "firebase-admin/messaging";

// Firebase Cloud Messaging through the Admin SDK. Credentials come from
// FIREBASE_SERVICE_ACCOUNT_JSON (Firebase Console -> Project settings ->
// Service accounts -> Generate new private key). Server-only.

const APP_NAME = "push";
/** FCM's limit for one sendEach call. */
const BATCH_SIZE = 500;

let app: App | null | undefined;

/** The Firebase app, or null (logged once) when push isn't configured. */
export function getFirebaseApp(): App | null {
  if (app !== undefined) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    console.warn("[push] FIREBASE_SERVICE_ACCOUNT_JSON is not set; push notifications are disabled.");
    app = null;
    return app;
  }
  try {
    const account = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
    app =
      getApps().find((a) => a.name === APP_NAME) ??
      initializeApp(
        {
          credential: cert({
            projectId: account.project_id,
            clientEmail: account.client_email,
            // Env UIs often store the key's newlines as a literal "\n".
            privateKey: account.private_key.replace(/\\n/g, "\n"),
          }),
        },
        APP_NAME,
      );
  } catch {
    // Never log the error object here: it could quote the private key.
    console.error("[push] FIREBASE_SERVICE_ACCOUNT_JSON is not a valid service account key; push is disabled.");
    app = null;
  }
  return app;
}

export type SendResult = { sent: number; failed: number; staleTokens: string[] };

/** Sends every message; never throws. Reports tokens FCM says are gone. */
export async function sendFcm(firebase: App, messages: TokenMessage[]): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, staleTokens: [] };
  const messaging = getMessaging(firebase);
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      const { responses } = await messaging.sendEach(batch);
      responses.forEach((response, index) => {
        if (response.success) {
          result.sent++;
          return;
        }
        result.failed++;
        const code = response.error?.code;
        if (code === "messaging/registration-token-not-registered") result.staleTokens.push(batch[index].token);
        else console.warn("[push] send failed:", code ?? "unknown");
      });
    } catch (e) {
      result.failed += batch.length;
      console.error("[push] sendEach failed:", e instanceof Error ? e.message : e);
    }
  }
  return result;
}
