// Starting points offered on /new. Each one is a complete, commented shader that teaches one idea.
export interface Template {
  id: string;
  title: string;
  blurb: string;
  code: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'circle',
    title: 'Glowing circle',
    blurb: 'Distance to a shape, and a glow that fades with it. Drag on the picture to move it.',
    code: `// A glowing circle. Drag on the picture to move it.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // Centre the coordinates and keep circles round on any screen shape.
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    vec2 mouse = iMouse.z > 0.0 ? (iMouse.xy - 0.5 * iResolution.xy) / iResolution.y : vec2(0.0);

    float d = length(uv - mouse) - 0.2;              // distance to the circle's edge
    float pulse = 0.5 + 0.5 * sin(iTime * 2.0);
    vec3 color = vec3(1.0, 0.6, 0.2);

    float glow = 0.012 / abs(d) * (0.6 + 0.4 * pulse);  // bright near the edge, fading out
    vec3 col = color * glow + vec3(0.02, 0.01, 0.05);
    fragColor = vec4(1.0 - exp(-col), 1.0);          // soft tone mapping keeps it from clipping
}
`,
  },
  {
    id: 'clouds',
    title: 'Noise and clouds',
    blurb: 'Layered noise (fbm), the building block of clouds, fire, terrain and marble.',
    code: `// Clouds from layered noise (fbm). Change the numbers to reshape them.

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);                // smooth blend between grid corners
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) { v += amp * noise(p); p *= 2.0; amp *= 0.5; }
    return v;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.y;
    float clouds = fbm(uv * 3.0 + vec2(iTime * 0.15, 0.0));
    vec3 sky = mix(vec3(0.25, 0.5, 0.9), vec3(0.6, 0.8, 1.0), fragCoord.y / iResolution.y);
    vec3 col = mix(sky, vec3(1.0), smoothstep(0.45, 0.8, clouds));
    fragColor = vec4(col, 1.0);
}
`,
  },
  {
    id: 'raymarch',
    title: '3D raymarched scene',
    blurb: 'A bouncing ball with light and shadow, drawn by walking each pixel’s ray into the scene.',
    code: `// A 3D scene drawn by raymarching: each pixel walks along a ray until it hits something.

float scene(vec3 p) {
    float ball = length(p - vec3(0.0, 1.0 + 0.25 * sin(iTime * 2.0), 0.0)) - 1.0;
    float ground = p.y;                              // the plane y = 0
    return min(ball, ground);                        // distance to the nearest surface
}

vec3 normalAt(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(scene(p + e.xyy) - scene(p - e.xyy),
                          scene(p + e.yxy) - scene(p - e.yxy),
                          scene(p + e.yyx) - scene(p - e.yyx)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    vec3 ro = vec3(0.0, 1.5, -5.0);                  // camera position
    vec3 rd = normalize(vec3(uv, 1.5));              // this pixel's ray

    float t = 0.0;
    for (int i = 0; i < 100; i++) {
        float d = scene(ro + rd * t);
        if (d < 0.001 || t > 50.0) break;
        t += d;                                      // safe to step this far: nothing is closer
    }

    vec3 skyCol = vec3(0.6, 0.75, 1.0) - rd.y * 0.4;
    vec3 col = skyCol;
    if (t < 50.0) {
        vec3 p = ro + rd * t;
        vec3 n = normalAt(p);
        vec3 light = normalize(vec3(cos(iTime * 0.5), 1.0, -0.6));
        float diffuse = max(dot(n, light), 0.0);
        float shadow = 1.0, h = 0.05;                // march toward the light to find shadows
        for (int i = 0; i < 40; i++) {
            float d = scene(p + n * 0.01 + light * h);
            shadow = min(shadow, 8.0 * d / h);
            h += clamp(d, 0.02, 0.5);
        }
        float checker = mod(floor(p.x) + floor(p.z), 2.0);
        vec3 base = p.y < 0.01 ? vec3(0.55 + 0.25 * checker) : vec3(1.0, 0.45, 0.3);
        col = base * (0.15 + 0.85 * diffuse * clamp(shadow, 0.0, 1.0));
        col = mix(col, skyCol, 1.0 - exp(-0.001 * t * t));   // fog in the distance
    }
    fragColor = vec4(pow(col, vec3(0.4545)), 1.0);   // gamma correction
}
`,
  },
  {
    id: 'waves',
    title: 'Colour waves',
    blurb: 'The classic first shader: colour from position and time. Short enough to read in one go.',
    code: `// Edit me! mainImage runs once per pixel, Shadertoy-style.
// Uniforms: iResolution (vec3), iTime (float), iMouse (vec4)

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0.0, 2.0, 4.0));
    fragColor = vec4(col, 1.0);
}
`,
  },
  {
    id: 'blank',
    title: 'Blank',
    blurb: 'Almost nothing: the smallest shader that runs. Start from scratch.',
    code: `// mainImage runs once for every pixel, many times a second.
// fragCoord is the pixel's position in pixels; set fragColor to its colour (red, green, blue, alpha).

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;            // 0 to 1 across the picture
    fragColor = vec4(uv.x, uv.y, 0.5, 1.0);
}
`,
  },
];
