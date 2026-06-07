/// press F for fullscreen

let cloudShader;
let myFont;
let mx = 0.5;
let my = 0.5;

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

  shader(cloudShader);
  cloudShader.setUniform('u_resolution', [width, height]);
  cloudShader.setUniform('u_time', millis() / 1000.0);
  cloudShader.setUniform('u_mouse', [mx, my]);

  quad(-1, -1, 1, -1, 1, 1, -1, 1);

  resetShader();

  _renderer.GL.disable(_renderer.GL.DEPTH_TEST);
  translate(-width / 2, -height / 2);
  drawApertureHUD();
  _renderer.GL.enable(_renderer.GL.DEPTH_TEST);
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
  text("ATMOSPHERE ALTITUDE: " + (4500 + floor(frameCount * 0.2)) + " M", 50, 85);
  text("REL_SPEED: 240.5 KNOTS", 50, 110);

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