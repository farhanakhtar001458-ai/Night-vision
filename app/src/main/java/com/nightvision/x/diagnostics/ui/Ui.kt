package com.nightvision.x.diagnostics.ui

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView

object Palette {
    val black = Color.rgb(7, 10, 8)
    val surface = Color.rgb(14, 20, 16)
    val surfaceRaised = Color.rgb(20, 29, 23)
    val border = Color.rgb(40, 59, 46)
    val green = Color.rgb(140, 255, 176)
    val greenStrong = Color.rgb(91, 238, 139)
    val greenMuted = Color.rgb(109, 160, 126)
    val text = Color.rgb(239, 246, 240)
    val secondary = Color.rgb(157, 174, 161)
    val dim = Color.rgb(104, 122, 109)
    val warning = Color.rgb(255, 194, 107)
    val error = Color.rgb(255, 126, 126)
}

abstract class DiagnosticActivity : Activity() {
    protected fun configureWindow() {
        window.statusBarColor = Palette.black
        window.navigationBarColor = Palette.black
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.setSystemBarsAppearance(
                0,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = 0
        }
    }
}

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

fun text(
    context: Context,
    value: CharSequence,
    size: Float = 14f,
    color: Int = Palette.text,
    bold: Boolean = false,
    mono: Boolean = false,
): TextView = TextView(context).apply {
    text = value
    textSize = size
    setTextColor(color)
    typeface = if (mono) Typeface.MONOSPACE else Typeface.create("sans", Typeface.NORMAL)
    if (bold) setTypeface(typeface, Typeface.BOLD)
    setLineSpacing(0f, 1.12f)
}

fun panel(context: Context, highlighted: Boolean = false): LinearLayout = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(context.dp(18), context.dp(18), context.dp(18), context.dp(18))
    background = GradientDrawable(
        if (highlighted) GradientDrawable.Orientation.TL_BR else GradientDrawable.Orientation.TOP_BOTTOM,
        if (highlighted) intArrayOf(Color.rgb(22, 39, 28), Palette.surface) else intArrayOf(Palette.surface, Palette.surface),
    ).apply {
        cornerRadius = context.dp(18).toFloat()
        setStroke(context.dp(1), if (highlighted) Color.rgb(50, 85, 61) else Palette.border)
    }
}

fun pill(context: Context, value: String, positive: Boolean = true): TextView = text(
    context,
    value,
    size = 10f,
    color = if (positive) Palette.green else Palette.secondary,
    bold = true,
    mono = true,
).apply {
    gravity = Gravity.CENTER
    setPadding(context.dp(9), context.dp(5), context.dp(9), context.dp(5))
    background = GradientDrawable().apply {
        cornerRadius = context.dp(100).toFloat()
        setColor(if (positive) Color.rgb(22, 49, 31) else Palette.surfaceRaised)
        setStroke(context.dp(1), if (positive) Palette.greenMuted else Palette.border)
    }
}

fun actionButton(context: Context, label: String, primary: Boolean = true): Button = Button(context).apply {
    text = label
    textSize = 12f
    isAllCaps = false
    setTextColor(if (primary) Palette.black else Palette.green)
    typeface = Typeface.create("sans", Typeface.BOLD)
    letterSpacing = 0.04f
    minHeight = context.dp(50)
    minimumHeight = context.dp(50)
    setPadding(context.dp(14), 0, context.dp(14), 0)
    stateListAnimator = null
    backgroundTintList = null
    background = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_pressed), GradientDrawable().apply {
            cornerRadius = context.dp(12).toFloat()
            setColor(if (primary) Palette.greenMuted else Palette.surfaceRaised)
            setStroke(context.dp(1), Palette.greenMuted)
        })
        addState(intArrayOf(), GradientDrawable().apply {
            cornerRadius = context.dp(12).toFloat()
            setColor(if (primary) Palette.greenStrong else Palette.surface)
            setStroke(context.dp(1), if (primary) Palette.greenStrong else Palette.border)
        })
    }
}

fun sectionTitle(context: Context, eyebrow: String, title: String? = null): LinearLayout =
    LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        addView(text(context, eyebrow, 11f, Palette.green, bold = true, mono = true).apply {
            letterSpacing = 0.12f
        })
        title?.let {
            addView(text(context, it, 24f, Palette.text, bold = true), LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = context.dp(6) })
        }
    }

fun specRow(context: Context, label: String, value: String, monoValue: Boolean = false): View {
    val row = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.TOP
        setPadding(0, context.dp(9), 0, context.dp(9))
    }
    row.addView(text(context, label, 12f, Palette.secondary), LinearLayout.LayoutParams(
        0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.39f,
    ).apply { rightMargin = context.dp(12) })
    row.addView(text(context, value, 12f, Palette.text, mono = monoValue).apply {
        setTextIsSelectable(true)
    }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.61f))
    return row
}

fun divider(context: Context): View = View(context).apply {
    setBackgroundColor(Palette.border)
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, context.dp(1)).apply {
        topMargin = context.dp(6)
        bottomMargin = context.dp(6)
    }
}

fun LinearLayout.addSpaced(view: View, top: Int = 0, bottom: Int = 0) {
    addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
        topMargin = context.dp(top)
        bottomMargin = context.dp(bottom)
    })
}

fun LinearLayout.addWeighted(view: View, weight: Float = 1f, endMargin: Int = 0) {
    addView(view, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight).apply {
        rightMargin = context.dp(endMargin)
    })
}

fun statCard(context: Context, value: String, label: String): LinearLayout = panel(context).apply {
    setPadding(context.dp(15), context.dp(15), context.dp(15), context.dp(15))
    addView(text(context, value, 25f, Palette.green, bold = true, mono = true))
    addView(text(context, label, 10f, Palette.secondary, bold = true, mono = true), LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = context.dp(4) })
}

fun scrollColumn(context: Context): Pair<ScrollView, LinearLayout> {
    val scroll = ScrollView(context).apply {
        isFillViewport = true
        clipToPadding = false
        overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
    }
    val column = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(context.dp(16), context.dp(18), context.dp(16), context.dp(36))
    }
    scroll.addView(column)
    return scroll to column
}

fun toolbar(context: Context, subtitle: String, onBack: (() -> Unit)? = null): LinearLayout {
    val bar = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(context.dp(16), context.dp(12), context.dp(16), context.dp(12))
        setBackgroundColor(Palette.black)
    }
    if (onBack != null) {
        val back = actionButton(context, "‹", primary = false).apply {
            textSize = 28f
            contentDescription = "Back"
            setOnClickListener { onBack() }
        }
        bar.addView(back, LinearLayout.LayoutParams(context.dp(48), context.dp(44)).apply {
            rightMargin = context.dp(12)
        })
    } else {
        bar.addView(text(context, "NV", 13f, Palette.green, bold = true, mono = true).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                cornerRadius = context.dp(10).toFloat()
                setColor(Palette.surfaceRaised)
                setStroke(context.dp(1), Palette.greenMuted)
            }
        }, LinearLayout.LayoutParams(context.dp(44), context.dp(44)).apply {
            rightMargin = context.dp(12)
        })
    }
    val titles = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    titles.addView(text(context, "NIGHT VISION X PRO", 14f, Palette.text, bold = true).apply {
        letterSpacing = 0.09f
    })
    titles.addView(text(context, subtitle, 9f, Palette.green, bold = true, mono = true).apply {
        letterSpacing = 0.08f
    })
    bar.addView(titles, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    return bar
}

/** Lightweight wrapping layout used for capability chips without a third-party UI dependency. */
class FlowLayout(context: Context) : ViewGroup(context) {
    private val horizontalGap = context.dp(7)
    private val verticalGap = context.dp(7)

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val available = MeasureSpec.getSize(widthMeasureSpec) - paddingLeft - paddingRight
        var x = 0
        var y = 0
        var rowHeight = 0
        var measuredWidth = 0
        for (index in 0 until childCount) {
            val child = getChildAt(index)
            if (child.visibility == GONE) continue
            measureChild(child, widthMeasureSpec, heightMeasureSpec)
            val childWidth = child.measuredWidth
            val childHeight = child.measuredHeight
            if (x > 0 && x + childWidth > available) {
                measuredWidth = maxOf(measuredWidth, x - horizontalGap)
                x = 0
                y += rowHeight + verticalGap
                rowHeight = 0
            }
            x += childWidth + horizontalGap
            rowHeight = maxOf(rowHeight, childHeight)
        }
        measuredWidth = maxOf(measuredWidth, if (x > 0) x - horizontalGap else 0)
        val measuredHeight = if (rowHeight > 0) y + rowHeight else 0
        setMeasuredDimension(
            resolveSize(measuredWidth + paddingLeft + paddingRight, widthMeasureSpec),
            resolveSize(measuredHeight + paddingTop + paddingBottom, heightMeasureSpec),
        )
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        var x = paddingLeft
        var y = paddingTop
        var rowHeight = 0
        val available = right - left - paddingRight
        for (index in 0 until childCount) {
            val child = getChildAt(index)
            if (child.visibility == GONE) continue
            if (x > paddingLeft && x + child.measuredWidth > available) {
                x = paddingLeft
                y += rowHeight + verticalGap
                rowHeight = 0
            }
            child.layout(x, y, x + child.measuredWidth, y + child.measuredHeight)
            x += child.measuredWidth + horizontalGap
            rowHeight = maxOf(rowHeight, child.measuredHeight)
        }
    }

    override fun generateDefaultLayoutParams(): LayoutParams = LayoutParams(
        LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT,
    )
}
