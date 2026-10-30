# 掌控图形化编程（Mmake）

<img src="docs/logo/Mmake.png" alt="Mmake" width="120" align="right">

面向中小学**信息科技 / 人工智能**课堂的图形化编程平台：拖积木 → 生成 MicroPython →
一键上传到**掌控板（mPython）**，同时配套**虚拟仿真**与**舞台演示**两种运行视图。

> 纯前端、单页、免安装；数据保存在浏览器本地，不上传服务器。

**在线体验：<https://gy2hpi.kicp.fun>**　|　**源码：<https://github.com/Ixinlin/mmake-block-studio>**

---

## 它能做什么

| 模块 | 说明 |
|---|---|
| 积木编程 | 基于 Blockly，中文积木，按「控制 / 运动 / 外观 / 逻辑 / 屏幕 / 变量 / 掌控板 / 拓展设备」分类 |
| 代码生成 | 实时生成可读的 MicroPython 代码，格式与 mPython 官方示例一致 |
| 上传真机 | WebSerial 直连，raw REPL 写入 `main.py`，无需安装 mPython IDE |
| 虚拟仿真 | 2D 掌控板 + 拓展设备卡片，可拖滑杆造数据、点按键、摇晃、模拟传感器 |
| 舞台演示 | 情景化舞台（书房 / 交通 / 校园…），元素可拖动，掌控小助手同步屏幕、可用 A/B 键与 PYTHON 触控 |
| 拓展库 | 40+ 传感器 / 执行器，悬停看详细介绍，点「▶ 视频介绍」看分镜动画 |
| 素材库 | 内置音乐、图片、表情、情景元素，支持上传自定义素材 |
| 工程文件 | 保存为 `.mxml`，可直接用 mPython IDE 打开；也支持打开官方 mxml / py |

## 运行方式

### 1. 在线版（推荐给课堂）

浏览器打开 <https://gy2hpi.kicp.fun>，
**必须用 Edge 或 Chrome**（上传真机依赖 WebSerial）。

### 2. Windows 桌面版

下载 `Mmake.exe` 双击运行：程序会把网页释放到
`%LOCALAPPDATA%\Mmake\web`，再用 Edge / Chrome 打开，然后自身退出。
没有常驻后台进程；工程数据跟着浏览器走，路径固定所以不会丢。

> 没有 Edge / Chrome 的机器，可在命令行执行 `Mmake.exe --serve`，
> 程序会起一个本地 HTTP 服务并给出访问地址。

### 3. 源码运行

```bash
git clone https://github.com/Ixinlin/mmake-block-studio.git
cd mmake-block-studio
# 直接用浏览器打开 index.html 也能跑（file:// 属于安全上下文，WebSerial 可用）
# 更稳妥的是起个静态服务：
npx serve .
```

## 打包 Windows 桌面版

```bash
node tools/make-icon.js           # 由 docs/logo/Mmake-source.png 生成圆角 logo 与 ICO
node tools/build-publish.js       # generate publish/（干净网页，已抹掉内置凭据）
node tools/build-exe.js           # 打包 dist/Mmake.exe（需要 Python + PyInstaller）
```

`build-exe.js` 会：

1. 生成一份干净的 `publish/`；
2. **随机生成 256 位资源密钥**，分片混淆后写入 `tools/exe/_buildkey.py`（不入库）；
3. 把 `publish/` 加密打包成 `build/web.pak`；
4. 用 PyInstaller 把「启动器 + 加密资源包」打成单文件 exe，并嵌入图标与版本信息。

运行时启动器解密 `web.pak` → 释放到 `%LOCALAPPDATA%\Mmake\web` → 用 Edge/Chrome 打开。
资源包带 SHA-256 校验，且用指纹文件 `web.pakid` 判断是否已释放过，二次启动秒开。

> **关于"加密"的能力边界**：网页是纯前端，代码必然要送到用户机器上。
> 这里做的是**资源包加密** —— 用 7-Zip 打开 exe 只能看到 `web.pak` 的乱码，
> 拿不到 html/js/css 明文。它挡得住"顺手把源码拷走"，**挡不住专业逆向**。
> 真正的保护请靠开源协议与版权声明。

## 开发

```bash
npm install                       # 只装开发依赖（jsdom / playwright）
node tools/run-tests.js           # 跑全部测试
node tools/run-tests.js r50       # 只跑某一轮
```

### 构建/打包脚本

| 脚本 | 作用 |
|---|---|
| `tools/build-publish.js` | 生成 `publish/`：可托管的干净网页（抹掉内置 API 凭据、替换教材示例） |
| `tools/build-repo.js` | 生成开源仓库目录（把运行时、构建脚本、测试、README/LICENSE 归拢到一起） |
| `tools/make-icon.js` | 由原始 logo 生成圆角透明 PNG 与多尺寸 ICO（用 Playwright + canvas，无需 Pillow） |
| `tools/pack-web.js` | 把 `publish/` 加密打包成 `build/web.pak` |
| `tools/build-exe.js` | 一键打包 `dist/Mmake.exe`（含密钥注入、图标、版本资源） |
| `tools/exe/launcher.py` | exe 启动器：解密资源包 → 释放 → 调 Edge/Chrome 打开 |
| `tools/exe/pakcrypto.py` | 资源包解密（纯标准库：`hashlib.shake_256` 密钥流 + SHA-256 校验） |
| `tools/png-info.py` | 零依赖读取 PNG，查看尺寸/通道/alpha，用于核对 logo |

### 目录结构

```
index.html              入口
css/style.css           全部样式
js/
  app.js                主流程、工具栏、拓展库、运行控制
  blocks-defs.js        积木定义（含自定义积木）
  toolbox.js            工具箱分类与影子块
  gen-python.js         积木 → MicroPython
  gen-sim.js            积木 → 仿真执行代码
  sim-engine.js         仿真运行时（解释执行生成的 JS）
  sim-board.js          2D 掌控板与拓展设备卡片
  stage.js / stage-scene.js   舞台与情景元素
  board3d.js            掌控板 3D 视图
  serial-link.js        WebSerial + raw REPL 上传
  project.js            工程存取 / mxml 导入导出
  py2blocks.js          Python → 积木（教材示例反解）
  device-intro.js       拓展设备介绍与「视频介绍」
  ...                   素材库、音乐、二维码、语音、视觉等
vendor/blockly/         Blockly 10 运行时
docs/logo/              logo 素材（原始方图 + 圆角透明版）
tools/                  构建与测试脚本
test-r*.js              各轮功能的回归测试
```

### 技术要点

- **Blockly 10**：两条反序列化路径（`fromXml` / `loadState`）行为不同，拖拽走后者。
- **上传协议**：官方 raw REPL 时序 `\r\n\x03\x03` → `\r\n\x01` → 横幅 →
  命令 + `\x04` → `OK` + stdout`\x04`stderr`\x04`>`。
  写入采用「**先按 UTF-8 字节切分，再逐块转义**」，避免转义序列被切断造成 `SyntaxError`。
- **仿真**：把积木编译成一段 JS，由 `sim-engine` 用异步解释器跑，
  与真机共用同一份状态模型，所以「仿真能跑的，真机基本也能跑」。

## AI 功能（可选）

语音识别 / 合成、人脸、文字、物体识别走**讯飞开放平台**。
本仓库**不内置任何 API 凭据**（避免泄露账号额度），
需要时在界面右上角 **⚙ AI 设置** 里填自己的 `APPID / APIKey / APISecret`，
保存在浏览器 localStorage，不会写进文件。

不填也能正常使用其余全部功能，只是识别类积木会返回 401。

## 已知限制

- 上传真机仅支持 Chromium 内核浏览器（Edge / Chrome / 国产 Chromium 浏览器）。
- 部分官方示例涉及 SIoT / MQTT / 音频录制，积木体系未覆盖，导入后会退化为普通文本积木。
- 教材（湘科版）示例数据未随开源版分发。

## 参与贡献

欢迎提 Issue / PR。提交前请：

1. `node tools/run-tests.js` 全绿；
2. 新增功能补一份 `test-rNN.js`；
3. 不要把任何密钥、内网地址、学生个人信息写进代码或测试。

## 许可证

[MIT](LICENSE)
