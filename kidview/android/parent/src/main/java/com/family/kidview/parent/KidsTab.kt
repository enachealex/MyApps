package com.family.kidview.parent

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

/** Activity tab: everything that happened, with filters (including one child at a time). */
@Composable
fun ActivityTab(vm: ParentViewModel) {
    TabPage { everyone(vm) }
}

/**
 * Kids tab: "Library" (the offline videos every kid's device saves), then one chip per child
 * showing what they're recommended and their own restrictions.
 */
@Composable
fun KidsTab(vm: ParentViewModel) {
    var removing by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    TabPage {
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = vm.kidSel == null, onClick = { vm.selectKid(null) }, label = { Text("Library") },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_download), null, Modifier.size(18.dp)) })
                vm.devices.forEach { d ->
                    FilterChip(selected = vm.kidSel == d.str("id"), onClick = { vm.selectKid(d.str("id")) }, label = { Text(d.str("name")) })
                }
            }
        }
        if (vm.kidSel == null) libraryItems(vm) { removing = it } else oneKid(vm)
    }
    Confirm(removing?.let { "Remove ${it.third} from the offline library? It will be deleted from the kids' devices too." }, "Remove",
        { removing = null }) { removing?.let { vm.listRemove(it.first, it.second) } }
}

// ------------------------------------------------------------------ everyone, with filters

private val KINDS = listOf("" to "All", "watch" to "Watched", "saved" to "Saved videos", "search" to "Searches",
    "blocked" to "Blocked", "change" to "Changes")
private val RANGES = listOf("today" to "Today", "24h" to "24 hours", "week" to "7 days", "all" to "All kept")

private fun LazyListScope.everyone(vm: ParentViewModel) {
    item {
        val f = vm.filter
        val days = vm.rules.optInt("activity_days", 7)
        Section("Activity", "Searches, videos and changes from the past $days days. Older activity is deleted automatically.") {
            ActivityFilters(vm)
            OutlinedTextField(
                value = f.text, onValueChange = { vm.updateFilter(f.copy(text = it), debounce = true) },
                placeholder = { Text("Find a video, channel, search or change", fontSize = 14.sp) },
                singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
                leadingIcon = { Icon(painterResource(R.drawable.ic_search), null) },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                val n = vm.activity.length()
                Text("$n${if (n >= 500) "+" else ""} event${if (n == 1) "" else "s"}", color = Muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                if (f != ActivityFilter()) TextButton(onClick = { vm.updateFilter(ActivityFilter()) }) { Text("Clear filters") }
            }
        }
    }
    val events = vm.activity.objects()
    if (events.isEmpty()) item { Empty("Nothing matches these filters") }
    items(events, key = { "e" + it.optLong("id") }) { e -> ActivityRow(vm, e) }
}

/** Type, When and Who: three buttons, each opening a wheel of choices. */
@Composable
private fun ActivityFilters(vm: ParentViewModel) {
    val f = vm.filter
    val parents = vm.state?.optJSONArray("parents")?.objects().orEmpty().map { it.str("name") }
    val who = listOf("" to "Everyone") + vm.devices.map { "d:" + it.str("id") to it.str("name") } +
        (listOf("PC dashboard") + parents).map { "p:$it" to "$it (changes)" }
    var picking by remember { mutableStateOf<String?>(null) }
    fun label(options: List<Pair<String, String>>, value: String) = options.firstOrNull { it.first == value }?.second ?: options[0].second

    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PickerButton("Type", label(KINDS, f.kind), f.kind != "", Modifier.weight(1f)) { picking = "type" }
        PickerButton("When", label(RANGES, f.range), f.range != "week", Modifier.weight(1f)) { picking = "when" }
        PickerButton("Who", label(who, f.who), f.who != "", Modifier.weight(1f)) { picking = "who" }
    }
    when (picking) {
        "type" -> WheelPickerSheet("Type of activity", KINDS, f.kind, { picking = null }) {
            picking = null; vm.updateFilter(f.copy(kind = it))
        }
        "when" -> WheelPickerSheet("When", RANGES, f.range, { picking = null }) {
            picking = null; vm.updateFilter(f.copy(range = it))
        }
        "who" -> WheelPickerSheet("Who", who, f.who, { picking = null }) {
            picking = null; vm.updateFilter(f.copy(who = it))
        }
    }
}

/** One line of activity, with block/allow actions. [scoped] = on a child's page (blocks can be just for them). */
@Composable
fun ActivityRow(vm: ParentViewModel, e: JSONObject) {
    val context = LocalContext.current
    val kind = e.str("kind")
    val video = JSONObject(e.toString()).put("id", e.str("video_id"))
    // Things a kid did can be blocked for everyone, or just for that kid's device.
    val deviceId = e.str("device_id").takeIf { kind != "change" && it.isNotEmpty() && vm.devices.any { d -> d.str("id") == it } }
    val who = deviceId?.let { vm.deviceName(it) }
    fun blockBoth(label: String, key: String, item: JSONObject, done: String) = buildList {
        add(VideoAction("$label for everyone", true) { vm.listAdd(key, item, done) })
        if (deviceId != null) add(VideoAction("$label just for $who", true) { vm.listAdd(key, item, "$done for $who", device = deviceId) })
    }
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (e.str("video_id").isNotEmpty()) Thumb(vm.api, e.str("video_id"), 88)
            else Box(Modifier.size(40.dp).clip(CircleShape).background(when (kind) { "change" -> WarnSoft; "blocked_search" -> BadSoft; else -> Color(0xFFE8E2FF) }),
                contentAlignment = Alignment.Center) {
                Icon(painterResource(if (kind == "change") R.drawable.ic_settings else R.drawable.ic_search), null, Modifier.size(20.dp),
                    tint = when (kind) { "change" -> Warn; "blocked_search" -> Bad; else -> Purple })
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                when (kind) {
                    "change" -> Text(e.str("reason"), fontSize = 14.sp)
                    "search" -> Text("Searched \"${e.str("query")}\" · ${e.optInt("results")} results", fontSize = 14.sp)
                    "blocked_search" -> { Text("Searched \"${e.str("query")}\"", fontSize = 14.sp); Tag("Blocked · ${e.str("reason")}", Tone.Bad) }
                    else -> {
                        Text(e.str("title"), maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                        Text(e.str("channel"), color = Muted, fontSize = 12.sp, maxLines = 1)
                        if (kind == "blocked_watch") Tag("Stopped · ${e.str("reason")}", Tone.Bad)
                        if (kind == "watch_saved") Tag("Saved video", Tone.Ok)
                    }
                }
                Text("${e.str("device")} · ${agoText(e.optDouble("ts"))}", color = Muted, fontSize = 12.sp)
            }
            ActionsMenu(when (kind) {
                "search" -> buildList {
                    add(VideoAction("See results") { vm.searchQuery = e.str("query"); vm.tab = Tab.Search; vm.search(e.str("query")) })
                    addAll(blockBoth("Block this search", "blocked_words", jsonOf("word" to e.str("query").lowercase()), "Blocked \"${e.str("query")}\""))
                }
                "watch", "watch_saved" -> buildList {
                    addAll(blockBoth("Block video", "blocked_videos", videoItem(video), "Video blocked"))
                    if (e.str("channel_id").isNotEmpty()) addAll(blockBoth("Block channel", "blocked_channels", channelItem(e), "Blocked ${e.str("channel")}"))
                    add(VideoAction("Watch on YouTube") { openOnYouTube(context, e.str("video_id")) })
                }
                "blocked_watch" -> listOf(
                    VideoAction("Allow this video") { vm.listAdd("approved_videos", videoItem(video), "Allowed, and added to Picks") },
                    VideoAction("Watch on YouTube") { openOnYouTube(context, e.str("video_id")) },
                )
                else -> emptyList()
            })
        }
    }
}

// ------------------------------------------------------------------ one child

private fun LazyListScope.oneKid(vm: ParentViewModel) {
    val k = vm.kidData
    if (k == null) {
        item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
        return
    }
    item { KidHeader(vm, k) }
    item {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("recommended" to "Recommended", "restrictions" to "Restrictions").forEach { (t, label) ->
                FilterChip(selected = vm.kidTab == t, onClick = {
                    vm.kidTab = t
                    if (t == "recommended" && vm.kidRec == null) vm.loadKidRec()
                }, label = { Text(label) })
            }
        }
    }
    when (vm.kidTab) {
        "restrictions" -> restrictions(vm, k)
        else -> recommended(vm)
    }
}

@Composable
private fun KidHeader(vm: ParentViewModel, k: JSONObject) {
    val d = k.getJSONObject("device")
    val w = k.getJSONObject("watching")
    val st = k.getJSONObject("stats")
    val top = st.optJSONArray("top_channels")?.objects().orEmpty()
    Section(d.str("name"), "Last used ${agoText(d.optDouble("last_seen"))}") {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tag(if (w.optBoolean("on")) "Can watch now" else "Watching off", if (w.optBoolean("on")) Tone.Ok else Tone.Bad)
            Text(watchText(w), color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Stat("${st.optInt("watches_7d")}", if (st.optInt("watches_7d") == 1) "video this week" else "videos this week", Modifier.weight(1f))
            Stat("${st.optInt("searches_7d")}", if (st.optInt("searches_7d") == 1) "search this week" else "searches this week", Modifier.weight(1f))
        }
        if (top.isNotEmpty()) Text("Watches most: " + top.take(3).joinToString(" · ") { "${it.str("channel")} (${it.optInt("count")})" },
            fontSize = 13.sp, color = Muted)
        OutlinedButton(onClick = { vm.showActivityFor(d.str("id")) }) { Text("See ${d.str("name")}'s activity") }
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier) {
    Column(modifier.background(Color(0xFFF6F5FA), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Text(value, fontWeight = FontWeight.Bold, fontSize = 20.sp)
        Text(label, color = Muted, fontSize = 12.sp)
    }
}

@Composable
private fun ScopeSwitch(vm: ParentViewModel) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Blocks apply to", color = Muted, fontSize = 13.sp)
        FilterChip(selected = vm.blockForKidOnly, onClick = { vm.blockForKidOnly = true }, label = { Text("Just ${vm.kidName}") })
        FilterChip(selected = !vm.blockForKidOnly, onClick = { vm.blockForKidOnly = false }, label = { Text("Everyone") })
    }
}

private fun LazyListScope.recommended(vm: ParentViewModel) {
    val rec = vm.kidRec
    if (rec == null) {
        item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
        return
    }
    item {
        val basedOn = rec.optJSONArray("based_on")?.strings().orEmpty()
        Text(if (rec.optBoolean("personal")) "Exactly what ${vm.kidName} sees on Home, based on what they watch most: ${basedOn.joinToString(", ")}."
            else "${vm.kidName} hasn't watched much yet, so they see a starter mix of funny and educational videos.",
            color = Muted, fontSize = 13.sp)
    }
    item { ScopeSwitch(vm) }
    rec.optJSONArray("sections")?.objects().orEmpty().forEach { sec ->
        item { Text(sec.str("title"), fontWeight = FontWeight.Bold, fontSize = 17.sp) }
        val videos = sec.optJSONArray("videos")?.objects().orEmpty()
        items(videos, key = { sec.str("title") + it.str("id") }) { v ->
            VideoRow(vm, v, actions = listOf(
                VideoAction("Block video", true) { vm.blockFromKids("blocked_videos", videoItem(v), "Video blocked") },
                VideoAction("Block channel", true) { vm.blockFromKids("blocked_channels", channelItem(v), "Blocked ${v.str("channel")}") },
                VideoAction("Add to Picks") { vm.listAdd("approved_videos", videoItem(v), "Added to Picks") },
            ))
        }
    }
}

private fun LazyListScope.restrictions(vm: ParentViewModel, k: JSONObject) {
    val lim = k.getJSONObject("limits")
    val fam = k.getJSONObject("family")
    val id = vm.kidSel ?: return
    val name = vm.kidName
    item {
        Section("Limits for $name", "These add to your family rules. \"Family setting\" follows the Rules tab.") {
            SwitchRow("Watching on this device", "Off = $name can't watch anything, even saved videos", lim.optBoolean("watching", true)) {
                vm.setKidLimit("watching", it)
            }
            OptionRow("Searching", lim.opt("search_enabled"), familyOption(fam.optBoolean("search_enabled", true).let { if (it) "On" else "Off" }),
                listOf(true to "On", false to "Off")) { vm.setKidLimit("search_enabled", it) }
            OptionRow("What can they find?", lim.opt("mode"), familyOption(if (fam.str("mode") == "allowlist") "Approved" else "Filtered"),
                listOf("blocklist" to "Filtered", "allowlist" to "Approved")) { vm.setKidLimit("mode", it) }
            OptionRow("Longest video", lim.opt("max_minutes"), familyOption(fam.optInt("max_minutes").let { if (it == 0) "No limit" else "$it min" }),
                listOf(0 to "No limit", 10 to "10 min", 15 to "15 min", 20 to "20 min", 30 to "30 min", 45 to "45 min", 60 to "1 hour")) {
                vm.setKidLimit("max_minutes", it)
            }
            OptionRow("Shorts", lim.opt("block_shorts"), familyOption(if (fam.optBoolean("block_shorts", true)) "Hidden" else "Allowed"),
                listOf(true to "Hidden", false to "Allowed")) { vm.setKidLimit("block_shorts", it) }
        }
    }
    item {
        val schedules = k.optJSONArray("schedules")?.objects().orEmpty()
        Section("Schedules for $name", "Every-device schedules, plus any just for $name.") {
            if (schedules.isEmpty()) Empty("No schedules")
            schedules.forEach { s ->
                val days = s.optJSONArray("days")?.let { a -> List(a.length()) { a.getInt(it) } }.orEmpty()
                Column(Modifier.padding(vertical = 4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(s.str("name"), fontWeight = FontWeight.SemiBold)
                        Tag(if (s.str("kind") == "off") "Watching off" else "Watching allowed", if (s.str("kind") == "off") Tone.Bad else Tone.Ok)
                        if (!s.optBoolean("enabled")) Tag("Switched off", Tone.Warn)
                    }
                    Text("${daysLabel(days)} · ${scheduleTimes(s.str("start"), s.str("end"))} · ${appliesTo(vm, s)}", color = Muted, fontSize = 12.sp)
                }
            }
            OutlinedButton(onClick = {
                vm.pendingSchedule = jsonOf("devices" to JSONArray(listOf(id)))
                vm.tab = Tab.Watching
            }) { Text("Add a schedule just for $name") }
        }
    }
    item {
        Section("Extra blocked words", "Only for $name, on top of the family list.") {
            AddRow("Add words, separated by commas", "Add") { text ->
                text.split(",").map { it.trim() }.filter { it.isNotEmpty() }.forEach {
                    vm.listAdd("blocked_words", jsonOf("word" to it), "Blocked \"$it\" for $name", device = id)
                }
            }
            WordChips(lim.optJSONArray("blocked_words")?.strings().orEmpty()) { vm.listRemove("blocked_words", it, device = id) }
        }
    }
    listOf(
        Triple("blocked_channels", "Blocked channels", "Nothing from these for $name."),
        Triple("allowed_channels", "Allowed channels", "Extra channels $name can watch when set to Approved."),
        Triple("blocked_videos", "Blocked videos", "Single videos blocked for $name."),
    ).forEach { (key, title, sub) ->
        item {
            val kind = if (key == "blocked_videos") "video" else "channel"
            val list = lim.optJSONArray(key)?.objects().orEmpty()
            Section(title, sub) {
                AddRow(if (kind == "channel") "Channel link or @handle" else "YouTube video link", "Add") { vm.addByLink(kind, it, key, device = id) }
                if (list.isEmpty()) Empty("None")
                list.forEach { i ->
                    ItemRow(i.str("title").ifEmpty { i.str("name") }, i.str("channel").ifEmpty { null }, vm.api,
                        if (kind == "video") i.str("id") else null) { vm.listRemove(key, i.str("id"), device = id) }
                }
            }
        }
    }
}

private fun familyOption(label: String) = "Family setting ($label)"

fun appliesTo(vm: ParentViewModel, s: JSONObject): String {
    val ids = s.optJSONArray("devices")?.strings().orEmpty()
    return if (ids.isEmpty()) "Every device" else "Only " + ids.joinToString(", ") { vm.deviceName(it) }
}

/** A setting that can follow the family rule (null) or be set just for this child. */
@Composable
private fun OptionRow(title: String, current: Any?, familyLabel: String, options: List<Pair<Any, String>>, onPick: (Any?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val value = if (current == null || current == JSONObject.NULL) null else current
    val all: List<Pair<Any?, String>> = listOf<Pair<Any?, String>>(null to familyLabel) + options
    val label = all.firstOrNull { (v, _) -> v == value || (v is Number && value is Number && v.toInt() == value.toInt()) }?.second ?: familyLabel
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(title, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Box {
            OutlinedButton(onClick = { open = true }) { Text(label, maxLines = 1) }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                all.forEach { (v, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { open = false; onPick(v) }) }
            }
        }
    }
}
