// SPDX-License-Identifier: AGPL-3.0-or-later
// Tarsier: user settings.
// Everything you might want to tune lives here; the logic is in Tarsier.ino.
#pragma once

#include <stdint.h>

// ---------------------------------------------------------------- USB / MIDI
#define USB_PRODUCT_NAME      "Tarsier"
#define USB_MANUFACTURER_NAME "Tarsier"

#define MIDI_CHANNEL 1        // 1..16

// CC sent in CC mode (1 = mod wheel, which most synths map by default).
#define CC_NUMBER 1

// Also send the CC alongside notes in BEAM, TRIGGER and THEREMIN modes.
#define CC_IN_ALL_MODES false

// ------------------------------------------------------------- Musical setup
// Key of the root note: 0 = C, 1 = C#, ... 11 = B.
#define ROOT_KEY 0

// Octaves selectable with a long press on pad 1 (scientific pitch: C4 = 60).
static const uint8_t OCTAVES[] = {2, 3, 4, 5};
#define DEFAULT_OCTAVE_INDEX 2      // octave 4

// Number of beam zones selectable with a long press on pad 2.
static const uint8_t ZONE_COUNTS[] = {5, 8, 12, 16};
#define DEFAULT_ZONES_INDEX 1       // 8 zones

// true: moving your hand closer plays higher notes / more bend / more CC.
#define NEAR_IS_HIGH true

// Velocity comes from how fast your hand moves through the beam.
// Set VELOCITY_FIXED to 1..127 to always send that value instead.
#define VELOCITY_FIXED 0
#define VELOCITY_MIN   40
#define VELOCITY_MAX   127
#define SPEED_SLOW     0.3f   // beam lengths per second that map to VELOCITY_MIN
#define SPEED_FAST     4.0f   // beam lengths per second that map to VELOCITY_MAX

// ----------------------------------------------------------- Beam (APDS9960)
// The sensor reports 0 (nothing) .. 255 (touching). The beam starts where the
// reading rises PROX_ENTER above the ambient baseline measured at startup, so
// a bigger value gives a shorter beam that ignores more background clutter.
#define PROX_ENTER 14
#define PROX_EXIT  8          // must be below PROX_ENTER (hysteresis)
#define PROX_NEAR  250        // reading treated as the closest position

// Reflected IR falls off roughly with the square of distance; with this on,
// zones are evenly spaced in physical distance rather than in raw reading.
#define LINEARIZE_DISTANCE true

// Smoothing of the raw reading (0..1, lower = smoother but laggier).
#define PROX_SMOOTHING 0.35f

// How far (in zones) the hand must pass a boundary before the note changes.
#define ZONE_HYSTERESIS 0.2f

// ---------------------------------------------------------------- Touch pads
#define TOUCH_DELTA    150    // rise above the startup baseline that counts as a touch
#define TOUCH_HOLD_MS  600    // press longer than this = long press
#define TOUCH_BOTH_MS  1000   // hold both pads this long = panic + recalibrate

// ---------------------------------------------------------------------- LEDs
#define LED_MAX_BRIGHTNESS 90 // 0..255, the pixels are very bright up close

// Serial debug output on the USB serial port (CDC).
#define DEBUG_SERIAL true
