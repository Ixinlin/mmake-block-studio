# -*- coding: utf-8 -*-
"""
png-info.py —— 零依赖读取 PNG，输出尺寸 / 颜色类型 / alpha 抽样

    python tools/png-info.py <文件> [x,y ...]

只依赖标准库 zlib：解 IDAT → 反滤波 → 取像素。
用来验证 logo 是否真的透明、圆角是否生效。
"""
import sys
import zlib


def read_png(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG 文件"
    pos, idat, w = 8, bytearray(), None
    while pos < len(data):
        ln = int.from_bytes(data[pos:pos + 4], "big")
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w = int.from_bytes(body[0:4], "big")
            h = int.from_bytes(body[4:8], "big")
            depth, ctype = body[8], body[9]
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
        pos += 12 + ln
    assert depth == 8, "仅支持 8bit 深度（当前 %s）" % depth
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(bytes(idat))
    stride = w * nch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(nch, stride):
                line[i] = (line[i] + line[i - nch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                b = prev[i]
                c = prev[i - nch] if i >= nch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, nch, bytes(out)


COLMAP = {0: "灰度", 2: "RGB", 3: "索引", 4: "灰度+Alpha", 6: "RGBA"}


def main():
    path = sys.argv[1]
    w, h, nch, px = read_png(path)
    print("文件 : %s" % path)
    print("尺寸 : %d x %d" % (w, h))
    print("通道 : %d（%s）" % (nch, COLMAP.get({1: 0, 3: 2, 2: 4, 4: 6}[nch], "?")))

    def alpha_at(x, y):
        i = (y * w + x) * nch
        if nch in (2, 4):
            return px[i + nch - 1]
        return 255

    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    print("四角 alpha : " + ", ".join(
        "(%d,%d)=%d" % (x, y, alpha_at(x, y)) for x, y in corners))
    center = alpha_at(w // 2, h // 2)
    print("中心 alpha : %d" % center)
    opaque = sum(1 for y in range(0, h, 4) for x in range(0, w, 4)
                 if alpha_at(x, y) > 8)
    total = len(range(0, h, 4)) * len(range(0, w, 4))
    print("不透明占比 : %.1f%%" % (100.0 * opaque / total))
    for spec in sys.argv[2:]:
        x, y = (int(v) for v in spec.split(","))
        i = (y * w + x) * nch
        print("  采样 (%d,%d) = %s" % (x, y, list(px[i:i + nch])))


if __name__ == "__main__":
    main()
