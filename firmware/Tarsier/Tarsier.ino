// SPDX-License-Identifier: AGPL-3.0-or-later
// Tarsier: a Soundbeam-style USB MIDI controller for the Adafruit Proximity Trinkey.
//
// The APDS9960 proximity sensor projects an invisible "beam" upwards. Moving a
// hand through it plays MIDI notes, bends pitch or sweeps a CC, depending on
// the mode. The two touch pads change settings and the two NeoPixels show
// what the device is doing. See README.md for the full user guide.
//
// Build with the Adafruit SAMD core, board "Adafruit ProxLight Trinkey M0",
// and Tools > USB Stack > TinyUSB (required for USB MIDI).

#include <Adafruit_TinyUSB.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_FreeTouch.h>
#include <Adafruit_APDS9960.h>

#include "config.h"

#if !defined(USE_TINYUSB)
#error "Select Tools > USB Stack > TinyUSB (FQBN option usbstack=tinyusb)"
#endif

// ===================================================================== Model

enum Mode : uint8_t { MODE_BEAM, MODE_TRIGGER, MODE_THEREMIN, MODE_CC, MODE_COUNT };

static const char *const MODE_NAMES[MODE_COUNT] = {"BEAM", "TRIGGER", "THEREMIN", "CC"};

// Each mode has a colour so it can be recognised at a glance.
static const uint32_t MODE_COLOURS[MODE_COUNT] = {
    0x00FF40,  // BEAM: green
    0xFF6000,  // TRIGGER: orange
    0xA000FF,  // THEREMIN: violet
    0x0060FF,  // CC: blue
};

struct Scale {
  const char *name;
  uint8_t length;
  uint8_t steps[12];
};

static const Scale SCALES[] = {
    {"major pentatonic", 5, {0, 2, 4, 7, 9}},
    {"minor pentatonic", 5, {0, 3, 5, 7, 10}},
    {"major", 7, {0, 2, 4, 5, 7, 9, 11}},
    {"natural minor", 7, {0, 2, 3, 5, 7, 8, 10}},
    {"blues", 6, {0, 3, 5, 6, 7, 10}},
    {"whole tone", 6, {0, 2, 4, 6, 8, 10}},
    {"chromatic", 12, {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}},
};
static const uint8_t SCALE_COUNT = sizeof(SCALES) / sizeof(SCALES[0]);
static const uint8_t OCTAVE_COUNT = sizeof(OCTAVES) / sizeof(OCTAVES[0]);
static const uint8_t ZONE_COUNT_OPTIONS = sizeof(ZONE_COUNTS) / sizeof(ZONE_COUNTS[0]);

static const uint8_t NO_NOTE = 0xFF;
static const uint8_t NO_ZONE = 0xFF;
static const uint16_t BEND_CENTRE = 8192;

// Settings changed with the touch pads.
static Mode mode = MODE_BEAM;
static uint8_t scaleIndex = 0;
static uint8_t octaveIndex = DEFAULT_OCTAVE_INDEX;
static uint8_t zonesIndex = DEFAULT_ZONES_INDEX;

// Beam state.
static float proxBaseline = 0;   // ambient reading with nothing in the beam
static float proxSmooth = 0;     // filtered reading
static bool handPresent = false;
static float position = 1.0f;    // 0 = nearest, 1 = edge of the beam
static float speed = 0;          // beam lengths per second, smoothed
static uint8_t zone = NO_ZONE;   // 0 = lowest note
static bool sensorOk = false;

// Output state, remembered so we only send changes.
static uint8_t activeNote = NO_NOTE;
static uint16_t lastBend = BEND_CENTRE;
static int16_t lastCC = -1;

// LED feedback.
static uint32_t noteFlashAt = 0;  // millis() of the last note-on
static uint32_t toastColour = 0;  // setting-change flash
static uint8_t toastBlinks = 0;
static uint32_t toastStart = 0;

// ================================================================ Hardware

Adafruit_USBD_MIDI usbMidi;
Adafruit_NeoPixel pixels(NUM_NEOPIXEL, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);
Adafruit_APDS9960 apds;
Adafruit_FreeTouch pad1(PIN_TOUCH1, OVERSAMPLE_4, RESISTOR_50K, FREQ_MODE_NONE);
Adafruit_FreeTouch pad2(PIN_TOUCH2, OVERSAMPLE_4, RESISTOR_50K, FREQ_MODE_NONE);

// Pixel 0 sits by pad 1, pixel 1 by pad 2.
static const uint8_t PIXEL_MODE = 0;  // shows the current mode
static const uint8_t PIXEL_BEAM = 1;  // shows the hand in the beam

#define debugf(...)                              \
  do {                                           \
    if (DEBUG_SERIAL && Serial) Serial.printf(__VA_ARGS__); \
  } while (0)

// ==================================================================== MIDI

static void midiSend(uint8_t status, uint8_t data1, uint8_t data2) {
  if (!TinyUSBDevice.mounted()) return;
  // USB-MIDI event packet: cable 0, code index = high nibble of the status.
  const uint8_t packet[4] = {(uint8_t)(status >> 4), status, data1, data2};
  usbMidi.writePacket(packet);
}

static uint8_t channelStatus(uint8_t type) { return type | ((MIDI_CHANNEL - 1) & 0x0F); }

static void noteOn(uint8_t note, uint8_t velocity) {
  midiSend(channelStatus(0x90), note, velocity);
  activeNote = note;
  noteFlashAt = millis();
  debugf("note on  %3u vel %3u\n", note, velocity);
}

static void noteOff() {
  if (activeNote == NO_NOTE) return;
  midiSend(channelStatus(0x80), activeNote, 0);
  debugf("note off %3u\n", activeNote);
  activeNote = NO_NOTE;
}

static void sendBend(uint16_t value) {
  if (value == lastBend) return;
  midiSend(channelStatus(0xE0), value & 0x7F, (value >> 7) & 0x7F);
  lastBend = value;
}

static void sendCC(uint8_t value) {
  if (value == lastCC) return;
  midiSend(channelStatus(0xB0), CC_NUMBER, value);
  lastCC = value;
}

// Silence everything this device might have left sounding.
static void releaseAll() {
  noteOff();
  sendBend(BEND_CENTRE);
  if (lastCC > 0) sendCC(0);
  zone = NO_ZONE;
}

static void panic() {
  releaseAll();
  midiSend(channelStatus(0xB0), 123, 0);  // All Notes Off
  debugf("panic\n");
}

// Discard anything the host sends us so the endpoint never stalls.
static void drainMidiInput() {
  uint8_t packet[4];
  while (usbMidi.readPacket(packet)) {
  }
}

// ================================================================== Music

static uint8_t rootNote() { return 12 * (OCTAVES[octaveIndex] + 1) + ROOT_KEY; }

static uint8_t zoneNote(uint8_t z) {
  const Scale &s = SCALES[scaleIndex];
  int note = rootNote() + 12 * (z / s.length) + s.steps[z % s.length];
  return note > 127 ? 127 : note;
}

static uint8_t velocityFromSpeed() {
  if (VELOCITY_FIXED > 0) return VELOCITY_FIXED;
  float t = (speed - SPEED_SLOW) / (SPEED_FAST - SPEED_SLOW);
  t = constrain(t, 0.0f, 1.0f);
  return VELOCITY_MIN + (uint8_t)(t * (VELOCITY_MAX - VELOCITY_MIN));
}

// 0 at the edge of the beam, 1 when nearest, flipped if NEAR_IS_HIGH is false.
static float intensity() { return NEAR_IS_HIGH ? 1.0f - position : position; }

// ================================================================== Beam

static void configureSensor() {
  // Same tuning as Adafruit's shipped Proximity Trinkey demo.
  apds.enableProximity(true);
  apds.setProxGain(APDS9960_PGAIN_8X);
  apds.setLED(APDS9960_LEDDRIVE_100MA, APDS9960_LEDBOOST_300PCNT);
  apds.setProxPulse(APDS9960_PPULSELEN_16US, 1);
}

static void calibrateBeam() {
  float sum = 0;
  for (int i = 0; i < 32; i++) {
    sum += apds.readProximity();
    delay(5);
  }
  proxBaseline = sum / 32;
  proxSmooth = proxBaseline;
  debugf("beam baseline %d\n", (int)proxBaseline);
}

// Maps a filtered reading to 0 (nearest) .. 1 (edge of the beam).
static float readingToPosition(float reading) {
  float edge = proxBaseline + PROX_EXIT;
  float near = max((float)PROX_NEAR, edge + 1);
  float p = constrain(reading, edge, near);
  if (LINEARIZE_DISTANCE) {
    // distance ~ 1 / sqrt(reading)
    float d = 1.0f / sqrtf(p), dNear = 1.0f / sqrtf(near), dEdge = 1.0f / sqrtf(edge);
    return (d - dNear) / (dEdge - dNear);
  }
  return (near - p) / (near - edge);
}

// Picks the zone for the current position, holding the old one near boundaries.
static uint8_t zoneForPosition(uint8_t zones) {
  float f = intensity() * zones;
  if (zone != NO_ZONE && zone < zones && f > zone - ZONE_HYSTERESIS && f < zone + 1 + ZONE_HYSTERESIS) {
    return zone;
  }
  int z = (int)f;
  return constrain(z, 0, zones - 1);
}

static void updateBeam(uint32_t now) {
  static uint32_t lastAt = 0;
  float dt = (now - lastAt) / 1000.0f;
  lastAt = now;

  proxSmooth += PROX_SMOOTHING * (apds.readProximity() - proxSmooth);

  bool wasPresent = handPresent;
  if (!handPresent && proxSmooth >= proxBaseline + PROX_ENTER) handPresent = true;
  if (handPresent && proxSmooth < proxBaseline + PROX_EXIT) handPresent = false;

  float newPosition = readingToPosition(proxSmooth);
  if (dt > 0 && dt < 0.1f) {
    float instant = fabsf(newPosition - position) / dt;
    speed += 0.3f * (instant - speed);
  }
  position = newPosition;

  if (!handPresent) {
    if (wasPresent) {
      debugf("hand left the beam\n");
      releaseAll();
    }
    return;
  }
  if (!wasPresent) debugf("hand entered the beam\n");

  switch (mode) {
    case MODE_BEAM: {
      uint8_t z = zoneForPosition(ZONE_COUNTS[zonesIndex]);
      if (z != zone) {
        zone = z;
        noteOff();
        noteOn(zoneNote(z), velocityFromSpeed());
      }
      break;
    }
    case MODE_TRIGGER:
      if (!wasPresent) noteOn(rootNote(), velocityFromSpeed());
      break;
    case MODE_THEREMIN:
      // Bend first so the note starts at the right pitch.
      sendBend(BEND_CENTRE + (uint16_t)(intensity() * (16383 - BEND_CENTRE)));
      if (!wasPresent) noteOn(rootNote(), velocityFromSpeed());
      break;
    default:
      break;
  }

  if (mode == MODE_CC || CC_IN_ALL_MODES) sendCC((uint8_t)(intensity() * 127 + 0.5f));
}

// ============================================================= Touch pads

struct Pad {
  Adafruit_FreeTouch *sensor;
  uint16_t baseline;
  bool down;
  uint32_t downAt;
  bool holdFired;
};

static Pad pads[2] = {{&pad1, 0, false, 0, false}, {&pad2, 0, false, 0, false}};
static bool chord = false;  // both pads were held together; ignore until released
static bool chordFired = false;
static uint32_t recalibrateAt = 0;  // pending recalibration, once hands are clear

static void calibratePads() {
  for (Pad &p : pads) {
    uint32_t sum = 0;
    for (int i = 0; i < 16; i++) sum += p.sensor->measure();
    p.baseline = sum / 16;
    debugf("pad baseline %u\n", p.baseline);
  }
}

static void showToast(uint32_t colour, uint8_t blinks) {
  toastColour = colour;
  toastBlinks = blinks;
  toastStart = millis();
}

static uint32_t wheel(uint8_t pos) {
  // Hue wheel: red -> green -> blue -> red.
  if (pos < 85) return Adafruit_NeoPixel::Color(255 - pos * 3, pos * 3, 0);
  if (pos < 170) {
    pos -= 85;
    return Adafruit_NeoPixel::Color(0, 255 - pos * 3, pos * 3);
  }
  pos -= 170;
  return Adafruit_NeoPixel::Color(pos * 3, 0, 255 - pos * 3);
}

static void onTap(uint8_t pad) {
  releaseAll();
  if (pad == 0) {
    mode = (Mode)((mode + 1) % MODE_COUNT);
    debugf("mode %s\n", MODE_NAMES[mode]);
    showToast(MODE_COLOURS[mode], mode + 1);
  } else {
    scaleIndex = (scaleIndex + 1) % SCALE_COUNT;
    debugf("scale %s\n", SCALES[scaleIndex].name);
    showToast(wheel(scaleIndex * 255 / SCALE_COUNT), scaleIndex + 1);
  }
}

static void onHold(uint8_t pad) {
  releaseAll();
  if (pad == 0) {
    octaveIndex = (octaveIndex + 1) % OCTAVE_COUNT;
    debugf("octave %u (root note %u)\n", OCTAVES[octaveIndex], rootNote());
    showToast(0xFFFFFF, octaveIndex + 1);
  } else {
    zonesIndex = (zonesIndex + 1) % ZONE_COUNT_OPTIONS;
    debugf("zones %u\n", ZONE_COUNTS[zonesIndex]);
    showToast(0xFFC000, zonesIndex + 1);
  }
}

static void onBothHeld() {
  panic();
  showToast(0xFF0000, 3);
}

// Runs a second after both pads are released, so fingers and hands are not
// measured as part of the new baselines.
static void recalibrate() {
  calibratePads();
  if (sensorOk) calibrateBeam();
  handPresent = false;
  showToast(0x00FF00, 1);
}

static void updatePads(uint32_t now) {
  for (uint8_t i = 0; i < 2; i++) {
    Pad &p = pads[i];
    bool touched = p.sensor->measure() > p.baseline + TOUCH_DELTA;
    if (touched && !p.down) {
      p.down = true;
      p.downAt = now;
      p.holdFired = false;
    } else if (!touched && p.down) {
      p.down = false;
      if (!chord && !p.holdFired && now - p.downAt > 30) onTap(i);
    } else if (touched && !chord && !p.holdFired && now - p.downAt >= TOUCH_HOLD_MS) {
      p.holdFired = true;
      onHold(i);
    }
  }

  if (pads[0].down && pads[1].down) {
    if (!chord) {
      chord = true;
      chordFired = false;
    }
    uint32_t since = now - max(pads[0].downAt, pads[1].downAt);
    if (!chordFired && since >= TOUCH_BOTH_MS) {
      chordFired = true;
      onBothHeld();
    }
  } else if (!pads[0].down && !pads[1].down) {
    if (chord && chordFired) recalibrateAt = now + 1000;
    chord = false;
  }

  if (recalibrateAt && (int32_t)(now - recalibrateAt) >= 0) {
    recalibrateAt = 0;
    recalibrate();
  }
}

// ==================================================================== LEDs

static uint32_t scale(uint32_t colour, uint8_t level) {
  uint8_t r = ((colour >> 16) & 0xFF) * level / 255;
  uint8_t g = ((colour >> 8) & 0xFF) * level / 255;
  uint8_t b = (colour & 0xFF) * level / 255;
  return pixels.gamma32(Adafruit_NeoPixel::Color(r, g, b));
}

static uint32_t blend(uint32_t a, uint32_t b, uint8_t t) {
  uint8_t r = (((a >> 16) & 0xFF) * (255 - t) + ((b >> 16) & 0xFF) * t) / 255;
  uint8_t g = (((a >> 8) & 0xFF) * (255 - t) + ((b >> 8) & 0xFF) * t) / 255;
  uint8_t bl = ((a & 0xFF) * (255 - t) + (b & 0xFF) * t) / 255;
  return Adafruit_NeoPixel::Color(r, g, bl);
}

// Slow triangle wave 0..255 used for "breathing".
static uint8_t breathe(uint32_t now, uint16_t periodMs) {
  uint16_t phase = now % periodMs;
  uint16_t half = periodMs / 2;
  return phase < half ? phase * 255 / half : (periodMs - phase) * 255 / half;
}

static void updateLeds(uint32_t now) {
  uint32_t modePixel, beamPixel;

  if (!sensorOk) {
    // Sensor missing: both pixels blink red quickly.
    uint32_t c = (now / 100) % 2 ? scale(0xFF0000, LED_MAX_BRIGHTNESS) : 0;
    modePixel = beamPixel = c;
  } else if (toastBlinks && now - toastStart < toastBlinks * 300u) {
    // Setting changed: blink its colour once per step of the new value.
    uint32_t c = (now - toastStart) % 300 < 180 ? scale(toastColour, LED_MAX_BRIGHTNESS) : 0;
    modePixel = beamPixel = c;
  } else {
    toastBlinks = 0;
    uint32_t modeColour = MODE_COLOURS[mode];

    if (!TinyUSBDevice.mounted()) {
      // Not connected to a computer (or it is asleep): slow amber pulse.
      modePixel = scale(0xFF8000, 10 + breathe(now, 3000) * (LED_MAX_BRIGHTNESS - 10) / 255);
    } else if (handPresent) {
      modePixel = scale(modeColour, LED_MAX_BRIGHTNESS / 2);
    } else {
      // Idle: the mode colour breathes gently.
      modePixel = scale(modeColour, 4 + breathe(now, 4000) * (LED_MAX_BRIGHTNESS / 3) / 255);
    }

    if (!handPresent) {
      beamPixel = 0;
    } else {
      // Hue follows the note zone (BEAM) or the position (other modes);
      // brightness follows how close the hand is.
      uint8_t hue = mode == MODE_BEAM && zone != NO_ZONE
                        ? zone * 255 / ZONE_COUNTS[zonesIndex]
                        : (uint8_t)(intensity() * 170);
      uint32_t c = wheel(hue);
      uint32_t sinceNote = now - noteFlashAt;
      if (activeNote != NO_NOTE && sinceNote < 150) {
        c = blend(c, 0xFFFFFF, 255 - sinceNote * 255 / 150);  // flash white on each note
      }
      uint8_t level = 12 + intensity() * (LED_MAX_BRIGHTNESS - 12);
      beamPixel = scale(c, level);
    }
  }

  pixels.setPixelColor(PIXEL_MODE, modePixel);
  pixels.setPixelColor(PIXEL_BEAM, beamPixel);
  pixels.show();
}

// =================================================================== Main

void setup() {
  if (!TinyUSBDevice.isInitialized()) TinyUSBDevice.begin(0);

  TinyUSBDevice.setManufacturerDescriptor(USB_MANUFACTURER_NAME);
  TinyUSBDevice.setProductDescriptor(USB_PRODUCT_NAME);
  usbMidi.setStringDescriptor(USB_PRODUCT_NAME);
  usbMidi.begin();
  Serial.begin(115200);

  // The core enumerated before setup() ran; re-enumerate so the host sees MIDI.
  if (TinyUSBDevice.mounted()) {
    TinyUSBDevice.detach();
    delay(10);
    TinyUSBDevice.attach();
  }

  pixels.begin();
  pixels.show();

  pad1.begin();
  pad2.begin();
  calibratePads();

  sensorOk = apds.begin();
  if (sensorOk) {
    configureSensor();
    calibrateBeam();
  }

  showToast(MODE_COLOURS[mode], mode + 1);
}

void loop() {
#ifdef TINYUSB_NEED_POLLING_TASK
  TinyUSBDevice.task();
#endif

  uint32_t now = millis();
  static uint32_t beamAt = 0, padsAt = 0, ledsAt = 0, retryAt = 0;

  drainMidiInput();

  if (!sensorOk && now - retryAt >= 1000) {
    retryAt = now;
    sensorOk = apds.begin();
    if (sensorOk) {
      configureSensor();
      calibrateBeam();
    }
  }

  if (sensorOk && now - beamAt >= 5) {
    beamAt = now;
    updateBeam(now);
  }
  if (now - padsAt >= 20) {
    padsAt = now;
    updatePads(now);
  }
  if (now - ledsAt >= 16) {
    ledsAt = now;
    updateLeds(now);
  }
}
