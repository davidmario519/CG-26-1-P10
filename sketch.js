/// 메인 스크린(공공 스크린) 뷰
/// - 카메라 고정(미세 드리프트만). 셰이더가 그리는 하늘/구름/바다를 옆에서 들여다보는 "어항" 시점
/// - 유저의 bird flock(boids)을 어항 안에 띄운다. x/y/z 전 축 주기 경계로 감겨(반대 면에서 재등장)
/// - 새는 셰이더와 동일한 카메라 수학으로 직접 투영한 2D 빌보드로 배경 위에 합성
/// 데모: [N] flock 추가(유저 접속 흉내) / [X] flock 제거(퇴장 흉내) / [F] 풀스크린

let cloudShader;
let myFont;
let qrImg;   // 우하단 참여 유도 QR (관객 → 폰으로 스캔 → fly.html 합류)

// 고정 카메라 (메인 스크린). 매 프레임 미세하게 드리프트시켜 "멈춰 보임"을 방지
let camRo = [0, 0.5, 0];      // origin
let camTa = [0, 0.44, -1];    // target
let camBasis;                 // {cu, cv, cw} — 셰이더 setCamera와 동일하게 계산

// ── 어항(stage) 박스: 이 직육면체 안에서 새들이 주기 경계로 감긴다 ──
const BOX_MIN = [-5.5, -4.0, -11.0];   // 최소 모서리 (바닥은 바다 근처, 뒤쪽은 안개 속)
const BOX_SIZE = [11.0, 7.0, 8.0];     // 크기 → 중심 (0, -0.5, -7), 카메라 앞쪽
const SHELL = 0.9;                     // 면 근처 페이드 두께(이음새 숨김)

// ── boids ──
let flocks = [];
const FLOCK_SIZE = 30;
const MAX_FLOCKS = 6;
const MAX_SPEED = 1.6;
const MAX_FORCE = 2.6;
const PERCEPTION = 3.0;     // 정렬/응집 인지 반경 (밀도 대비 충분히 커야 군집이 보임)
const SEP_DIST = 0.7;       // 분리 거리

// ── 네트워크 (폰에서 보낸 flock 수신) ──
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
let socket = null;
let linkStatus = 'OFFLINE';
const NET_TIMEOUT = 5000;   // 갱신 없이 이 시간 지나면 네트워크 flock 제거(ms)

let weatherData = {
  cloud: 0.5,
  rain: 0.0,
  wind: 0.0,
  temp: 20.0,
  humidity: 0,
  code: 0,
  condition: 'LOADING',
  updated: '--:--'
};

let lastWeatherFetch = -999999;
const WEATHER_UPDATE_INTERVAL = 30 * 60 * 1000; // 30분마다 갱신

const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=37.5509&longitude=126.9410&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,cloud_cover,wind_speed_10m&timezone=Asia%2FSeoul';

function preload() {
  cloudShader = loadShader('effect.vert', 'effect.frag');
  myFont = loadFont('GalmuriMono11.ttf');
  qrImg = loadImage('src/QR.png');
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(1);
  noStroke();
  fetchWeather();

  for (let i = 0; i < 3; i++) spawnFlock();   // 폰 없이도 볼 수 있게 로컬 데모 flock 3개
  connectScreen();
}

// 허브 서버에 'screen'으로 접속. 폰들의 flock 상태를 받아 렌더한다. 끊기면 자동 재연결
function connectScreen() {
  try {
    socket = new WebSocket(WS_URL);
    socket.onopen = () => { linkStatus = 'ONLINE'; socket.send(JSON.stringify({ type: 'hello', role: 'screen' })); };
    socket.onmessage = (e) => { try { onScreenMessage(JSON.parse(e.data)); } catch (_) {} };
    socket.onclose = () => { linkStatus = 'OFFLINE'; socket = null; setTimeout(connectScreen, 2000); };
    socket.onerror = () => {};
  } catch (e) { linkStatus = 'OFFLINE'; }
}

function onScreenMessage(msg) {
  if (msg.type === 'flock') {
    let f = flocks.find(x => x.netId === msg.id);
    if (!f) f = spawnNetFlock(msg.id, msg.hue, msg.c);
    f.targetC = msg.c.slice();              // 최신 중심(절대 좌표)으로 보정
    f.vel = msg.v ? msg.v.slice() : [0, 0, 0];
    f.hue = msg.hue;
    f.lastSeen = millis();
  } else if (msg.type === 'leave') {
    flocks = flocks.filter(x => x.netId !== msg.id);
  }
}

function draw() {
  background(0);

  if (millis() - lastWeatherFetch > WEATHER_UPDATE_INTERVAL) {
    fetchWeather();
  }

  let t = millis() / 1000.0;

  // 고정 카메라 + 미세 드리프트. 셰이더와 JS가 같은 ro/ta/roll을 공유해야 새가 정렬된다
  let cr = 0.022 * Math.sin(t * 0.35);
  camRo = [Math.sin(t * 0.05) * 0.12, 0.5 + Math.sin(t * 0.07) * 0.05, 0.0];
  camTa = [camRo[0] + Math.sin(t * 0.03) * 0.06, camRo[1] - 0.06, camRo[2] - 1.0];
  camBasis = computeCameraBasis(camRo, camTa, cr);

  // ── 1) 배경: 풀스크린 raymarch 셰이더 ──
  shader(cloudShader);
  cloudShader.setUniform('u_resolution', [width, height]);
  cloudShader.setUniform('u_time', t);
  cloudShader.setUniform('u_camPos', camRo);
  cloudShader.setUniform('u_camTarget', camTa);
  cloudShader.setUniform('u_roll', cr);
  quad(-1, -1, 1, -1, 1, 1, -1, 1);
  resetShader();

  // ── 2) 그 위에 2D 합성: 새(boids) → HUD ──
  _renderer.GL.disable(_renderer.GL.DEPTH_TEST);
  translate(-width / 2, -height / 2);

  // 끊긴 폰의 flock 정리(leave 메시지를 놓쳤을 때 대비)
  flocks = flocks.filter(f => f.netId == null || millis() - f.lastSeen < NET_TIMEOUT);

  updateFlocks(deltaTime / 1000.0);
  drawFlocks();
  drawApertureHUD();

  _renderer.GL.enable(_renderer.GL.DEPTH_TEST);
}

// ───────────────────────── boids 시뮬레이션 ─────────────────────────

function spawnFlock() {
  if (flocks.filter(f => f.netId == null).length >= MAX_FLOCKS) return;
  let cx = random(BOX_MIN[0], BOX_MIN[0] + BOX_SIZE[0]);
  let cy = random(BOX_MIN[1], BOX_MIN[1] + BOX_SIZE[1]);
  let cz = random(BOX_MIN[2], BOX_MIN[2] + BOX_SIZE[2]);
  // 같은 방향을 보고 뭉쳐서 출발 → 처음부터 정렬·응집이 성립
  let dir = norm3([random(-1, 1), random(-0.3, 0.3), random(-1, 1)]);
  let birds = [];
  for (let i = 0; i < FLOCK_SIZE; i++) {
    birds.push({
      pos: [cx + random(-1, 1), cy + random(-0.6, 0.6), cz + random(-1, 1)],
      vel: scale3(dir, MAX_SPEED * random(0.6, 1.0)),
      phase: random(TWO_PI)
    });
  }
  flocks.push({ hue: random(360), birds, bt: random(TWO_PI), bias: [0, 0, 0] });
}

function removeFlock() {
  for (let i = flocks.length - 1; i >= 0; i--) {
    if (flocks[i].netId == null) { flocks.splice(i, 1); return; }  // 데모 flock만 제거
  }
}

// 폰에서 수신한 flock. 중심(c)은 절대 좌표 → 어항으로 mod 매핑해 앵커로 쓰고, 그 주위로 boids를 로컬 생성
function spawnNetFlock(id, hue, c) {
  let smoothC = c.slice();
  let anchor = [
    wrapAxis(c[0], BOX_MIN[0], BOX_SIZE[0]),
    wrapAxis(c[1], BOX_MIN[1], BOX_SIZE[1]),
    wrapAxis(c[2], BOX_MIN[2], BOX_SIZE[2])
  ];
  let birds = [];
  for (let i = 0; i < FLOCK_SIZE; i++) {
    birds.push({
      pos: [
        wrapAxis(anchor[0] + random(-1, 1), BOX_MIN[0], BOX_SIZE[0]),
        wrapAxis(anchor[1] + random(-0.6, 0.6), BOX_MIN[1], BOX_SIZE[1]),
        wrapAxis(anchor[2] + random(-1, 1), BOX_MIN[2], BOX_SIZE[2])
      ],
      vel: [random(-0.5, 0.5), random(-0.2, 0.2), random(-0.5, 0.5)],
      phase: random(TWO_PI)
    });
  }
  let f = { netId: id, hue, birds, targetC: c.slice(), vel: [0, 0, 0], smoothC, anchor, lastSeen: millis() };
  flocks.push(f);
  return f;
}

function updateFlocks(dt) {
  dt = Math.min(dt, 0.05);   // 프레임이 튀어도 시뮬이 폭발하지 않도록

  for (let f of flocks) {
    if (f.netId != null) {
      // 네트워크 flock: 패킷 사이를 dead reckoning(+보간)하고 어항으로 mod 매핑한 앵커를 만든다
      f.targetC = add3(f.targetC, scale3(f.vel, dt));
      f.smoothC = lerp3(f.smoothC, f.targetC, 0.2);
      f.anchor = [
        wrapAxis(f.smoothC[0], BOX_MIN[0], BOX_SIZE[0]),
        wrapAxis(f.smoothC[1], BOX_MIN[1], BOX_SIZE[1]),
        wrapAxis(f.smoothC[2], BOX_MIN[2], BOX_SIZE[2])
      ];
    } else {
      // 로컬 데모 flock: 완만하게 회전하는 드리프트로 어항을 가로지른다
      f.bt = (f.bt || 0) + dt * 0.15;
      f.bias = [Math.cos(f.bt) * 0.7, Math.sin(f.bt * 0.6) * 0.25, Math.sin(f.bt) * 0.7];
    }

    let birds = f.birds;
    for (let b of birds) {
      let sep = [0, 0, 0], ali = [0, 0, 0], coh = [0, 0, 0];
      let n = 0, ns = 0;

      for (let o of birds) {
        if (o === b) continue;
        let d = toroidalDelta(b.pos, o.pos);   // b - o (반대 면 너머 이웃도 인지)
        let dist = len3(d);
        if (dist > 1e-5 && dist < SEP_DIST) { sep = add3(sep, scale3(d, 1 / (dist * dist))); ns++; }
        if (dist < PERCEPTION) { ali = add3(ali, o.vel); coh = add3(coh, scale3(d, -1)); n++; }
      }

      let acc = [0, 0, 0];
      if (ns > 0) {
        let s = limit3(sub3(scale3(norm3(sep), MAX_SPEED), b.vel), MAX_FORCE);
        acc = add3(acc, scale3(s, 1.6));   // 분리
      }
      if (n > 0) {
        let a = limit3(sub3(scale3(norm3(scale3(ali, 1 / n)), MAX_SPEED), b.vel), MAX_FORCE);
        acc = add3(acc, scale3(a, 1.0));   // 정렬
        let c = limit3(sub3(scale3(norm3(scale3(coh, 1 / n)), MAX_SPEED), b.vel), MAX_FORCE);
        acc = add3(acc, scale3(c, 1.1));   // 응집 (분리보다 멀리서 작동해 군집을 유지)
      }
      // 전역 유도: 네트워크 flock은 폰의 중심(앵커)으로 토러스 seek, 로컬은 드리프트 bias
      if (f.netId != null) {
        let toA = toroidalDelta(f.anchor, b.pos);   // 앵커 - b (반대 면 너머도 최단으로)
        let seek = limit3(sub3(scale3(norm3(toA), MAX_SPEED), b.vel), MAX_FORCE);
        acc = add3(acc, scale3(seek, 0.8));
      } else {
        acc = add3(acc, scale3(f.bias, MAX_FORCE * 0.5));
      }

      b.vel = limit3(add3(b.vel, scale3(acc, dt)), MAX_SPEED);
      if (len3(b.vel) < 0.3) b.vel = scale3(norm3(add3(b.vel, [0.01, 0, 0.01])), 0.3);
      b.pos = add3(b.pos, scale3(b.vel, dt));

      // 전 축 주기 경계: 한 면으로 나가면 반대 면에서 재등장
      b.pos = [
        wrapAxis(b.pos[0], BOX_MIN[0], BOX_SIZE[0]),
        wrapAxis(b.pos[1], BOX_MIN[1], BOX_SIZE[1]),
        wrapAxis(b.pos[2], BOX_MIN[2], BOX_SIZE[2])
      ];
    }

    // 데모 flock은 레이더 표시용 중심을 직접 계산(네트워크 flock은 anchor가 이미 있음)
    if (f.netId == null) f.anchor = flockCentroid(f.birds);
  }
}

// ───────────────────────── 새 렌더(셰이더와 동일 카메라로 직접 투영) ─────────────────────────

function drawFlocks() {
  let t = millis() / 1000.0;
  let bright = birdBrightness(t);

  // 모든 새를 투영해 모은 뒤 먼 것부터 그린다(화가 알고리즘)
  let list = [];
  for (let f of flocks) {
    let col = flockColor(f.hue, bright);
    for (let b of f.birds) {
      let pr = projectToScreen(b.pos, camRo, camBasis);
      if (!pr) continue;
      list.push({ b, pr, col });
    }
  }
  list.sort((A, B) => B.pr.vf - A.pr.vf);

  for (let item of list) drawBird(item, t);
}

function drawBird(item, t) {
  let { b, pr, col } = item;

  // 화면상 진행 방향(heading): 살짝 앞 지점을 같은 카메라로 투영해 2D 각도를 구함
  let ahead = projectToScreen(add3(b.pos, scale3(norm3(b.vel), 0.25)), camRo, camBasis);
  let heading = ahead ? Math.atan2(ahead.sy - pr.sy, ahead.sx - pr.sx) : 0;

  // 알파: 면 근처 fade shell(이음새 숨김) × 원거리 안개
  let a = shellAlpha(b.pos) * (1 - smooth01(9.0, 13.0, pr.vf));
  drawBirdSprite(pr.sx, pr.sy, pr.vf, heading, col, a, b.phase, t);
}

// 면에 가까울수록 0으로 페이드 → 반대 면 재등장 순간을 안개처럼 가린다
function shellAlpha(p) {
  let a = 1;
  for (let i = 0; i < 3; i++) {
    let d = Math.min(p[i] - BOX_MIN[i], BOX_MIN[i] + BOX_SIZE[i] - p[i]);
    a *= smooth01(0.0, SHELL, d);
  }
  return a;
}

// ───────────────────────── 날씨 (HUD readout 전용) ─────────────────────────

async function fetchWeather() {
  try {
    const res = await fetch(WEATHER_URL);
    const data = await res.json();
    const current = data.current;

    weatherData.cloud = constrain(current.cloud_cover / 100.0, 0.0, 1.0);
    weatherData.rain = constrain((current.rain || current.precipitation || 0) / 5.0, 0.0, 1.0);
    weatherData.wind = current.wind_speed_10m;
    weatherData.temp = current.temperature_2m;
    weatherData.humidity = current.relative_humidity_2m;
    weatherData.code = current.weather_code;
    weatherData.condition = getWeatherCondition(current.weather_code);

    let now = new Date();
    weatherData.updated = nf(now.getHours(), 2) + ':' + nf(now.getMinutes(), 2);

    lastWeatherFetch = millis();
  } catch (err) {
    console.log('weather fetch failed', err);
  }
}

function getWeatherCondition(code) {
  if (code === 0) return 'CLEAR SKY';
  if (code === 1) return 'MAINLY CLEAR';
  if (code === 2) return 'PARTLY CLOUDY';
  if (code === 3) return 'OVERCAST';
  if (code === 45 || code === 48) return 'FOG';
  if (code >= 51 && code <= 57) return 'DRIZZLE';
  if (code >= 61 && code <= 67) return 'RAIN';
  if (code >= 71 && code <= 77) return 'SNOW';
  if (code >= 80 && code <= 82) return 'RAIN SHOWERS';
  if (code >= 95 && code <= 99) return 'THUNDERSTORM';
  return 'UNKNOWN WX';
}

function drawWeatherIcon(x, y, s, code) {
  push();
  translate(x, y);

  stroke(253, 253, 237, 230);
  strokeWeight(2);
  noFill();

  let isCloud = code === 2 || code === 3;
  let isRain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  let isFog = code === 45 || code === 48;
  let isStorm = code >= 95;
  let isClear = code === 0 || code === 1;

  if (isClear) {
    ellipse(0, 0, s * 0.42, s * 0.42);
    for (let i = 0; i < 8; i++) {
      let a = TWO_PI * i / 8.0;
      line(cos(a) * s * 0.34, sin(a) * s * 0.34, cos(a) * s * 0.48, sin(a) * s * 0.48);
    }
  }

  if (isCloud || isRain || isFog || isStorm) {
    arc(-s * 0.22, 0, s * 0.42, s * 0.36, PI, TWO_PI);
    arc(0, -s * 0.08, s * 0.52, s * 0.48, PI, TWO_PI);
    arc(s * 0.24, 0, s * 0.42, s * 0.34, PI, TWO_PI);
    line(-s * 0.45, 0, s * 0.48, 0);
  }

  if (isRain) {
    for (let i = -1; i <= 1; i++) {
      line(i * s * 0.20, s * 0.18, i * s * 0.20 - s * 0.08, s * 0.42);
    }
  }

  if (isFog) {
    line(-s * 0.45, s * 0.20, s * 0.45, s * 0.20);
    line(-s * 0.35, s * 0.34, s * 0.35, s * 0.34);
  }

  if (isStorm) {
    beginShape();
    vertex(-s * 0.05, s * 0.12);
    vertex(s * 0.08, s * 0.12);
    vertex(-s * 0.03, s * 0.40);
    vertex(s * 0.15, s * 0.40);
    vertex(-s * 0.10, s * 0.72);
    endShape();
  }

  pop();
}

function drawWeatherHUD() {
  let x = 50;
  let y = height - 130;
  let cream = color('#FDFDED');
  let dim = color(253, 253, 237, 120);

  push();
  stroke(dim);
  strokeWeight(1.5);
  noFill();

  line(x, y - 18, x + 310, y - 18);
  line(x, y + 58, x + 310, y + 58);

  drawWeatherIcon(x + 30, y + 20, 44, weatherData.code);

  noStroke();
  fill(cream);
  textFont(myFont);

  textSize(11);
  text('WX LIVE // SOGANG-MAPO SECTOR', x + 68, y - 2);

  textSize(24);
  text(nf(weatherData.temp, 1, 1) + ' C', x + 68, y + 28);

  textSize(11);
  text(weatherData.condition, x + 158, y + 26);

  fill(dim);
  textSize(10);
  text('CLOUD ' + floor(weatherData.cloud * 100) + '%', x, y + 82);
  text('WIND ' + nf(weatherData.wind, 1, 1) + ' KM/H', x + 95, y + 82);
  text('HUM ' + weatherData.humidity + '%', x + 215, y + 82);
  text('UPDATED ' + weatherData.updated + ' / 30 MIN CYCLE', x, y + 100);

  pop();
}

// 각 flock(=한 명의 비행자)의 실제 화면 위치에 레이더 락온 박스를 그린다.
// 네트워크 flock은 'FLYER #id', 로컬 데모는 'SIM'. 박스 색 = 그 유저의 새떼 색
function drawUserReticles() {
  for (let f of flocks) {
    if (!f.anchor) continue;
    let pr = projectToScreen(f.anchor, camRo, camBasis);
    if (!pr) continue;   // 카메라 뒤면 스킵

    let col = flockColor(f.hue, 1.0);
    let isLive = f.netId != null;

    // 레이더 잔상(트레일)
    if (!f.trail) f.trail = [];
    if (frameCount % 5 === 0) {
      f.trail.push([pr.sx, pr.sy]);
      if (f.trail.length > 7) f.trail.shift();
    }
    noFill();
    strokeWeight(1.2);
    for (let i = 0; i < f.trail.length; i++) {
      let a = map(i, 0, max(1, f.trail.length - 1), 22, 120);
      let s = lerp(7, 15, i / max(1, f.trail.length - 1));
      stroke(col[0], col[1], col[2], a);
      rect(f.trail[i][0] - s / 2, f.trail[i][1] - s / 2, s, s);
    }

    // 락온 박스: 코너 브래킷 + 십자
    let R = 26, c = 9;
    let L = pr.sx - R, T = pr.sy - R, Rr = pr.sx + R, B = pr.sy + R;
    stroke(col[0], col[1], col[2], 235);
    strokeWeight(2);
    line(L, T, L + c, T); line(L, T, L, T + c);
    line(Rr, T, Rr - c, T); line(Rr, T, Rr, T + c);
    line(L, B, L + c, B); line(L, B, L, B - c);
    line(Rr, B, Rr - c, B); line(Rr, B, Rr, B - c);
    strokeWeight(1.2);
    line(pr.sx - 7, pr.sy, pr.sx + 7, pr.sy);
    line(pr.sx, pr.sy - 7, pr.sx, pr.sy + 7);

    // 라벨
    noStroke();
    textAlign(LEFT, BASELINE);
    fill(col[0], col[1], col[2], 240);
    textSize(11);
    text(isLive ? "FLYER #" + f.netId : "SIM " + floor(f.hue), Rr + 8, pr.sy - 5);
    fill(col[0], col[1], col[2], 175);
    textSize(9);
    text("DIST " + nf(pr.vf * 0.4, 1, 2) + " KM", Rr + 8, pr.sy + 9);
  }
}

function drawApertureHUD() {
  let cream = color('#FDFDED');
  let transparentCream = color(253, 253, 237, 80);

  textFont(myFont);

  let cx = width / 2;
  let cy = height / 2;

  let gaugeW = 220;
  let gaugeH = 170;
  let lineGap = 18;

  let scroll = (frameCount * 0.9) % lineGap;
  let jitter = sin(frameCount * 0.18) * 2.0 + noise(frameCount * 0.035) * 3.0;

  push();
  translate(cx, cy + jitter);

  noFill();

  stroke(transparentCream);
  strokeWeight(1.4);
  rect(-gaugeW / 2, -gaugeH / 2, gaugeW, gaugeH);

  stroke(253, 253, 237, 45);
  strokeWeight(1);
  line(-gaugeW / 2, 0, gaugeW / 2, 0);
  line(0, -gaugeH / 2, 0, gaugeH / 2);

  for (let y = -gaugeH; y <= gaugeH; y += lineGap) {
    let yy = y + scroll;

    if (yy > -gaugeH / 2 + 10 && yy < gaugeH / 2 - 10) {
      let distFromCenter = abs(yy);
      let alpha = map(distFromCenter, 0, gaugeH / 2, 150, 35);

      stroke(253, 253, 237, alpha);
      strokeWeight(1.2);

      let tickW = distFromCenter < 8 ? 145 : 82;
      line(-tickW / 2, yy, tickW / 2, yy);

      if (distFromCenter > 12) {
        stroke(253, 253, 237, alpha * 0.75);
        line(-tickW / 2 - 22, yy, -tickW / 2 - 8, yy);
        line(tickW / 2 + 8, yy, tickW / 2 + 22, yy);
      }
    }
  }

  stroke(cream);
  strokeWeight(3.2);
  line(-gaugeW / 2 + 18, 0, gaugeW / 2 - 18, 0);

  strokeWeight(2);
  line(-22, 0, -7, 0);
  line(7, 0, 22, 0);

  strokeWeight(1.5);
  line(-gaugeW / 2 - 22, 0, -gaugeW / 2 - 5, 0);
  line(gaugeW / 2 + 5, 0, gaugeW / 2 + 22, 0);

  noStroke();
  fill(253, 253, 237, 155);
  textSize(9);
  textAlign(LEFT, CENTER);
  text('ALT REF', -gaugeW / 2 + 8, -gaugeH / 2 - 12);
  text('STAB', gaugeW / 2 - 42, -gaugeH / 2 - 12);
  textAlign(LEFT, BASELINE);

  pop();

  drawUserReticles();

  let totalBirds = flocks.length * FLOCK_SIZE;
  let liveFlyers = flocks.filter(f => f.netId != null).length;
  textSize(14);
  text("FEED // SOGANG-MAPO AERIAL   " + floor(frameRate()) + " FPS", 50, 60);
  text("LINK: " + linkStatus + "    LIVE FLYERS: " + liveFlyers, 50, 85);
  text("ACTIVE FLOCKS: " + flocks.length + "    BIRDS: " + totalBirds, 50, 110);

  fill(transparentCream);
  text("SCAN QR TO RELEASE YOUR FLOCK     [N] +FLOCK   [X] -FLOCK   (DEMO)", 50, 135);
  fill(cream);

  drawWeatherHUD();

  // ── 우하단: 관객 참여 QR + 라이브 인디케이터 ──
  let qr = drawJoinQR();   // 코너에 스캔용 QR 패널

  textSize(14);
  fill(cream);
  let feedLabel = "SYSTEM LIVE FEED";
  let fw = textWidth(feedLabel);
  let feedX = width - 24 - fw;             // QR 패널 오른쪽 가장자리(width-24)에 맞춰 우측 정렬
  let feedY = (qr ? qr.y : height - 24) - 16;
  text(feedLabel, feedX, feedY);
  if (frameCount % 40 < 20) {
    rect(feedX - 22, feedY - 12, 13, 13);  // REC 점멸
  }
}

// 우하단 QR: 지나가던 관객이 폰으로 스캔 → fly.html 접속 → 자기 새떼 합류.
// 대비 확보용 밝은 패널 위에 그려 어두운 하늘에서도 스캔되게 한다. 패널 영역을 반환.
function drawJoinQR() {
  if (!qrImg) return null;
  let qrSize = 104;
  let pad = 11;
  let labelH = 22;
  let panelW = qrSize + pad * 2;
  let panelH = qrSize + pad * 2 + labelH;
  let x = width - panelW - 24;
  let y = height - panelH - 24;

  push();
  noStroke();
  fill(253, 253, 237, 240);                       // 크림색 패널
  rect(x, y, panelW, panelH, 6);
  fill(255);                                       // QR 뒤 순백(스캔 안정성)
  rect(x + pad, y + pad, qrSize, qrSize);
  image(qrImg, x + pad, y + pad, qrSize, qrSize);

  fill(20, 24, 40, 235);                           // 어두운 라벨
  textFont(myFont);
  textSize(10);
  textAlign(CENTER, CENTER);
  text("SCAN TO JOIN THE FLOCK", x + panelW / 2, y + pad + qrSize + labelH / 2 + 1);
  textAlign(LEFT, BASELINE);
  pop();

  return { x, y, w: panelW, h: panelH };
}

function keyPressed() {
  if (key === 'f' || key === 'F') {
    fullscreen(!fullscreen());
  }
  if (key === 'n' || key === 'N') {
    spawnFlock();   // 데모: 유저 접속 흉내
  }
  if (key === 'x' || key === 'X') {
    removeFlock();  // 데모: 유저 퇴장 흉내
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ───────────────────────── 어항 주기 경계(스크린 전용) ─────────────────────────
// (공용 벡터/투영 수학은 common.js)

// 주기 경계 안으로 좌표를 감는다(음수 모듈로 처리)
function wrapAxis(x, min, size) {
  let r = (x - min) % size;
  if (r < 0) r += size;
  return min + r;
}

// 박스 크기의 절반을 넘는 거리는 반대편으로 감아 토러스 위 최단 벡터(a - b)를 만든다
function toroidalDelta(a, b) {
  let d = sub3(a, b);
  for (let i = 0; i < 3; i++) {
    if (d[i] > BOX_SIZE[i] * 0.5) d[i] -= BOX_SIZE[i];
    else if (d[i] < -BOX_SIZE[i] * 0.5) d[i] += BOX_SIZE[i];
  }
  return d;
}

// flock 새들의 wrap-aware 평균 위치(레이더 표시용 중심). 새가 경계를 걸쳐도 한쪽으로 모아 평균낸다
function flockCentroid(birds) {
  let ref = birds[0].pos;
  let s = [0, 0, 0];
  for (let b of birds) s = add3(s, toroidalDelta(b.pos, ref));
  let m = add3(ref, scale3(s, 1 / birds.length));
  return [
    wrapAxis(m[0], BOX_MIN[0], BOX_SIZE[0]),
    wrapAxis(m[1], BOX_MIN[1], BOX_SIZE[1]),
    wrapAxis(m[2], BOX_MIN[2], BOX_SIZE[2])
  ];
}
