# WorkManager creates its Room database by reflection; newer R8 strips the constructor otherwise.
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# Background workers are created by reflection too.
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
