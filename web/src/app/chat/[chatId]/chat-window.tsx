"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Avatar } from "@/components/avatar";
import { Menu } from "@/components/menu";
import {
  MESSAGE_MAX,
  MESSAGE_PAGE_SIZE,
  chatName,
  editWindowLeftMs,
  formatMessageTime,
  mergeMessages,
  profileName,
  type ChatDetails,
  type ChatMessage,
  type MessageRow,
  type PublicProfile,
} from "@/lib/chat";
import type { CallTarget, GroupCallInfo } from "@/lib/call/types";
import { fetchChatDetails } from "@/lib/chat-actions";
import { onChatEvent } from "@/lib/chat-events";
import {
  ACCEPTED_FILE_INPUT,
  ACCEPTED_IMAGE_INPUTS,
  AUDIO_TYPES,
  MAX_UPLOAD_BYTES,
  mediaPublicUrl,
  type MediaMimeType,
} from "@/lib/media";
import { UploadError, compressImage, requestUploadUrl, uploadToR2 } from "@/lib/media-client";
import { EditError, editMessage } from "@/lib/message-edit";
import { createClient } from "@/lib/supabase/client";
import { formatBytes } from "@/lib/vault";
import { markVoicemailPlayed } from "@/lib/voicemail-client";
import { CallButton } from "../call/call-button";
import { GroupCallBanner } from "../call/group-call-banner";
import { ChatMenu } from "../chat-menu";
import { GroupInfo } from "./group-info";
import { AudioMessage, FileMessage, ImageMessage, Lightbox, VideoMessage } from "./media";
import { VOICE_NOTE_MAX_SECONDS, VoiceNoteBar } from "./voice-note-bar";
import { VoicemailMessage } from "./voicemail-message";
import type { RecordedAudio } from "@/lib/audio-recorder";

type Props = {
  chatId: string;
  meId: string;
  other: PublicProfile | null;
  details: ChatDetails;
  initialMessages: ChatMessage[];
};

/** A file that has been validated (and compressed) and is ready to upload. */
type PreparedMedia = {
  blob: Blob;
  type: MediaMimeType;
  kind: "image" | "audio";
  fileName: string;
  /** Recorded voice notes know their length. */
  durationSeconds?: number;
  /** Text sent with an image (pasted screenshots). */
  caption?: string;
};

const errorText = (e: unknown) =>
  e instanceof UploadError ? e.message : "Something went wrong. Please try again.";

export function ChatWindow({ chatId, meId, other, details: initialDetails, initialMessages }: Props) {
  const [supabase] = useState(createClient);
  const [messages, setMessages] = useState(initialMessages);
  const [details, setDetails] = useState(initialDetails);
  const [infoOpen, setInfoOpen] = useState(false);
  const closeInfo = useCallback(() => setInfoOpen(false), []);
  const group = details.type === "group";
  /** Who the header call buttons call: the other person, or the whole group. */
  const groupCall: GroupCallInfo | null = group
    ? { chatId, title: details.title || "Group", members: details.members }
    : null;
  const callTarget: CallTarget = groupCall
    ? { kind: "group", group: groupCall }
    : { kind: "direct", peer: other ? { ...other, chatId } : null };
  const [connected, setConnected] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  /** The message being edited in the composer, if any. */
  const [editing, setEditing] = useState<ChatMessage | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  /** Prepared files by message id, kept so a failed upload can be retried. */
  const pendingMedia = useRef(new Map<string, PreparedMedia>());
  const objectUrls = useRef(new Set<string>());

  // Release local previews when leaving the chat.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  // Realtime: append new messages for this chat as they are inserted.
  useEffect(() => {
    const catchUp = async () => {
      // Covers anything sent between the server render and (re)subscribing.
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);
      if (data) setMessages((prev) => mergeMessages(prev, data));
    };

    const reloadDetails = async () => {
      const fresh = await fetchChatDetails(supabase, chatId);
      if (fresh) setDetails(fresh);
    };

    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const message = payload.new as MessageRow;
          setMessages((prev) => mergeMessages(prev, [message]));
          // Group system messages announce renames and membership changes.
          if (message.message_type === "system") void reloadDetails();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          // e.g. a voicemail was played; only update what we already have.
          const message = payload.new as MessageRow;
          setMessages((prev) => (prev.some((m) => m.id === message.id) ? mergeMessages(prev, [message]) : prev));
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          void catchUp();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnected(false);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, chatId]);

  // Actions taken from the sidebar menu or the group info panel.
  useEffect(
    () =>
      onChatEvent((event) => {
        if (event.chatId !== chatId) return;
        if (event.type === "muted") setDetails((d) => ({ ...d, isMuted: event.muted }));
        else if (event.type === "cleared") {
          setMessages([]);
          setEditing(null);
        }
        else if (event.type === "updated") {
          void fetchChatDetails(supabase, chatId).then((fresh) => fresh && setDetails(fresh));
        }
      }),
    [supabase, chatId],
  );

  /** Sender names for group bubbles; people who left show as "Former member". */
  const memberNames = new Map(details.members.map((m) => [m.id, profileName(m)]));

  // Keep the view pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const patch = useCallback((id: string, changes: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...changes } : m)));
  }, []);

  const insertMessage = useCallback(
    async (message: ChatMessage, mediaKey: string | null) => {
      const { data, error } = await supabase
        .from("messages")
        .insert({
          id: message.id,
          chat_id: chatId,
          sender_id: meId,
          message_type: message.message_type,
          content: message.content,
          media_url: mediaKey,
          duration_seconds: message.duration_seconds,
        })
        .select()
        .single();
      if (error || !data) throw new UploadError("Message not sent. Please try again.");
      setMessages((prev) => mergeMessages(prev, [data]));
    },
    [supabase, chatId, meId],
  );

  // --- Text -----------------------------------------------------------------

  const sendText = useCallback(
    async (message: ChatMessage) => {
      try {
        await insertMessage(message, null);
      } catch (e) {
        patch(message.id, { status: "failed", error: errorText(e) });
      }
    },
    [insertMessage, patch],
  );

  function handleSendText(content: string) {
    const optimistic: ChatMessage = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      sender_id: meId,
      message_type: "text",
      content,
      media_url: null,
      duration_seconds: null,
      call_id: null,
      voicemail_played_at: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    stickToBottom.current = true;
    setMessages((prev) => mergeMessages(prev, [optimistic]));
    void sendText(optimistic);
  }

  // --- Media ----------------------------------------------------------------

  const sendMedia = useCallback(
    async (message: ChatMessage, media: PreparedMedia) => {
      try {
        // 1. Presigned PUT URL from our API (auth + membership checked there).
        const target = await requestUploadUrl({
          chatId,
          fileName: media.fileName,
          fileType: media.type,
          fileSize: media.blob.size,
        });
        // 2. Upload straight to R2; throttle progress updates to whole percents.
        let lastPct = -1;
        await uploadToR2(target, media.blob, (fraction) => {
          const pct = Math.floor(fraction * 100);
          if (pct !== lastPct) {
            lastPct = pct;
            patch(message.id, { progress: fraction });
          }
        });
        // 3. Record the message. media_url stores the object key, not a URL.
        await insertMessage(message, target.key);
        pendingMedia.current.delete(message.id);
      } catch (e) {
        patch(message.id, { status: "failed", error: errorText(e), progress: undefined });
      }
    },
    [chatId, insertMessage, patch],
  );

  async function prepare(file: File): Promise<PreparedMedia> {
    if (ACCEPTED_IMAGE_INPUTS.includes(file.type)) {
      const image = await compressImage(file);
      if (image.blob.size > MAX_UPLOAD_BYTES.image) throw new UploadError("That image is too large.");
      return { blob: image.blob, type: image.type, kind: "image", fileName: file.name };
    }
    if (file.type in AUDIO_TYPES) {
      if (file.size > MAX_UPLOAD_BYTES.audio) {
        throw new UploadError(`Audio files must be ${MAX_UPLOAD_BYTES.audio / 1024 / 1024} MB or smaller.`);
      }
      return { blob: file, type: file.type as MediaMimeType, kind: "audio", fileName: file.name };
    }
    throw new UploadError("Only images (JPEG, PNG, WebP, GIF, AVIF) and audio files are supported.");
  }

  async function handleAttach(file: File) {
    setNotice(null);
    let media: PreparedMedia;
    try {
      media = await prepare(file);
    } catch (e) {
      setNotice(errorText(e));
      return;
    }
    queueMedia(media);
  }

  /**
   * Images pasted into the composer (screenshots etc.): each one goes through
   * the normal pipeline; the caption rides on the last image.
   */
  async function handleSendImages(files: File[], caption: string) {
    setNotice(null);
    const prepared: PreparedMedia[] = [];
    for (const file of files) {
      try {
        prepared.push(await prepare(file));
      } catch (e) {
        setNotice(errorText(e));
      }
    }
    if (prepared.length === 0) {
      if (caption) handleSendText(caption); // don't lose what they typed
      return;
    }
    prepared.forEach((media, i) => queueMedia(i === prepared.length - 1 && caption ? { ...media, caption } : media));
  }

  /** A voice note from the composer: same upload pipeline, plus its length. */
  function handleVoiceNote(audio: RecordedAudio) {
    setNotice(null);
    if (audio.blob.size > MAX_UPLOAD_BYTES.audio) {
      setNotice("That recording is too large to send.");
      return;
    }
    queueMedia({
      blob: audio.blob,
      type: audio.type,
      kind: "audio",
      fileName: `voice-message.${AUDIO_TYPES[audio.type]}`,
      durationSeconds: Math.min(VOICE_NOTE_MAX_SECONDS, Math.max(1, Math.round(audio.seconds))),
    });
  }

  /** Shows the media optimistically and starts uploading it. */
  function queueMedia(media: PreparedMedia) {
    const localUrl = URL.createObjectURL(media.blob);
    objectUrls.current.add(localUrl);
    const optimistic: ChatMessage = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      sender_id: meId,
      message_type: media.kind,
      content: media.caption || null,
      media_url: null,
      duration_seconds: media.durationSeconds ?? null,
      call_id: null,
      voicemail_played_at: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      status: "sending",
      localUrl,
      progress: 0,
    };
    pendingMedia.current.set(optimistic.id, media);
    stickToBottom.current = true;
    setMessages((prev) => mergeMessages(prev, [optimistic]));
    void sendMedia(optimistic, media);
  }

  /** I listened to a voicemail: show it as played now, record it on the server. */
  const handleVoicemailPlayed = useCallback(
    (id: string) => {
      patch(id, { voicemail_played_at: new Date().toISOString() });
      void markVoicemailPlayed(supabase, id).then((playedAt) => playedAt && patch(id, { voicemail_played_at: playedAt }));
    },
    [supabase, patch],
  );

  // --- Editing --------------------------------------------------------------

  function startEdit(message: ChatMessage) {
    if (editWindowLeftMs(message.created_at) <= 0) return; // the menu hides itself at the limit
    setNotice(null);
    setEditing(message);
  }

  const cancelEdit = useCallback(() => setEditing(null), []);

  /** Shows the new text right away; Postgres has the final say (10-minute rule). */
  async function saveEdit(content: string) {
    const target = editing;
    setEditing(null);
    if (!target) return;
    const current = messages.find((m) => m.id === target.id) ?? target;
    if (content === current.content) return;

    const before = { content: current.content, edited_at: current.edited_at };
    patch(target.id, { content, edited_at: new Date().toISOString() });
    try {
      const row = await editMessage(supabase, target.id, content);
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? mergeMessages(prev, [row]) : prev));
    } catch (e) {
      patch(target.id, before);
      setNotice(e instanceof EditError ? e.message : "Couldn't edit the message. Please try again.");
    }
  }

  function retry(message: ChatMessage) {
    const again: Partial<ChatMessage> = { status: "sending", error: undefined };
    const media = pendingMedia.current.get(message.id);
    if (message.message_type !== "text" && media) {
      patch(message.id, { ...again, progress: 0 });
      void sendMedia(message, media);
    } else {
      patch(message.id, again);
      void sendText(message);
    }
  }

  const name = chatName({ type: details.type, title: details.title, other });

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={`Conversation with ${name}`}>
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 md:px-4 dark:border-zinc-800">
        <Link
          href="/chat"
          aria-label="Back to chats"
          className="-ml-1 rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        {group ? (
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label={`Group info for ${name}`}
            className="-my-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 pr-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
          >
            <Avatar name={name} group />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{name}</p>
              <p className="truncate text-xs text-zinc-500">
                {details.members.length} members · tap for group info
              </p>
            </div>
          </button>
        ) : (
          <>
            <Avatar name={name} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{name}</p>
              {other?.username && <p className="truncate text-xs text-zinc-500">@{other.username}</p>}
            </div>
          </>
        )}
        {details.isMuted && (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800" title="Notifications muted">
            Muted
          </span>
        )}
        {!connected && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Reconnecting…
          </span>
        )}
        <CallButton target={callTarget} type="video" />
        <CallButton target={callTarget} type="voice" />
        <ChatMenu
          chatId={chatId}
          type={details.type}
          name={name}
          isMuted={details.isMuted}
          isAdmin={details.myRole === "admin"}
          extraItems={group ? [{ label: "Group info", onSelect: () => setInfoOpen(true) }] : []}
          triggerClassName="size-10"
        />
      </header>
      {groupCall && <GroupCallBanner group={groupCall} />}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-zinc-500">
            <p>
              {group ? `This is the start of "${name}".` : `This is the start of your conversation with ${name}.`}
              <br />
              Say hi 👋
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {messages.map((message, i) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  mine={message.sender_id === meId}
                  grouped={messages[i - 1]?.sender_id === message.sender_id && messages[i - 1]?.message_type !== "system"}
                  senderLabel={
                    group && message.sender_id !== meId
                      ? (message.sender_id && memberNames.get(message.sender_id)) || "Former member"
                      : null
                  }
                  editable={message.sender_id === meId && message.message_type === "text" && !message.status}
                  beingEdited={editing?.id === message.id}
                  onEdit={() => startEdit(message)}
                  onRetry={() => retry(message)}
                  onOpenImage={setLightbox}
                  onVoicemailPlayed={handleVoicemailPlayed}
                />
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mx-3 mb-0 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              <span className="flex-1">{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="px-1 opacity-70 hover:opacity-100">
                ✕
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Composer
        onSend={handleSendText}
        onAttach={(file) => void handleAttach(file)}
        onSendImages={(files, caption) => void handleSendImages(files, caption)}
        onVoiceNote={handleVoiceNote}
        onNotice={setNotice}
        editing={editing && { id: editing.id, content: editing.content ?? "" }}
        onSaveEdit={(content) => void saveEdit(content)}
        onCancelEdit={cancelEdit}
      />
      <Lightbox src={lightbox} onClose={closeLightbox} />
      {group && <GroupInfo open={infoOpen} onClose={closeInfo} meId={meId} details={details} />}
    </section>
  );
}

function MessageBubble({
  message,
  mine,
  grouped,
  senderLabel,
  editable,
  beingEdited,
  onEdit,
  onRetry,
  onOpenImage,
  onVoicemailPlayed,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  /** Shown above the first bubble of a run in group chats. */
  senderLabel: string | null;
  /** My own delivered text message (editing still depends on the 10-minute window). */
  editable: boolean;
  beingEdited: boolean;
  onEdit: () => void;
  onRetry: () => void;
  onOpenImage: (src: string) => void;
  onVoicemailPlayed: (id: string) => void;
}) {
  const canEdit = useEditWindowOpen(message.created_at, editable);

  if (message.message_type === "system") {
    return <li className="my-2 text-center text-xs text-zinc-500">{message.content}</li>;
  }

  const sending = message.status === "sending";
  const mediaSrc = message.localUrl ?? mediaPublicUrl(message.media_url);

  let body;
  switch (message.message_type) {
    case "image":
      body = (
        <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
          <ImageMessage src={mediaSrc} progress={message.progress} sending={sending} onOpen={onOpenImage} />
          {message.content && (
            <div
              className={`max-w-[min(18rem,70vw)] rounded-2xl px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap ${
                mine
                  ? "rounded-tr-md bg-indigo-600 text-white"
                  : "rounded-tl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              } ${sending ? "opacity-70" : ""}`}
            >
              {message.content}
            </div>
          )}
        </div>
      );
      break;
    case "audio":
      body = (
        <AudioMessage
          id={message.id}
          src={mediaSrc}
          durationSeconds={message.duration_seconds}
          mine={mine}
          sending={sending}
          progress={message.progress}
        />
      );
      break;
    case "video":
      body = <VideoMessage src={mediaSrc} name={message.content} />;
      break;
    case "voicemail":
      body = (
        <VoicemailMessage
          id={message.id}
          src={mediaSrc}
          durationSeconds={message.duration_seconds ?? 0}
          createdAt={message.created_at}
          playedAt={message.voicemail_played_at}
          mine={mine}
          sending={sending}
          onPlayed={() => onVoicemailPlayed(message.id)}
        />
      );
      break;
    case "file":
      body = <FileMessage src={mediaSrc} name={message.content} mine={mine} />;
      break;
    case "text":
      body = (
        <div
          className={`rounded-2xl px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap ${
            mine
              ? "rounded-br-md bg-indigo-600 text-white"
              : "rounded-bl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          } ${sending ? "opacity-70" : ""} ${beingEdited ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950" : ""}`}
        >
          {message.content}
        </div>
      );
      break;
    default:
      body = (
        <div className="rounded-2xl bg-zinc-100 px-3.5 py-2 text-sm text-zinc-500 italic dark:bg-zinc-800">
          Unsupported message type
        </div>
      );
  }

  return (
    <motion.li
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`flex ${mine ? "justify-end" : "justify-start"} ${grouped ? "" : "mt-2"}`}
    >
      <div className={`flex max-w-[80%] flex-col md:max-w-[65%] ${mine ? "items-end" : "items-start"}`}>
        {senderLabel && !grouped && (
          <span className="mb-1 flex items-center gap-1.5 px-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
            <Avatar name={senderLabel} size="xs" />
            {senderLabel}
          </span>
        )}
        {canEdit ? (
          <div className="group/msg flex max-w-full items-center gap-1">
            <Menu
              label="Message options"
              items={[{ label: "Edit", onSelect: onEdit }]}
              triggerClassName="shrink-0 opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
            />
            <div className="min-w-0">{body}</div>
          </div>
        ) : (
          body
        )}
        <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-zinc-500">
          {message.status === "failed" ? (
            <>
              <span className="text-red-600 dark:text-red-400">{message.error ?? "Not sent"}</span>
              <button type="button" onClick={onRetry} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Retry
              </button>
            </>
          ) : sending ? (
            <span>{message.message_type === "text" ? "Sending…" : "Uploading…"}</span>
          ) : message.message_type === "voicemail" ? null : (
            <>
              <time suppressHydrationWarning dateTime={message.created_at}>
                {formatMessageTime(message.created_at)}
              </time>
              {message.edited_at && (
                <span
                  suppressHydrationWarning
                  title={`Edited ${new Date(message.edited_at).toLocaleString()}`}
                  className="cursor-default"
                >
                  · edited
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </motion.li>
  );
}

/**
 * Whether my message can still be edited, flipping to false exactly when the
 * 10-minute window closes. Starts false so server and client render alike.
 */
function useEditWindowOpen(createdAt: string, enabled: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const left = editWindowLeftMs(createdAt);
    if (left <= 0) return;
    const show = window.setTimeout(() => setOpen(true), 0);
    const hide = window.setTimeout(() => setOpen(false), left);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
      setOpen(false);
    };
  }, [createdAt, enabled]);
  return enabled && open;
}

/** An image pasted from the clipboard, waiting in the composer to be sent. */
type StagedImage = { id: string; file: File; url: string };

const MAX_STAGED_IMAGES = 10;

/** "PNG · 420 KB" */
const imageBadge = (file: File) =>
  `${(file.type.split("/")[1] ?? "image").toUpperCase()} · ${formatBytes(file.size)}`;

/** Screenshots paste as "image.png"; give them a name worth keeping. */
function namePasted(file: File) {
  if (file.name && file.name !== "image.png" && file.name !== "image") return file;
  const ext = file.type.split("/")[1] ?? "png";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return new File([file], `screenshot-${stamp}.${ext}`, { type: file.type, lastModified: file.lastModified });
}

function Composer({
  onSend,
  onAttach,
  onSendImages,
  onVoiceNote,
  onNotice,
  editing,
  onSaveEdit,
  onCancelEdit,
}: {
  onSend: (content: string) => void;
  onAttach: (file: File) => void;
  /** Pasted images, with the typed text as their caption. */
  onSendImages: (files: File[], caption: string) => void;
  onVoiceNote: (audio: RecordedAudio) => void;
  onNotice: (message: string) => void;
  /** Editing mode: the message whose text is in the input. */
  editing: { id: string; content: string } | null;
  onSaveEdit: (content: string) => void;
  onCancelEdit: () => void;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const stopRecording = useCallback(() => setRecording(false), []);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Entering / leaving editing mode swaps the input's text (adjusted during
  // render, not in an effect). Any unsent draft comes back afterwards.
  const editingId = editing?.id ?? null;
  const [shownEditId, setShownEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  if (editingId !== shownEditId) {
    setShownEditId(editingId);
    if (editing) {
      if (shownEditId === null) setDraft(text);
      setText(editing.content);
    } else {
      setText(draft);
      setDraft("");
    }
  }

  // Focus the input with the cursor at the end when editing starts.
  useLayoutEffect(() => {
    const el = input.current;
    if (!editingId || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editingId, recording]);

  // Auto-grow up to ~6 lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, recording]);

  // --- Pasted images ----------------------------------------------------------

  const [staged, setStaged] = useState<StagedImage[]>([]);
  const showStaged = staged.length > 0 && !editing;

  function stageImages(files: File[]) {
    const accepted = files.filter((f) => ACCEPTED_IMAGE_INPUTS.includes(f.type));
    if (accepted.length < files.length) onNotice("Only JPEG, PNG, WebP, GIF and AVIF images can be pasted.");
    const room = MAX_STAGED_IMAGES - staged.length;
    if (accepted.length > room) onNotice(`You can send up to ${MAX_STAGED_IMAGES} images at once.`);
    const added = accepted.slice(0, Math.max(0, room)).map((file) => {
      const named = namePasted(file);
      return { id: crypto.randomUUID(), file: named, url: URL.createObjectURL(named) };
    });
    if (added.length === 0) return;
    setStaged((prev) => [...prev, ...added]); // another paste queues behind the first
    input.current?.focus();
  }

  function unstage(id?: string) {
    setStaged((prev) => {
      const [gone, kept] = id ? [prev.filter((s) => s.id === id), prev.filter((s) => s.id !== id)] : [prev, []];
      gone.forEach((s) => URL.revokeObjectURL(s.url));
      return kept;
    });
  }

  // Release previews when leaving the chat.
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  });
  useEffect(() => () => stagedRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  // Paste anywhere in the chat (the input or the conversation itself). Only
  // image-only clipboards are intercepted; anything with text pastes as text,
  // untouched (newlines, tabs, code) — including Office copies that also
  // carry a picture of the selection.
  const stageRef = useRef(stageImages);
  useEffect(() => {
    stageRef.current = stageImages;
  });
  useEffect(() => {
    if (editingId || recording) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const otherField =
        target &&
        target !== input.current &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.closest("[role=dialog]"));
      const data = e.clipboardData;
      if (otherField || !data || data.getData("text/plain").trim()) return;
      const files = Array.from(data.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file);
      if (files.length === 0) return;
      e.preventDefault();
      stageRef.current(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [editingId, recording]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const content = text.trim();
    if (editing) {
      if (content) onSaveEdit(content); // the text swap above restores the draft
    } else if (staged.length > 0) {
      onSendImages(
        staged.map((s) => s.file),
        content,
      );
      unstage();
      setText("");
    } else if (content) {
      onSend(content);
      setText("");
    }
    input.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && editing) {
      e.preventDefault();
      onCancelEdit();
    } else if (e.key === "Escape" && showStaged) {
      e.preventDefault();
      unstage();
    }
  }

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow picking the same file again
    files.slice(0, 10).forEach(onAttach);
  }

  if (recording) {
    return (
      <div className="flex shrink-0 items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <VoiceNoteBar onSend={onVoiceNote} onClose={stopRecording} onNotice={onNotice} />
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800">
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key="editing"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl border-l-4 border-amber-400 bg-amber-50 py-2 pr-2 pl-3 dark:bg-amber-950/30">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden>
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Editing message</p>
                <p className="truncate text-sm text-zinc-600 dark:text-zinc-300">{editing.content}</p>
              </div>
              <button
                type="button"
                onClick={onCancelEdit}
                aria-label="Cancel editing"
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-amber-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-amber-900/40 dark:hover:text-white"
              >
                Cancel <kbd className="ml-0.5 font-sans text-zinc-400">(Esc)</kbd>
              </button>
            </div>
          </motion.div>
        )}
        {showStaged && (
          <motion.div
            key="staged"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              role="group"
              aria-label="Pasted images ready to send"
              className="mx-3 mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60"
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <p className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {staged.length === 1 ? "1 image" : `${staged.length} images`} ready to send
                  </span>{" "}
                  · add a caption below, Enter to send, Esc to discard
                </p>
                <button
                  type="button"
                  onClick={() => unstage()}
                  aria-label="Discard pasted images"
                  title="Discard"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden>
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
              <ul className="flex gap-2 overflow-x-auto pb-1">
                <AnimatePresence initial={false}>
                  {staged.map((s) => (
                    <motion.li
                      key={s.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="relative size-24 shrink-0 overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800"
                    >
                      {/* Local object URL preview; next/image can't optimise blobs. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt={s.file.name} className="size-full object-cover" />
                      <span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/65 px-1 py-0.5 text-center text-[10px] font-medium text-white tabular-nums">
                        {imageBadge(s.file)}
                      </span>
                      {staged.length > 1 && (
                        <button
                          type="button"
                          onClick={() => unstage(s.id)}
                          aria-label={`Remove ${s.file.name}`}
                          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className="size-3" aria-hidden>
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={submit} className="flex items-end gap-2 p-3">
        {!editing && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_FILE_INPUT}
              multiple
              onChange={handleFiles}
              className="hidden"
              tabIndex={-1}
              aria-hidden
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Attach photo or audio"
              title="Attach photo or audio"
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5" aria-hidden>
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <circle cx="9" cy="10" r="1.8" />
                <path d="M21 16l-5-5-8 8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={MESSAGE_MAX}
          placeholder={editing ? "Edit message" : showStaged ? "Add a caption…" : "Message"}
          aria-label={editing ? "Edit message" : showStaged ? "Caption" : "Message"}
          autoFocus
          className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-4 py-2 text-[15px] outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {!editing && !showStaged && (
          <button
            type="button"
            onClick={() => setRecording(true)}
            aria-label="Record voice message"
            title="Record voice message"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
              <rect x="9" y="2.5" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
            </svg>
          </button>
        )}
        <button
          type="submit"
          disabled={!text.trim() && !showStaged}
          aria-label={editing ? "Save edit" : showStaged ? `Send ${staged.length === 1 ? "image" : `${staged.length} images`}` : "Send message"}
          title={editing ? "Save edit" : undefined}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
        >
          {editing ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12l-11.61 1.87z" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}
