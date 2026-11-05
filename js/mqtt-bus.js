/* ============================================================
 * mqtt-bus.js —— MQTT 仿真双通道（第六十轮）
 *
 * 为什么需要它：
 *   湘教版八年级的物联网示例几乎都是「主控板 A 发布 / 主控板 B 订阅」，
 *   以前的仿真只有「自发自收」的页内回环 —— 学生开两个标签页做双板实验，
 *   两边永远收不到对方的消息，只能讲原理、看不到效果。
 *
 * 现在提供两条通道：
 *   ① 虚拟通道（默认，零配置、断网可用）
 *      BroadcastChannel('zkb-mqtt-v1')：同一浏览器下多个标签页 / 窗口
 *      互相收发，等价于「局域网里有一台 MQTT 服务器」。
 *      再叠一层页内回环，单标签页也能自发自收，方便调试。
 *   ② 真实通道（可选，需联网）
 *      纯 JS 的 MQTT 3.1.1 over WebSocket 客户端（约 120 行），
 *      连 broker.emqx.io:8083/mqtt 这类公开 WebSocket 代理，
 *      与真实掌控板（连同一个 broker）互通。
 *
 * 只用浏览器原生 API：BroadcastChannel / WebSocket / TextEncoder。
 * ============================================================ */
(function (global) {
  'use strict';
  var ZKB = global.ZKB || (global.ZKB = {});

  var CHANNEL = 'zkb-mqtt-v1';
  var bc = null;              /* BroadcastChannel */
  var listeners = [];         /* 收到的消息回调 (topic, msg) => void */
  var ws = null;              /* 真实通道：WebSocket */
  var wsCfg = null;           /* { url, clientId, user, pwd } */
  var wsReady = false;
  var wsSubs = [];            /* 真实通道已订阅的主题 */
  var pingTimer = 0;
  var pktId = 1;

  function log(msg, cls) {
    if (ZKB.log) ZKB.log(msg, cls);
  }

  /* ---------- 编码辅助（MQTT 3.1.1） ---------- */
  var enc = new TextEncoder();

  function utf8(s) { return enc.encode(String(s == null ? '' : s)); }

  /* 剩余长度：7 位一组的变长整数 */
  function varLen(n) {
    var out = [];
    do {
      var b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      out.push(b);
    } while (n > 0);
    return out;
  }

  function strField(s) {
    var b = utf8(s);
    return [b.length >> 8, b.length & 255].concat(Array.from(b));
  }

  function packet(type, flags, body) {
    var head = [(type << 4) | flags].concat(varLen(body.length));
    return new Uint8Array(head.concat(body));
  }

  function connectPacket(cfg) {
    var vh = strField('MQTT').concat([4]);       /* 协议名 + 级别 4（3.1.1） */
    var flags = 0x02;                             /* clean session */
    if (cfg.user) flags |= 0x80;
    if (cfg.pwd) flags |= 0x40;
    vh = vh.concat([flags, 0, 60]);               /* keepalive 60s */
    var payload = strField(cfg.clientId || ('zkb_' + Math.random().toString(36).slice(2, 8)));
    if (cfg.user) payload = payload.concat(strField(cfg.user));
    if (cfg.pwd) payload = payload.concat(strField(cfg.pwd));
    return packet(1, 0, vh.concat(payload));
  }

  function subscribePacket(topic) {
    var id = pktId++ & 0xffff;
    var body = [id >> 8, id & 255].concat(strField(topic)).concat([0]);  /* QoS 0 */
    return packet(8, 2, body);
  }

  function publishPacket(topic, msg) {
    var body = strField(topic).concat(utf8(msg));
    return packet(3, 0, body);                    /* QoS 0 */
  }

  /* 解析收到的 PUBLISH（type 3） */
  function parsePublish(buf) {
    var i = 0;
    /* 跳过固定头：1 字节 type + 变长剩余长度 */
    i = 1;
    var mult = 1, len = 0, b;
    do { b = buf[i++]; len += (b & 127) * mult; mult *= 128; } while (b & 128);
    var tl = (buf[i] << 8) | buf[i + 1];
    i += 2;
    var topic = new TextDecoder().decode(buf.slice(i, i + tl));
    i += tl;
    var payload = new TextDecoder().decode(buf.slice(i));
    return { topic: topic, msg: payload };
  }

  /* ---------- 对外接口 ---------- */
  function ensureChannel() {
    if (bc || typeof BroadcastChannel === 'undefined') return;
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = function (ev) {
        var d = ev && ev.data;
        if (!d || d.k !== 'pub') return;
        emit(d.topic, d.msg, 'virtual');
      };
    } catch (e) { bc = null; }
  }

  /* 打开虚拟通道（幂等） */
  function open(cfg) {
    ensureChannel();
    if (cfg && cfg.wsUrl) connectWs(cfg);
  }

  function emit(topic, msg, via) {
    listeners.forEach(function (fn) {
      try { fn(String(topic), String(msg), via); }
      catch (e) { log('MQTT 消息处理出错：' + e.message, 'log-err'); }
    });
  }

  function publish(topic, msg) {
    var t = String(topic || ''), m = String(msg == null ? '' : msg);
    /* ① 页内回环（自己也能收到，便于单板调试） */
    setTimeout(function () { emit(t, m, 'local'); }, 20);
    /* ② 跨标签页 */
    ensureChannel();
    if (bc) {
      try { bc.postMessage({ k: 'pub', topic: t, msg: m }); } catch (e) { }
    }
    /* ③ 真实服务器 */
    if (ws && wsReady) {
      try { ws.send(publishPacket(t, m)); } catch (e) { }
    }
  }

  function subscribe(topic) {
    var t = String(topic || '');
    if (wsSubs.indexOf(t) >= 0) return;
    wsSubs.push(t);
    if (ws && wsReady) {
      try { ws.send(subscribePacket(t)); } catch (e) { }
    }
  }

  /* ---------- 真实通道：MQTT over WebSocket ---------- */
  function connectWs(cfg) {
    if (typeof WebSocket === 'undefined') {
      log('当前环境不支持 WebSocket，无法连接真实 MQTT 服务器', 'log-err');
      return false;
    }
    closeWs();
    wsCfg = cfg;
    try {
      ws = new WebSocket(cfg.wsUrl);
      ws.binaryType = 'arraybuffer';
    } catch (e) {
      log('MQTT 服务器地址无效：' + cfg.wsUrl, 'log-err');
      return false;
    }
    ws.onopen = function () {
      try { ws.send(connectPacket(cfg)); } catch (e) { }
      log('正在与真实 MQTT 服务器握手：' + cfg.wsUrl, 'log-sim');
    };
    ws.onmessage = function (ev) {
      var buf = new Uint8Array(ev.data);
      if (!buf.length) return;
      var type = buf[0] >> 4;
      if (type === 2) {                     /* CONNACK */
        if (buf[3] === 0) {
          wsReady = true;
          log('真实 MQTT 服务器连接成功 ✓', 'log-sim');
          wsSubs.forEach(function (t) {
            try { ws.send(subscribePacket(t)); } catch (e) { }
          });
          startPing();
        } else {
          log('MQTT 连接被拒绝（返回码 ' + buf[3] + '）', 'log-err');
        }
      } else if (type === 3) {              /* PUBLISH */
        var p = parsePublish(buf);
        emit(p.topic, p.msg, 'real');
      }
    };
    ws.onerror = function () {
      log('真实 MQTT 服务器连接失败（检查地址 / 网络）', 'log-err');
    };
    ws.onclose = function () {
      if (wsReady) log('真实 MQTT 通道已断开', 'log-sim');
      wsReady = false;
      stopPing();
    };
    return true;
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(function () {
      if (!ws || !wsReady) return;
      try { ws.send(packet(12, 0, [])); } catch (e) { }   /* PINGREQ */
    }, 45000);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = 0; }
  }
  function closeWs() {
    stopPing();
    wsReady = false;
    if (ws) {
      try { ws.send(packet(14, 0, [])); } catch (e) { }   /* DISCONNECT */
      try { ws.close(); } catch (e) { }
      ws = null;
    }
  }

  ZKB.MqttBus = {
    open: open,
    close: function () { closeWs(); if (bc) { try { bc.close(); } catch (e) { } bc = null; } },
    publish: publish,
    subscribe: subscribe,
    onMessage: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    isReal: function () { return !!wsReady; },
    realUrl: function () { return wsCfg ? wsCfg.wsUrl : ''; },
    /* 供测试用：直接注入一条消息，模拟「别的板子发来的」 */
    inject: function (topic, msg) { emit(topic, msg, 'inject'); }
  };

})(window);
