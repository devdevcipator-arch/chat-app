-- =============================================================================
-- Voice notes: audio messages recorded in the composer carry their length.
--
-- duration_seconds was voicemail-only (see 20261110000000). Recorded voice
-- notes are ordinary 'audio' messages and now may set it too (1–300 s), so
-- bubbles and the chat list can show "00:07" without downloading the file.
-- Uploaded audio files may still leave it null. call_id and
-- voicemail_played_at remain voicemail-only.
--
-- The key rule is unchanged: chats/<chat_id>/<sender_id>/<uuid>.<ext>
-- (media_url_is_object_key + the "send as self to own chats" policy), and
-- duration_seconds is already in the column-level INSERT grant.
-- =============================================================================

alter table public.messages drop constraint voicemail_shape;

alter table public.messages
  add constraint voicemail_shape check (
    case message_type
      when 'voicemail' then
        media_url ~ '\.(webm|ogg|m4a|mp4)$'
        and duration_seconds between 1 and 120
      when 'audio' then
        (duration_seconds is null or duration_seconds between 1 and 300)
        and call_id is null
        and voicemail_played_at is null
      else
        duration_seconds is null
        and call_id is null
        and voicemail_played_at is null
    end
  );
