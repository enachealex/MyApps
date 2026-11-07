package com.family.kidview.parent

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * A button showing a filter's name and current choice, e.g. "When / 7 days". Highlighted when it's
 * set to something other than its default.
 */
@Composable
fun PickerButton(label: String, value: String, active: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = if (active) Color(0xFFF0ECFF) else Color.White,
        border = BorderStroke(1.dp, if (active) Purple else Color(0xFFD9D6E3)),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text(label, color = Muted, fontSize = 11.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(value, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = if (active) PurpleDark else Color(0xFF1D2330),
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text("▾", color = if (active) Purple else Muted, fontSize = 13.sp)
            }
        }
    }
}

private val ITEM_H = 44.dp
private const val VISIBLE_ROWS = 5

/**
 * A scroll wheel of [options] (value to label) in a sheet from the bottom. Spin it (or tap an option)
 * so the choice sits in the middle band, then tap Done.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WheelPickerSheet(
    title: String,
    options: List<Pair<String, String>>,
    selected: String,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    val start = options.indexOfFirst { it.first == selected }.coerceAtLeast(0)
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = start)
    val fling = rememberSnapFlingBehavior(lazyListState = listState, snapPosition = SnapPosition.Center)
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    // The option nearest the middle band.
    val centered by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val middle = (info.viewportStartOffset + info.viewportEndOffset) / 2
            info.visibleItemsInfo.minByOrNull { abs(it.offset + it.size / 2 - middle) }?.index ?: start
        }
    }
    var lastCentered by remember { mutableIntStateOf(start) }
    LaunchedEffect(centered) {
        if (centered != lastCentered) { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); lastCentered = centered }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Color.White) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                TextButton(onClick = { options.getOrNull(centered)?.let { onPick(it.first) } }) {
                    Text("Done", fontWeight = FontWeight.Bold)
                }
            }
            Box(Modifier.fillMaxWidth().height(ITEM_H * VISIBLE_ROWS)) {
                // The middle band: whatever sits here is the choice.
                Box(
                    Modifier.align(Alignment.Center).fillMaxWidth().padding(horizontal = 20.dp).height(ITEM_H)
                        .clip(RoundedCornerShape(12.dp)).background(Color(0xFFF0ECFF)),
                )
                LazyColumn(
                    state = listState,
                    flingBehavior = fling,
                    contentPadding = PaddingValues(vertical = ITEM_H * (VISIBLE_ROWS / 2)),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    itemsIndexed(options, key = { _, o -> o.first }) { i, (_, label) ->
                        val distance = abs(i - centered)
                        Text(
                            label,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            fontSize = if (distance == 0) 20.sp else 17.sp,
                            fontWeight = if (distance == 0) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (distance == 0) PurpleDark else Color(0xFF1D2330),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(ITEM_H)
                                .clickable { scope.launch { listState.animateScrollToItem(i) } }
                                .wrapContentHeight(Alignment.CenterVertically)
                                .padding(horizontal = 32.dp)
                                .graphicsLayer {
                                    // Rows further from the middle fade and tilt away, like a wheel.
                                    alpha = when (distance) { 0 -> 1f; 1 -> 0.55f; else -> 0.25f }
                                    rotationX = ((i - centered).coerceIn(-2, 2)) * -18f
                                },
                        )
                    }
                }
            }
        }
    }
}
