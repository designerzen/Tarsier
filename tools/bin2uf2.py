#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Convert a SAMD21 firmware .bin into a .uf2 for drag-and-drop flashing.

Usage: python tools/bin2uf2.py firmware.bin Tarsier.uf2

The Trinkey's UF2 bootloader occupies the first 8 KB of flash, so the
application is placed at 0x2000.
"""
import struct
import sys

APP_START = 0x2000
FAMILY_SAMD21 = 0x68ED2B88
PAYLOAD = 256


def convert(data: bytes) -> bytes:
    blocks = [data[i:i + PAYLOAD] for i in range(0, len(data), PAYLOAD)]
    out = bytearray()
    for n, chunk in enumerate(blocks):
        header = struct.pack(
            "<IIIIIIII",
            0x0A324655,  # magic start 0
            0x9E5D5157,  # magic start 1
            0x00002000,  # flags: family ID present
            APP_START + n * PAYLOAD,
            PAYLOAD,
            n,
            len(blocks),
            FAMILY_SAMD21,
        )
        body = chunk.ljust(476, b"\x00")
        out += header + body + struct.pack("<I", 0x0AB16F30)  # magic end
    return bytes(out)


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    with open(sys.argv[1], "rb") as f:
        data = f.read()
    with open(sys.argv[2], "wb") as f:
        f.write(convert(data))
    print(f"wrote {sys.argv[2]} ({len(data)} bytes of firmware)")


if __name__ == "__main__":
    main()
