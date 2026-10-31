export function compatibleShader(source: string) {
  if (source.includes('linearToRelativeLuminance(')) {
    source = `float shaderGradientLuminance(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }\n${source.replaceAll(
      'linearToRelativeLuminance(',
      'shaderGradientLuminance('
    )}`
  }
  return source.replace(
    /#include <(?:uv2_pars_vertex|uv2_vertex|uv2_pars_fragment|encodings_fragment)>/g,
    ''
  )
}
