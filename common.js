/// 메인 스크린(sketch.js)과 폰 클라이언트(phone.js)가 공유하는 카메라/투영/벡터 수학.
/// 두 클라이언트가 같은 월드 좌표계와 같은 투영을 쓰게 해서, 폰이 보낸 위치를
/// 스크린이 정확히 같은 공간에 배치할 수 있게 한다. (effect.frag의 카메라 수학과 1:1 대응)

const BIRD_RADIUS = 0.11;   // 새 한 마리의 월드 반경(화면 크기 환산용)

// ── 벡터 유틸 (월드는 [x, y, z] 배열) ──
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm3(a) { let l = len3(a); return l > 1e-6 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; }
function limit3(a, m) { let l = len3(a); return l > m ? scale3(a, m / l) : a; }
function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

// 부드러운 0→1 보간 (GLSL smoothstep 대응)
function smooth01(a, b, x) {
  let t = constrain((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// 셰이더 setCamera와 동일한 기저 벡터(cu=오른쪽, cv=위, cw=전방)
function computeCameraBasis(ro, ta, roll) {
  let cw = norm3(sub3(ta, ro));
  let cp = [Math.sin(roll), Math.cos(roll), 0];
  let cu = norm3(cross3(cw, cp));
  let cv = norm3(cross3(cu, cw));
  return { cu, cv, cw };
}

// 월드 점을 셰이더의 광선 공식(rd = ca * normalize(vec3(p, 1.5)))을 역산해 화면 픽셀로.
// 반환 sx/sy는 translate(-width/2,-height/2) 적용된 2D 오버레이 좌표(top-origin)이고 vf는 카메라 전방 거리.
function projectToScreen(pw, ro, basis) {
  let v = sub3(pw, ro);
  let vf = dot3(v, basis.cw);
  if (vf <= 0.05) return null;                  // 카메라 뒤/너무 가까움
  let px = 1.5 * dot3(v, basis.cu) / vf;
  let py = 1.5 * dot3(v, basis.cv) / vf;
  let sx = (px * height + width) / 2;           // p.x = (2*fragX - W)/H 역산
  let sy = height - (py * height + height) / 2; // GL은 bottom-origin → 2D top-origin으로 뒤집기
  return { sx, sy, vf };
}

// 낮/밤에 따른 새 밝기(밤엔 실루엣). 셰이더의 getDayCycle/sunVisibility와 같은 위상
function birdBrightness(t) {
  let dc = (t * 0.015) % 1.0;
  let sunVis = smooth01(0.0, 0.16, dc) * (1.0 - smooth01(0.58, 0.78, dc));
  return 0.3 + 0.7 * sunVis;
}

function flockColor(hue, bright) {
  colorMode(HSB, 360, 100, 100);
  let c = color(hue, 55, 100 * bright);
  colorMode(RGB, 255);
  return [red(c), green(c), blue(c)];
}

// 투영된 새 한 마리를 2D 빌보드로 그린다. 머리(+x)에서 날개가 뒤(-x)·옆(±y)으로 펼쳐진 V, spread가 펄럭임
function drawBirdSprite(sx, sy, vf, heading, col, alpha, flapPhase, t) {
  if (alpha < 0.01) return;
  let size = constrain(0.75 * BIRD_RADIUS * height / vf, 1.5, 60);
  let flap = Math.sin(t * 9 + flapPhase) * 0.5 + 0.5;
  let spread = size * (0.55 + 0.4 * flap);

  push();
  translate(sx, sy);
  rotateZ(heading);
  noFill();
  stroke(col[0], col[1], col[2], 230 * alpha);
  strokeWeight(Math.max(1.0, size * 0.16));
  line(size * 0.25, 0, -size * 0.55, -spread);
  line(size * 0.25, 0, -size * 0.55, spread);
  pop();
}
