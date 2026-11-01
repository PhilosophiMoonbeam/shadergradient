#define STANDARD
varying vec3 vViewPosition;
varying vec2 vGlassUv;
#ifdef USE_TRANSMISSION
varying vec3 vWorldPosition;
#endif

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

uniform float uTime;
uniform float uSpeed;
uniform float uNoiseDensity;
uniform float uNoiseStrength;
uniform float uLoop;
uniform float uLoopDuration;

void main() {
  #include <uv_vertex>
  #include <color_vertex>
  #include <morphinstance_vertex>
  #include <morphcolor_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>

  vec2 phase = vec2(uTime * uSpeed, uTime * uSpeed * 0.73);
  if (uLoop > 0.5 && uLoopDuration > 0.0) {
    float angle = 2.0 * PI * uTime / uLoopDuration;
    phase = vec2(sin(angle), cos(angle)) * uSpeed;
  }
  float density = max(abs(uNoiseDensity), 0.01);
  float strength = clamp(uNoiseStrength, -0.45, 0.45);
  vec2 a = vec2(1.3, 0.7) * density;
  vec2 b = vec2(-0.8, 1.1) * density;
  vec2 c = vec2(0.6, -1.5) * density;
  float wa = dot(position.xy, a) + phase.x;
  float wb = dot(position.xy, b) + phase.y;
  float wc = dot(position.xy, c) - phase.x + phase.y;
  float height = strength * (0.55 * sin(wa) + 0.3 * sin(wb) + 0.15 * sin(wc));
  vec2 gradient = strength * (0.55 * cos(wa) * a + 0.3 * cos(wb) * b + 0.15 * cos(wc) * c);
  // PlaneGeometry is XY with a +Z front, not an XZ water surface.
  objectNormal = normalize(vec3(-gradient, 1.0));

  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>
  #include <begin_vertex>
  transformed.z += height;
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <displacementmap_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vGlassUv = uv;
  vViewPosition = -mvPosition.xyz;
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
  #ifdef USE_TRANSMISSION
  vWorldPosition = worldPosition.xyz;
  #endif
}
