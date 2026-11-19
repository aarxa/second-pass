// The GLSL wrapper and error parser shared by the browser renderer and the shader agent (agent/),
// so a shader compiles the same way in the editor and in the agent's headless browser.
// Keep this file free of DOM code: the agent imports it from Node.

export interface CompileError {
  line: number; // 1-based line in the user's code
  message: string;
}

export const HEADER = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
out vec4 shaderlab_outColor;
`;
export const HEADER_LINES = HEADER.split('\n').length - 1;
export const FOOTER = `
void main() { mainImage(shaderlab_outColor, gl_FragCoord.xy); }
`;
export const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the whole screen; no vertex buffer needed.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Parses driver logs like "ERROR: 0:12: 'foo' : undeclared identifier" into user-code lines. */
export function parseErrors(log: string): CompileError[] {
  const out: CompileError[] = [];
  // Drivers pad the log with NUL and other control characters; strip them before parsing.
  for (const raw of log.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').split('\n')) {
    const m = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(raw.trim());
    if (m) out.push({ line: Math.max(1, Number(m[1]) - HEADER_LINES), message: m[2] });
    else if (raw.trim()) out.push({ line: 1, message: raw.trim() });
  }
  return out;
}

