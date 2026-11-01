# Shrinking rules for the C5 protocol, shipped inside the module's jar so R8 applies them wherever it goes (the
# app's release build reads META-INF/proguard from every library). The frames are read and written only through
# their generated kotlinx.serialization serializers: those, the companions that hand them out, and the wire names
# they carry must survive, or a minified build reads every desktop frame as malformed.

-keepattributes RuntimeVisibleAnnotations,AnnotationDefault,InnerClasses,EnclosingMethod,Signature

# Generated serializers and the descriptors they build from the classes' fields.
-keep,includedescriptorclasses class com.oxespace.mobile.protocol.**$$serializer { *; }
-keepclassmembers class com.oxespace.mobile.protocol.** {
    *** Companion;
}
-keepclasseswithmembers class com.oxespace.mobile.protocol.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Frame types and wire enums: a sealed frame is chosen by its @SerialName, an enum value by its entry.
-keep @kotlinx.serialization.Serializable class com.oxespace.mobile.protocol.** { <fields>; }
-keepclassmembers enum com.oxespace.mobile.protocol.** {
    <fields>;
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
