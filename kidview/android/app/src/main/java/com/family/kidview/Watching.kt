package com.family.kidview

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Whether watching is allowed right now.
 *
 * The server sends the times watching is off over the next week (schedules plus any
 * parent override). We keep that list so bedtime still works when the device is offline.
 */
object Watching {

    /** Remember what the server said. [o] is a /api/home or /api/library response. */
    fun save(ctx: Context, o: JSONObject) {
        val p = Prefs(ctx)
        p.lastPaused = o.optBoolean("paused")
        o.optJSONArray("off_periods")?.let {
            p.offPeriods = it.toString()
            p.periodsUntil = o.optLong("periods_until")
        }
    }

    private fun now() = System.currentTimeMillis() / 1000

    private fun periods(p: Prefs): List<LongArray>? {
        val text = p.offPeriods ?: return null
        val arr = runCatching { JSONArray(text) }.getOrNull() ?: return null
        return List(arr.length()) { i -> arr.getJSONArray(i).let { longArrayOf(it.getLong(0), it.getLong(1)) } }
    }

    fun pausedNow(ctx: Context): Boolean {
        val p = Prefs(ctx)
        val list = periods(p)
        if (list == null || now() >= p.periodsUntil) return p.lastPaused
        return list.any { now() >= it[0] && now() < it[1] }
    }

    /** When watching comes back, if it's off now and we know. */
    fun backAt(ctx: Context): Long? {
        val p = Prefs(ctx)
        val end = periods(p)?.firstOrNull { now() >= it[0] && now() < it[1] }?.get(1) ?: return null
        return end.takeIf { it < p.periodsUntil }
    }

    /** "Back at 7:00 AM", "Back tomorrow at 7:00 AM", "Back on Saturday at 9:00 AM". */
    fun backText(backAt: Long?): String {
        if (backAt == null) return "See you later!"
        val date = Date(backAt * 1000)
        val clock = DateFormat.getTimeInstance(DateFormat.SHORT).format(date)
        fun midnight(d: Date): Long {
            val c = Calendar.getInstance()
            c.setTime(d)
            c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
            return c.timeInMillis
        }
        return when (Math.round((midnight(date) - midnight(Date())) / 86_400_000.0)) {
            0L -> "Back at $clock"
            1L -> "Back tomorrow at $clock"
            else -> "Back on ${SimpleDateFormat("EEEE", Locale.getDefault()).format(date)} at $clock"
        }
    }
}
