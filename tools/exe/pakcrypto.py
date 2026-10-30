# -*- coding: utf-8 -*-
"""
pakcrypto.py —— 解开 build/web.pak（由 tools/pack-web.js 生成）

只用 Python 标准库，镜像 pack-web.js 的算法：

    keystream = SHAKE256(key ‖ nonce)      # NIST SP 800-185 的可扩展输出函数
    plaintext = ciphertext XOR keystream
    明文自带 SHA-256 摘要，解完立刻校验

⚠️ 密钥藏在 exe 里，这是**防随手拷贝/防 7-Zip 拖走源码**级别的混淆，
   不是对抗逆向的安全边界。真要保护创作，请靠开源协议与版权声明。
"""

import hashlib
import json
import os
import struct

MAGIC_HDR = b"MMAKEPAK"      # 明文头（8 字节）
MAGIC_DAT = b"MMPKDAT1"      # 密文内的成功标志（8 字节，务必与 pack-web.js 一致）
HDR_LEN = 8 + 1 + 16         # magic + 版本 + nonce


class PakError(Exception):
    pass


def load_key():
    """取构建时注入的 256 位密钥（混淆存放，见 _buildkey.py）"""
    try:
        from _buildkey import unwrap_key
    except ImportError as e:
        raise PakError("缺少密钥模块 _buildkey：%s" % e)
    key = unwrap_key()
    if not isinstance(key, (bytes, bytearray)) or len(key) != 32:
        raise PakError("密钥长度异常（应为 32 字节，实际 %r）" % (len(key),))
    return bytes(key)


def pak_fingerprint(pak_path):
    """资源包指纹：用于判断本地已释放的网页是否还是这一版"""
    h = hashlib.sha256()
    with open(pak_path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def decrypt_pak(pak_path):
    """解出 (文件清单, 数据区)；失败抛 PakError"""
    with open(pak_path, "rb") as f:
        raw = f.read()
    if len(raw) < HDR_LEN + 64:
        raise PakError("资源包过小或已损坏（%d 字节）" % len(raw))
    if raw[:8] != MAGIC_HDR:
        raise PakError("不是 Mmake 资源包（文件头不符）")
    ver = raw[8]
    if ver != 1:
        raise PakError("不支持的资源包版本：%d" % ver)

    nonce = raw[9:HDR_LEN]
    cipher = raw[HDR_LEN:]

    key = load_key()
    ks = hashlib.shake_256(key + nonce).digest(len(cipher))
    n = len(cipher)
    # 大整数一次异或，比逐字节快得多
    pt = (int.from_bytes(cipher, "big") ^ int.from_bytes(ks, "big")).to_bytes(n, "big")

    if pt[:8] != MAGIC_DAT:
        raise PakError("资源包解密失败：密钥不匹配或文件已损坏")

    digest = pt[8:40]
    body = pt[40:]
    if hashlib.sha256(body).digest() != digest:
        raise PakError("资源包完整性校验失败（SHA-256 不符）")

    (json_len,) = struct.unpack_from("<I", body, 0)
    manifest = json.loads(body[4:4 + json_len].decode("utf-8"))
    data = body[4 + json_len:]
    return manifest["files"], data


def extract_to(files, data, dest):
    """按清单把文件写到 dest 下"""
    os.makedirs(dest, exist_ok=True)
    for e in files:
        rel = e["p"].replace("\\", "/")
        target = os.path.join(dest, *rel.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(data[e["o"]:e["o"] + e["l"]])
    return len(files)
