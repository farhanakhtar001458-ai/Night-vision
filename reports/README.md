# Device camera reports

No Infinix GT 30 Pro (X6873) hardware report has been collected in this repository yet.
**No ISO range, exposure range, resolution, or camera role is asserted in advance.**

Run the diagnostic APK on the phone, then use **EXPORT JSON** and **EXPORT TXT**. The app uses
Android's document picker, so no broad storage permission is needed. Copy the two generated files
into this directory if you want to include them in the next development phase.

Expected filenames begin with:

```
night-vision-camera-x6873-<UTC timestamp>.json
night-vision-camera-x6873-<UTC timestamp>.txt
```

The filename is derived from the runtime `Build.MODEL`; a different value is preserved rather than
rewritten to X6873. Generated `device-*.json` / `device-*.txt` reports are Git-ignored by default so
that hardware data is committed only after explicit review.
