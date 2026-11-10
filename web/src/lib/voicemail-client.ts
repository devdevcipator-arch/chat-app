import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { MessageRow } from "@/lib/chat";
import { AUDIO_TYPES, type AudioMimeType } from "@/lib/media";
import { UploadError, requestUploadUrl, uploadToR2 } from "@/lib/media-client";
import { VOICEMAIL_MAX_SECONDS } from "@/lib/call/types";

// Browser-only voicemail helpers: pick a recording format, then upload the
// recording to R2 through the normal media pipeline and post the message.

type Client = SupabaseClient<Database>;

// Recording formats live with the shared recorder.
export { pickRecordingFormat, uploadTypeFor, type RecordingFormat } from "@/lib/audio-recorder";

export const clampVoicemailSeconds = (seconds: number) =>
  Math.min(VOICEMAIL_MAX_SECONDS, Math.max(1, Math.round(seconds)));

export type SendVoicemailInput = {
  chatId: string;
  senderId: string;
  blob: Blob;
  type: AudioMimeType;
  durationSeconds: number;
  /** The unanswered call this follows (null after a "busy"). */
  callId: string | null;
  onProgress?: (fraction: number) => void;
};

/**
 * 1. Presigned PUT from /api/media/upload-url (auth + membership checked; the
 *    key lands in chats/<chatId>/<senderId>/…, as RLS requires).
 * 2. Upload straight to R2.
 * 3. Insert the voicemail message (media_url = the object key).
 */
export async function sendVoicemail(supabase: Client, input: SendVoicemailInput): Promise<MessageRow> {
  const { chatId, senderId, type, durationSeconds, callId, onProgress } = input;
  // Re-tag so the body matches the signed Content-Type exactly.
  const blob = input.blob.type === type ? input.blob : new Blob([input.blob], { type });
  if (blob.size === 0) throw new UploadError("The recording is empty. Please record again.");

  const ext = AUDIO_TYPES[type];
  const target = await requestUploadUrl({
    chatId,
    fileName: `voicemail.${ext}`,
    fileType: type,
    fileSize: blob.size,
  });
  await uploadToR2(target, blob, onProgress);

  const row = {
    id: crypto.randomUUID(),
    chat_id: chatId,
    sender_id: senderId,
    message_type: "voicemail",
    content: null,
    media_url: target.key,
    duration_seconds: clampVoicemailSeconds(durationSeconds),
  };

  let result = await supabase
    .from("messages")
    .insert({ ...row, call_id: callId })
    .select()
    .single();
  // Linking to the call is a nicety: if that call can't be referenced (e.g. it
  // was already given a voicemail in another tab), still deliver the message.
  if (result.error && callId) {
    result = await supabase.from("messages").insert({ ...row, call_id: null }).select().single();
  }
  if (result.error || !result.data) throw new UploadError("Voicemail not sent. Please try again.");
  return result.data;
}

/** Recipient listened: sets voicemail_played_at (idempotent). */
export async function markVoicemailPlayed(supabase: Client, messageId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("mark_voicemail_played", { p_message_id: messageId });
  if (error) return null;
  return data ?? null;
}
