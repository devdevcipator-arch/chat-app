import "server-only";
import { RtcRole, RtcTokenBuilder } from "agora-token";

// Server-only Agora config. The App Certificate must never reach the browser;
// the App ID is handed out alongside each token instead of via NEXT_PUBLIC_.

export const AGORA_TOKEN_TTL_SECONDS = 3600;

export function getAgoraConfig() {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate) return null;
  return { appId, appCertificate };
}

/** RTC publisher token bound to one channel and one string user account. */
export function buildRtcToken(
  config: { appId: string; appCertificate: string },
  channelName: string,
  account: string,
) {
  return RtcTokenBuilder.buildTokenWithUserAccount(
    config.appId,
    config.appCertificate,
    channelName,
    account,
    RtcRole.PUBLISHER,
    AGORA_TOKEN_TTL_SECONDS, // token expiry, seconds from now
    AGORA_TOKEN_TTL_SECONDS, // join/publish privilege expiry, seconds from now
  );
}
