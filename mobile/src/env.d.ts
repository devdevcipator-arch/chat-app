/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    EXPO_PUBLIC_API_BASE_URL?: string;
    EXPO_PUBLIC_R2_PUBLIC_BASE?: string;
  }
}
