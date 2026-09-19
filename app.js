(() => {
"use strict";
const CFG = window.MEETING_CONFIG || {};
const ROOM = CFG.ROOM || "class";
const NAMESPACE = CFG.NAMESPACE || "meetingapp";
const APP_NAME = CFG.APP_NAME || "My Meeting App";
// Teachers: each has their own passcode hash (and optionally the rooms they may host).
// The old single HOST_PASSCODE_HASH setting still works as an unnamed teacher.
const TEACHERS = (Array.isArray(CFG.TEACHERS) ? CFG.TEACHERS : [])
  .map((t) => ({ name: String((t && t.name) || "").trim().slice(0, 40), hash: String((t && t.hash) || "").trim().toLowerCase(), rooms: t && Array.isArray(t.rooms) && t.rooms.length ? t.rooms : null }))
  .filter((t) => t.hash);
if (CFG.HOST_PASSCODE_HASH) TEACHERS.push({ name: "", hash: String(CFG.HOST_PASSCODE_HASH).trim().toLowerCase(), rooms: null });
const EXTRA_ICE_SERVERS = Array.isArray(CFG.EXTRA_ICE_SERVERS) ? CFG.EXTRA_ICE_SERVERS : [];
const PUBLIC_URL = CFG.PUBLIC_URL || "";
const LOGO = CFG.LOGO || "🎓";
const BRAND = /^#[0-9a-f]{3,8}$/i.test(CFG.BRAND_COLOR || "") ? CFG.BRAND_COLOR : "#1a73e8";
const TEACHER_LABEL = String(CFG.TEACHER_LABEL || "").slice(0, 40);
const DEFAULT_HASH = "8eb2961d9750214f76ff37133422ee3f48100588caa32566007a6d33bea8b5fc";
const DEFAULT_ROOM = "SampleAppWorseParkingsCutOpenly";

async function sha256Hex(text) {
  if (!(window.crypto && crypto.subtle)) throw new Error("no-crypto");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const cl = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

window.addEventListener("load", () => {
  /* =====================  VIDEO CALL (WebRTC, browser to browser)  ===================== */
  const params = new URLSearchParams(location.search);
  const cleanId = (x) => String(x || "").replace(/[^A-Za-z0-9_-]/g, "").replace(/[-_]{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 60);
  const ROOM_ID = cleanId(params.get("room")) || cleanId(ROOM) || "class";
  const HOST_PEER = `${NAMESPACE}-${ROOM_ID}-host`;
  const ROLE_PARAM = params.get("role");
  const PEER_OPTS = { debug: 1, config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }, ...EXTRA_ICE_SERVERS] } };
  let myId = null, myName = "Guest", peer = null, localStream = null, camTrack = null, screenStream = null;
  let leaving = false, ended = false, entering = false;
  const peers = new Map();   // peer id -> { name, conn, call }   (teacher: every student; student: only the teacher)
  const calls = new Set();
  const tiles = new Map();

  let teacherName = TEACHER_LABEL || "Teacher";   // what students see on the teacher's video tile
  const attendance = [];                          // { id, name, joined, left }
  const rejected = new Set();                     // removed students (blocked for this session)
  const turnedAway = new Set();                   // turned away while the class was locked
  const blocked = (id) => rejected.has(id) || turnedAway.has(id);
  let locked = false, chatOn = true, handUp = false;

  /* ---- branding ---- */
  function setLogo(el, logo) {
    el.textContent = "";
    if (/^(https?:|data:)/i.test(logo) || /\.(png|jpe?g|svg|webp|gif|ico)(\?.*)?$/i.test(logo)) {
      const img = document.createElement("img"); img.src = logo; img.alt = ""; el.append(img);
    } else el.textContent = logo;
  }
  document.documentElement.style.setProperty("--brand", BRAND);
  document.title = APP_NAME;
  $("appName").textContent = APP_NAME;
  $("endedName").textContent = APP_NAME;
  $("pjName").textContent = APP_NAME;
  $("pjTag").textContent = CFG.TAGLINE || "";
  $("pjWelcome").textContent = CFG.WELCOME_TEXT || "";
  $("pjFoot").textContent = CFG.FOOTER_TEXT || "";
  ["brandLogo", "pjLogo", "endedLogo"].forEach((id) => setLogo($(id), LOGO));
  (() => {
    const l = document.createElement("link"); l.rel = "icon";
    l.href = /^(https?:|data:)/i.test(LOGO) || /\.(png|jpe?g|svg|webp|gif|ico)(\?.*)?$/i.test(LOGO)
      ? LOGO : "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${LOGO}</text></svg>`);
    document.head.append(l);
  })();

  /* ---- small helpers: toast, beep, download ---- */
  function toast(text, opts) {
    opts = opts || {};
    const d = document.createElement("div"); d.className = "toast" + (opts.type ? " " + opts.type : "");
    const sp = document.createElement("span"); sp.textContent = text; d.append(sp);
    const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.setAttribute("aria-label", "Dismiss"); x.onclick = () => d.remove(); d.append(x);
    $("toasts").append(d);
    if (opts.ms !== 0) setTimeout(() => d.remove(), opts.ms || 5000);
    return d;
  }
  let actx = null;
  function beep() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.value = 0.05;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.15);
    } catch (e) { /* ignore */ }
  }
  function saveBlob(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  const netBad = (b) => $("netDot").classList.toggle("bad", !!b);

  function setStatus(t) { const el = $("vstatus"); el.textContent = t || ""; el.style.display = t ? "block" : "none"; }
  function ensureTile(id, name, self) {
    let t = tiles.get(id);
    if (!t) {
      const d = document.createElement("div"); d.className = "tile" + (self ? " self" : "");
      const v = document.createElement("video"); v.autoplay = true; v.playsInline = true; if (self) v.muted = true;
      const n = document.createElement("span"); n.className = "nm";
      d.append(v, n); $("vgrid").append(d); t = { d, v, n }; tiles.set(id, t);
    }
    if (name) t.n.textContent = name + (self ? " (you)" : "");
    return t;
  }
  function dropTile(id) { const t = tiles.get(id); if (t) { t.d.remove(); tiles.delete(id); } }

  /* ---- camera / microphone ---- */
  function blackTrack() { const c = document.createElement("canvas"); c.width = c.height = 16; c.getContext("2d").fillRect(0, 0, 16, 16); return c.captureStream(5).getVideoTracks()[0]; }
  function silentTrack() { try { const ac = new (window.AudioContext || window.webkitAudioContext)(); return ac.createMediaStreamDestination().stream.getAudioTracks()[0]; } catch (e) { return null; } }
  async function getLocalMedia() {
    let st = null; const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      try { st = await md.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } }, audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch (e1) {
        try { st = await md.getUserMedia({ audio: true }); }
        catch (e2) { try { st = await md.getUserMedia({ video: true }); } catch (e3) { st = null; } }
      }
    }
    if (!st) st = new MediaStream();
    // a call needs one video and one audio track in each direction, even if the camera or microphone is missing
    if (!st.getVideoTracks().length) st.addTrack(blackTrack());
    if (!st.getAudioTracks().length) { const a = silentTrack(); if (a) st.addTrack(a); }
    return st;
  }
  const outVideo = () => (screenStream ? screenStream.getVideoTracks()[0] : camTrack);
  const outStream = () => new MediaStream([outVideo(), ...localStream.getAudioTracks()].filter(Boolean));

  function setMic(on) {
    const t = localStream && localStream.getAudioTracks()[0]; if (!t) return;
    t.enabled = on; $("micBtn").classList.toggle("off", !on); $("micBtn").textContent = on ? "🎤" : "🔇";
  }
  $("micBtn").onclick = () => { const t = localStream && localStream.getAudioTracks()[0]; if (t) setMic(!t.enabled); };
  $("camBtn").onclick = () => {
    if (!camTrack) return;
    camTrack.enabled = !camTrack.enabled; $("camBtn").classList.toggle("off", !camTrack.enabled); $("camBtn").textContent = camTrack.enabled ? "📷" : "🚫";
  };
  function setOutVideo(track) {
    calls.forEach((c) => {
      try { const sd = c.peerConnection && c.peerConnection.getSenders().find((x) => x.track && x.track.kind === "video"); if (sd) sd.replaceTrack(track).catch(() => {}); }
      catch (e) { console.warn(e); }
    });
    const t = tiles.get("self");
    if (t) { t.v.srcObject = new MediaStream([track, ...localStream.getAudioTracks()]); t.d.classList.toggle("screen", !!screenStream); }
  }
  async function toggleScreen() {
    if (screenStream) { stopScreen(); return; }
    try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch (e) { screenStream = null; return; }
    const tr = screenStream.getVideoTracks()[0]; tr.onended = stopScreen;
    setOutVideo(tr); $("scrBtn").classList.add("on");
  }
  function stopScreen() {
    if (!screenStream) return;
    const st = screenStream; screenStream = null; st.getTracks().forEach((t) => t.stop());
    setOutVideo(camTrack); $("scrBtn").classList.remove("on");
  }
  $("scrBtn").onclick = toggleScreen;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) $("scrBtn").style.display = "none";

  /* ---- teacher (the hub: every student connects to this browser) ---- */
  function startHost() {
    let tries = 0, ready = false;
    const open = () => {
      if (leaving) return;
      setStatus("Starting class…");
      peer = new Peer(HOST_PEER, PEER_OPTS);
      peer.on("open", (id) => {
        netBad(false); myId = id; hostId = id; recalc();
        if (ready) return; ready = true;
        setStatus("Class is live. Click 🔗 Share link to invite students.");
        setTimeout(() => { if ($("vstatus").textContent.startsWith("Class is live")) setStatus(""); }, 9000);
      });
      peer.on("connection", onStudentConn);
      peer.on("call", onStudentCall);
      peer.on("disconnected", () => { netBad(true); if (!leaving && peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
      peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          if (++tries > 20) { setStatus("This class is already open in another tab or device. Close it, then reload this page."); return; }
          setStatus(`Room busy (an old session may still be closing)… retry ${tries}/20`);
          try { peer.destroy(); } catch (e) { /* ignore */ }
          setTimeout(open, 3000);
        } else if (err.type === "peer-unavailable") { /* a student left early */ }
        else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) setStatus("Cannot reach the connection service. Check your internet…");
        else console.warn("peer error", err);
      });
    };
    open();
  }
  function uniqueName(n, id) {
    const used = new Set(); peers.forEach((p, k) => { if (k !== id && p.name) used.add(p.name.toLowerCase()); });
    if (!used.has(n.toLowerCase())) return n;
    let i = 2; while (used.has(`${n} (${i})`.toLowerCase())) i++;
    return `${n} (${i})`;
  }
  function onStudentConn(conn) {
    const id = conn.peer;
    const wasKnown = attendance.some((a) => a.id === id);
    if (rejected.has(id) || (locked && !wasKnown)) {
      if (!rejected.has(id)) turnedAway.add(id);
      conn.on("open", () => {
        try { conn.send("wb:" + JSON.stringify({ t: "kick", reason: rejected.has(id) ? "removed" : "locked" })); } catch (e) { /* ignore */ }
        setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 600);
      });
      return;
    }
    conn.on("open", () => {
      const p = peers.get(id) || {}; p.conn = conn;
      p.name = uniqueName(String((conn.metadata && conn.metadata.name) || "Student").trim().slice(0, 40) || "Student", id); peers.set(id, p);
      let a = attendance.find((x) => x.id === id);
      if (a) a.left = null; else { a = { id, name: p.name, joined: new Date(), left: null }; attendance.push(a); addSys(`${p.name} joined`); }
      p.att = a;
      ensureTile(id, p.name);
      bcast({ t: "hello", name: teacherName, chat: chatOn, rec: !!recorder }, [id]);
      sendPerm([id]);
      if ($("showAll").checked) bcast({ t: "mode", m: main.dataset.mode }, [id]);
      sendState(id); refreshPerm();
    });
    conn.on("data", (d) => onData(id, d));
    const gone = () => { const p = peers.get(id); if (p && p.conn === conn) dropStudent(id); };
    conn.on("close", gone); conn.on("error", gone);
  }
  function onStudentCall(call) {
    const id = call.peer;
    if (blocked(id)) { try { call.close(); } catch (e) { /* ignore */ } return; }
    const p = peers.get(id) || {}; p.call = call; peers.set(id, p);
    calls.add(call);
    call.answer(outStream());
    call.on("stream", (st) => { const q = peers.get(id) || {}; ensureTile(id, q.name || (call.metadata && call.metadata.name) || "Student").v.srcObject = st; });
    call.on("close", () => calls.delete(call)); call.on("error", () => calls.delete(call));
  }
  function dropStudent(id) {
    const p = peers.get(id); if (!p) return;
    peers.delete(id);
    try { p.call && p.call.close(); } catch (e) { /* ignore */ }
    try { p.conn && p.conn.close(); } catch (e) { /* ignore */ }
    if (p.att) p.att.left = new Date();
    if (!ended) addSys(`${p.name || "A student"} left`);
    dropTile(id); allowed.delete(id); sendPerm(); updateHandBadge(); refreshPerm();
  }
  function lowerHand(id) {
    const p = peers.get(id); if (!p) return;
    p.hand = false; setHandMark(id, false); bcast({ t: "lowerhand" }, [id]); updateHandBadge(); refreshPerm();
  }
  function setHandMark(id, on) {
    const t = tiles.get(id); if (!t) return;
    let h = t.d.querySelector(".hand");
    if (on && !h) { h = document.createElement("div"); h.className = "hand"; h.textContent = "✋"; t.d.append(h); }
    else if (!on && h) h.remove();
  }
  function updateHandBadge() {
    let n = 0; peers.forEach((p) => { if (p.hand) n++; });
    const b = $("handBadge"); b.textContent = "✋ " + n; b.style.display = n ? "inline" : "none";
  }

  /* ---- student ---- */
  function startGuest() {
    peer = new Peer(undefined, PEER_OPTS);
    let timer = null;
    const waitMsg = "Waiting for the teacher to start the class…";
    const schedule = (msg, ms) => { if (leaving) return; setStatus(msg); clearTimeout(timer); timer = setTimeout(connectHost, ms || 3000); };
    const linked = (conn) => {
      hostId = HOST_PEER; peers.set(HOST_PEER, { conn, name: teacherName }); setStatus(""); recalc();
      if (handUp) setTimeout(() => bcast({ t: "hand", up: true }), 600);
      const call = peer.call(HOST_PEER, outStream(), { metadata: { name: myName } });
      peers.get(HOST_PEER).call = call; calls.add(call);
      call.on("stream", (st) => { ensureTile(HOST_PEER, teacherName).v.srcObject = st; });
      call.on("close", () => calls.delete(call));
    };
    const lost = () => {
      const p = peers.get(HOST_PEER); peers.delete(HOST_PEER);
      try { p && p.call && p.call.close(); } catch (e) { /* ignore */ }
      calls.clear(); dropTile(HOST_PEER); hostId = null; recalc();
      schedule("The teacher disconnected. Waiting to reconnect…");
    };
    const connectHost = () => {
      if (leaving || !peer || peer.destroyed) return;
      if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* ignore */ } }
      setStatus("Connecting to the teacher…");
      const conn = peer.connect(HOST_PEER, { reliable: true, metadata: { name: myName } });
      let opened = false;
      conn.on("open", () => { opened = true; clearTimeout(timer); linked(conn); });
      conn.on("data", (d) => onData(HOST_PEER, d));
      conn.on("close", () => { if (opened) { const p = peers.get(HOST_PEER); if (p && p.conn === conn) lost(); } });
      conn.on("error", () => {});
      clearTimeout(timer);
      timer = setTimeout(() => { if (!opened) { try { conn.close(); } catch (e) { /* ignore */ } schedule(waitMsg); } }, 10000);
    };
    peer.on("open", (id) => { netBad(false); const first = !myId; myId = id; recalc(); if (first) connectHost(); });
    peer.on("disconnected", () => { netBad(true); if (!leaving && peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") schedule(waitMsg);
      else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) setStatus("Cannot reach the connection service. Check your internet…");
      else console.warn("peer error", err);
    });
  }

  /* ---- leaving ---- */
  function showEnded(msg) {
    if (ended) return;
    if (isHost) { finishRecording(); const n = new Date(); attendance.forEach((a) => { if (!a.left) a.left = n; }); }
    ended = true; leaving = true;
    $("endedMsg").textContent = msg || "The class has ended. Thanks for joining!";
    try { wl && wl.release(); } catch (e) { /* ignore */ }
    try { peer && peer.destroy(); } catch (e) { /* ignore */ }
    try { localStream && localStream.getTracks().forEach((t) => t.stop()); screenStream && screenStream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
    $("ended").classList.add("show");
  }
  $("leaveBtn").onclick = () => {
    if (!confirm(isHost ? "End the class for everyone?" : "Leave the class?")) return;
    if (isHost) {
      bcast({ t: "end" });
      if (attendance.length && confirm("Download the attendance list before ending?")) downloadAttendance();
      setTimeout(() => showEnded(), 400);
    } else showEnded();
  };
  $("rejoin").addEventListener("click", () => location.reload());

  /* ---- join screen ---- */
  let teacherMode = false;
  const pjMsg = (t) => { $("pjMsg").textContent = t || ""; };
  try { $("pjUser").value = localStorage.getItem("meeting-name") || ""; } catch (e) { /* ignore */ }
  function setTeacherMode(on) {
    teacherMode = on;
    $("pjTeacherRow").style.display = on ? "" : "none";
    $("pjTeacher").textContent = on ? "Start class" : "Teacher login";
    $("pjTeacher").classList.toggle("primary", on); $("pjStudent").classList.toggle("primary", !on);
    const named = TEACHERS.length && TEACHERS.every((t) => t.name);
    $("pjUser").parentElement.style.display = on && named ? "none" : "";
    if (on) $("pjPass").focus();
  }
  if (ROLE_PARAM === "student") $("pjTeacher").style.display = "none";
  if (ROLE_PARAM === "teacher") { $("pjStudent").style.display = "none"; setTeacherMode(true); }
  let fails = 0, lockUntil = 0;
  async function enter(asHost) {
    if (entering) return;
    let who = null;   // the teacher whose passcode matched
    if (typeof Peer === "undefined") { pjMsg("Could not load the connection library. Check your internet and reload."); return; }
    if (asHost) {
      const wait = Math.ceil((lockUntil - Date.now()) / 1000);
      if (wait > 0) { pjMsg(`Too many wrong attempts. Try again in ${wait}s.`); return; }
      let h = "";
      try { h = await sha256Hex($("pjPass").value); }
      catch (e) { pjMsg("Passcode check needs HTTPS (GitHub Pages) or localhost."); return; }
      who = TEACHERS.find((t) => t.hash === h) || null;
      if (!who) {
        fails++; if (fails >= 3) lockUntil = Date.now() + Math.min(300, (fails - 2) * 15) * 1000;
        pjMsg("Wrong passcode"); return;
      }
      fails = 0;
      if (who.rooms && !who.rooms.some((r) => cleanId(r).toLowerCase() === ROOM_ID.toLowerCase())) {
        pjMsg("This passcode is not allowed to host this class room."); return;
      }
    }
    const nm = (asHost && who && who.name) || $("pjUser").value.trim() || (asHost ? "Teacher" : "");
    if (!nm) { pjMsg("Please enter your name"); return; }
    entering = true; myName = nm; pjMsg("");
    try { localStorage.setItem("meeting-name", nm); } catch (e) { /* ignore */ }
    $("pjStudent").disabled = $("pjTeacher").disabled = true;
    localStream = await getLocalMedia(); camTrack = localStream.getVideoTracks()[0];
    $("prejoin").style.display = "none";
    if (!asHost) { $("vwrap").classList.add("guest"); $("handBtn").style.display = ""; }
    keepAwake();
    ensureTile("self", myName, true).v.srcObject = localStream;
    if (asHost) {
      isHost = true; teacherName = (who && who.name) || TEACHER_LABEL || myName;
      $("recBtn").style.display = "";
      if (TEACHERS.some((t) => t.hash === DEFAULT_HASH)) toast("⚠ A teacher is still using the default passcode (change-me-123). Replace its hash in config.js.", { type: "warn", ms: 0 });
      toast(`Logged in as ${teacherName}`, { ms: 3000 });
      if (ROOM_ID === cleanId(DEFAULT_ROOM)) toast("⚠ Change ROOM and NAMESPACE in config.js so your class link is unique and hard to guess.", { type: "warn", ms: 0 });
      $("shareBtn").style.display = ""; $("permBtn").style.display = ""; $("showAllWrap").style.display = "";
      recalc(); startHost();
    } else startGuest();
  }
  $("pjTeacher").onclick = () => { if (!teacherMode) setTeacherMode(true); else enter(true); };
  $("pjStudent").onclick = () => { if (teacherMode) setTeacherMode(false); enter(false); };
  [$("pjUser"), $("pjPass")].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") (teacherMode ? $("pjTeacher") : $("pjStudent")).click(); }));

  /* =====================  LAYOUT  ===================== */
  const main = $("main"), stage = $("stage"), vwrap = $("vwrap");
  function setMode(m, remote) {
    main.dataset.mode = m;
    if (isHost && !remote && $("showAll").checked) bcast({ t: "mode", m });
    document.querySelectorAll("#top [data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    if (m === "board" && !vwrap.dataset.placed) {
      const r = stage.getBoundingClientRect();
      vwrap.style.setProperty("--fx", Math.max(8, r.width - 320 - 16) + "px");
      vwrap.style.setProperty("--fy", Math.max(8, r.height - 220 - 16) + "px");
      vwrap.dataset.placed = "1";
    }
    setTimeout(() => { resizeCanvas(); }, 30);
  }
  document.querySelectorAll("#top [data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("vSplit").addEventListener("click", () => setMode("split"));

  // divider between video and whiteboard (split mode)
  (() => {
    const s = $("split"); let drag = false;
    s.addEventListener("pointerdown", (e) => { drag = true; s.setPointerCapture(e.pointerId); });
    s.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = stage.getBoundingClientRect();
      stage.style.setProperty("--vw", clamp(e.clientX - r.left, 200, r.width - 320) + "px");
      vwrap.style.setProperty("--vw", clamp(e.clientX - r.left, 200, r.width - 320) + "px");
    });
    const end = () => { drag = false; };
    s.addEventListener("pointerup", end); s.addEventListener("pointercancel", end);
  })();

  // floating video window: drag + resize (whiteboard mode)
  (() => {
    const bar = $("vbar"), grip = $("vgrip");
    let mode = null, off = [0, 0];
    const num = (v, d) => parseFloat(vwrap.style.getPropertyValue(v)) || d;
    bar.addEventListener("pointerdown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      mode = "move"; bar.setPointerCapture(e.pointerId);
      off = [e.clientX - num("--fx", 20), e.clientY - num("--fy", 20)];
    });
    grip.addEventListener("pointerdown", (e) => { mode = "size"; grip.setPointerCapture(e.pointerId); e.stopPropagation(); });
    const move = (e) => {
      if (!mode) return;
      const r = stage.getBoundingClientRect();
      if (mode === "move") {
        const w = num("--fw", 320), h = num("--fh", 220);
        vwrap.style.setProperty("--fx", clamp(e.clientX - off[0] - 0, 0, r.width - w) + "px");
        vwrap.style.setProperty("--fy", clamp(e.clientY - off[1] - 0, 0, r.height - h) + "px");
      } else {
        const x = num("--fx", 20), y = num("--fy", 20);
        vwrap.style.setProperty("--fw", clamp(e.clientX - r.left - x, 200, r.width - x) + "px");
        vwrap.style.setProperty("--fh", clamp(e.clientY - r.top - y, 140, r.height - y) + "px");
      }
    };
    const end = () => { mode = null; };
    [bar, grip].forEach((el) => { el.addEventListener("pointermove", move); el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end); });
  })();

  /* =====================  CHAT  ===================== */
  const chatLog = $("chatLog"), badge = $("badge");
  let unread = 0;
  function addChat(who, text, mine) {
    const d = document.createElement("div"); d.className = "msg" + (mine ? " mine" : "");
    const h = document.createElement("div"); h.className = "mh";
    h.textContent = `${who} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const b = document.createElement("div"); b.textContent = text;
    d.append(h, b); chatLog.append(d); chatLog.scrollTop = chatLog.scrollHeight;
  }
  $("chatBtn").addEventListener("click", () => {
    const open = main.classList.toggle("chat-open");
    $("chatBtn").classList.toggle("active", open);
    if (open) { unread = 0; badge.style.display = "none"; $("chatInput").focus(); }
    setTimeout(resizeCanvas, 30);
  });
  function addSys(text) {
    const d = document.createElement("div"); d.className = "msg sys"; d.textContent = text;
    chatLog.append(d); chatLog.scrollTop = chatLog.scrollHeight;
  }
  function chatEnabled(on) {
    chatOn = on; const off = !on && !isHost;
    $("chatInput").disabled = off; $("chatSend").disabled = off;
    $("chatInput").placeholder = off ? "Chat is turned off by the teacher" : "Type a message…";
  }
  function setHand(up, fromHost) {
    handUp = up; $("handBtn").classList.toggle("on", up);
    if (!fromHost) bcast({ t: "hand", up });
    else toast("The teacher lowered your hand.");
  }
  $("handBtn").onclick = () => setHand(!handUp);
  function showRec(on) {
    $("recBadge").style.display = on ? "" : "none";
    if (on && !isHost) toast("🔴 This class is being recorded.", { type: "warn" });
  }
  $("chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!chatOn && !isHost) return;
    const t = $("chatInput").value.trim(); if (!t) return;
    $("chatInput").value = "";
    bcast({ t: "chat", who: myName, text: t });
    addChat("You", t, true);
  });
  function incomingChat(m) {
    addChat(String(m.who || "Guest").slice(0, 40), String(m.text || "").slice(0, 2000), false);
    if (!main.classList.contains("chat-open")) { unread++; badge.textContent = unread; badge.style.display = "inline"; }
  }

  /* =====================  NETWORK (whiteboard + chat over data channels)  ===================== */
  // Teacher = hub. Students send to the teacher; the teacher checks permissions and forwards to everyone else.
  const queue = [], CH = 12000;
  function targets() { const r = []; peers.forEach((p, id) => { if (p.conn && p.conn.open) r.push(id); }); return r; }
  function sendRaw(id, s) {
    if (s.length <= CH) { queue.push({ id, text: "wb:" + s }); return; }
    const mid = uid(), n = Math.ceil(s.length / CH);
    for (let i = 0; i < n; i++) queue.push({ id, text: `wc:${mid}:${i}:${n}:${s.slice(i * CH, (i + 1) * CH)}` });
  }
  function bcast(obj, to) {
    const list = to || targets(); if (!list.length) return;
    const s = JSON.stringify(obj); list.forEach((id) => sendRaw(id, s));
  }
  function relayRaw(s, except) { targets().forEach((id) => { if (id !== except) sendRaw(id, s); }); }
  setInterval(() => {
    for (let k = 0; k < 12 && queue.length; k++) {
      const m = queue[0], p = peers.get(m.id);
      if (!p || !p.conn || !p.conn.open) { queue.shift(); continue; }
      const dc = p.conn.dataChannel;
      if (dc && dc.bufferedAmount > 1000000) break;
      queue.shift();
      try { p.conn.send(m.text); } catch (err) { console.warn(err); }
    }
  }, 8);
  const asm = {};
  function onData(from, text) {
    if (typeof text !== "string") return;
    let full = null;
    if (text.startsWith("wb:")) full = text.slice(3);
    else if (text.startsWith("wc:")) {
      const parts = text.split(":"); const mid = parts[1], i = +parts[2], n = +parts[3];
      const data = text.slice(`wc:${mid}:${i}:${n}:`.length);
      const k = from + mid; const a = asm[k] || (asm[k] = { n, got: 0, p: [] });
      if (!a.p[i]) { a.p[i] = data; a.got++; }
      if (a.got === n) { delete asm[k]; full = a.p.join(""); }
    }
    if (full === null) return;
    try {
      const m = JSON.parse(full);
      if (!m || typeof m !== "object") return;
      if (isHost) {
        const p = peers.get(from); if (!p || !p.conn) return;
        if (m.t === "chat") {
          const now = Date.now(); p.ct = (p.ct || []).filter((x) => now - x < 5000);
          if (!chatOn || p.ct.length >= 6) return; p.ct.push(now);
          m.who = p.name; m.text = String(m.text || "").slice(0, 2000); if (!m.text.trim()) return;
          full = JSON.stringify(m);
        }
      }
      onMsg(m, from);
      if (isHost && (m.t === "chat" || (WRITE.includes(m.t) && authorized(from)))) relayRaw(full, from);
    } catch (err) { console.warn("message error", err); }
  }

  /* =====================  WHITEBOARD STATE  ===================== */
  const pages = {};
  const pg = (k) => pages[k] || (pages[k] = { objs: [], bg: null, undo: [], redo: [] });
  let key = "board";
  let pdfDoc = null, pdfId = null, pdfInfo = { n: 1, total: 1 };
  const sentBg = new Set();
  const view = { s: 1, x: 0, y: 0 };
  const S = { tool: "pen", color: "#111111", size: 4, fill: false };
  let selId = null, dirty = true, spaceDown = false;

  // ---- host / permissions ----
  const WRITE = ["put", "putn", "pt", "del", "clear", "bg", "page"];
  let isHost = false, hostId = null, allowAll = false, allowed = new Set(), canDraw = false, rx = 0;
  const authorized = (id) => id === hostId || allowAll || allowed.has(id);
  function recalc() {
    const was = canDraw;
    canDraw = isHost || allowAll || (!!myId && allowed.has(myId));
    $("viewOnly").style.display = canDraw ? "none" : "block";
    document.querySelectorAll("#tools [data-tool]").forEach((b) => { b.disabled = !canDraw && b.dataset.tool !== "hand"; });
    $("clearBtn").disabled = !canDraw; $("pdfBtn").disabled = !canDraw;
    if (!canDraw) setTool("hand"); else if (!was) setTool("pen");
    updUI();
  }
  function sendPerm(to) { bcast({ t: "perm", all: allowAll, ids: Array.from(allowed) }, to); }

  const cv = $("cv"), ctx = cv.getContext("2d"), wrap = $("cvwrap");
  let dpr = 1;
  function resizeCanvas() {
    const r = wrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    dirty = true;
  }
  new ResizeObserver(resizeCanvas).observe(wrap);
  window.addEventListener("resize", resizeCanvas);

  /* ---- object operations (local + broadcast) ---- */
  const find = (id) => pg(key).objs.find((o) => o.id === id);
  function applyPut(k, o) { const p = pg(k); const i = p.objs.findIndex((x) => x.id === o.id); if (i >= 0) p.objs[i] = o; else p.objs.push(o); }
  function applyDel(k, ids) { const p = pg(k); p.objs = p.objs.filter((o) => !ids.includes(o.id)); }
  function applyClear(k) { pg(k).objs = []; }
  function opPut(k, o) { applyPut(k, o); bcast({ t: "put", k, o }); dirty = true; updUI(); }
  function opDel(k, ids) { applyDel(k, ids); bcast({ t: "del", k, ids }); if (ids.includes(selId)) selId = null; dirty = true; updUI(); }
  function opClear(k) { applyClear(k); bcast({ t: "clear", k }); selId = null; dirty = true; updUI(); }
  function pushUndo(k, a) { const p = pg(k); p.undo.push(a); p.redo.length = 0; if (p.undo.length > 200) p.undo.shift(); updUI(); }
  const addAction = (k, o) => ({ undo: () => opDel(k, [o.id]), redo: () => opPut(k, cl(o)) });
  function undo() { const p = pg(key), a = p.undo.pop(); if (!a) return; a.undo(); p.redo.push(a); updUI(); }
  function redo() { const p = pg(key), a = p.redo.pop(); if (!a) return; a.redo(); p.undo.push(a); updUI(); }

  function setBg(k, data, w, h) {
    const img = new Image(); img.onload = () => { dirty = true; }; img.src = data;
    pg(k).bg = { img, data, w, h };
    dirty = true;
  }

  function sendState(id) {
    if (!isHost || !id || id === myId) return;
    const has = Object.keys(pages).some((k) => pages[k].objs.length) || key !== "board";
    if (!has) return;
    const to = [id];
    Object.keys(pages).forEach((k) => {
      const os = pages[k].objs;
      for (let i = 0; i < os.length; i += 40) bcast({ t: "putn", k, os: os.slice(i, i + 40) }, to);
    });
    if ($("share").checked && key !== "board") {
      const b = pg(key).bg; if (b) bcast({ t: "bg", k: key, img: b.data, w: b.w, h: b.h }, to);
    }
    if ($("share").checked) bcast({ t: "page", k: key, n: pdfInfo.n, total: pdfInfo.total }, to);
  }

  const HOSTCMD = ["hello", "kick", "end", "mute", "lowerhand", "chatlock", "rec"];
  function hostCmd(m) {
    switch (m.t) {
      case "hello": if (m.name) { teacherName = String(m.name).slice(0, 40); ensureTile(HOST_PEER, teacherName); } chatEnabled(m.chat !== false); showRec(!!m.rec); break;
      case "kick": showEnded(m.reason === "locked" ? "This class is locked. Ask your teacher to unlock it, then rejoin." : "You were removed from the class by the teacher."); break;
      case "end": showEnded("The teacher ended the class. Thanks for joining!"); break;
      case "mute": { const t = localStream && localStream.getAudioTracks()[0]; if (t && t.enabled) { setMic(false); toast("The teacher muted your microphone."); } break; }
      case "lowerhand": setHand(false, true); break;
      case "chatlock": chatEnabled(m.on !== false); break;
      case "rec": showRec(!!m.on); break;
    }
  }
  function onMsg(m, from) {
    rx++;
    if (m.t === "chat") { incomingChat(m); return; }
    if (m.t === "hand") {
      if (!isHost || !from) return; const p = peers.get(from); if (!p) return;
      p.hand = !!m.up; setHandMark(from, p.hand);
      if (p.hand) { toast(`✋ ${p.name} raised a hand`); beep(); }
      updateHandBadge(); refreshPerm(); return;
    }
    if (HOSTCMD.includes(m.t)) { if (isHost || (from && from !== hostId)) return; hostCmd(m); return; }
    if (m.t === "perm") { if (from && from !== hostId) return; allowAll = !!m.all; allowed = new Set(m.ids || []); recalc(); return; }
    if (m.t === "mode") { if (from && from !== hostId) return; setMode(m.m, true); return; }
    if (WRITE.includes(m.t) && from && !authorized(from)) return;
    switch (m.t) {
      case "put": applyPut(m.k, m.o); break;
      case "putn": m.os.forEach((o) => applyPut(m.k, o)); break;
      case "pt": { const o = pg(m.k).objs.find((x) => x.id === m.id); if (o && o.pts) o.pts.push(...m.p); break; }
      case "del": applyDel(m.k, m.ids); break;
      case "clear": applyClear(m.k); break;
      case "bg": setBg(m.k, m.img, m.w, m.h); break;
      case "page":
        pdfInfo = { n: m.n || 1, total: m.total || 1 };
        switchPage(m.k, true);
        if (m.k !== "board" && !pg(m.k).bg && from) bcast({ t: "needbg", k: m.k }, [from]);
        break;
      case "needbg": { const b = pg(m.k).bg; if (b && from) bcast({ t: "bg", k: m.k, img: b.data, w: b.w, h: b.h }, [from]); break; }
    }
    dirty = true; updUI();
  }

  /* ---- geometry helpers ---- */
  const distSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  function bbox(o) {
    if (o.pts) {
      const xs = o.pts.map((p) => p[0]), ys = o.pts.map((p) => p[1]), pad = o.sw / 2;
      return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    }
    if (o.a) { const pad = o.sw / 2; return [Math.min(o.a[0], o.b[0]) - pad, Math.min(o.a[1], o.b[1]) - pad, Math.max(o.a[0], o.b[0]) + pad, Math.max(o.a[1], o.b[1]) + pad]; }
    if (o.type === "text") {
      ctx.save(); ctx.font = `${o.fs}px sans-serif`;
      const lines = o.t.split("\n"), w = Math.max(...lines.map((l) => ctx.measureText(l).width)); ctx.restore();
      return [o.x, o.y, o.x + w, o.y + lines.length * o.fs * 1.25];
    }
    return [o.x, o.y, o.x + o.w, o.y + o.h];
  }
  function hit(o, x, y, tol) {
    const t = tol + (o.sw || 0) / 2;
    switch (o.type) {
      case "pen": case "hl":
        if (o.pts.length === 1) return Math.hypot(x - o.pts[0][0], y - o.pts[0][1]) <= t;
        for (let i = 0; i < o.pts.length - 1; i++) if (distSeg(x, y, o.pts[i][0], o.pts[i][1], o.pts[i + 1][0], o.pts[i + 1][1]) <= t) return true;
        return false;
      case "line": case "arrow": return distSeg(x, y, o.a[0], o.a[1], o.b[0], o.b[1]) <= t;
      case "rect": {
        const out = x >= o.x - t && x <= o.x + o.w + t && y >= o.y - t && y <= o.y + o.h + t;
        const inn = x > o.x + t && x < o.x + o.w - t && y > o.y + t && y < o.y + o.h - t;
        return o.f ? out : out && !inn;
      }
      case "ellipse": {
        const rx = Math.max(o.w / 2, 1), ry = Math.max(o.h / 2, 1), d = Math.hypot((x - o.x - rx) / rx, (y - o.y - ry) / ry);
        const e = t / Math.min(rx, ry);
        return o.f ? d <= 1 + e : Math.abs(d - 1) <= e;
      }
      case "text": { const b = bbox(o); return x >= b[0] - tol && x <= b[2] + tol && y >= b[1] - tol && y <= b[3] + tol; }
    }
    return false;
  }
  function findHit(w, tol) { const os = pg(key).objs; for (let i = os.length - 1; i >= 0; i--) if (hit(os[i], w[0], w[1], tol)) return os[i]; return null; }
  function translate(o, dx, dy) {
    const n = cl(o);
    if (n.pts) n.pts = n.pts.map((p) => [p[0] + dx, p[1] + dy]);
    if (n.a) { n.a = [n.a[0] + dx, n.a[1] + dy]; n.b = [n.b[0] + dx, n.b[1] + dy]; }
    if (n.x !== undefined) { n.x += dx; n.y += dy; }
    return n;
  }

  /* ---- rendering ---- */
  function drawObj(o) {
    ctx.save();
    ctx.strokeStyle = o.c; ctx.fillStyle = o.c; ctx.lineWidth = o.sw; ctx.lineCap = "round"; ctx.lineJoin = "round";
    switch (o.type) {
      case "pen": case "hl": {
        if (o.type === "hl") ctx.globalAlpha = 0.35;
        const p = o.pts;
        if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0], p[0][1], o.sw / 2, 0, Math.PI * 2); ctx.fill(); }
        else {
          ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
          for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
          ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]); ctx.stroke();
        }
        break;
      }
      case "line": case "arrow": {
        ctx.beginPath(); ctx.moveTo(o.a[0], o.a[1]); ctx.lineTo(o.b[0], o.b[1]); ctx.stroke();
        if (o.type === "arrow") {
          const ang = Math.atan2(o.b[1] - o.a[1], o.b[0] - o.a[0]), hl = Math.max(12, o.sw * 4);
          ctx.beginPath();
          ctx.moveTo(o.b[0] - hl * Math.cos(ang - 0.45), o.b[1] - hl * Math.sin(ang - 0.45)); ctx.lineTo(o.b[0], o.b[1]);
          ctx.lineTo(o.b[0] - hl * Math.cos(ang + 0.45), o.b[1] - hl * Math.sin(ang + 0.45)); ctx.stroke();
        }
        break;
      }
      case "rect":
        if (o.f) { ctx.globalAlpha = 0.3; ctx.fillRect(o.x, o.y, o.w, o.h); ctx.globalAlpha = 1; }
        ctx.strokeRect(o.x, o.y, o.w, o.h); break;
      case "ellipse":
        ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.max(o.w / 2, 0.1), Math.max(o.h / 2, 0.1), 0, 0, Math.PI * 2);
        if (o.f) { ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.stroke(); break;
      case "text":
        ctx.font = `${o.fs}px sans-serif`; ctx.textBaseline = "top";
        o.t.split("\n").forEach((l, i) => ctx.fillText(l, o.x, o.y + i * o.fs * 1.25)); break;
    }
    ctx.restore();
  }
  function drawGrid() {
    const g = 40; if (view.s < 0.3) return;
    const x0 = -view.x / view.s, y0 = -view.y / view.s, x1 = x0 + cv.width / dpr / view.s, y1 = y0 + cv.height / dpr / view.s;
    const n = ((x1 - x0) / g) * ((y1 - y0) / g); if (n > 25000) return;
    ctx.fillStyle = "#ced4da"; const r = 1.4 / view.s;
    for (let x = Math.floor(x0 / g) * g; x < x1; x += g) for (let y = Math.floor(y0 / g) * g; y < y1; y += g) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  let lastZ = "";
  function render() {
    requestAnimationFrame(render);
    const z = Math.round(view.s * 100) + "%"; if (z !== lastZ) { lastZ = z; $("zLbl").textContent = z; }
    if (!dirty) return; dirty = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
    const p = pg(key);
    if (p.bg && p.bg.img.complete && p.bg.img.naturalWidth) {
      ctx.drawImage(p.bg.img, 0, 0, p.bg.w, p.bg.h);
      ctx.strokeStyle = "#adb5bd"; ctx.lineWidth = 1 / view.s; ctx.strokeRect(0, 0, p.bg.w, p.bg.h);
    } else if (!p.bg) drawGrid();
    p.objs.forEach(drawObj);
    if (selId) {
      const o = find(selId);
      if (o) {
        const b = bbox(o), pad = 4 / view.s;
        ctx.save(); ctx.setLineDash([6 / view.s, 4 / view.s]); ctx.strokeStyle = "#1a73e8"; ctx.lineWidth = 1.5 / view.s;
        ctx.strokeRect(b[0] - pad, b[1] - pad, b[2] - b[0] + 2 * pad, b[3] - b[1] + 2 * pad); ctx.restore();
      }
    }
  }
  requestAnimationFrame(render);

  /* ---- view (zoom / pan / fit) ---- */
  function zoomAt(cx, cy, f) {
    const ns = clamp(view.s * f, 0.1, 8), r = ns / view.s;
    view.x = cx - (cx - view.x) * r; view.y = cy - (cy - view.y) * r; view.s = ns; dirty = true;
  }
  function fitView() {
    const r = wrap.getBoundingClientRect(), b = pg(key).bg;
    if (b) { const s = Math.min((r.width - 40) / b.w, (r.height - 40) / b.h); view.s = s; view.x = (r.width - b.w * s) / 2; view.y = (r.height - b.h * s) / 2; }
    else { view.s = 1; view.x = 0; view.y = 0; }
    dirty = true;
  }
  $("zIn").onclick = () => { const r = wrap.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); };
  $("zOut").onclick = () => { const r = wrap.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); };
  $("zFit").onclick = fitView;
  cv.addEventListener("wheel", (e) => {
    e.preventDefault(); const s = scr(e);
    if (e.ctrlKey || e.metaKey) zoomAt(s[0], s[1], Math.exp(-e.deltaY * (Math.abs(e.deltaY) < 30 ? 0.01 : 0.0025)));
    else if (e.shiftKey) view.x -= e.deltaY;
    else { view.x -= e.deltaX; view.y -= e.deltaY; }
    dirty = true;
  }, { passive: false });

  /* ---- pages / PDF ---- */
  function switchPage(k, fit) {
    commitText(); key = k; selId = null;
    if (fit) fitView();
    dirty = true; updUI();
  }
  function broadcastPage(k) {
    if (!$("share").checked) return;
    const b = pg(k).bg;
    if (k !== "board" && b && !sentBg.has(k)) { bcast({ t: "bg", k, img: b.data, w: b.w, h: b.h }); sentBg.add(k); }
    bcast({ t: "page", k, n: pdfInfo.n, total: pdfInfo.total });
  }
  async function gotoPdfPage(n) {
    if (!pdfDoc) return;
    n = clamp(n, 1, pdfDoc.numPages);
    const k = `pdf${pdfId}:${n}`;
    if (!pg(k).bg) {
      const page = await pdfDoc.getPage(n), v1 = page.getViewport({ scale: 1 });
      const sc = 1200 / v1.width, vp = page.getViewport({ scale: sc });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      setBg(k, c.toDataURL("image/jpeg", 0.72), 1000, 1000 * v1.height / v1.width);
    }
    pdfInfo = { n, total: pdfDoc.numPages };
    switchPage(k, true); broadcastPage(k);
  }
  $("pdfBtn").onclick = () => $("pdfFile").click();
  $("pdfFile").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (typeof pdfjsLib === "undefined") { alert("The PDF library could not be loaded. Check your internet connection."); return; }
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      pdfDoc = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
      pdfId = uid().slice(0, 5); await gotoPdfPage(1);
    } catch (err) { console.error(err); alert("Could not open that PDF."); }
  };
  $("pPrev").onclick = () => gotoPdfPage(pdfInfo.n - 1);
  $("pNext").onclick = () => gotoPdfPage(pdfInfo.n + 1);
  $("pBoard").onclick = () => { switchPage("board", true); broadcastPage("board"); };

  /* ---- toolbar wiring ---- */
  const COLORS = ["#111111", "#e03131", "#f08c00", "#2f9e44", "#1971c2", "#9c36b5", "#868e96", "#ffffff"];
  COLORS.forEach((c) => {
    const b = document.createElement("button"); b.className = "sw"; b.style.background = c; b.dataset.c = c; b.title = c;
    b.onclick = () => setColor(c); $("colors").insertBefore(b, $("colorPick"));
  });
  function setColor(c) {
    S.color = c; $("colorPick").value = c;
    document.querySelectorAll(".sw").forEach((b) => b.classList.toggle("active", b.dataset.c === c));
    if (selId) { const o = find(selId); if (o) { const before = cl(o), after = cl(o); after.c = c; if (after.f) after.f = c; opPut(key, after); pushUndo(key, { undo: () => opPut(key, cl(before)), redo: () => opPut(key, cl(after)) }); } }
  }
  $("colorPick").oninput = (e) => setColor(e.target.value);
  $("size").oninput = (e) => { S.size = +e.target.value; $("sizeLbl").textContent = S.size; };
  $("fill").onchange = (e) => { S.fill = e.target.checked; };
  $("undoBtn").onclick = undo; $("redoBtn").onclick = redo;
  $("clearBtn").onclick = () => {
    const k = key, old = cl(pg(k).objs); if (!old.length) return;
    if (!confirm("Clear this page for everyone?")) return;
    opClear(k);
    pushUndo(k, { undo: () => old.forEach((o) => opPut(k, cl(o))), redo: () => opClear(k) });
  };
  $("saveBtn").onclick = () => { dirty = true; const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "whiteboard.png"; a.click(); };

  function setTool(t) {
    commitText(); S.tool = t; if (t !== "select") selId = null;
    document.querySelectorAll("#tools [data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    cv.style.cursor = { select: "default", hand: "grab", text: "text", eraser: "cell" }[t] || "crosshair";
    dirty = true;
  }
  document.querySelectorAll("#tools [data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));

  function updUI() {
    const p = pg(key);
    $("undoBtn").disabled = !canDraw || !p.undo.length; $("redoBtn").disabled = !canDraw || !p.redo.length;
    $("pLbl").textContent = key === "board" ? "Board" : `Page ${pdfInfo.n}/${pdfInfo.total}`;
    $("pPrev").disabled = !canDraw || !pdfDoc || pdfInfo.n <= 1;
    $("pNext").disabled = !canDraw || !pdfDoc || pdfInfo.n >= (pdfDoc ? pdfDoc.numPages : 1);
    $("pBoard").disabled = !canDraw || key === "board";
  }

  /* ---- text tool ---- */
  let txt = null;
  function startText(s, w) {
    const el = document.createElement("textarea"), fs = 14 + S.size * 2;
    el.id = "wb-text"; el.style.left = s[0] + "px"; el.style.top = s[1] + "px"; el.style.fontSize = fs * view.s + "px"; el.style.color = S.color;
    wrap.append(el); txt = { el, x: w[0], y: w[1], fs, c: S.color, k: key };
    el.addEventListener("input", () => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; });
    el.addEventListener("blur", commitText);
    el.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") { el.value = ""; commitText(); }
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) commitText();
    });
    setTimeout(() => el.focus(), 0);
  }
  function commitText() {
    if (!txt) return; const { el, x, y, fs, c, k } = txt; txt = null;
    const v = el.value.replace(/\s+$/, ""); el.remove(); if (!v) return;
    const o = { id: uid(), type: "text", x, y, t: v, c, fs };
    opPut(k, o); pushUndo(k, addAction(k, cl(o)));
  }

  /* ---- pointer interaction ---- */
  let mode = null, cur = null, curKey = null, start = null, panSt = null, moveSt = null, erased = [];
  let penBuf = null, lastPut = 0;
  const scr = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const wor = (s) => [(s[0] - view.x) / view.s, (s[1] - view.y) / view.s];
  function livePut(o, force) { const now = performance.now(); if (force || now - lastPut > 60) { lastPut = now; bcast({ t: "put", k: curKey, o }); } }
  function flushPen() { if (penBuf && penBuf.pts.length) { bcast({ t: "pt", k: penBuf.k, id: penBuf.id, p: penBuf.pts }); penBuf.pts = []; } }
  setInterval(flushPen, 50);

  function newShape(t, w) {
    const base = { id: uid(), type: t, c: S.color, sw: S.size };
    if (t === "line" || t === "arrow") return Object.assign(base, { a: [w[0], w[1]], b: [w[0], w[1]] });
    return Object.assign(base, { f: S.fill ? S.color : null, x: w[0], y: w[1], w: 0, h: 0 });
  }
  function setGeom(o, st, w, shift) {
    let dx = w[0] - st[0], dy = w[1] - st[1];
    if (o.a) {
      if (shift) { const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(dx, dy); dx = l * Math.cos(ang); dy = l * Math.sin(ang); }
      o.a = [st[0], st[1]]; o.b = [st[0] + dx, st[1] + dy];
    } else {
      if (shift) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
      o.x = Math.min(st[0], st[0] + dx); o.y = Math.min(st[1], st[1] + dy); o.w = Math.abs(dx); o.h = Math.abs(dy);
    }
  }
  function eraseAt(w) {
    const p = pg(curKey), tol = (S.size * 1.5 + 5) / view.s, gone = [];
    for (let i = p.objs.length - 1; i >= 0; i--) if (hit(p.objs[i], w[0], w[1], tol)) gone.push(p.objs[i]);
    if (gone.length) {
      const ids = gone.map((o) => o.id); erased.push(...gone.map(cl));
      applyDel(curKey, ids); bcast({ t: "del", k: curKey, ids }); dirty = true;
    }
  }

  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault(); commitText(); cv.setPointerCapture(e.pointerId);
    const s = scr(e), w = wor(s), p = pg(key);
    if (e.button === 1 || e.button === 2 || S.tool === "hand" || spaceDown) { mode = "pan"; panSt = { s, x: view.x, y: view.y }; cv.style.cursor = "grabbing"; return; }
    if (e.button !== 0 || !canDraw) return;
    curKey = key; const t = S.tool;
    if (t === "pen" || t === "hl") {
      cur = { id: uid(), type: t, c: S.color, sw: t === "hl" ? S.size * 4 : S.size, pts: [w] };
      p.objs.push(cur); mode = "draw"; bcast({ t: "put", k: curKey, o: cur }); penBuf = { k: curKey, id: cur.id, pts: [] };
    } else if (["line", "arrow", "rect", "ellipse"].includes(t)) {
      start = w; cur = newShape(t, w); p.objs.push(cur); mode = "shape";
    } else if (t === "select") {
      const o = findHit(w, 6 / view.s);
      if (o) { selId = o.id; mode = "move"; moveSt = { orig: cl(o), start: w, moved: false }; } else selId = null;
    } else if (t === "eraser") { mode = "erase"; erased = []; eraseAt(w); }
    else if (t === "text") startText(s, w);
    dirty = true;
  });
  cv.addEventListener("pointermove", (e) => {
    if (!mode) return;
    const s = scr(e), w = wor(s);
    if (mode === "pan") { view.x = panSt.x + (s[0] - panSt.s[0]); view.y = panSt.y + (s[1] - panSt.s[1]); }
    else if (mode === "draw") {
      const l = cur.pts[cur.pts.length - 1];
      if (Math.hypot(w[0] - l[0], w[1] - l[1]) >= 1.2 / view.s) { cur.pts.push(w); penBuf.pts.push(w); }
    } else if (mode === "shape") { setGeom(cur, start, w, e.shiftKey); livePut(cur); }
    else if (mode === "move") {
      const dx = w[0] - moveSt.start[0], dy = w[1] - moveSt.start[1];
      if (dx || dy) { moveSt.moved = true; const n = translate(moveSt.orig, dx, dy); applyPut(curKey, n); livePut(n); }
    } else if (mode === "erase") eraseAt(w);
    dirty = true;
  });
  function endPointer() {
    if (!mode) return;
    const k = curKey;
    if (mode === "draw") { flushPen(); bcast({ t: "put", k, o: cur }); pushUndo(k, addAction(k, cl(cur))); }
    else if (mode === "shape") {
      const tiny = cur.a ? Math.hypot(cur.b[0] - cur.a[0], cur.b[1] - cur.a[1]) < 2 / view.s : (cur.w < 2 / view.s && cur.h < 2 / view.s);
      if (tiny) { applyDel(k, [cur.id]); bcast({ t: "del", k, ids: [cur.id] }); }
      else { bcast({ t: "put", k, o: cur }); pushUndo(k, addAction(k, cl(cur))); }
    } else if (mode === "move" && moveSt.moved) {
      const o = find(selId);
      if (o) { const before = moveSt.orig, after = cl(o); bcast({ t: "put", k, o: after }); pushUndo(k, { undo: () => opPut(k, cl(before)), redo: () => opPut(k, cl(after)) }); }
    } else if (mode === "erase" && erased.length) {
      const list = erased.slice();
      pushUndo(k, { undo: () => list.forEach((o) => opPut(k, cl(o))), redo: () => opDel(k, list.map((o) => o.id)) });
    }
    mode = null; cur = null; penBuf = null; setTool(S.tool); dirty = true; updUI();
  }
  cv.addEventListener("pointerup", endPointer);
  cv.addEventListener("pointercancel", endPointer);

  /* ---- keyboard shortcuts ---- */
  const KEYS = { v: "select", h: "hand", p: "pen", m: "hl", e: "eraser", l: "line", a: "arrow", r: "rect", o: "ellipse", t: "text" };
  window.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.code === "Space") { spaceDown = true; e.preventDefault(); return; }
    if (!canDraw) { if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "h") setTool("hand"); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && selId) {
      const o = find(selId); if (o) { const k = key, c = cl(o); opDel(k, [c.id]); pushUndo(k, { undo: () => opPut(k, cl(c)), redo: () => opDel(k, [c.id]) }); }
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && KEYS[e.key.toLowerCase()]) setTool(KEYS[e.key.toLowerCase()]);
  });
  window.addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });

  /* ---- host login + permission panel ---- */
  function renderPerm() {
    const box = $("permList"); box.innerHTML = "";
    $("allowAll").checked = allowAll; $("lockClass").checked = locked; $("chatOnChk").checked = chatOn;
    const list = []; peers.forEach((p, id) => { if (p.conn && p.conn.open) list.push({ id, p }); });
    $("pCount").textContent = `${list.length} student${list.length === 1 ? "" : "s"} online`;
    if (!list.length) { const e = document.createElement("div"); e.className = "muted2"; e.style.padding = "12px 0"; e.textContent = "No students have joined yet."; box.append(e); return; }
    list.forEach(({ id, p }) => {
      const row = document.createElement("div"); row.className = "prow";
      const pn = document.createElement("span"); pn.className = "pn"; pn.textContent = p.name || "Student";
      if (p.att) { const sm = document.createElement("small"); sm.textContent = "Joined " + p.att.joined.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); pn.append(sm); }
      row.append(pn);
      if (p.hand) { const h = document.createElement("button"); h.type = "button"; h.className = "hd"; h.textContent = "✋ Lower"; h.onclick = () => lowerHand(id); row.append(h); }
      const l = document.createElement("label"), c = document.createElement("input");
      c.type = "checkbox"; c.checked = allowAll || allowed.has(id); c.disabled = allowAll;
      c.onchange = () => { if (c.checked) allowed.add(id); else allowed.delete(id); sendPerm(); };
      l.title = "Allow this student to draw"; l.append(c, "✏️"); row.append(l);
      const m = document.createElement("button"); m.type = "button"; m.textContent = "🔇"; m.title = "Mute this student's microphone"; m.onclick = () => { bcast({ t: "mute" }, [id]); toast(`Muted ${p.name}`, { ms: 2000 }); };
      const x = document.createElement("button"); x.type = "button"; x.className = "danger"; x.textContent = "✕"; x.title = "Remove from class"; x.onclick = () => removeStudent(id, p.name);
      row.append(m, x); box.append(row);
    });
  }
  function removeStudent(id, name) {
    if (!confirm(`Remove ${name || "this student"} from the class?`)) return;
    rejected.add(id); bcast({ t: "kick", reason: "removed" }, [id]);
    setTimeout(() => dropStudent(id), 500);
  }
  $("muteAll").onclick = () => { bcast({ t: "mute" }); toast("Muted all students.", { ms: 2500 }); };
  $("lockClass").onchange = (e) => { locked = e.target.checked; if (!locked) turnedAway.clear(); toast(locked ? "🔒 Class locked. No new students can join." : "🔓 Class unlocked.", { ms: 2500 }); };
  $("chatOnChk").onchange = (e) => { chatEnabled(e.target.checked); bcast({ t: "chatlock", on: chatOn }); toast(chatOn ? "Student chat is on." : "Student chat is off.", { ms: 2500 }); };
  $("attDl").onclick = () => { if (!attendance.length) { toast("No attendance yet."); return; } downloadAttendance(); };
  const csvCell = (v) => { let t = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  function downloadAttendance() {
    const now = new Date(), fmt = (d) => d.toLocaleString();
    const rows = [[`Class: ${APP_NAME}`], [`Room: ${ROOM_ID}`], [`Teacher: ${teacherName}`], [`Date: ${now.toLocaleDateString()}`], [], ["Name", "Joined", "Left", "Minutes present"]];
    attendance.forEach((a) => rows.push([a.name, fmt(a.joined), a.left ? fmt(a.left) : "(still in class)", Math.round(((a.left || now) - a.joined) / 60000)]));
    const csv = "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `attendance-${ROOM_ID}-${now.toISOString().slice(0, 10)}.csv`);
  }

  /* ---- recording (teacher) ---- */
  let recorder = null, recDisp = null, recCtx = null, recTimer = null;
  async function startRecording() {
    if (typeof MediaRecorder === "undefined" || !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) { toast("Recording is not supported in this browser. Use desktop Chrome or Edge.", { type: "bad" }); return; }
    toast("In the next window choose “This tab” and tick “Share tab audio” so students' voices are recorded too.", { ms: 7000 });
    try { recDisp = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true, preferCurrentTab: true, selfBrowserSurface: "include" }); }
    catch (e) { recDisp = null; return; }
    try {
      recCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = recCtx.createMediaStreamDestination();
      const da = recDisp.getAudioTracks()[0]; if (da) recCtx.createMediaStreamSource(new MediaStream([da])).connect(dest); else toast("No tab audio was shared, so only your microphone is recorded.", { type: "warn" });
      const mic = localStream.getAudioTracks()[0]; if (mic) recCtx.createMediaStreamSource(new MediaStream([mic])).connect(dest);
      const out = new MediaStream([...recDisp.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const chunks = [];
      recorder = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 1500000 } : { videoBitsPerSecond: 1500000 });
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const ext = /mp4/.test(recorder.mimeType) ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        try { recDisp && recDisp.getTracks().forEach((t) => t.stop()); recCtx && recCtx.close(); } catch (e) { /* ignore */ }
        clearInterval(recTimer); recorder = null; recDisp = null; recCtx = null;
        $("recBtn").classList.remove("rec"); $("recBtn").querySelector(".lbl").textContent = "Record"; $("recBtn").firstChild.textContent = "⏺ ";
        showRec(false); if (!ended) bcast({ t: "rec", on: false });
        if (blob.size) { saveBlob(blob, `class-${ROOM_ID}-${teacherName.replace(/[^A-Za-z0-9]+/g, "").slice(0, 20) || "teacher"}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`); toast("Recording saved to your Downloads folder.", { ms: 6000 }); }
      };
      recDisp.getVideoTracks()[0].onended = stopRecording;
      recorder.start(10000);
      const t0 = Date.now();
      const tick = () => { const sec = Math.floor((Date.now() - t0) / 1000); $("recBtn").querySelector(".lbl").textContent = `Stop ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; };
      $("recBtn").classList.add("rec"); $("recBtn").firstChild.textContent = "⏹ "; tick(); recTimer = setInterval(tick, 1000);
      showRec(true); bcast({ t: "rec", on: true });
    } catch (e) {
      console.warn(e); toast("Could not start recording.", { type: "bad" });
      try { recDisp && recDisp.getTracks().forEach((t) => t.stop()); } catch (e2) { /* ignore */ } recorder = null; recDisp = null;
    }
  }
  function stopRecording() { if (recorder && recorder.state !== "inactive") recorder.stop(); }
  function finishRecording() { stopRecording(); }
  $("recBtn").onclick = () => (recorder ? stopRecording() : startRecording());

  /* ---- reliability: keep screen awake, warn before closing, network status ---- */
  let wl = null;
  async function keepAwake() { try { if ("wakeLock" in navigator) wl = await navigator.wakeLock.request("screen"); } catch (e) { /* ignore */ } }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !ended && localStream) keepAwake(); });
  window.addEventListener("beforeunload", (e) => { if (isHost && !ended) { e.preventDefault(); e.returnValue = ""; } });
  window.addEventListener("offline", () => { netBad(true); toast("You are offline. Reconnecting when your internet returns…", { type: "bad", ms: 4000 }); });
  window.addEventListener("online", () => {
    netBad(false); toast("Back online.", { ms: 2500 });
    try { if (peer && peer.disconnected && !peer.destroyed) peer.reconnect(); } catch (e) { /* ignore */ }
  });
  function refreshPerm() { if ($("permPanel").classList.contains("show")) renderPerm(); }
  $("allowAll").onchange = (e) => { allowAll = e.target.checked; sendPerm(); renderPerm(); };
  $("permBtn").onclick = () => { $("sharePanel").classList.remove("show"); const pn = $("permPanel"); pn.classList.toggle("show"); if (pn.classList.contains("show")) renderPerm(); };
  $("showAll").onchange = (e) => { if (e.target.checked) bcast({ t: "mode", m: main.dataset.mode }); };
  /* ---- share class link (teacher only) ---- */
  const SHARE_KEY = "meeting-share-base";
  const isLocalUrl = (u) => /^(file:|https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.))/i.test((u || "").trim());
  const baseUrl = () => PUBLIC_URL || (location.protocol === "file:" ? location.href.split(/[?#]/)[0] : location.origin + location.pathname);
  const makeLink = (base) => `${base.split(/[?#]/)[0]}?room=${encodeURIComponent(ROOM_ID)}&role=student`;
  const shareMsg = (t) => { $("shareMsg").textContent = t; if (t) setTimeout(() => { if ($("shareMsg").textContent === t) $("shareMsg").textContent = ""; }, 2500); };
  const shareText = () => `Join my class${APP_NAME ? " on " + APP_NAME : ""}: ${$("shareUrl").value.trim()}`;
  function updShareWarn() {
    $("shareWarn").classList.toggle("show", isLocalUrl($("shareUrl").value));
    try { localStorage.setItem(SHARE_KEY, $("shareUrl").value.trim().split(/[?#]/)[0]); } catch (err) { /* storage may be unavailable */ }
  }
  function fillShareUrl() {
    let saved = ""; try { saved = localStorage.getItem(SHARE_KEY) || ""; } catch (err) { /* ignore */ }
    const cur = baseUrl();
    $("shareUrl").value = makeLink(PUBLIC_URL || (isLocalUrl(cur) && saved ? saved : cur));
    updShareWarn();
  }
  $("shareBtn").onclick = () => {
    $("permPanel").classList.remove("show");
    const pn = $("sharePanel"); pn.classList.toggle("show");
    if (!pn.classList.contains("show")) return;
    $("shareNative").style.display = navigator.share ? "" : "none";
    fillShareUrl();
    $("shareUrl").focus(); $("shareUrl").select();
  };
  $("shareUrl").addEventListener("input", updShareWarn);
  $("shareCopy").onclick = async () => {
    const url = $("shareUrl").value.trim();
    if (!url) { shareMsg("Enter a link first"); return; }
    try {
      await navigator.clipboard.writeText(url);
      shareMsg("Link copied ✔");
    } catch (err) {
      $("shareUrl").select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { /* ignore */ }
      shareMsg(ok ? "Link copied ✔" : "Press Ctrl+C to copy the selected link");
    }
  };
  $("shareNative").onclick = () => {
    const url = $("shareUrl").value.trim();
    if (navigator.share) navigator.share({ title: APP_NAME, text: "Join my class", url }).catch(() => {});
  };
  $("shareWa").onclick = () => window.open("https://wa.me/?text=" + encodeURIComponent(shareText()), "_blank", "noopener");
  $("shareMail").onclick = () => { location.href = "mailto:?subject=" + encodeURIComponent("Class invitation") + "&body=" + encodeURIComponent(shareText()); };

  setInterval(() => { $("syncLbl").textContent = `Sync: ${targets().length} other(s) · ${rx} received`; }, 1000);

  /* ---- init ---- */
  setColor("#111111"); setTool("pen"); setMode("video"); resizeCanvas(); recalc(); updUI();
});
})();
