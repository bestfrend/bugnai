# Virtuosity Drums — compact browser subset v1

Source: https://github.com/sfzinstruments/virtuosity_drums
Pinned source commit: 9f04cf9a734527edfbb0a4eee1f674e45bbf71bc
License: CC0 1.0 Universal; see LICENSE.txt.
Original performance: Austin McMahon, recorded at Virtuosity Musical Instruments,
Boston. Library distributed by Versilian Studios / the sfzinstruments project.

This is a small adaptation, not the complete original SFZ library. It uses the
stereo overhead microphone and one sample per chosen velocity layer, without
round-robin rotation, other microphone positions or the full original SFZ engine.

Keys: W high tom, A low tom, S closed hi-hat, D ride, J snare center, K crash,
L kick (snares on). Each has three original strike samples corresponding to
MIDI velocities 40, 80 and 120. Files are selected by velocity ranges 1–42,
43–84 and 85–127. The application additionally applies the selected gain.

Preparation: near-silent lead-in trimmed with 2 ms pre-roll, one shared gain per
instrument (relative sample dynamics preserved), tails limited to 10 seconds,
35 ms end fade, resampled to 44.1 kHz stereo and encoded with MP3 VBR quality 2.

`sources.json` records every original source filename, SHA-256 hashes, gain and
trim. Reproduce from the repository root with `python3 scripts/import-virtuosity.py`
(requires ffmpeg and HTTPS access to raw.githubusercontent.com).

The files in this version are intentionally fixed: use a new kit version if
changing them later, so saved performances retain the original sound.
