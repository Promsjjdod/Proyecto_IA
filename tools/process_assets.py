#!/usr/bin/env python3
"""
TINY TOADS — asset pipeline.

  python3 tools/process_assets.py keyout  in.png out.png [--tol 90] [--shadow]
  python3 tools/process_assets.py slice   in.png out_dir prefix name1,name2,... --cell 512
  python3 tools/process_assets.py sheet   out.png cell img1.png img2.png ...
  python3 tools/process_assets.py resize  in.png out.png max_side
  python3 tools/process_assets.py keycenter in.png out.png   (frame: key-out magenta window only)

Chroma key: pure-magenta background (#FF00FF) -> transparent with soft edge
despill. Works on glossy cartoon assets with dark outlines.
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter


def load(p):
    return Image.open(p).convert("RGBA")


def magenta_mask(arr, tol=90):
    r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    # distance to magenta in RGB, plus "pinkness" measure (r,b high, g low)
    d = np.sqrt((r - 255) ** 2 + (g - 0) ** 2 + (b - 255) ** 2)
    soft = np.clip((d - tol * 0.6) / (tol * 0.8), 0, 1)  # 0 = background, 1 = foreground
    # protect any pixel whose green channel is significant (purples, pinks of the character)
    soft = np.where(g > 95, np.maximum(soft, np.clip((g - 95) / 30, 0, 1)), soft)
    return soft


def keyout(src, dst, tol=90, keep_shadow=False):
    im = load(src)
    arr = np.array(im).astype(np.float32)
    alpha = magenta_mask(arr, tol)
    if not keep_shadow:
        # pure chroma: strong magenta (r,b high, g very low). Lavender/purple skin keeps g>90.
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        chroma = (r > 150) & (b > 150) & (g < 70) & (np.abs(r - b) < 70)
        alpha = np.where(chroma, 0.0, alpha)
        # darker magenta (ground shadows): r,b ~ 120-200, g < 40
        shadow = (r > 90) & (b > 90) & (g < 45) & (np.abs(r - b) < 60) & (r < 200)
        alpha = np.where(shadow, 0.0, alpha)
    a = (alpha * 255).astype(np.uint8)
    # despill: reduce magenta fringe on semi-transparent pixels
    fr = alpha[..., None]
    rgb = arr[..., :3]
    g = rgb[..., 1:2]
    rgb_desp = rgb.copy()
    rgb_desp[..., 0:1] = np.minimum(rgb[..., 0:1], g + 80 + 175 * fr)
    rgb_desp[..., 2:3] = np.minimum(rgb[..., 2:3], g + 80 + 175 * fr)
    out = np.dstack([rgb_desp.clip(0, 255).astype(np.uint8), a])
    img = Image.fromarray(out, "RGBA")
    # clean alpha with slight erosion of 1px halo
    a_img = img.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    img.putalpha(a_img)
    img.save(dst, optimize=True)
    return img


def components(alpha, min_area=1500, expected=None):
    """Split a single-row sheet into poses using column projection of alpha."""
    solid = alpha > 40
    col = solid.sum(axis=0)
    cols_on = col > 2
    segs = []
    x = 0
    w = len(col)
    while x < w:
        if cols_on[x]:
            x0 = x
            while x < w and cols_on[x]:
                x += 1
            segs.append([x0, x - 1])
        else:
            x += 1
    # merge segments separated by tiny gaps
    merged = []
    for sg in segs:
        if merged and sg[0] - merged[-1][1] < 10:
            merged[-1][1] = sg[1]
        else:
            merged.append(sg)
    segs = merged
    # if too many segments, iteratively merge the smallest into its nearer neighbour
    def width(sg):
        return sg[1] - sg[0]
    if expected:
        while len(segs) > expected:
            i = min(range(len(segs)), key=lambda k: width(segs[k]))
            if i == 0:
                j = 1
            elif i == len(segs) - 1:
                j = i - 1
            else:
                j = i - 1 if (segs[i][0] - segs[i - 1][1]) <= (segs[i + 1][0] - segs[i][1]) else i + 1
            a, b = sorted([segs[i], segs[j]], key=lambda sg: sg[0])
            segs[min(i, j)] = [a[0], b[1]]
            segs.pop(max(i, j))
        # if too few, split the widest ones at their weakest interior column
        while len(segs) < expected:
            i = max(range(len(segs)), key=lambda k: width(segs[k]))
            x0, x1 = segs[i]
            inner = col[x0 + 40:x1 - 40]
            if len(inner) == 0:
                break
            cut = x0 + 40 + int(np.argmin(inner))
            segs[i:i + 1] = [[x0, cut], [cut + 1, x1]]
    boxes = []
    for x0, x1 in segs:
        rows = np.nonzero(solid[:, x0:x1 + 1].any(axis=1))[0]
        if len(rows) == 0:
            continue
        boxes.append([x0, rows[0], x1, rows[-1]])
    return boxes


def fit_cell(img, cell, pad=0.06):
    w, h = img.size
    s = min(cell * (1 - pad * 2) / w, cell * (1 - pad * 2) / h)
    nw, nh = max(1, int(w * s)), max(1, int(h * s))
    im2 = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    canvas.paste(im2, ((cell - nw) // 2, cell - nh - int(cell * pad)), im2)
    return canvas


def slice_sheet(src, out_dir, prefix, names, cell=512, tol=90):
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(out_dir, f"_{prefix}_keyed.png")
    img = keyout(src, tmp, tol)
    alpha = np.array(img.getchannel("A"))
    boxes = components(alpha, expected=len(names))
    print(f"{src}: found {len(boxes)} components, expected {len(names)}")
    # normalise scale across poses using the tallest component
    outs = []
    for i, name in enumerate(names):
        if i >= len(boxes):
            print("  MISSING", name)
            continue
        x0, y0, x1, y1 = boxes[i]
        crop = img.crop((x0, y0, x1 + 1, y1 + 1))
        outs.append((name, crop))
    maxh = max(c.size[1] for _, c in outs)
    maxw = max(c.size[0] for _, c in outs)
    ref = max(maxh, maxw)
    for name, crop in outs:
        # keep relative scale between poses (don't blow up small crops)
        w, h = crop.size
        s = cell * 0.88 / ref
        im2 = crop.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
        canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        canvas.paste(im2, ((cell - im2.size[0]) // 2, cell - im2.size[1] - int(cell * 0.06)), im2)
        p = os.path.join(out_dir, f"{prefix}_{name}.png")
        canvas.save(p, optimize=True)
        print("  ->", p)
    os.remove(tmp)


def make_sheet(dst, cell, files):
    cell = int(cell)
    sheet = Image.new("RGBA", (cell * len(files), cell), (0, 0, 0, 0))
    for i, f in enumerate(files):
        im = load(f)
        if im.size != (cell, cell):
            im = fit_cell(im, cell, 0)
        sheet.paste(im, (i * cell, 0), im)
    sheet.save(dst, optimize=True)
    print("sheet ->", dst, sheet.size)


def resize(src, dst, max_side):
    im = load(src)
    w, h = im.size
    s = int(max_side) / max(w, h)
    if s < 1:
        im = im.resize((int(w * s), int(h * s)), Image.LANCZOS)
    ext = os.path.splitext(dst)[1].lower()
    if ext in (".jpg", ".jpeg"):
        im.convert("RGB").save(dst, quality=86, optimize=True, progressive=True)
    elif ext == ".webp":
        im.save(dst, quality=84, method=6)
    else:
        im.save(dst, optimize=True)
    print("resize ->", dst, im.size)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "keyout":
        tol = int(sys.argv[sys.argv.index("--tol") + 1]) if "--tol" in sys.argv else 90
        keyout(sys.argv[2], sys.argv[3], tol, "--shadow" in sys.argv)
    elif cmd == "slice":
        cell = int(sys.argv[sys.argv.index("--cell") + 1]) if "--cell" in sys.argv else 512
        tol = int(sys.argv[sys.argv.index("--tol") + 1]) if "--tol" in sys.argv else 90
        slice_sheet(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5].split(","), cell, tol)
    elif cmd == "sheet":
        make_sheet(sys.argv[2], sys.argv[3], sys.argv[4:])
    elif cmd == "resize":
        resize(sys.argv[2], sys.argv[3], sys.argv[4])
