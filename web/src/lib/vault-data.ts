import { createClient } from "@/lib/supabase/server";
import { toGalleryItem, type GalleryItem } from "@/lib/vault";

export const GALLERY_PAGE_SIZE = 500;

/** The signed-in user's gallery, newest first (RLS-scoped). */
export async function getMyGallery(): Promise<GalleryItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_gallery")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(GALLERY_PAGE_SIZE);
  if (error) {
    console.error("user_gallery read failed:", error.message);
    return [];
  }
  return data.map(toGalleryItem);
}
