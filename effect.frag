#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

#define TURBULENCE 0

float hash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.xyz, p.yzx + 19.19);
    return fract(p.x * p.y * p.z);
}

float noise(in vec3 x) {
#if TURBULENCE==1
    x *= 0.5;
#endif

    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    float n = mix(
        mix(
            mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
            mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x),
            f.y
        ),
        mix(
            mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
            mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x),
            f.y
        ),
        f.z
    );

    n = n * 2.0 - 1.0;

#if TURBULENCE==0
    return n;
#else
    return 2.0 * abs(n) - 1.0;
#endif
}

mat3 setCamera(in vec3 ro, in vec3 ta, float cr) {
    vec3 cw = normalize(ta - ro);
    vec3 cp = vec3(sin(cr), cos(cr), 0.0);
    vec3 cu = normalize(cross(cw, cp));
    vec3 cv = normalize(cross(cu, cw));
    return mat3(cu, cv, cw);
}

float getDayCycle() {
    return mod(u_time * 0.015, 1.0); //시간조절
}

vec3 timeColor(vec3 dawn, vec3 day, vec3 sunset, vec3 night, float t) {
    vec3 col = dawn;
    col = mix(col, day, smoothstep(0.00, 0.25, t));
    col = mix(col, sunset, smoothstep(0.50, 0.70, t));
    col = mix(col, night, smoothstep(0.72, 0.85, t));
    col = mix(col, dawn, smoothstep(0.88, 1.00, t));
    return col;
}

vec3 getTimeSkyTopColor(float t) {
    return timeColor(
        vec3(0.42, 0.38, 0.66),
        vec3(0.35, 0.62, 0.95),
        vec3(0.95, 0.45, 0.16),
        vec3(0.015, 0.025, 0.09),
        t
    );
}

vec3 getTimeSkyHorizonColor(float t) {
    return timeColor(
        vec3(0.95, 0.58, 0.38),
        vec3(0.78, 0.88, 1.00),
        vec3(1.00, 0.58, 0.18),
        vec3(0.04, 0.06, 0.14),
        t
    );
}

vec3 getTimeSkyColor(vec2 st, float t) {
    float y = smoothstep(0.0, 1.0, st.y);
    return mix(getTimeSkyHorizonColor(t), getTimeSkyTopColor(t), y);
}

vec3 getTimeCloudColor(float t) {
    return timeColor(
        vec3(1.00, 0.78, 0.62),
        vec3(1.00, 0.96, 0.88),
        vec3(1.00, 0.66, 0.32),
        vec3(0.22, 0.27, 0.40),
        t
    );
}

vec3 getTimeCloudShadowColor(float t) {
    return timeColor(
        vec3(0.45, 0.40, 0.55),
        vec3(0.25, 0.30, 0.35),
        vec3(0.42, 0.24, 0.18),
        vec3(0.04, 0.06, 0.11),
        t
    );
}

vec3 getTimeOceanColor(float t) {
    return timeColor(
        vec3(0.08, 0.16, 0.28),
        vec3(0.015, 0.16, 0.28),
        vec3(0.24, 0.12, 0.08),
        vec3(0.005, 0.02, 0.06),
        t
    );
}

vec3 getTimeOceanHighlightColor(float t) {
    return timeColor(
        vec3(0.90, 0.50, 0.32),
        vec3(0.12, 0.42, 0.52),
        vec3(1.00, 0.55, 0.14),
        vec3(0.04, 0.07, 0.14),
        t
    );
}

vec3 getSunDirection(float t) {
    float angle = mix(3.14159, 0.0, t);
    return normalize(vec3(cos(angle), sin(angle) * 0.95 - 0.05, -0.65));
}

float starNoise(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 starField(vec3 rd, float dayCycle) {
    float nightAmount = smoothstep(0.62, 0.78, dayCycle)
                      * (1.0 - smoothstep(0.90, 1.0, dayCycle));

    float skyAmount = smoothstep(-0.10, 0.25, rd.y);

    vec2 uv = rd.xz / max(rd.y + 0.45, 0.12);
    uv *= 70.0;

    vec2 cell = floor(uv);
    vec2 local = fract(uv);

    float rnd = starNoise(cell);
    float star = smoothstep(0.955, 1.0, rnd);

    vec2 center = vec2(starNoise(cell + 2.3), starNoise(cell + 7.1));
    float d = length(local - center);

    star *= smoothstep(0.13, 0.0, d);
    star *= 0.75 + 0.25 * sin(u_time * 2.0 + rnd * 20.0);

    return vec3(1.0, 0.95, 0.82) * star * nightAmount * skyAmount * 3.2;
}

float sunVisibility(float dayCycle) {
    float riseFade = smoothstep(0.00, 0.16, dayCycle);
    float setFade = 1.0 - smoothstep(0.58, 0.78, dayCycle);
    return riseFade * setFade;
}

vec3 sunDisc(vec3 rd, vec3 sunDir, float dayCycle) {
    float dayAmount = sunVisibility(dayCycle);

    float d = dot(rd, sunDir);
    float disc = smoothstep(0.9990, 0.99975, d);
    float glow = pow(max(d, 0.0), 70.0) * 0.55;

    return vec3(1.0, 0.72, 0.25) * (disc + glow) * dayAmount;
}

float seaOctave(vec2 uv) {
    uv += noise(vec3(uv, 0.0));
    vec2 wv = 1.0 - abs(sin(uv));
    vec2 swv = abs(cos(uv));
    wv = mix(wv, swv, wv);
    return pow(1.0 - pow(wv.x * wv.y, 0.65), 2.0);
}

float seaMap(vec3 p) {
    float freq = 0.16;
    float amp = 0.8;
    vec2 uv = p.xz;
    float d = 0.0;

    for (int i = 0; i < 5; i++) {
        float t = u_time * (0.16 + 0.025 * float(i));
        d += seaOctave((uv + vec2(t, -t)) * freq) * amp;
        d += seaOctave((uv - vec2(t, t)) * freq) * amp * 0.55;
        uv *= mat2(1.6, 1.2, -1.2, 1.6);
        freq *= 1.75;
        amp *= 0.38;
    }

    return p.y + 5.2 - d * 0.42;
}

vec3 seaNormal(vec3 p) {
    float e = 0.10;
    float h = seaMap(p);

    vec3 n;
    n.x = seaMap(vec3(p.x + e, p.y, p.z)) - h;
    n.z = seaMap(vec3(p.x, p.y, p.z + e)) - h;
    n.y = e;

    return normalize(n);
}

vec3 oceanColor(vec3 ro, vec3 rd, float dayCycle) {
    vec2 skyUV = vec2(0.5, rd.y * 0.5 + 0.5);
    vec3 sky = getTimeSkyColor(skyUV, dayCycle);

    if (abs(rd.y) < 0.001) return sky;

    float t = (-5.2 - ro.y) / rd.y;
    if (t <= 0.0) return sky;

    vec3 p = ro + rd * t;

    for (int i = 0; i < 7; i++) {
        float h = seaMap(p);
        p += rd * h * 0.55;
    }

    vec3 n = seaNormal(p);
    vec3 sunDir = getSunDirection(dayCycle);

    float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.65;
    float diffuse = clamp(dot(n, sunDir), 0.0, 1.0);
    float spec = pow(max(dot(reflect(rd, n), sunDir), 0.0), 90.0);

    vec3 deep = getTimeOceanColor(dayCycle);
    vec3 shallow = getTimeOceanHighlightColor(dayCycle);

    vec3 water = mix(deep, shallow, diffuse);
    water += getTimeSkyHorizonColor(dayCycle) * spec * 0.9;
    water = mix(water, sky, fresnel);

    float fog = 1.0 - exp(-0.012 * t);
    water = mix(water, sky, fog);

    return water;
}

float holeMask(vec3 p) {
    vec3 q = p * 0.16;
    q.xz += vec2(u_time * 0.025, -u_time * 0.018);

    float h = 0.0;
    h += 0.50 * noise(q);
    h += 0.30 * noise(q * 2.0 + 13.1);
    h += 0.20 * noise(q * 4.0 - 5.7);

    h = h * 0.5 + 0.5;

    float keepCloud = smoothstep(0.45, 0.64, h);
    float deck = smoothstep(-5.0, -2.2, p.y) * smoothstep(3.8, 0.3, p.y);

    return mix(1.0, keepCloud, deck);
}

float map5(in vec3 p) {
    vec3 q = p - vec3(0.0, 0.1, 1.0) * u_time;
    float f;
    float a = 0.5;

    f  = a * noise(q); q = q * 2.02; a *= 0.5;
    f += a * noise(q); q = q * 2.03; a *= 0.5;
    f += a * noise(q); q = q * 2.01; a *= 0.5;
    f += a * noise(q); q = q * 2.02; a *= 0.5;
    f += a * noise(q);

    return clamp(1.5 - p.y - 2.0 + 1.75 * f, 0.0, 1.0);
}

float map4(in vec3 p) {
    vec3 q = p - vec3(0.0, 0.1, 1.0) * u_time;
    float f;
    float a = 0.5;

    f  = a * noise(q); q = q * 2.02; a *= 0.5;
    f += a * noise(q); q = q * 2.03; a *= 0.5;
    f += a * noise(q); q = q * 2.01; a *= 0.5;
    f += a * noise(q);

    return clamp(1.5 - p.y - 2.0 + 1.75 * f, 0.0, 1.0);
}

float map3(in vec3 p) {
    vec3 q = p - vec3(0.0, 0.1, 1.0) * u_time;
    float f;
    float a = 0.5;

    f  = a * noise(q); q = q * 2.02; a *= 0.5;
    f += a * noise(q); q = q * 2.03; a *= 0.5;
    f += a * noise(q);

    return clamp(1.5 - p.y - 2.0 + 1.75 * f, 0.0, 1.0);
}

float map2(in vec3 p) {
    vec3 q = p - vec3(0.0, 0.1, 1.0) * u_time;
    float f;
    float a = 0.5;

    f  = a * noise(q); q = q * 2.02; a *= 0.5;
    f += a * noise(q);

    return clamp(1.5 - p.y - 2.0 + 1.75 * f, 0.0, 1.0);
}

const vec3 cloudLightDir = vec3(-0.7071, 0.0, -0.7071);

#define MARCH(STEPS, MAPLOD) \
for (int i = 0; i < STEPS; i++) { \
    vec3 pos = ro + t * rd; \
    if (sum.a > 0.99) break; \
    if (pos.y < -5.5 || pos.y > 4.5) { \
        t += max(0.06, 0.10 * t); \
        continue; \
    } \
    float den = MAPLOD(pos); \
    if (den < 0.01) { t += max(0.06, 0.042 * t); continue; } \
    den *= holeMask(pos); \
    if (den > 0.01) { \
        vec3 lightPos = pos + 0.3 * cloudLightDir; \
        float lightDen = map2(lightPos) * holeMask(lightPos); \
        float dif = clamp((den - lightDen) / 0.6, 0.0, 1.0); \
        vec3 cloudBright = getTimeCloudColor(dayCycle); \
        vec3 cloudDark = getTimeCloudShadowColor(dayCycle); \
        vec3 lin = vec3(1.0, 0.6, 0.3) * dif + vec3(0.91, 0.98, 1.05); \
        vec4 col = vec4(mix(cloudBright, cloudDark, den), den); \
        col.xyz *= lin; \
        col.xyz = mix(col.xyz, bgcol, 1.0 - exp(-0.0004 * t * t)); \
        col.w *= 0.4; \
        col.rgb *= col.a; \
        sum += col * (1.0 - sum.a); \
    } \
    t += max(0.06, 0.042 * t); \
}

vec4 raymarch(in vec3 ro, in vec3 rd, in vec3 bgcol, in ivec2 px, float dayCycle) {
    vec4 sum = vec4(0.0);
    float t = 0.05 * hash(vec3(vec2(px), u_time));

    MARCH(24, map5);
    MARCH(12, map4);
    MARCH(10, map3);
    MARCH(8, map2);

    return clamp(sum, 0.0, 1.0);
}

vec4 render(in vec3 ro, in vec3 rd, in ivec2 px) {
    float dayCycle = getDayCycle();

    vec3 sunDir = getSunDirection(dayCycle);
    float sun = clamp(dot(sunDir, rd), 0.0, 1.0);

    vec2 skyUV = vec2(0.5, rd.y * 0.5 + 0.5);
    vec3 sky = getTimeSkyColor(skyUV, dayCycle);

float sunAmount = sunVisibility(dayCycle);

sky += getTimeSkyHorizonColor(dayCycle) * pow(sun, 8.0) * 0.45 * sunAmount;
sky += vec3(1.0, 0.78, 0.45) * pow(sun, 80.0) * sunAmount;

sky += starField(rd, dayCycle);
sky += sunDisc(rd, sunDir, dayCycle);
    vec3 sea = oceanColor(ro, rd, dayCycle);
    float seaMask = 1.0 - smoothstep(-0.12, 0.18, rd.y);
    vec3 base = mix(sky, sea, seaMask);

    vec4 clouds = raymarch(ro, rd, base, px, dayCycle);
    vec3 col = base * (1.0 - clouds.a) + clouds.rgb;

    return vec4(col, 1.0);
}

void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    vec2 p = (2.0 * fragCoord - u_resolution.xy) / u_resolution.y;

    float t = u_time;

float heightSpeed = 0.08;
float yawRange = 0.99;
float pitchDown = -0.70;
float pitchUp = 0.32;
float cameraLow = -0.45;
float cameraHigh = 1.45;

// 마우스로 시점을 직접 조종 (u_mouse는 0~1 정규화 좌표)
float yaw = mix(-yawRange, yawRange, u_mouse.x);   // mouseX → Yaw(좌우)
float pitch = mix(pitchUp, pitchDown, u_mouse.y);  // mouseY → Pitch(상하, 화면 위=올려다봄)

// 카메라 높이는 기존처럼 자동으로 떠다니게 유지
float nHeight = noise(vec3(t * heightSpeed, 15.0, 2.0)) * 0.5 + 0.5;
float camY = mix(cameraLow, cameraHigh, nHeight);
camY += sin(t * 0.21 + 0.8) * 0.10;

pitch = clamp(pitch, pitchDown, pitchUp);
camY = clamp(camY, cameraLow, cameraHigh);
    vec3 ro = vec3(
        sin(t * 0.08) * 0.18,
        camY,
        cos(t * 0.07) * 0.18
    );

    vec3 ta = ro + vec3(
        sin(yaw),
        pitch,
        -1.0 + cos(yaw) * 0.25
    );

    mat3 ca = setCamera(ro, ta, 0.022 * sin(t * 0.35));
    vec3 rd = ca * normalize(vec3(p.xy, 1.5));

    fragColor = render(ro, rd, ivec2(fragCoord - 0.5));
}