#!/usr/bin/env python3
"""Prepare a card illustration for src/assets.

    python3 frontend/scripts/normalise-card-art.py <source.png> <dest.png> [fill] [shift_x]

`fill` (default 0.96) is how much of the canvas the figure should take. Above
1.0 it overflows and is clipped by the canvas edge, which is how a portrait
illustration is made to read at the same weight as a landscape one.
`shift_x` (default 0) nudges the figure sideways, as a fraction of the canvas
width - positive moves it right.

Trims the transparent margin, then centres the figure on a common 4:3
canvas. Stdlib only - no Pillow, no ImageMagick, nothing to install.

Why the padding: the illustrations arrive in whatever shape they were drawn
(one was 500x500 portrait, another 666x375 landscape). Left at their natural
aspects, `object-fit: contain` renders each at a different footprint, so one
department's card shows small artwork beside a band of empty space while
another's fills the row. One canvas for all of them means one CSS rule
places them identically.

Accepts non-interlaced 8-bit RGBA PNGs, which is what the sources have been.
"""
import sys
import zlib
import struct

CANVAS_W, CANVAS_H = 432, 324  # 4:3
FILL = 0.96                    # margin, so nothing touches the canvas edge


def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i, idat, hdr = 8, b'', None
    while i < len(d):
        ln, typ = struct.unpack('>I4s', d[i:i + 8])
        body = d[i + 8:i + 8 + ln]
        if typ == b'IHDR':
            hdr = struct.unpack('>IIBBBBB', body)
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
        i += 12 + ln
    w, h, depth, ctype, _comp, _filt, inter = hdr
    assert depth == 8 and ctype == 6 and inter == 0, f'need 8-bit RGBA, non-interlaced: {hdr}'
    raw = zlib.decompress(idat)
    bpp, stride = 4, w * 4
    out, prev, pos = bytearray(), bytearray(stride), 0
    for _ in range(h):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                c = prev[x - bpp] if x >= bpp else 0
                b = prev[x]
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, out


def trim(w, h, px):
    """The bounding box of everything that is not fully transparent."""
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        row = y * w
        for x in range(w):
            if px[(row + x) * 4 + 3] > 2:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    assert x1 >= 0, 'image is entirely transparent'
    return x0, y0, x1 - x0 + 1, y1 - y0 + 1


def resample(px, w, x0, y0, cw, ch, nw, nh):
    """Box filter. Averaged in PREMULTIPLIED alpha, so transparent pixels
    cannot bleed their colour into the edges of the figure."""
    out = bytearray(nw * nh * 4)
    for ny in range(nh):
        sy0 = int(ny * ch / nh)
        sy1 = max(sy0 + 1, int((ny + 1) * ch / nh))
        for nx in range(nw):
            sx0 = int(nx * cw / nw)
            sx1 = max(sx0 + 1, int((nx + 1) * cw / nw))
            r = g = b = a = n = 0
            for sy in range(sy0, sy1):
                base = (y0 + sy) * w
                for sx in range(sx0, sx1):
                    o = (base + x0 + sx) * 4
                    al = px[o + 3]
                    r += px[o] * al
                    g += px[o + 1] * al
                    b += px[o + 2] * al
                    a += al
                    n += 1
            o = (ny * nw + nx) * 4
            if a:
                out[o] = round(r / a)
                out[o + 1] = round(g / a)
                out[o + 2] = round(b / a)
            out[o + 3] = round(a / n)
    return out


def write_png(path, w, h, buf):
    def chunk(typ, data):
        crc = zlib.crc32(typ + data) & 0xffffffff
        return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', crc)

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter 0; the payload is already small enough
        raw += buf[y * w * 4:(y + 1) * w * 4]
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    return len(png)


def main(src, dest, fill=FILL, shift_x=0.0):
    w, h, px = read_png(src)
    x0, y0, cw, ch = trim(w, h, px)
    # Fit inside the canvas, keeping the figure's own proportions.
    sc = min(CANVAS_W * fill / cw, CANVAS_H * fill / ch)
    nw, nh = max(1, round(cw * sc)), max(1, round(ch * sc))
    art = resample(px, w, x0, y0, cw, ch, nw, nh)

    canvas = bytearray(CANVAS_W * CANVAS_H * 4)
    ox = (CANVAS_W - nw) // 2 + round(shift_x * CANVAS_W)
    oy = (CANVAS_H - nh) // 2
    # Clip rather than refuse, so fill > 1 can trim the edges off a figure
    # that is the wrong shape for the canvas.
    for y in range(nh):
        cy = oy + y
        if cy < 0 or cy >= CANVAS_H:
            continue
        lo = max(0, -ox)
        hi = min(nw, CANVAS_W - ox)
        if hi <= lo:
            continue
        s = (y * nw + lo) * 4
        d = (cy * CANVAS_W + ox + lo) * 4
        canvas[d:d + (hi - lo) * 4] = art[s:s + (hi - lo) * 4]

    kb = write_png(dest, CANVAS_W, CANVAS_H, canvas) / 1024
    print(f'{src}: {w}x{h} -> trim {cw}x{ch} -> art {nw}x{nh} '
          f'centred on {CANVAS_W}x{CANVAS_H} ({kb:.0f} KB) -> {dest}')


if __name__ == '__main__':
    if not 3 <= len(sys.argv) <= 5:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2],
         float(sys.argv[3]) if len(sys.argv) > 3 else FILL,
         float(sys.argv[4]) if len(sys.argv) > 4 else 0.0)
