// OPTIONAL Android plugin (most people should use the Home Assistant Companion sensors instead – see docs/mobile.md): measures time spent in OTHER Bible apps (e.g. YouVersion)
// using Android's UsageStatsManager, so Tolle can log it and prompt you for the chapter.
//
// Install: copy this file to
//   android/app/src/main/java/io/github/shotgn16/tolle/BibleUsagePlugin.kt
// enable Kotlin in android/app/build.gradle (plugins { id 'org.jetbrains.kotlin.android' }),
// and register it in MainActivity.java:
//   public class MainActivity extends BridgeActivity {
//     @Override public void onCreate(Bundle savedInstanceState) {
//       registerPlugin(BibleUsagePlugin.class); super.onCreate(savedInstanceState);
//     }
//   }
// and add to AndroidManifest.xml (inside <manifest>):
//   <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS"
//       xmlns:tools="http://schemas.android.com/tools" tools:ignore="ProtectedPermissions" />
//
// NOTE: Google Play only allows PACKAGE_USAGE_STATS for apps whose core purpose needs it and
// requires a declaration form. Consider shipping this only in a sideloaded / F-Droid build.
package io.github.shotgn16.tolle

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "BibleUsage")
class BibleUsagePlugin : Plugin() {

    private fun granted(): Boolean {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    @PluginMethod
    fun hasPermission(call: PluginCall) {
        call.resolve(JSObject().put("granted", granted()))
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        activity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        call.resolve()
    }

    /** usage({ packages: ["com.sirma.mobile.bible.android"], since: <epoch ms> }) → { apps: [{ package, minutes, lastUsed }] } */
    @PluginMethod
    fun usage(call: PluginCall) {
        if (!granted()) { call.reject("Usage access not granted"); return }
        val wanted = call.getArray("packages", JSArray()).toList<String>().toSet()
        val since = call.getLong("since") ?: (System.currentTimeMillis() - 86_400_000L)
        val now = System.currentTimeMillis()
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val events = usm.queryEvents(since, now)
        val started = HashMap<String, Long>()
        val total = HashMap<String, Long>()
        val last = HashMap<String, Long>()
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            if (e.packageName !in wanted) continue
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> started[e.packageName] = e.timeStamp
                UsageEvents.Event.ACTIVITY_PAUSED -> started.remove(e.packageName)?.let {
                    total[e.packageName] = (total[e.packageName] ?: 0L) + (e.timeStamp - it)
                    last[e.packageName] = e.timeStamp
                }
            }
        }
        val apps = JSArray()
        for ((pkg, ms) in total) {
            apps.put(JSObject().put("package", pkg).put("minutes", ms / 60000.0).put("lastUsed", last[pkg] ?: now))
        }
        call.resolve(JSObject().put("apps", apps))
    }
}
