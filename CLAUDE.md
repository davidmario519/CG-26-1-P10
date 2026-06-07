# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single p5.js WebGL sketch (course project P10, Lesson 10 "Shader") that renders an
animated sky over an ocean using a raymarched volumetric-cloud fragment shader, with a
2D "camera HUD" overlay drawn on top. Live weather for the Sogang/Mapo area of Seoul is
fetched from the Open-Meteo API and shown in the HUD.

## Running

There is no build step, no tests, and no linter. The page **must** be served over HTTP —
`loadShader()` and `fetch()` will not work from `file://`.

```bash
# from this directory (P10/)
python3 -m http.server 8000      # then open http://localhost:8000
```

Or use the VS Code Live Server / p5-vscode extension (this project is set up for
`samplavigne.p5-vscode`, see `jsconfig.json`).

In-app controls: press **F** to toggle fullscreen. The window auto-resizes the canvas.

## Architecture

The frame is rendered in two distinct layers inside `draw()` ([sketch.js](sketch.js)):

1. **3D scene = one fullscreen fragment shader.** `shader(cloudShader)` is bound and a
   fullscreen quad is drawn with `quad(-1,-1, 1,-1, 1,1, -1,1)`. The vertex shader
   ([effect.vert](effect.vert)) is a pass-through that writes `aPosition` straight to
   `gl_Position`, so the quad coordinates are already NDC and cover the screen. All of the
   visual richness lives in [effect.frag](effect.frag); JS only feeds it three uniforms:
   `u_resolution`, `u_time` (seconds), and `u_mouse`.
2. **HUD = normal p5 2D drawing on top.** After `resetShader()`, depth testing is disabled
   via the raw GL context (`_renderer.GL.disable(_renderer.GL.DEPTH_TEST)`) and the origin
   is translated to the top-left corner so HUD code can use screen-space pixel coordinates
   like ordinary 2D p5. Depth test is re-enabled afterward. `drawApertureHUD()` is the
   entry point; it draws the altitude gauge, tracking reticles, telemetry text, and calls
   `drawWeatherHUD()`.

### Fragment shader (effect.frag)

GLSL **ES 3.00** (`#version 300 es`, `out vec4 fragColor`, `in`/`out` qualifiers) — keep
this version when editing; p5 0.12 supports it but the older `gl_FragColor`/`varying`
syntax will not mix with it.

Pipeline per pixel (`render()` → builds sky/sun/stars/ocean as a background, then
`raymarch()` composites clouds over it):
- **Day/night cycle**: `getDayCycle()` returns a 0→1 phase from `u_time`; every color in
  the scene (sky top/horizon, cloud lit/shadow, ocean deep/highlight) is interpolated
  through dawn→day→sunset→night keyframes by the shared `timeColor()` helper. Sun direction,
  sun disc, and a procedural star field are all driven by this same phase.
- **Clouds**: value-noise fBm (`noise()` + `map2..map5`, which are progressively
  lower-LOD octave counts) raymarched by the `MARCH(STEPS, MAPLOD)` macro. `raymarch()`
  calls it at decreasing LOD as the ray travels (`MARCH(40, map5)` near → `MARCH(16, map2)`
  far). `holeMask()` punches gaps so the clouds form a band rather than solid cover.
- **Ocean**: separate raymarch (`seaMap`/`seaNormal`) with Fresnel, specular, and distance fog.
- **Camera**: animated entirely in `main()` — Perlin-noise-driven yaw/pitch/height plus
  layered sines to avoid the look "freezing", assembled into a view matrix by `setCamera()`.

### Weather integration

`fetchWeather()` pulls Open-Meteo current conditions (`WEATHER_URL`, hard-coded lat/long
for Seoul) on startup and every 30 min (`WEATHER_UPDATE_INTERVAL`). Note: the weather
values currently feed **only the HUD readout** (`drawWeatherHUD` / `getWeatherCondition` /
`drawWeatherIcon`) — they are *not* passed to the shader as uniforms. Wiring cloud/rain/wind
into `effect.frag` would mean adding `setUniform` calls in `draw()` and matching `uniform`
declarations in the shader.

## Gotchas

- `myFont` is declared and referenced by `textFont(myFont)` but never loaded (the
  `loadFont` line in `preload()` is commented out), so HUD text falls back to the default
  font. Uncomment and supply a `.ttf` to change it.
- Comments in the source are partly in Korean (e.g. `//시간조절` = "time adjust" next to
  `getDayCycle`'s speed, `//멈춰 보이는 구간 방지` = "prevent the camera from looking stuck").
- `pixelDensity(1)` is set deliberately — the raymarcher is fragment-heavy, so rendering at
  native retina density would roughly quadruple the cost.
