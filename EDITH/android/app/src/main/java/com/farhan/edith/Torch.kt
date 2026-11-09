package com.farhan.edith

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager

/** Camera2 se torch — koi camera preview nahi, sirf LED. */
object Torch {

    private var lastOn = false

    fun isOn(): Boolean = lastOn

    fun set(ctx: Context, on: Boolean): Boolean {
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return false
        return try {
            var backId: String? = null
            var anyId: String? = null
            for (id in cm.cameraIdList) {
                val ch = cm.getCameraCharacteristics(id)
                val flash = ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false
                if (!flash) continue
                if (anyId == null) anyId = id
                if (ch.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK) {
                    backId = id
                    break
                }
            }
            val id = backId ?: anyId ?: return false
            cm.setTorchMode(id, on)
            lastOn = on
            true
        } catch (t: Throwable) {
            false
        }
    }

    fun toggle(ctx: Context): Boolean = set(ctx, !lastOn)
}
