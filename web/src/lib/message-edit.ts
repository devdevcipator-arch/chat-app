import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageRow } from "@/lib/chat";
import type { Database } from "@/lib/database.types";

// Editing your own text messages. The edit_message RPC is the only write path
// and enforces everything (author, text-only, 10-minute window, non-empty).

export const EDIT_EXPIRED_MESSAGE = "Editing time limit expired (10 minutes max)";

export class EditError extends Error {
  constructor(
    message: string,
    /** The 10-minute window closed before the edit reached the server. */
    readonly expired = false,
  ) {
    super(message);
  }
}

/** Saves the new text and returns the updated row. Throws EditError. */
export async function editMessage(
  supabase: SupabaseClient<Database>,
  messageId: string,
  content: string,
): Promise<MessageRow> {
  const { data, error } = await supabase.rpc("edit_message", {
    p_message_id: messageId,
    p_new_content: content,
  });
  if (error) {
    const expired = error.hint === "edit_window_expired" || /within 10 minutes/i.test(error.message);
    if (expired) throw new EditError(EDIT_EXPIRED_MESSAGE, true);
    throw new EditError(
      ["22023", "22001", "42501"].includes(error.code) ? `${error.message}.` : "Couldn't edit the message. Please try again.",
    );
  }
  if (!data) throw new EditError("Couldn't edit the message. Please try again.");
  return data;
}
