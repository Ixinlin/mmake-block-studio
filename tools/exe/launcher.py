# -*- coding: utf-8 -*-
"""
掌控图形化编程（Mmake）桌面版启动器
====================================

为什么不是 Electron 那种"内嵌浏览器"的壳？
  本项目要用 **WebSerial** 直接读写掌控板串口（USB 上传程序），
  它只在 Chromium 内核 + 安全上下文里可用；同时工程数据存在 localStorage。
  实测 Edge/Chrome 打开 file:// 页面时 isSecureContext=true、
  navigator.serial 可用、localStorage 正常，所以：

    解密内置资源包  →  释放到固定目录  →  用 Edge/Chrome 打开 file://  →  本程序退出

  好处：没有常驻后台进程、没有黑框控制台、不需要安装，
  双击即用；localStorage 因为路径固定而能长期保存工程。

内置资源是加密的（见 pakcrypto.py）：
  用 7-Zip 直接打开 exe 只能看到 build/web.pak 的一堆乱码，
  必须运行本程序、由它解密后才能拿到网页资源。

  如果所在机器没有 Edge/Chrome，可用 `Mmake.exe --serve`
  在本机起 HTTP 服务（控制台模式），再用任意浏览器打开。

日志：%LOCALAPPDATA%\\Mmake\\launcher.log
"""

import os
import shutil
import socket
import subprocess
import sys
import threading
import traceback
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

APP_TITLE = "掌控图形化编程"
APP_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Mmake")
WEB_DIR = os.path.join(APP_DIR, "web")
LOG_PATH = os.path.join(APP_DIR, "launcher.log")
PAKID_PATH = os.path.join(APP_DIR, "web.pakid")   # 已释放资源包的指纹


# ------------------------------------------------------------------ 基础
def log(msg):
    """windowed 打包后没有控制台，出问题会「双击没反应」，一律写日志"""
    try:
        os.makedirs(APP_DIR, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(str(msg).rstrip() + "\n")
    except Exception:
        pass
    try:
        # Windows 控制台默认 GBK，直接 print 中文会变乱码（--serve / --check 时可见）
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        print(msg)
    except Exception:
        pass          # windowed 模式下 stdout 是 None


def message_box(text, title=APP_TITLE, flags=0x40):
    """没有 tkinter 也能弹原生对话框：直接调 Win32 user32.MessageBoxW"""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, str(text), str(title), flags)
    except Exception:
        log("弹窗失败（无 GUI）：" + str(text))


def _meipass():
    return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))


def bundled_pak():
    """打包后资源包在 sys._MEIPASS/web.pak"""
    if getattr(sys, "frozen", False):
        return os.path.join(_meipass(), "web.pak")
    return os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "build", "web.pak"))


def clear_web():
    """换版本时清掉旧目录，避免残留上一次的文件"""
    if os.path.isdir(WEB_DIR):
        shutil.rmtree(WEB_DIR, ignore_errors=True)


def extract_web():
    """解密内置资源包 → 释放到固定目录（路径稳定 = localStorage 里的工程不会丢）"""
    pak = bundled_pak()
    log("内置资源包：" + pak)
    if not os.path.isfile(pak):
        raise RuntimeError("安装包内缺少资源包：\n" + pak)

    import pakcrypto

    fingerprint = pakcrypto.pak_fingerprint(pak)
    if os.path.isfile(PAKID_PATH):
        try:
            with open(PAKID_PATH, "r", encoding="utf-8") as f:
                if f.read().strip() == fingerprint and os.path.isfile(
                        os.path.join(WEB_DIR, "index.html")):
                    log("资源无变化，跳过解密释放：" + WEB_DIR)
                    return WEB_DIR
        except Exception as e:
            log("读取 pakid 失败，重新释放：" + str(e))

    files, data = pakcrypto.decrypt_pak(pak)
    log("解密成功：%d 个文件，数据区 %d 字节" % (len(files), len(data)))

    clear_web()
    n = pakcrypto.extract_to(files, data, WEB_DIR)
    with open(PAKID_PATH, "w", encoding="utf-8") as f:
        f.write(fingerprint)
    log("已释放 %d 个文件到：%s" % (n, WEB_DIR))
    return WEB_DIR


def find_chromium():
    """优先 Edge，其次 Chrome（两者都是 Chromium 内核，支持 WebSerial）"""
    names = ("msedge.exe", "chrome.exe")
    roots = [
        os.environ.get("ProgramFiles", r"C:\Program Files"),
        os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        os.environ.get("LOCALAPPDATA", ""),
    ]
    subs = (r"Microsoft\Edge\Application", r"Google\Chrome\Application")
    for name in names:
        for root in roots:
            if not root:
                continue
            for sub in subs:
                p = os.path.join(root, sub, name)
                if os.path.isfile(p):
                    return p
    return None


def open_url(url):
    exe = find_chromium()
    if exe:
        try:
            subprocess.Popen([exe, url])
            log("已用 %s 打开" % os.path.basename(exe))
            return exe
        except Exception as e:
            log("调用 %s 失败：%s" % (exe, e))
    try:
        webbrowser.open(url)
        log("已用系统默认浏览器打开")
        return "default"
    except Exception as e:
        log("打开浏览器失败：%s" % e)
        return None


# --------------------------------------------------- --serve 兜底模式
class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".wav": "audio/wav",
    })

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def serve_mode(web):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    url = "http://127.0.0.1:%d/index.html" % port
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=web))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print("=" * 56)
    print(" %s 已启动（HTTP 模式）" % APP_TITLE)
    print(" 访问地址：%s" % url)
    print(" 使用期间请不要关闭本窗口，关闭即退出。")
    print("=" * 56)
    open_url(url)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    httpd.shutdown()
    return 0


# ------------------------------------------------------------------ 入口
def main():
    log("=" * 56)
    log("启动 %s（frozen=%s）" % (APP_TITLE, getattr(sys, "frozen", False)))

    if "--check" in sys.argv[1:]:
        # 只解密校验、不打开浏览器，给自动化测试用
        import pakcrypto
        pak = bundled_pak()
        files, _ = pakcrypto.decrypt_pak(pak)
        print("OK %s files=%d" % (pak, len(files)))
        return 0

    web = extract_web()

    if "--serve" in sys.argv[1:]:
        return serve_mode(web)

    index = os.path.join(web, "index.html")
    if not os.path.isfile(index):
        raise RuntimeError("释放后找不到 index.html：\n" + index)

    url = "file:///" + index.replace("\\", "/")
    log("打开：" + url)
    who = open_url(url)

    if who is None:
        message_box("未能自动打开浏览器。\n\n请手动打开下面的文件：\n" + index, APP_TITLE, 0x30)
        return 1
    if who == "default":
        # 默认浏览器不一定是 Chromium，串口上传可能用不了，提示一句
        message_box("已用系统默认浏览器打开。\n\n"
                    "如果「上传到硬件」提示不支持串口，请改用 Edge 或 Chrome 打开，\n"
                    "或安装 Edge 后重新运行本程序。", APP_TITLE, 0x40)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        log(traceback.format_exc())
        message_box("启动失败：\n\n" + traceback.format_exc(limit=2), APP_TITLE, 0x10)
        sys.exit(1)
