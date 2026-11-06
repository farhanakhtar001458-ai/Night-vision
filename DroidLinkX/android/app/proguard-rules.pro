# DroidLink X release rules
-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*
-keepclassmembers,allowobfuscation class * { @com.squareup.moshi.Json <fields>; }
-keep class com.droidlinkx.core.network.dto.** { *; }
-keepclasseswithmembers class * { @com.squareup.moshi.* <methods>; }
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keepresources okhttp3.internal.publicsuffix.*
