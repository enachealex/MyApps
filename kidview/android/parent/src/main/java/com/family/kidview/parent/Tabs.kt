package com.family.kidview.parent

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

// ------------------------------------------------------------------ shared by Search and Kids

data class VideoAction(val label: String, val danger: Boolean = false, val run: () -> Unit)

@Composable
fun ActionsMenu(actions: List<VideoAction>) {
    if (actions.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(painterResource(R.drawable.ic_more), "More", tint = Muted) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            actions.forEach { a ->
                DropdownMenuItem(text = { Text(a.label, color = if (a.danger) Bad else Color.Unspecified) },
                    onClick = { open = false; a.run() })
            }
        }
    }
}

fun videoItem(v: JSONObject) = jsonOf("id" to v.str("id"), "title" to v.str("title"), "channel" to v.str("channel"),
    "channel_id" to v.str("channel_id"), "duration" to v.opt("duration"))

fun channelItem(v: JSONObject) = jsonOf("id" to v.str("channel_id"), "name" to v.str("channel"))

/** A video card used in Search and in a child's Recommended list. */
@Composable
fun VideoRow(vm: ParentViewModel, v: JSONObject, tag: @Composable (() -> Unit)? = null, actions: List<VideoAction>) {
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Thumb(vm.api, v.str("id"), 120)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(v.str("title"), maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(v.str("channel") + (v.longOrNull("duration")?.let { " · " + duration(it.toInt()) } ?: ""),
                    color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                tag?.invoke()
            }
            ActionsMenu(actions)
        }
    }
}

// ------------------------------------------------------------------ Search

@Composable
fun SearchTab(vm: ParentViewModel) {
    val focus = LocalFocusManager.current
    val context = LocalContext.current
    val result = vm.searchResult
    val allowed = vm.rules.optJSONArray("allowed_channels")?.objects().orEmpty().map { it.str("id") }.toSet()
    val items = result?.optJSONArray("results")?.objects().orEmpty()

    TabPage {
        item {
            OutlinedTextField(
                value = vm.searchQuery, onValueChange = { vm.searchQuery = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Search like your kids would") }, singleLine = true,
                leadingIcon = { Icon(painterResource(R.drawable.ic_search), null) },
                shape = RoundedCornerShape(28.dp),
                colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Color.White, focusedContainerColor = Color.White),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focus.clearFocus(); vm.search(vm.searchQuery) }),
            )
        }
        when {
            vm.searching -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            result == null -> item {
                Text("See exactly what your kids would see. Hidden videos show why, and you can block or allow anything from here.", color = Muted)
            }
            else -> {
                item {
                    val shown = items.count { it.str("reason").isEmpty() }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (result.str("query_reason").isNotEmpty()) {
                            Text("Kids would see nothing: ${result.str("query_reason")}", color = Bad, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        } else {
                            Tag("$shown shown", Tone.Ok); Tag("${items.size - shown} hidden", Tone.Warn)
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = {
                                vm.listAdd("blocked_words", jsonOf("word" to vm.searchQuery.trim().lowercase()), "Blocked \"${vm.searchQuery.trim()}\"")
                            }) { Text("Block this search", color = Bad) }
                        }
                    }
                }
                items(items, key = { it.str("id") }) { v ->
                    val reason = v.str("reason")
                    VideoRow(vm, v, tag = { if (reason.isEmpty()) Tag("Shown", Tone.Ok) else Tag("Hidden · $reason", Tone.Bad) }, actions = buildList {
                        add(VideoAction("Block video", true) { vm.listAdd("blocked_videos", videoItem(v), "Video blocked") })
                        add(VideoAction("Block channel", true) { vm.listAdd("blocked_channels", channelItem(v), "Blocked ${v.str("channel")}") })
                        if (v.str("channel_id") !in allowed) add(VideoAction("Allow channel") {
                            vm.listAdd("allowed_channels", channelItem(v), "Allowed ${v.str("channel")}")
                        })
                        add(VideoAction("Add to Picks") { vm.listAdd("approved_videos", videoItem(v), "Added to Picks") })
                        if (reason.isEmpty()) add(VideoAction("Save offline") { vm.listAdd("library_videos", videoItem(v), "Saving offline") })
                        add(VideoAction("Watch on YouTube") { openOnYouTube(context, v.str("id")) })
                    })
                }
            }
        }
    }
}

// ------------------------------------------------------------------ Rules

@Composable
fun RulesTab(vm: ParentViewModel) {
    val r = vm.rules
    val topics = vm.state?.optJSONObject("topics") ?: JSONObject()
    val words = r.optJSONArray("blocked_words")?.strings().orEmpty()
    var removing by remember { mutableStateOf<Triple<String, String, String>?>(null) }  // key, id, label

    TabPage {
        item {
            Section("Blocked topics", "One switch blocks a whole topic in searches, titles, channels, descriptions and tags.") {
                topics.keys().asSequence().toList().forEach { name ->
                    val list = topics.getJSONArray(name).strings()
                    SwitchRow(name, list.take(5).joinToString(", ") + if (list.size > 5) ", …" else "", list.all { it in words }) { vm.setTopic(name, it) }
                }
            }
        }
        item {
            Section("What can they find?") {
                val allow = r.str("mode") == "allowlist"
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !allow, onClick = { vm.setRule("mode", "blocklist") }, label = { Text("Filtered") })
                    FilterChip(selected = allow, onClick = { vm.setRule("mode", "allowlist") }, label = { Text("Approved") })
                }
                Text(if (allow) "Approved: only allowed channels and your Picks can be watched." else "Filtered: anything on YouTube except what your rules hide.",
                    color = Muted, fontSize = 13.sp)
            }
        }
        item {
            Section("Blocked words", "Short words (5 letters or fewer) only match whole words.") {
                AddRow("Add words, separated by commas", "Add") { text ->
                    text.split(",").map { it.trim() }.filter { it.isNotEmpty() }.forEach { vm.listAdd("blocked_words", jsonOf("word" to it), "Blocked \"$it\"") }
                }
                WordChips(words) { removing = Triple("blocked_words", it, "\"$it\"") }
            }
        }
        item { LinkList(vm, "Allowed channels", "Used when \"What can they find?\" is set to Approved.", "allowed_channels", "channel", "Channel link or @handle") { removing = it } }
        item { LinkList(vm, "Blocked channels", "Nothing from these ever shows up.", "blocked_channels", "channel", "Channel link or @handle") { removing = it } }
        item { LinkList(vm, "Picks", "Shown on the kids' home screen and always allowed.", "approved_videos", "video", "YouTube video link") { removing = it } }
        item { LinkList(vm, "Blocked videos", null, "blocked_videos", "video", "YouTube video link") { removing = it } }
    }

    Confirm(removing?.let { "Remove ${it.third}?" }, "Remove", { removing = null }) {
        removing?.let { vm.listRemove(it.first, it.second) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WordChips(words: List<String>, onRemove: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        words.forEach { w ->
            InputChip(selected = false, onClick = { onRemove(w) }, label = { Text(w, fontSize = 13.sp) },
                trailingIcon = { Icon(painterResource(R.drawable.ic_close), "Remove", Modifier.size(16.dp)) })
        }
    }
}

@Composable
private fun LinkList(vm: ParentViewModel, title: String, subtitle: String?, key: String, kind: String, placeholder: String,
                     onRemove: (Triple<String, String, String>) -> Unit) {
    val items = vm.rules.optJSONArray(key)?.objects().orEmpty()
    Section(title, subtitle) {
        AddRow(placeholder, "Add") { vm.addByLink(kind, it, key) }
        if (items.isEmpty()) Empty("None yet")
        items.forEach { i ->
            val label = if (kind == "channel") i.str("name") else i.str("title")
            ItemRow(label, if (kind == "video") i.str("channel") else null, vm.api, if (kind == "video") i.str("id") else null) {
                onRemove(Triple(key, i.str("id"), label))
            }
        }
    }
}

// ------------------------------------------------------------------ Library

/** The offline library, shown under Kids → Library. */
fun androidx.compose.foundation.lazy.LazyListScope.libraryItems(vm: ParentViewModel, onRemove: (Triple<String, String, String>) -> Unit) {
    val lib = vm.library
    val r = vm.rules
    val items = lib?.optJSONArray("items")?.objects().orEmpty()
    run {
        item {
            Section("Offline library", "Your PC downloads these, and kids' devices copy them on home Wi-Fi to watch with no internet.",
                action = { TextButton(onClick = { vm.syncLibrary() }) { Text("Check now") } }) {
                if (lib == null) Text("Loading…", color = Muted)
                else {
                    val ready = items.count { it.str("state") == "ready" }
                    val waiting = items.count { it.str("state") in listOf("waiting", "downloading") }
                    val gb = lib.optLong("total_size") / 1e9
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Tag("$ready ready · " + if (gb >= 1) "%.1f GB".format(gb) else "${(gb * 1000).toInt()} MB", Tone.Ok)
                        if (waiting > 0) Tag("$waiting to download", Tone.Warn)
                    }
                    lib.str("current").takeIf { it.isNotEmpty() }?.let { Text("Downloading \"$it\"…", color = Muted, fontSize = 13.sp) }
                }
            }
        }
        item {
            val channels = r.optJSONArray("library_channels")?.objects().orEmpty()
            Section("Channels that stay up to date", "Their newest videos download automatically, after passing your rules.") {
                ChoiceRow("Videos to keep per channel", vm.libCount, listOf(3 to "Newest 3", 5 to "Newest 5", 10 to "Newest 10", 20 to "Newest 20")) { vm.libCount = it }
                AddRow("Channel link or @handle", "Add") { text -> vm.addByLink("channel", text, "library_channels") { put("count", vm.libCount) } }
                if (channels.isEmpty()) Empty("None yet")
                channels.forEach { c -> ItemRow(c.str("name"), "Newest ${c.optInt("count")}") { onRemove(Triple("library_channels", c.str("id"), c.str("name"))) } }
            }
        }
        item {
            val videos = r.optJSONArray("library_videos")?.objects().orEmpty()
            Section("Single videos", "Stay until you remove them.") {
                AddRow("YouTube video link", "Add") { vm.addByLink("video", it, "library_videos") }
                if (videos.isEmpty()) Empty("None yet")
                videos.forEach { v -> ItemRow(v.str("title"), v.str("channel"), vm.api, v.str("id")) { onRemove(Triple("library_videos", v.str("id"), v.str("title"))) } }
            }
        }
        if (items.isNotEmpty()) {
            item {
                Section("What's in the library") {
                    items.forEach { i ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.padding(vertical = 4.dp)) {
                            Thumb(vm.api, i.str("id"), 96)
                            Column(Modifier.weight(1f)) {
                                Text(i.str("title"), maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                                Text("from ${i.str("source")}" + (i.optLong("size").takeIf { it > 0 }?.let { " · ${it / 1_000_000} MB" } ?: ""),
                                    color = Muted, fontSize = 12.sp, maxLines = 1)
                            }
                            when (i.str("state")) {
                                "ready" -> Tag("Ready", Tone.Ok)
                                "downloading" -> Tag("Downloading", Tone.Warn)
                                "waiting" -> Tag("Waiting", Tone.Warn)
                                else -> Tag(i.str("state").replaceFirstChar { it.uppercase() }, Tone.Bad)
                            }
                        }
                    }
                }
            }
        }
    }

}
