import { requireOptionalNativeModule } from "expo";
import { AppState, Platform } from "react-native";
import { useCall } from "../state/calls";

type NativeLockScreen = { setEnabled(enabled: boolean): void };

const native = Platform.OS === "android" ? requireOptionalNativeModule<NativeLockScreen>("CallLockScreen") : null;

const onLockScreen = () => {
  const { phase } = useCall.getState();
  return phase === "incoming" || phase === "connecting" || phase === "active";
};

/** The app shows over the lock screen only during a call, never for the chats. */
export function startCallLockScreen() {
  if (!native) return;
  const apply = () => {
    try {
      native.setEnabled(onLockScreen());
    } catch {}
  };
  useCall.subscribe((state, previous) => {
    if (state.phase !== previous.phase) apply();
  });
  // The activity may not have existed yet when the phase changed.
  AppState.addEventListener("change", apply);
  apply();
}
