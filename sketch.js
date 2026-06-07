/// press F for fullscreen

let cloudShader;
let myFont;
let mx = 0.5;
let my = 0.5;

// WASD 자유 비행 카메라: 위치는 JS가 누적(camPos), 시점(yaw/pitch)은 마우스가 담당
let camPos = [0, 0.5, 0];   // 카메라 월드 좌표 [x, y, z]
const MOVE_SPEED = 2.5;     // 초당 이동 거리(units/sec)
const SPRINT_MULT = 3.0;    // Shift 가속 배율

let targetHistory = [];
const MAX_HISTORY = 4;

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
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(1);
  noStroke();
  fetchWeather();
}

function draw() {
  background(0);

  if (millis() - lastWeatherFetch > WEATHER_UPDATE_INTERVAL) {
    fetchWeather();
  }

  // 마우스 위치를 0~1로 정규화하고 부드럽게 따라가도록 보간
  let targetMx = constrain(mouseX / width, 0, 1);
  let targetMy = constrain(mouseY / height, 0, 1);
  mx = lerp(mx, targetMx, 0.06);
  my = lerp(my, targetMy, 0.06);

  updateCamera();

  shader(cloudShader);
  cloudShader.setUniform('u_resolution', [width, height]);
  cloudShader.setUniform('u_time', millis() / 1000.0);
  cloudShader.setUniform('u_mouse', [mx, my]);
  cloudShader.setUniform('u_camPos', camPos);

  quad(-1, -1, 1, -1, 1, 1, -1, 1);

  resetShader();

  _renderer.GL.disable(_renderer.GL.DEPTH_TEST);
  translate(-width / 2, -height / 2);
  drawApertureHUD();
  _renderer.GL.enable(_renderer.GL.DEPTH_TEST);
}

// WASD: 수평 이동 / Q,E: 고도 / Shift: 부스트. 시점(yaw)을 따라 전진 방향이 회전한다.
function updateCamera() {
  let dt = deltaTime / 1000.0;   // 프레임레이트 독립적으로 (초 단위)

  // 셰이더와 동일한 yaw 매핑으로 수평 전진/우측 벡터를 구한다
  let yaw = map(mx, 0, 1, -0.99, 0.99);
  let fx = Math.sin(yaw);
  let fz = -1.0 + Math.cos(yaw) * 0.25;
  let fl = Math.hypot(fx, fz);
  fx /= fl; fz /= fl;            // 전진 방향(정규화)
  let rx = -fz, rz = fx;         // 카메라 오른쪽 방향

  let vx = 0, vy = 0, vz = 0;
  if (keyIsDown(87)) { vx += fx; vz += fz; }   // W 전진
  if (keyIsDown(83)) { vx -= fx; vz -= fz; }   // S 후진
  if (keyIsDown(68)) { vx += rx; vz += rz; }   // D 우측
  if (keyIsDown(65)) { vx -= rx; vz -= rz; }   // A 좌측
  if (keyIsDown(69)) { vy += 1; }              // E 상승
  if (keyIsDown(81)) { vy -= 1; }              // Q 하강

  let mag = Math.hypot(vx, vy, vz);
  if (mag > 0) {
    // 대각 이동이 빨라지지 않도록 정규화 후 속도 적용
    let step = MOVE_SPEED * (keyIsDown(SHIFT) ? SPRINT_MULT : 1.0) * dt / mag;
    camPos[0] += vx * step;
    camPos[1] += vy * step;
    camPos[2] += vz * step;
  }

  // 바다(y=-5.2) 아래로 잠기거나 구름대 위로 완전히 벗어나지 않도록 제한
  camPos[0] = constrain(camPos[0], -60, 60);
  camPos[1] = constrain(camPos[1], -4.8, 4.0);
  camPos[2] = constrain(camPos[2], -60, 60);
}

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

  let targetX = noise(frameCount * 0.005) * (width - 300) + 150;
  let targetY = noise(frameCount * 0.005 + 500) * (height - 300) + 150;

  if (frameCount % 45 === 0) {
    targetHistory.push({ x: targetX, y: targetY, alpha: 255 });
    if (targetHistory.length > MAX_HISTORY) {
      targetHistory.shift();
    }
  }

  for (let i = 0; i < targetHistory.length; i++) {
    let hist = targetHistory[i];
    hist.alpha -= 0.5;

    let markerColor = color(253, 253, 237, hist.alpha);

    stroke(markerColor);
    strokeWeight(1.5);
    noFill();
    rect(hist.x - 6, hist.y - 6, 12, 12);

    noStroke();
    fill(markerColor);
    textSize(10);
    text(`x: ${floor(hist.x)} y: ${floor(hist.y)}`, hist.x + 12, hist.y + 4);
  }

  stroke(cream);
  strokeWeight(2);
  noFill();
  rect(targetX - 25, targetY - 25, 50, 50);

  noStroke();
  fill(cream);
  textSize(10);
  text("LOCK_ID: OBJ_" + floor(noise(frameCount * 0.001) * 9000), targetX + 32, targetY - 12);
  text("DIST: " + nf(noise(frameCount * 0.01) * 5, 1, 2) + " KM", targetX + 32, targetY);

  textSize(14);
  text("CAMERA FRAME RATE: " + floor(frameRate()) + " FPS", 50, 60);
  // 고도는 해수면(y=-5.2) 기준 실제 카메라 높이를 미터로 환산
  text("ATMOSPHERE ALTITUDE: " + floor((camPos[1] + 5.2) * 800) + " M", 50, 85);
  text("NAV  X:" + nf(camPos[0], 1, 1) + "  Z:" + nf(camPos[2], 1, 1), 50, 110);

  fill(transparentCream);
  text("FLIGHT  W A S D MOVE   Q E ALT   SHIFT BOOST", 50, 135);
  fill(cream);

  drawWeatherHUD();

  if (frameCount % 40 < 20) {
    rect(width - 80, height - 78, 18, 18);
  }

  textSize(14);
  text("SYSTEM LIVE FEED", width - 230, height - 64);
}

function keyPressed() {
  if (key === 'f' || key === 'F') {
    let fs = fullscreen();
    fullscreen(!fs);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}