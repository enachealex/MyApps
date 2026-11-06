package com.family.kidview.parent

import android.text.format.DateFormat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONArray
import org.json.JSONObject

/** The line under On/Off, e.g. "Bedtime · back on 7:00 AM". */
fun watchText(w: JSONObject): String {
    val until = whenText(w.longOrNull("until"))
    return when {
        w.optBoolean("override") -> w.str("reason") + if (until.isNotEmpty()) " until $until" else ""
        !w.optBoolean("on") -> w.str("reason") + if (until.isNotEmpty()) " · back on $until" else ""
        until.isNotEmpty() -> "Turns off $until"
        else -> "No schedule is limiting watching"
    }
}

private val PRESETS = listOf(
    Triple("Bedtime (school nights)", "Bedtime", jsonOf("kind" to "off", "days" to JSONArray(listOf(6, 0, 1, 2, 3)), "start" to "20:00", "end" to "07:00")),
    Triple("Weekend bedtime", "Weekend bedtime", jsonOf("kind" to "off", "days" to JSONArray(listOf(4, 5)), "start" to "21:00", "end" to "08:00")),
    Triple("School hours", "School hours", jsonOf("kind" to "off", "days" to JSONArray(listOf(0, 1, 2, 3, 4)), "start" to "08:00", "end" to "15:00")),
    Triple("After school only", "After school", jsonOf("kind" to "allowed", "days" to JSONArray(listOf(0, 1, 2, 3, 4)), "start" to "15:30", "end" to "18:00")),
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WatchingTab(vm: ParentViewModel) {
    val w = vm.watching
    val on = w.optBoolean("on")
    val schedules = vm.rules.optJSONArray("schedules")?.objects().orEmpty()
    var askHowLong by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }

    // "Add a schedule just for <child>" on the Kids tab lands here with the editor open.
    LaunchedEffect(vm.pendingSchedule) { vm.pendingSchedule?.let { editing = it; vm.pendingSchedule = null } }

    TabPage {
        item {
            Section("Watching") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (on) "On" else "Off", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, color = if (on) Ok else Bad)
                        Text(watchText(w), color = Muted, fontSize = 14.sp)
                    }
                    Switch(checked = on, onCheckedChange = { want ->
                        if (want && !w.optBoolean("override") && w.optBoolean("has_schedules")) askHowLong = true
                        else vm.setWatching(want)
                    })
                }
                if (w.optBoolean("override") && w.optBoolean("has_schedules")) {
                    OutlinedButton(onClick = { vm.resumeSchedule() }) { Text("Go back to the schedule") }
                }
                Text("A video that's playing stops within seconds when watching turns off.", color = Muted, fontSize = 12.sp)
            }
        }

        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Schedules", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("Kids' devices follow these even when offline.", color = Muted, fontSize = 13.sp)
                }
                FilledTonalButton(onClick = { editing = JSONObject() }) {
                    Icon(painterResource(R.drawable.ic_add), null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Add")
                }
            }
        }

        if (schedules.isEmpty()) {
            item {
                Section("No schedules yet", "Start from one of these and adjust it:") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        PRESETS.forEach { (label, name, s) ->
                            AssistChip(onClick = { editing = JSONObject(s.toString()).put("name", name) }, label = { Text(label) })
                        }
                    }
                }
            }
        }

        items(schedules, key = { it.str("id") }) { s ->
            ScheduleCard(s, w, appliesTo(vm, s),
                onToggle = { checked ->
                    vm.saveSchedule(JSONObject(s.toString()).put("enabled", checked),
                        if (checked) "${s.str("name")} is on" else "${s.str("name")} is switched off")
                },
                onEdit = { editing = s },
                onDelete = { deleting = s })
        }
    }

    if (askHowLong) AllowDialog(w, onPick = { minutes -> askHowLong = false; vm.setWatching(true, minutes) }) { askHowLong = false }
    editing?.let { s -> ScheduleEditor(s, vm.devices, onSave = { vm.saveSchedule(it); editing = null }) { editing = null } }
    Confirm(deleting?.let { "Delete the schedule \"${it.str("name")}\"?" }, "Delete", { deleting = null }) {
        deleting?.let { vm.deleteSchedule(it.str("id")) }
    }
}

@Composable
private fun ScheduleCard(s: JSONObject, w: JSONObject, who: String, onToggle: (Boolean) -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    val enabled = s.optBoolean("enabled")
    val off = s.str("kind") == "off"
    val inEffect = enabled && w.str("scheduled_reason") == s.str("name") &&
        (if (off) !w.optBoolean("scheduled_on") else w.optBoolean("scheduled_on"))
    val days = s.optJSONArray("days")?.let { a -> List(a.length()) { a.getInt(it) } }.orEmpty()
    Card(
        onClick = onEdit, shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White), elevation = CardDefaults.cardElevation(1.dp),
    ) {
        Row(Modifier.padding(start = 4.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = enabled, onCheckedChange = onToggle)
            Column(Modifier.weight(1f).padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(s.str("name"), fontWeight = FontWeight.Bold, fontSize = 16.sp, color = if (enabled) Color.Unspecified else Muted)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Tag(if (off) "Watching off" else "Watching allowed", if (off) Tone.Bad else Tone.Ok)
                    if (inEffect) Tag("In effect now", Tone.Warn)
                    if (!enabled) Tag("Switched off", Tone.Warn)
                }
                Text("${daysLabel(days)} · ${scheduleTimes(s.str("start"), s.str("end"))} · $who", color = Muted, fontSize = 13.sp)
            }
            IconButton(onClick = onDelete) { Icon(painterResource(R.drawable.ic_delete), "Delete", tint = Muted) }
        }
    }
}

@Composable
private fun AllowDialog(w: JSONObject, onPick: (Int?) -> Unit, onCancel: () -> Unit) {
    val until = whenText(w.longOrNull("scheduled_until"))
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Turn watching on?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${w.str("reason").ifBlank { "A schedule" }} has watching off" + (if (until.isNotEmpty()) " until $until." else "."))
                Spacer(Modifier.height(4.dp))
                listOf(30 to "For 30 minutes", 60 to "For 1 hour", 120 to "For 2 hours").forEach { (m, label) ->
                    OutlinedButton(onClick = { onPick(m) }, modifier = Modifier.fillMaxWidth()) { Text(label) }
                }
                if (until.isNotEmpty()) OutlinedButton(onClick = { onPick(null) }, modifier = Modifier.fillMaxWidth()) { Text("Until $until") }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
    )
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun ScheduleEditor(initial: JSONObject, devices: List<JSONObject>, onSave: (JSONObject) -> Unit, onDismiss: () -> Unit) {
    val isNew = initial.str("id").isEmpty()
    var name by remember { mutableStateOf(initial.str("name")) }
    var kind by remember { mutableStateOf(initial.str("kind").ifEmpty { "off" }) }
    val days = remember {
        mutableStateListOf<Int>().apply { initial.optJSONArray("days")?.let { a -> repeat(a.length()) { add(a.getInt(it)) } } }
    }
    var start by remember { mutableStateOf(initial.str("start").ifEmpty { "20:00" }) }
    var end by remember { mutableStateOf(initial.str("end").ifEmpty { "07:00" }) }
    var enabled by remember { mutableStateOf(if (initial.has("enabled")) initial.optBoolean("enabled") else true) }
    // Which kids' devices it applies to. Empty = every device.
    val targets = remember { mutableStateListOf<String>().apply { addAll(initial.optJSONArray("devices")?.strings().orEmpty()) } }
    var picking by remember { mutableStateOf<String?>(null) }  // "start" | "end"
    var error by remember { mutableStateOf<String?>(null) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(shape = RoundedCornerShape(24.dp), color = Color.White, modifier = Modifier.fillMaxWidth(0.94f)) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(if (isNew) "New schedule" else "Edit schedule", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                OutlinedTextField(name, { name = it.take(40) }, label = { Text("Name") }, placeholder = { Text("Bedtime") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())

                Text("What happens", fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = kind == "off", onClick = { kind = "off" }, label = { Text("Watching off") })
                    FilterChip(selected = kind == "allowed", onClick = { kind = "allowed" }, label = { Text("Only allowed then") })
                }
                Text(if (kind == "off") "Watching is turned off during this time."
                    else "On these days, watching only works during this time.", color = Muted, fontSize = 13.sp)

                Text("Days", fontWeight = FontWeight.SemiBold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    DAYS.forEachIndexed { i, d ->
                        FilterChip(selected = i in days, onClick = { if (i in days) days.remove(i) else days.add(i) }, label = { Text(d) })
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("Every day" to (0..6).toList(), "Weekdays" to listOf(0, 1, 2, 3, 4), "Weekends" to listOf(5, 6),
                        "School nights" to listOf(6, 0, 1, 2, 3)).forEach { (label, set) ->
                        TextButton(onClick = { days.clear(); days.addAll(set) }) { Text(label, fontSize = 13.sp) }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("From", color = Muted, fontSize = 12.sp)
                        OutlinedButton(onClick = { picking = "start" }, modifier = Modifier.fillMaxWidth()) { Text(hhmmText(start), fontSize = 16.sp) }
                    }
                    Column(Modifier.weight(1f)) {
                        Text("To", color = Muted, fontSize = 12.sp)
                        OutlinedButton(onClick = { picking = "end" }, modifier = Modifier.fillMaxWidth()) { Text(hhmmText(end), fontSize = 16.sp) }
                    }
                }
                if (start == end) Text("Same time = all day", color = Muted, fontSize = 13.sp)
                else if (end < start) Text("Runs overnight into the next day", color = Muted, fontSize = 13.sp)

                Text("Applies to", fontWeight = FontWeight.SemiBold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    FilterChip(selected = targets.isEmpty(), onClick = { targets.clear() }, label = { Text("Every device") })
                    devices.forEach { d ->
                        val id = d.str("id")
                        FilterChip(selected = id in targets, onClick = { if (id in targets) targets.remove(id) else targets.add(id) },
                            label = { Text(d.str("name")) })
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { enabled = !enabled }) {
                    Checkbox(checked = enabled, onCheckedChange = { enabled = it })
                    Text("Apply this schedule now")
                }
                error?.let { Text(it, color = Bad) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.align(Alignment.End)) {
                    TextButton(onClick = onDismiss) { Text("Cancel") }
                    Button(onClick = {
                        when {
                            days.isEmpty() -> error = "Pick at least one day"
                            else -> onSave(jsonOf(
                                "id" to initial.str("id").ifEmpty { null }, "name" to name.ifBlank { "Schedule" }, "kind" to kind,
                                "days" to JSONArray(days.sorted()), "start" to start, "end" to end, "enabled" to enabled,
                                "devices" to JSONArray(targets.toList()),
                            ))
                        }
                    }) { Text("Save") }
                }
            }
        }
    }

    picking?.let { which ->
        val current = if (which == "start") start else end
        val state = rememberTimePickerState(current.take(2).toInt(), current.takeLast(2).toInt(), DateFormat.is24HourFormat(LocalContext.current))
        AlertDialog(
            onDismissRequest = { picking = null },
            title = { Text(if (which == "start") "From" else "To") },
            text = { TimePicker(state = state) },
            confirmButton = {
                TextButton(onClick = {
                    val v = "%02d:%02d".format(state.hour, state.minute)
                    if (which == "start") start = v else end = v
                    picking = null
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { picking = null }) { Text("Cancel") } },
        )
    }
}
