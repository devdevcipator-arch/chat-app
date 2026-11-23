package expo.modules.calllockscreen

import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lets the activity appear over the lock screen only while a call is ringing
 * or in progress. It is deliberately not a manifest flag: that would show
 * every chat on a locked phone.
 */
class CallLockScreenModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallLockScreen")

    Function("setEnabled") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          activity.setShowWhenLocked(enabled)
          activity.setTurnScreenOn(enabled)
        } else {
          @Suppress("DEPRECATION")
          val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          if (enabled) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
        }
      }
    }
  }
}
