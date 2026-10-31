---
'@shadergradient/core': patch
'@shadergradient/react': patch
'@shadergradient/vue': patch
---

Extract the shared shader sources, geometry settings, ten presets and grain shader into the framework-neutral `@shadergradient/core` asset package. React and Vue consume its public exports instead of private source paths; their public framework APIs and renderer behavior are unchanged. Include the package-local MIT license and retained shader/vendor attributions with the new core package.
