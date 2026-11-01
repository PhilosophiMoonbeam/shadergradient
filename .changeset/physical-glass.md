---
'@shadergradient/core': patch
'@shadergradient/react': patch
'@shadergradient/vue': patch
'@shadergradient/svelte': patch
---

Replace the glass shader's low-alpha chromatic approximation with revision-supported physical opaque-scene transmission and environment reflections. Keep the public three-geometry shader map while sharing its canonical fragment, use consistent deformed normals and glass-only sheet tessellation, normalize glass tint colors into linear RGB, and make polish follow `roughness = 1 - reflection`.

Keep glass materials and uniform objects stable during live control changes, dispose owned resources including the r186 DFG binding, and preserve existing non-glass color/render paths. Glass needs opaque content behind it in the same scene plus suitable lighting; CSS backgrounds are not transmission sources. Include the rebuilt Next Glass Studio with genuine backdrop comparison, geometry/tint/surface controls, reduced motion, responsive contrast and explicit failure states.
