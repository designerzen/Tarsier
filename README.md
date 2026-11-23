<p align="center"><img src="assets/logo.svg" alt="Tarsier logo: a round tarsier face with huge eyes" width="160"></p>

# Tarsier

Tarsier is an accessible music instrument you play by moving a hand through the
air. It began in 2015 as a [Drake Music](https://www.drakemusic.org/) project.
This firmware is written specifically for the
[Adafruit Proximity Trinkey](https://www.adafruit.com/product/5022), a
USB-stick-sized board with an infrared proximity sensor, two touch pads and two
RGB LEDs.

Plug it into a computer and wave a hand over the sensor: it plays notes, bends
pitch or sweeps a controller. It shows up as a standard USB MIDI device called
**Tarsier**, so it works without drivers on Windows, macOS, Linux, iOS and
Android, and with any DAW, synth or music app that accepts MIDI.

## Why "Tarsier"?

The [tarsier](https://en.wikipedia.org/wiki/Tarsier) is a tiny primate from the
islands of Southeast Asia, small enough to sit in the palm of a hand. It is known
for its enormous eyes; each one is about as big as its brain. It hunts at night
by staying very still and watching for the slightest movement nearby, then
springing at it.

This device works the same way. It is small enough to hide in a hand and has one
big "eye", the infrared sensor between its LEDs. It stays still, watches for
movement in front of it, and reacts the moment a hand comes into view. Some
tarsiers also call to each other at frequencies too high for people to hear;
this one sends its calls as MIDI.

## Why it exists

Many people cannot play conventional instruments, because they need fine finger
control, strength, reach or a precise grip. [Drake Music](https://www.drakemusic.org/)
works to break down those barriers so disabled people can learn, play, create
and lead music, often by inventing new instruments and adapting technology.

Tarsier follows that approach:

- **Any movement can play.** A hand, a fist, an elbow, a foot or a head moving
  through the beam all work, and there is no need to touch anything.
- **It can't play a wrong note.** In BEAM mode the notes come from a scale, so
  every movement sounds musical.
- **How you move sets the dynamics.** A quick sweep plays louder than a slow
  drift.
- **It shows what it is doing.** The LEDs show the current mode, where the hand
  is in the beam and when a note is played, which helps players who can't hear
  well or who are still learning how it responds.
- **It is cheap and easy to get hold of.** The hardware costs about the same as
  a set of guitar strings, plugs straight into USB, and needs no software
  installed.
- **It is open.** The settings, scales and behaviour can be changed to suit
  each player.

## How it compares

| Device | How it is played | Compared with Tarsier |
|--------|------------------|-----------------------|
| [Soundbeam](https://www.soundbeam.co.uk/) | An ultrasonic beam turns movement into MIDI. It has been used in special education and music therapy for decades. | Soundbeam is Tarsier's main inspiration, with a much longer range and a mature, supported system. It is also far more expensive and needs dedicated hardware. Tarsier fits in a pocket and covers a shorter range. |
| Theremin (e.g. Moog Etherwave) | Hands near two antennas control pitch and volume. | Very expressive but notoriously hard to play in tune. Tarsier's BEAM mode snaps to a scale, and its THEREMIN mode gives the continuous-pitch feel without the steep learning curve. |
| [Skoog](https://skoogmusic.com/) | A soft, squeezable cube for accessible music making. | Built for accessibility like Tarsier, but it has to be touched and pressed. Tarsier responds to movement without contact. |
| [EyeHarp](https://eyeharp.org/) and other eye-gaze instruments | Played by where the player looks on a screen. | Suit players with very limited movement. They need a screen and eye-tracking hardware; Tarsier needs only a USB port. |
| Camera hand-tracking (e.g. Leap Motion / Ultraleap) | A camera tracks the hands in 3D. | Tracks far more detail, but needs extra software and a powerful computer, and is more fiddly to set up. Tarsier sends MIDI straight from the device. |
| Switch interfaces and big-button controllers | Large buttons or adaptive switches trigger notes. | Simple and reliable, but each switch is one on/off action. Tarsier gives a whole range of notes and continuous control from one movement. |

Tarsier is not a replacement for any of these. It is a low-cost, plug-in option
that sits alongside them.

## How it works

The APDS9960 sensor between the two LEDs shines infrared upwards and measures
how much bounces back. That makes an invisible **beam** reaching roughly
10–15 cm above the board. The beam is split into zones by distance, and what
happens as your hand moves through it depends on the mode.

| # | Mode | LED colour | What the beam does |
|---|------|-----------|--------------------|
| 1 | **BEAM** | green | The beam is split into note zones (8 by default) laid out on a scale. Each time your hand crosses into a new zone, the old note stops and the new one plays, like a Soundbeam. Closer means higher. |
| 2 | **TRIGGER** | orange | One note (the root) plays when your hand enters the beam and stops when it leaves. Use it for drums or one-shots. |
| 3 | **THEREMIN** | violet | The root note plays on entry and pitch bend follows your hand: centre at the edge of the beam, full bend up when close. |
| 4 | **CC** | blue | Controller **CC 1** (mod wheel) goes from 0 at the edge to 127 when close, and drops back to 0 when you leave. |

Note **velocity** follows how fast your hand moves through the beam, so a quick
swipe plays louder than a slow drift.

All messages go out on **MIDI channel 1**.

## Controls

The two touch pads are at the end of the board, opposite the USB plug.

| Gesture | Action | LED feedback |
|---------|--------|--------------|
| Tap pad **1** | Next mode | Both LEDs blink the mode colour, once per mode number (BEAM = 1 blink … CC = 4) |
| Tap pad **2** | Next scale | Blinks a scale colour, once per scale number (see below) |
| Hold pad **1** (0.6 s) | Next octave: 2, 3, **4**, 5 | White blinks: 1 = octave 2 … 4 = octave 5 |
| Hold pad **2** (0.6 s) | Next zone count: 5, **8**, 12, 16 | Amber blinks: 1 = 5 zones … 4 = 16 zones |
| Hold **both** pads (1 s) | Panic: stop all notes, then recalibrate | 3 red blinks. Let go and keep your hands clear; a green blink means recalibration is done |

Scales, in order: 1 major pentatonic (default), 2 minor pentatonic, 3 major,
4 natural minor, 5 blues, 6 whole tone, 7 chromatic. All are in C unless you
change `ROOT_KEY`.

## Reading the lights

Pixel 0 (next to pad 1) shows the **mode**. Pixel 1 (next to pad 2) shows the **beam**.

| What you see | Meaning |
|--------------|---------|
| Mode pixel breathing slowly | Ready, no hand in the beam. The colour is the current mode. |
| Mode pixel steady | A hand is in the beam |
| Beam pixel lit | A hand is in the beam. It gets brighter as you get closer. In BEAM mode each note zone has its own colour around the colour wheel; in other modes the colour shifts with distance. |
| Beam pixel flashes white | A note was just sent |
| Mode pixel pulsing amber | Not connected to a computer, or the computer is asleep. Nothing is being sent. |
| Both pixels blinking red fast | The proximity sensor isn't responding. The firmware keeps retrying every second. |

## Installing

### Option A: drag and drop (no tools needed)

1. Plug in the Trinkey and **double-tap** the reset button. A drive called
   `TRINKEYBOOT` appears and the LEDs turn green.
2. Copy [`dist/Tarsier.uf2`](dist/Tarsier.uf2) onto that drive.
3. The board restarts as **Tarsier**. Pick it as a MIDI input in your DAW or
   synth, or check it with a web MIDI monitor.

To go back to CircuitPython later, double-tap reset and copy a CircuitPython
UF2 onto `TRINKEYBOOT`.

### Option B: build from source

Requirements:

- Arduino IDE 2 or `arduino-cli`
- Board package **Adafruit SAMD Boards**, from the board manager URL
  `https://adafruit.github.io/arduino-board-index/package_adafruit_index.json`
- Libraries: **Adafruit TinyUSB Library**, **Adafruit NeoPixel**,
  **Adafruit FreeTouch Library** and **Adafruit APDS9960 Library**

**Arduino IDE:** open `firmware/Tarsier/Tarsier.ino`. Select
*Tools → Board → Adafruit ProxLight Trinkey M0* and **Tools → USB Stack → TinyUSB**,
then upload. Without the TinyUSB stack the board can't act as a MIDI device, and
the build stops with an error saying so.

**arduino-cli:** the sketch folder contains `sketch.yaml`, which already selects
the board and the TinyUSB stack.

```sh
arduino-cli core install adafruit:samd \
  --additional-urls https://adafruit.github.io/arduino-board-index/package_adafruit_index.json
arduino-cli lib install "Adafruit TinyUSB Library" "Adafruit NeoPixel" \
  "Adafruit FreeTouch Library" "Adafruit APDS9960 Library"
arduino-cli compile --output-dir build firmware/Tarsier
arduino-cli upload -p <port> firmware/Tarsier      # or:
python tools/bin2uf2.py build/Tarsier.ino.bin dist/Tarsier.uf2
```

### Option C: GitHub Actions

Every push and pull request builds the firmware on GitHub
([`.github/workflows/build.yml`](.github/workflows/build.yml)). Download
`Tarsier.uf2` from the run's **Artifacts** section. If you push a tag starting
with `v` (for example `v1.0.0`), the UF2 and BIN files are also attached to a
GitHub release for that tag. You can also start a build by hand from the
**Actions** tab.

Each push to `master` also publishes the project page in [`site/`](site/index.html)
to GitHub Pages, with that build's `Tarsier.uf2` alongside it. Before the
first deploy, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
The page will then be at <https://designerzen.github.io/Tarsier/>.

On Windows, if the compiler reports a missing header such as
`machine/_default_types.h`, the Arduino data folder path is too long for the
toolchain. Install it under a shorter path.

## Customising

All settings are in [`firmware/Tarsier/config.h`](firmware/Tarsier/config.h):
MIDI channel, CC number, key, octaves, zone counts, the velocity curve, beam
length and sensitivity, touch sensitivity, LED brightness and the USB device
name. Some useful ones:

- `NEAR_IS_HIGH`: set to `false` if you want notes to get higher as your hand moves away.
- `PROX_ENTER` / `PROX_EXIT`: raise both for a shorter beam that ignores more
  clutter, such as a ceiling or a lampshade.
- `VELOCITY_FIXED`: set to a value from 1 to 127 for a constant velocity.
- `CC_IN_ALL_MODES`: also send the CC while playing notes, for example to
  open a filter as your hand gets closer.

For THEREMIN mode, set your synth's pitch-bend range to 12 semitones. With the
usual default of 2 semitones, the whole beam covers only a whole tone.

Debug messages (notes, mode changes, calibration) go to the USB serial port at
115200 baud.

## Notes

- The beam is calibrated against the room when the board starts. If something
  was in front of the sensor at the time, hold both pads for a second to
  recalibrate.
- Windows can remember a USB device's old name. If the board still shows up as
  "ProxLight Trinkey" after flashing, remove it in Device Manager and plug it
  in again.
- Hardware details are in [`docs/adafruit-proximity-trinkey.pdf`](docs/adafruit-proximity-trinkey.pdf).

## Licence

Tarsier is free and open-source software, released under the
[GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html)
(AGPL-3.0). In plain terms:

- **You can** use it for any purpose, including in schools, therapy sessions,
  performances and commercial work, at no cost.
- **You can** study how it works, change it, and share your changed versions.
- **If you share it**, whether as source code, a compiled `.uf2` file, or a
  device with the firmware already installed, you must make the full source
  code available under the same licence, keep the copyright and licence
  notices, and say what you changed.
- **If people use a modified version over a network**, for example a web
  service built from this code, you must offer them the source code too. This
  is what the "Affero" adds to the ordinary GPL.
- **There is no warranty.** The software is provided as it is.

The aim is that Tarsier and every improvement made to it stay open and
available to everyone. See [`LICENSE`](LICENSE) for the full legal text.
