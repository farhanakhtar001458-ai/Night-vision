# Camera diagnostics: implementation and limitations

## Data path

`Camera2DiagnosticScanner` calls `CameraManager.cameraIdList`, then obtains a separate
`CameraCharacteristics` instance for every logical ID. On API 28+, it reads each logical camera's
`physicalCameraIds` and requests characteristics for every additional physical ID. The logical owner
is preserved in the snapshot. A physical-ID read failure creates an unreadable entry with the real
exception; it does not erase the logical camera's results.

No `CameraDevice`, `CameraCaptureSession`, `CaptureRequest`, `ImageReader`, codec, or sensor listener is
created in this milestone.

## Reported fields

| Dashboard/report field | Camera2 source |
| --- | --- |
| Lens facing | `LENS_FACING` |
| Hardware level | `INFO_SUPPORTED_HARDWARE_LEVEL` |
| Capabilities / manual / RAW | `REQUEST_AVAILABLE_CAPABILITIES` |
| Physical IDs | `physicalCameraIds` (API 28+) |
| Pixel array | `SENSOR_INFO_PIXEL_ARRAY_SIZE` |
| Pre-correction active array | `SENSOR_INFO_PRE_CORRECTION_ACTIVE_ARRAY_SIZE` (`Rect`) |
| Active array | `SENSOR_INFO_ACTIVE_ARRAY_SIZE` |
| Sensor dimensions | `SENSOR_INFO_PHYSICAL_SIZE` |
| ISO | `SENSOR_INFO_SENSITIVITY_RANGE` |
| Exposure | `SENSOR_INFO_EXPOSURE_TIME_RANGE` (nanoseconds) |
| Exposure compensation | `CONTROL_AE_COMPENSATION_RANGE`, `CONTROL_AE_COMPENSATION_STEP` |
| AF / manual focus | `CONTROL_AF_AVAILABLE_MODES`; AF `OFF` is reported separately |
| Focus distances | `LENS_INFO_MINIMUM_FOCUS_DISTANCE`, `LENS_INFO_HYPERFOCAL_DISTANCE` |
| Focus calibration | `LENS_INFO_FOCUS_DISTANCE_CALIBRATION` |
| Focal length / aperture / filter | Corresponding `LENS_INFO_AVAILABLE_*` keys |
| OIS | `LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION` |
| Video stabilization | `CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES` |
| FPS | `CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES` |
| Formats / sizes | `SCALER_STREAM_CONFIGURATION_MAP` |
| Frame duration | `getOutputMinFrameDuration(format, size)` |
| Stream counts / depth | `REQUEST_MAX_NUM_OUTPUT_*`, `REQUEST_PIPELINE_MAX_DEPTH` |

Unknown enum values are retained as numeric names instead of being silently dropped. Unknown output
format codes remain visible in hexadecimal. Non-finite lens values become JSON `null`, never JSON
`NaN`, and remain identifiable in the readable UI.

## JSON semantics

The schema version is `1`. The report contains UTC and epoch timestamps, runtime device information,
scan warnings, all camera snapshots, and recommendations. Important units have explicit suffixes:

- `exposure.exposure_time_ns.minimum/maximum`: integer nanoseconds (`Long`).
- `sensor.physical_size_mm`: millimetres.
- `focus_and_optics.*_diopters`: dioptres, not metres.
- `timing_and_stabilization.target_fps_ranges`: inclusive integer FPS ranges.
- `output_formats[].sizes[].minimum_frame_duration_ns`: nanoseconds, omitted as `null` when the
  platform returns zero/no duration.

`null` means unavailable, unreported, or unreadable. It never means zero, Auto, or an assumed default.
An empty array means that Android returned an empty set. TXT is a view of the same immutable snapshot;
JSON is the preferred machine-readable input for the next phase.

## Main / ultra-wide / front identification

Front and external labels come directly from `LENS_FACING`. Android Camera2 does **not** provide
marketing role labels such as “main” or “ultra-wide”. Where focal length and physical sensor width are
available, the module calculates:

```
horizontal FoV = 2 × atan(sensor width / (2 × shortest focal length))
```

It compares rear-camera fields of view to identify likely ultra-wide and telephoto cameras. Standard
FoV values may be labelled **Main (estimated)**. The basis and numeric FoV are shown/exported. Missing
optics produce only **Rear camera**, not a guessed role. A logical camera with multiple physical IDs is
labelled **Logical rear multi-camera** instead of being assigned a physical-lens role.

This geometric calculation is approximate: distortion correction, crop regions, active-array choices,
and vendor tuning can change the effective preview FoV.

## Recommendation rules

The recommendation engine is deterministic and uses only scanned values. It checks:

- whether `MANUAL_SENSOR` is advertised before proposing manual controls;
- each camera's exact ISO/exposure bounds rather than a generic range;
- whether maximum exposure exceeds approximately one 30 FPS frame (33,333,333 ns);
- YUV_420_888 and at least one reported size before suggesting an ImageReader pipeline;
- whether any advertised target FPS range includes 30;
- actual OIS/EIS mode lists before suggesting stabilization controls.

It does not claim that maximum ISO is usable, that a stream combination works, or that static metadata
proves real-time performance. Those require camera-frame testing in a later approved milestone.

## Honest limitations

1. Some vendors expose incomplete or inconsistent characteristics. Such values are shown as returned;
   inconsistencies are not repaired with online device specifications.
2. Physical IDs can be inaccessible on some builds. The report includes the read error and owner ID.
3. RAW capability and RAW output formats are related but distinct; both are retained.
4. A listed format/resolution does not guarantee all formats can run together or sustain the target FPS.
5. Manual focus is reported from AF `OFF`; calibration metadata explains whether focus distances are
   calibrated, approximate, or uncalibrated. Manual-sensor support alone is not treated as manual focus.
6. OIS/EIS support is not measured stabilization quality. No optical stabilization claim is made from
   software or future gyroscope data.
7. Running on a device other than X6873 is allowed for compatibility testing; the report preserves the
   actual `Build.MODEL` and never relabels it.
