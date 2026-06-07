/// 폰 클라이언트 (QR 접속) — fly.html이 로드
/// 유저가 자기 새떼를 1인칭으로 직접 몬다. 항상 전진하고, 드래그/기울기로 방향(yaw·pitch)을 조종.
/// 비행 위치/방향은 메인 스크린과 같은 월드 좌표계로, 나중에 WebSocket으로 그대로 전송한다.
/// (지금은 maybeSendState가 payload만 만들고 보내진 않음 — 네트워크 붙일 자리)

let cloudShader;
let myFont;

// 비행 상태 (월드 좌표계는 메인 스크린과 공유)
let flightPos = [0, 0.3, 0];
let yaw = 0;      // 0 = -z 방향(메인 스크린이 보는 방향)
let pitch = 0;
let bank = 0;     // 선회 시 카메라 기울기(u_roll로 전달)

let camRo = [0, 0.3, 0];
let camTa = [0, 0.3, -1];
let camBasis;

// 입력
let started = false;
let useTilt = false;
let tiltGamma = 0, tiltBeta = 0, betaNeutral = null, gammaNeutral = null;
let startBtn;
let permState = 'idle';   // 모션 권한 상태(HUD 진단용)
let tiltEvents = 0;       // 수신한 deviceorientation 이벤트 수

let companions = [];

const RES = 0.8;             // 렌더 해상도 배율(폰 성능용. 1.0=풀, 낮출수록 빠르고 흐림)
const CRUISE = 2.0;          // 전진 속도(units/sec)
const MAX_YAW_RATE = 0.80;    // 최대 선회 속도(rad/sec)
const MAX_PITCH = 0.5;       // 최대 상하 각(rad ≈ 28°)
const BANK_SCALE = 0.6;      // 선회 → 기울기 비율
const TILT_DEADZONE = 5;     // 이 각도(deg) 이내 기울기는 무시(손떨림 방지)
const TILT_RANGE = 30;       // 이 각도(deg) 기울이면 최대 입력
const TILT_PITCH_INVERT = false;  // 앞뒤(상하)가 반대로 느껴지면 true로
const COMPANIONS = 18;          // 함께 나는 내 새떼 수(월드 공간 boids)
const COMP_PERCEPTION = 3.0;    // 정렬/응집 인지 반경
const COMP_SEP = 0.7;           // 분리 거리
const COMP_MAX_SPEED = 5.0;     // 카메라(CRUISE)보다 빨라야 따라잡고 대형 유지
const COMP_MAX_FORCE = 7.0;
const LEAD_DIST = 6.0;          // 카메라 앞쪽 앵커 거리(새떼가 머무는 지점)
let flockHue = 45;              // 내 새떼 색(접속 시 랜덤 → 스크린에서 개별 식별)

// ── 네트워크 ──
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
let socket = null;
let lastSent = 0;

function preload() {
  cloudShader = loadShader('effect.vert', 'effect.frag');
  myFont = loadFont('GalmuriMono11.ttf');   // WEBGL text()는 로드된 폰트 필요
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(RES);
  noStroke();
  textFont(myFont);

  startBtn = select('#start');   // 안내 오버레이(클릭 안 받음). 시작은 화면 탭/클릭으로 처리

  // 비행 시작 + 모션 권한을 실제 DOM 제스처(touchend/click)에서 처리 (p5 핸들러보다 안정적)
  window.addEventListener('touchend', onFirstGesture);
  window.addEventListener('click', onFirstGesture);

  flockHue = floor(random(360));   // 이 폰의 새떼 색(스크린에서 개별 식별)
  initCompanions();
  connectPhone();
}

// 모션 센서 활성화 시도. iOS는 권한 팝업, 안드로이드는 즉시 활성. 허용 전까지 탭마다 재시도
function tryEnableMotion() {
  if (useTilt) return;   // 이미 켜짐
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    permState = 'requesting';
    DeviceOrientationEvent.requestPermission()
      .then(s => {
        permState = s;   // 'granted' | 'denied'
        if (s === 'granted') window.addEventListener('deviceorientation', onTilt);
      })
      .catch(err => { permState = 'err:' + (err && err.name ? err.name : err); });
  } else if (typeof window.DeviceOrientationEvent !== 'undefined') {
    // 리스너만 등록. useTilt는 실제 기울기 이벤트가 올 때 onTilt에서 켠다.
    // (데스크톱 크롬은 API는 있지만 이벤트가 안 와서 false로 남음 → 마우스 드래그 사용)
    window.addEventListener('deviceorientation', onTilt);
    permState = 'listening';
  } else {
    permState = 'no-API';
  }
}

// 허브 서버에 'phone'으로 접속. 끊기면 자동 재연결
function connectPhone() {
  try {
    socket = new WebSocket(WS_URL);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', role: 'phone', hue: flockHue }));
    socket.onclose = () => { socket = null; setTimeout(connectPhone, 2000); };
    socket.onerror = () => {};
  } catch (e) { /* 서버 없으면 비행만 로컬로 계속 */ }
}

// 첫 탭/클릭: 비행 시작 + 모션 권한 (둘 다 이 DOM 제스처 안에서)
function onFirstGesture() {
  beginFlight();
  tryEnableMotion();
}

// 비행 시작(안내 오버레이 숨김). 안내문은 p5에 의존하지 않고 직접 DOM으로 숨긴다
function beginFlight() {
  if (started) return;
  started = true;
  let el = document.getElementById('start');
  if (el) el.style.display = 'none';
}

function onTilt(e) {
  if (e.gamma === null && e.beta === null) return;   // 데스크톱: 값이 안 와 여기서 빠짐 → 드래그 유지
  tiltEvents++;
  useTilt = true;   // 실제 기울기 데이터가 도착할 때만 기울기 모드로 전환

  // 첫 이벤트의 자세를 '수평'으로 보정(폰을 든 각도가 기준이 됨)
  if (gammaNeutral === null) gammaNeutral = e.gamma || 0;
  if (betaNeutral === null) betaNeutral = e.beta || 0;
  tiltGamma = (e.gamma || 0) - gammaNeutral;      // 좌우 기울기(보정 기준)
  tiltBeta = (e.beta || 0) - betaNeutral;         // 앞뒤 기울기(보정 기준)
}

// 기울기(도) → 데드존 적용 후 -1..1 정규화
function tiltAxis(deg) {
  let m = Math.max(0, Math.abs(deg) - TILT_DEADZONE);
  return constrain(Math.sign(deg) * m / (TILT_RANGE - TILT_DEADZONE), -1, 1);
}

function draw() {
  background(0);
  let t = millis() / 1000.0;

  if (started) updateFlight(deltaTime / 1000.0);

  let fwd = headingVec(yaw, pitch);
  camRo = flightPos;
  camTa = add3(flightPos, fwd);
  camBasis = computeCameraBasis(camRo, camTa, bank);

  // ── 1인칭 하늘(메인 스크린과 같은 셰이더) ──
  shader(cloudShader);
  cloudShader.setUniform('u_resolution', [width, height]);
  cloudShader.setUniform('u_time', t);
  cloudShader.setUniform('u_camPos', camRo);
  cloudShader.setUniform('u_camTarget', camTa);
  cloudShader.setUniform('u_roll', bank);
  quad(-1, -1, 1, -1, 1, 1, -1, 1);
  resetShader();

  // ── 동료 새 + HUD를 2D로 합성 ──
  _renderer.GL.disable(_renderer.GL.DEPTH_TEST);
  translate(-width / 2, -height / 2);
  updateCompanions(deltaTime / 1000.0);
  drawCompanions(t);
  drawPhoneHUD(t);
  _renderer.GL.enable(_renderer.GL.DEPTH_TEST);

  maybeSendState(t);
}

// yaw(좌우)·pitch(상하)로부터 전방 단위 벡터. yaw=pitch=0 → (0,0,-1)
function headingVec(y, p) {
  let cp = Math.cos(p);
  return [Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp];
}

function updateFlight(dt) {
  dt = Math.min(dt, 0.05);

  let yawRate = 0;
  let pitchTarget = 0;
  let steering = false;

  let touching = (typeof touches !== 'undefined' && touches.length > 0);

  if (useTilt) {
    // 기울기 우선(모션 권한이 허용된 폰)
    yawRate = tiltAxis(tiltGamma) * MAX_YAW_RATE;          // 좌우로 기울이면 선회
    let pp = tiltAxis(tiltBeta) * MAX_PITCH;               // 앞뒤로 기울이면 하강/상승
    pitchTarget = TILT_PITCH_INVERT ? -pp : pp;
    steering = true;
  } else if (mouseIsPressed || touching) {
    // 드래그(데스크톱/센서 없는 기기): 화면 중앙 기준 위치로 선회/상하
    let px = touching ? touches[0].x : mouseX;
    let py = touching ? touches[0].y : mouseY;
    let nx = constrain((px - width / 2) / (width * 0.4), -1, 1);
    let ny = constrain((py - height / 2) / (height * 0.4), -1, 1);
    yawRate = nx * MAX_YAW_RATE;
    pitchTarget = -ny * MAX_PITCH;
    steering = true;
  }

  yaw += yawRate * dt;
  pitch = lerp(pitch, steering ? pitchTarget : 0, 0.05);   // 입력 없으면 수평으로 복귀
  pitch = constrain(pitch, -MAX_PITCH, MAX_PITCH);
  bank = lerp(bank, -yawRate * BANK_SCALE, 0.1);            // 선회 쪽으로 기울기

  flightPos = add3(flightPos, scale3(headingVec(yaw, pitch), CRUISE * dt));
}

// ── 함께 나는 내 새떼: 월드 좌표 boids ──
// 서로 separation/alignment/cohesion으로 군집을 이루고, 카메라 앞쪽 앵커로 끌려 시야에 머물며 함께 전진한다.
// 월드 공간에 있으므로 배경 구름과 같은 깊이감/시차를 가진다.
function initCompanions() {
  companions = [];
  let cw = [0, 0, -1];
  let anchor = add3(camRo, scale3(cw, LEAD_DIST));
  for (let i = 0; i < COMPANIONS; i++) {
    companions.push({
      pos: add3(anchor, [random(-2, 2), random(-1.5, 1.5), random(-2, 2)]),
      vel: scale3(cw, CRUISE),
      phase: random(TWO_PI),
      seed: random(1000)
    });
  }
}

function updateCompanions(dt) {
  dt = Math.min(dt, 0.05);
  // 새떼가 머물 앵커 = 카메라 앞쪽(살짝 아래). 카메라가 전진하면 같이 끌려 전진
  let anchor = add3(camRo, add3(scale3(camBasis.cw, LEAD_DIST), scale3(camBasis.cv, -0.4)));

  for (let b of companions) {
    let sep = [0, 0, 0], ali = [0, 0, 0], coh = [0, 0, 0];
    let n = 0, ns = 0;

    for (let o of companions) {
      if (o === b) continue;
      let d = sub3(b.pos, o.pos);   // b - o
      let dist = len3(d);
      if (dist > 1e-5 && dist < COMP_SEP) { sep = add3(sep, scale3(d, 1 / (dist * dist))); ns++; }
      if (dist < COMP_PERCEPTION) { ali = add3(ali, o.vel); coh = add3(coh, scale3(d, -1)); n++; }
    }

    let acc = [0, 0, 0];
    if (ns > 0) {
      let s = limit3(sub3(scale3(norm3(sep), COMP_MAX_SPEED), b.vel), COMP_MAX_FORCE);
      acc = add3(acc, scale3(s, 1.5));   // 분리
    }
    if (n > 0) {
      let a = limit3(sub3(scale3(norm3(scale3(ali, 1 / n)), COMP_MAX_SPEED), b.vel), COMP_MAX_FORCE);
      acc = add3(acc, scale3(a, 1.0));   // 정렬
      let c = limit3(sub3(scale3(norm3(scale3(coh, 1 / n)), COMP_MAX_SPEED), b.vel), COMP_MAX_FORCE);
      acc = add3(acc, scale3(c, 0.9));   // 응집
    }

    // 앵커로의 끌림 → 시야에 머물며 카메라와 함께 전진(따라잡기)
    let lead = limit3(sub3(scale3(norm3(sub3(anchor, b.pos)), COMP_MAX_SPEED), b.vel), COMP_MAX_FORCE);
    acc = add3(acc, scale3(lead, 0.5));

    // 약한 노이즈 흔들림으로 생기 부여
    let wob = [
      noise(b.seed, frameCount * 0.01) - 0.5,
      (noise(b.seed + 5.0, frameCount * 0.01) - 0.5) * 0.5,
      noise(b.seed + 9.0, frameCount * 0.01) - 0.5
    ];
    acc = add3(acc, scale3(wob, COMP_MAX_FORCE * 0.25));

    b.vel = limit3(add3(b.vel, scale3(acc, dt)), COMP_MAX_SPEED);
    b.pos = add3(b.pos, scale3(b.vel, dt));
  }
}

function drawCompanions(t) {
  let col = flockColor(flockHue, birdBrightness(t));
  let list = [];

  for (let c of companions) {
    let pr = projectToScreen(c.pos, camRo, camBasis);
    if (!pr) continue;

    // heading은 새 자신의 실제 진행 방향(월드 속도)을 투영
    let ahead = projectToScreen(add3(c.pos, scale3(norm3(c.vel), 0.3)), camRo, camBasis);
    let heading = ahead ? Math.atan2(ahead.sy - pr.sy, ahead.sx - pr.sx) : 0;

    // 너무 가깝거나(앞을 스쳐갈 때) 너무 먼 새는 페이드
    let alpha = smooth01(0.8, 2.2, pr.vf) * (1 - smooth01(11.0, 15.0, pr.vf));
    list.push({ pr, heading, alpha, phase: c.phase });
  }

  list.sort((A, B) => B.pr.vf - A.pr.vf);
  for (let it of list) {
    drawBirdSprite(it.pr.sx, it.pr.sy, it.pr.vf, it.heading, col, it.alpha, it.phase, t);
  }
}

function drawPhoneHUD(t) {
  textFont(myFont);
  let cx = width / 2, cy = height / 2;

  // 중앙 조준 십자
  stroke(253, 253, 237, started ? 70 : 30);
  strokeWeight(1.5);
  noFill();
  line(cx - 14, cy, cx - 5, cy);
  line(cx + 5, cy, cx + 14, cy);
  line(cx, cy - 14, cx, cy - 5);
  line(cx, cy + 5, cx, cy + 14);

  noStroke();
  fill(253, 253, 237, 220);
  textAlign(LEFT, TOP);
  textSize(13);
  text("FLOCK · YOU", 20, 20);

  fill(253, 253, 237, 150);
  textSize(11);
  let hdg = floor(degrees(((yaw % TWO_PI) + TWO_PI) % TWO_PI));
  text("SPD " + nf(CRUISE, 1, 1) + "   HDG " + hdg + "°   [" + (useTilt ? "TILT" : "DRAG") + "]", 20, 40);

  // 모션 진단: 권한 상태 / 수신 이벤트 수 / 현재 기울기값
  text("MOTION: " + permState + "   evt:" + tiltEvents
     + "   γ" + floor(tiltGamma) + " β" + floor(tiltBeta), 20, 58);

  if (started) {
    textAlign(CENTER, BOTTOM);
    fill(253, 253, 237, 210);
    textSize(13);
    text("Check your flock in front of your screen", cx, height - 42);
    fill(253, 253, 237, 130);
    textSize(11);
    text(useTilt ? "Tilt to navigate" : "Drag to navigate", cx, height - 24);
  }
  textAlign(LEFT, BASELINE);
}

// ~15Hz로 비행 상태를 허브에 전송 → 서버가 모든 메인 스크린에 flock으로 중계
function maybeSendState(t) {
  if (t - lastSent < 1 / 15) return;
  lastSent = t;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: 'state',
    c: flightPos,                  // 월드 중심 — 메인 스크린이 mod로 어항에 매핑
    v: headingVec(yaw, pitch),     // 진행 방향(dead reckoning용)
    hue: flockHue                  // 내 새떼 색
  }));
}

// 첫 탭/클릭이면 비행 시작(iOS 모션 권한도 이 제스처 안에서 요청), 이후엔 조향
function touchStarted() {
  if (!started) beginFlight();
  return false;   // 스크롤/줌 등 기본 동작 방지
}
function touchMoved() { return false; }
function mousePressed() {   // 데스크톱(마우스) 시작
  if (!started) beginFlight();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
