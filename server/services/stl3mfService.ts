import * as fs from "fs";
import * as path from "path";
import AdmZip = require("adm-zip");

const GENERATED_DIR = path.join(process.cwd(), "generated_files");

if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

export interface STLAnalysis {
  fileName: string;
  format: "ascii" | "binary";
  triangleCount: number;
  vertexCount: number;
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  dimensions: { width: number; height: number; depth: number };
  volume: number;
  surfaceArea: number;
  isClosed: boolean;
  centerOfMass: { x: number; y: number; z: number };
}

export interface ThreeMFAnalysis {
  fileName: string;
  modelCount: number;
  triangleCount: number;
  vertexCount: number;
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  dimensions: { width: number; height: number; depth: number };
  unit: string;
  metadata: Record<string, string>;
  thumbnailPresent: boolean;
}

interface Triangle {
  normal: { x: number; y: number; z: number };
  v1: { x: number; y: number; z: number };
  v2: { x: number; y: number; z: number };
  v3: { x: number; y: number; z: number };
}

interface Vertex {
  x: number;
  y: number;
  z: number;
}

function parseSTLAscii(content: string): Triangle[] {
  const triangles: Triangle[] = [];
  const facetRegex = /facet\s+normal\s+([\-\d.e+]+)\s+([\-\d.e+]+)\s+([\-\d.e+]+)\s+outer\s+loop\s+vertex\s+([\-\d.e+]+)\s+([\-\d.e+]+)\s+([\-\d.e+]+)\s+vertex\s+([\-\d.e+]+)\s+([\-\d.e+]+)\s+([\-\d.e+]+)\s+vertex\s+([\-\d.e+]+)\s+([\-\d.e+]+)\s+([\-\d.e+]+)\s+endloop\s+endfacet/gi;

  let match;
  while ((match = facetRegex.exec(content)) !== null) {
    triangles.push({
      normal: { x: parseFloat(match[1]), y: parseFloat(match[2]), z: parseFloat(match[3]) },
      v1: { x: parseFloat(match[4]), y: parseFloat(match[5]), z: parseFloat(match[6]) },
      v2: { x: parseFloat(match[7]), y: parseFloat(match[8]), z: parseFloat(match[9]) },
      v3: { x: parseFloat(match[10]), y: parseFloat(match[11]), z: parseFloat(match[12]) },
    });
  }
  return triangles;
}

function parseSTLBinary(buffer: Buffer): Triangle[] {
  const triangles: Triangle[] = [];
  const triangleCount = buffer.readUInt32LE(80);
  let offset = 84;

  for (let i = 0; i < triangleCount; i++) {
    if (offset + 50 > buffer.length) break;
    triangles.push({
      normal: {
        x: buffer.readFloatLE(offset),
        y: buffer.readFloatLE(offset + 4),
        z: buffer.readFloatLE(offset + 8),
      },
      v1: {
        x: buffer.readFloatLE(offset + 12),
        y: buffer.readFloatLE(offset + 16),
        z: buffer.readFloatLE(offset + 20),
      },
      v2: {
        x: buffer.readFloatLE(offset + 24),
        y: buffer.readFloatLE(offset + 28),
        z: buffer.readFloatLE(offset + 32),
      },
      v3: {
        x: buffer.readFloatLE(offset + 36),
        y: buffer.readFloatLE(offset + 40),
        z: buffer.readFloatLE(offset + 44),
      },
    });
    offset += 50;
  }
  return triangles;
}

function isSTLAscii(buffer: Buffer): boolean {
  const header = buffer.subarray(0, Math.min(80, buffer.length)).toString("ascii").trim();
  return header.toLowerCase().startsWith("solid") && buffer.toString("ascii", 0, 200).includes("facet");
}

function computeTriangleArea(v1: Vertex, v2: Vertex, v3: Vertex): number {
  const ax = v2.x - v1.x, ay = v2.y - v1.y, az = v2.z - v1.z;
  const bx = v3.x - v1.x, by = v3.y - v1.y, bz = v3.z - v1.z;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function computeSignedVolumeOfTriangle(v1: Vertex, v2: Vertex, v3: Vertex): number {
  return (
    (v1.x * (v2.y * v3.z - v3.y * v2.z) -
      v2.x * (v1.y * v3.z - v3.y * v1.z) +
      v3.x * (v1.y * v2.z - v2.y * v1.z)) / 6.0
  );
}

function analyzeTriangles(triangles: Triangle[]): Omit<STLAnalysis, "fileName" | "format"> {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let volume = 0;
  let surfaceArea = 0;
  const center = { x: 0, y: 0, z: 0 };
  const uniqueVertices = new Set<string>();

  for (const tri of triangles) {
    for (const v of [tri.v1, tri.v2, tri.v3]) {
      min.x = Math.min(min.x, v.x);
      min.y = Math.min(min.y, v.y);
      min.z = Math.min(min.z, v.z);
      max.x = Math.max(max.x, v.x);
      max.y = Math.max(max.y, v.y);
      max.z = Math.max(max.z, v.z);
      uniqueVertices.add(`${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`);
    }
    const area = computeTriangleArea(tri.v1, tri.v2, tri.v3);
    surfaceArea += area;
    volume += computeSignedVolumeOfTriangle(tri.v1, tri.v2, tri.v3);

    const cx = (tri.v1.x + tri.v2.x + tri.v3.x) / 3;
    const cy = (tri.v1.y + tri.v2.y + tri.v3.y) / 3;
    const cz = (tri.v1.z + tri.v2.z + tri.v3.z) / 3;
    center.x += cx * area;
    center.y += cy * area;
    center.z += cz * area;
  }

  volume = Math.abs(volume);
  if (surfaceArea > 0) {
    center.x /= surfaceArea;
    center.y /= surfaceArea;
    center.z /= surfaceArea;
  }

  const dimensions = {
    width: max.x - min.x,
    height: max.y - min.y,
    depth: max.z - min.z,
  };

  const edgeMap = new Map<string, number>();
  for (const tri of triangles) {
    const verts = [tri.v1, tri.v2, tri.v3];
    for (let i = 0; i < 3; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 3];
      const key = [
        `${Math.min(a.x, b.x).toFixed(6)},${Math.min(a.y, b.y).toFixed(6)},${Math.min(a.z, b.z).toFixed(6)}`,
        `${Math.max(a.x, b.x).toFixed(6)},${Math.max(a.y, b.y).toFixed(6)},${Math.max(a.z, b.z).toFixed(6)}`,
      ].join("-");
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    }
  }
  let isClosed = true;
  edgeMap.forEach((count) => { if (count !== 2) isClosed = false; });

  return {
    triangleCount: triangles.length,
    vertexCount: uniqueVertices.size,
    boundingBox: { min, max },
    dimensions,
    volume,
    surfaceArea,
    isClosed,
    centerOfMass: center,
  };
}

function trianglesToAsciiSTL(triangles: Triangle[], solidName = "model"): string {
  let stl = `solid ${solidName}\n`;
  for (const tri of triangles) {
    stl += `  facet normal ${tri.normal.x.toExponential(6)} ${tri.normal.y.toExponential(6)} ${tri.normal.z.toExponential(6)}\n`;
    stl += `    outer loop\n`;
    stl += `      vertex ${tri.v1.x.toExponential(6)} ${tri.v1.y.toExponential(6)} ${tri.v1.z.toExponential(6)}\n`;
    stl += `      vertex ${tri.v2.x.toExponential(6)} ${tri.v2.y.toExponential(6)} ${tri.v2.z.toExponential(6)}\n`;
    stl += `      vertex ${tri.v3.x.toExponential(6)} ${tri.v3.y.toExponential(6)} ${tri.v3.z.toExponential(6)}\n`;
    stl += `    endloop\n`;
    stl += `  endfacet\n`;
  }
  stl += `endsolid ${solidName}\n`;
  return stl;
}

function trianglesToBinarySTL(triangles: Triangle[]): Buffer {
  const headerSize = 80;
  const triangleSize = 50;
  const bufferSize = headerSize + 4 + triangles.length * triangleSize;
  const buffer = Buffer.alloc(bufferSize);

  buffer.write("Binary STL generated by Ulysse", 0);
  buffer.writeUInt32LE(triangles.length, 80);

  let offset = 84;
  for (const tri of triangles) {
    buffer.writeFloatLE(tri.normal.x, offset);
    buffer.writeFloatLE(tri.normal.y, offset + 4);
    buffer.writeFloatLE(tri.normal.z, offset + 8);
    buffer.writeFloatLE(tri.v1.x, offset + 12);
    buffer.writeFloatLE(tri.v1.y, offset + 16);
    buffer.writeFloatLE(tri.v1.z, offset + 20);
    buffer.writeFloatLE(tri.v2.x, offset + 24);
    buffer.writeFloatLE(tri.v2.y, offset + 28);
    buffer.writeFloatLE(tri.v2.z, offset + 32);
    buffer.writeFloatLE(tri.v3.x, offset + 36);
    buffer.writeFloatLE(tri.v3.y, offset + 40);
    buffer.writeFloatLE(tri.v3.z, offset + 44);
    buffer.writeUInt16LE(0, offset + 48);
    offset += 50;
  }
  return buffer;
}

function computeNormal(v1: Vertex, v2: Vertex, v3: Vertex): Vertex {
  const ax = v2.x - v1.x, ay = v2.y - v1.y, az = v2.z - v1.z;
  const bx = v3.x - v1.x, by = v3.y - v1.y, bz = v3.z - v1.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

function createBoxTriangles(width: number, height: number, depth: number): Triangle[] {
  const hw = width / 2, hh = height / 2, hd = depth / 2;
  const verts: Vertex[] = [
    { x: -hw, y: -hh, z: -hd }, { x: hw, y: -hh, z: -hd },
    { x: hw, y: hh, z: -hd },  { x: -hw, y: hh, z: -hd },
    { x: -hw, y: -hh, z: hd }, { x: hw, y: -hh, z: hd },
    { x: hw, y: hh, z: hd },   { x: -hw, y: hh, z: hd },
  ];
  const faces = [
    [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7],
    [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7],
  ];
  const triangles: Triangle[] = [];
  for (const f of faces) {
    const v0 = verts[f[0]], v1 = verts[f[1]], v2 = verts[f[2]], v3 = verts[f[3]];
    const n = computeNormal(v0, v1, v2);
    triangles.push({ normal: n, v1: v0, v2: v1, v3: v2 });
    triangles.push({ normal: n, v1: v0, v2: v2, v3: v3 });
  }
  return triangles;
}

function createSphereTriangles(radius: number, segments = 24, rings = 16): Triangle[] {
  const triangles: Triangle[] = [];
  const vertices: Vertex[][] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const phi = (Math.PI * ring) / rings;
    const row: Vertex[] = [];
    for (let seg = 0; seg <= segments; seg++) {
      const theta = (2 * Math.PI * seg) / segments;
      row.push({
        x: radius * Math.sin(phi) * Math.cos(theta),
        y: radius * Math.cos(phi),
        z: radius * Math.sin(phi) * Math.sin(theta),
      });
    }
    vertices.push(row);
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      const v0 = vertices[ring][seg];
      const v1 = vertices[ring][seg + 1];
      const v2 = vertices[ring + 1][seg + 1];
      const v3 = vertices[ring + 1][seg];
      if (ring !== 0) {
        const n = computeNormal(v0, v1, v2);
        triangles.push({ normal: n, v1: v0, v2: v1, v3: v2 });
      }
      if (ring !== rings - 1) {
        const n = computeNormal(v0, v2, v3);
        triangles.push({ normal: n, v1: v0, v2: v2, v3: v3 });
      }
    }
  }
  return triangles;
}

function createCylinderTriangles(radius: number, height: number, segments = 24): Triangle[] {
  const triangles: Triangle[] = [];
  const hh = height / 2;
  const topCenter: Vertex = { x: 0, y: hh, z: 0 };
  const bottomCenter: Vertex = { x: 0, y: -hh, z: 0 };

  for (let i = 0; i < segments; i++) {
    const theta1 = (2 * Math.PI * i) / segments;
    const theta2 = (2 * Math.PI * (i + 1)) / segments;
    const x1 = radius * Math.cos(theta1), z1 = radius * Math.sin(theta1);
    const x2 = radius * Math.cos(theta2), z2 = radius * Math.sin(theta2);
    const top1: Vertex = { x: x1, y: hh, z: z1 };
    const top2: Vertex = { x: x2, y: hh, z: z2 };
    const bot1: Vertex = { x: x1, y: -hh, z: z1 };
    const bot2: Vertex = { x: x2, y: -hh, z: z2 };

    const sn = computeNormal(bot1, bot2, top2);
    triangles.push({ normal: sn, v1: bot1, v2: bot2, v3: top2 });
    triangles.push({ normal: sn, v1: bot1, v2: top2, v3: top1 });

    const tn: Vertex = { x: 0, y: 1, z: 0 };
    triangles.push({ normal: tn, v1: topCenter, v2: top1, v3: top2 });
    const bn: Vertex = { x: 0, y: -1, z: 0 };
    triangles.push({ normal: bn, v1: bottomCenter, v2: bot2, v3: bot1 });
  }
  return triangles;
}

function createPyramidTriangles(base: number, height: number): Triangle[] {
  const hb = base / 2;
  const apex: Vertex = { x: 0, y: height, z: 0 };
  const v0: Vertex = { x: -hb, y: 0, z: -hb };
  const v1: Vertex = { x: hb, y: 0, z: -hb };
  const v2: Vertex = { x: hb, y: 0, z: hb };
  const v3: Vertex = { x: -hb, y: 0, z: hb };
  const triangles: Triangle[] = [];

  const faces: [Vertex, Vertex, Vertex][] = [
    [v0, v1, apex], [v1, v2, apex], [v2, v3, apex], [v3, v0, apex],
    [v0, v2, v1], [v0, v3, v2],
  ];
  for (const [a, b, c] of faces) {
    triangles.push({ normal: computeNormal(a, b, c), v1: a, v2: b, v3: c });
  }
  return triangles;
}

function createTorusTriangles(majorRadius: number, minorRadius: number, majorSeg = 24, minorSeg = 12): Triangle[] {
  const triangles: Triangle[] = [];
  const vertices: Vertex[][] = [];
  for (let i = 0; i <= majorSeg; i++) {
    const theta = (2 * Math.PI * i) / majorSeg;
    const row: Vertex[] = [];
    for (let j = 0; j <= minorSeg; j++) {
      const phi = (2 * Math.PI * j) / minorSeg;
      row.push({
        x: (majorRadius + minorRadius * Math.cos(phi)) * Math.cos(theta),
        y: minorRadius * Math.sin(phi),
        z: (majorRadius + minorRadius * Math.cos(phi)) * Math.sin(theta),
      });
    }
    vertices.push(row);
  }
  for (let i = 0; i < majorSeg; i++) {
    for (let j = 0; j < minorSeg; j++) {
      const v0 = vertices[i][j], v1 = vertices[i + 1][j];
      const v2 = vertices[i + 1][j + 1], v3 = vertices[i][j + 1];
      triangles.push({ normal: computeNormal(v0, v1, v2), v1: v0, v2: v1, v3: v2 });
      triangles.push({ normal: computeNormal(v0, v2, v3), v1: v0, v2: v2, v3: v3 });
    }
  }
  return triangles;
}

function scaleTriangles(triangles: Triangle[], sx: number, sy: number, sz: number): Triangle[] {
  return triangles.map((tri) => ({
    normal: computeNormal(
      { x: tri.v1.x * sx, y: tri.v1.y * sy, z: tri.v1.z * sz },
      { x: tri.v2.x * sx, y: tri.v2.y * sy, z: tri.v2.z * sz },
      { x: tri.v3.x * sx, y: tri.v3.y * sy, z: tri.v3.z * sz }
    ),
    v1: { x: tri.v1.x * sx, y: tri.v1.y * sy, z: tri.v1.z * sz },
    v2: { x: tri.v2.x * sx, y: tri.v2.y * sy, z: tri.v2.z * sz },
    v3: { x: tri.v3.x * sx, y: tri.v3.y * sy, z: tri.v3.z * sz },
  }));
}

function translateTriangles(triangles: Triangle[], tx: number, ty: number, tz: number): Triangle[] {
  return triangles.map((tri) => ({
    normal: tri.normal,
    v1: { x: tri.v1.x + tx, y: tri.v1.y + ty, z: tri.v1.z + tz },
    v2: { x: tri.v2.x + tx, y: tri.v2.y + ty, z: tri.v2.z + tz },
    v3: { x: tri.v3.x + tx, y: tri.v3.y + ty, z: tri.v3.z + tz },
  }));
}

function rotateTrianglesY(triangles: Triangle[], angleDeg: number): Triangle[] {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rotV = (v: Vertex): Vertex => ({
    x: v.x * cos + v.z * sin,
    y: v.y,
    z: -v.x * sin + v.z * cos,
  });
  return triangles.map((tri) => {
    const rv1 = rotV(tri.v1), rv2 = rotV(tri.v2), rv3 = rotV(tri.v3);
    return { normal: computeNormal(rv1, rv2, rv3), v1: rv1, v2: rv2, v3: rv3 };
  });
}

function mergeTriangles(...groups: Triangle[][]): Triangle[] {
  return groups.flat();
}

function parse3MF(filePath: string): ThreeMFAnalysis {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const analysis: ThreeMFAnalysis = {
    fileName: path.basename(filePath),
    modelCount: 0,
    triangleCount: 0,
    vertexCount: 0,
    boundingBox: { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } },
    dimensions: { width: 0, height: 0, depth: 0 },
    unit: "millimeter",
    metadata: {},
    thumbnailPresent: false,
  };

  for (const entry of entries) {
    if (entry.entryName.toLowerCase().includes("thumbnail")) {
      analysis.thumbnailPresent = true;
    }

    if (entry.entryName.endsWith(".model") || entry.entryName.endsWith(".xml")) {
      const content = entry.getData().toString("utf-8");

      const unitMatch = content.match(/unit="(\w+)"/);
      if (unitMatch) analysis.unit = unitMatch[1];

      const metaRegex = /<metadata\s+name="([^"]+)"[^>]*>([^<]*)<\/metadata>/gi;
      let metaMatch;
      while ((metaMatch = metaRegex.exec(content)) !== null) {
        analysis.metadata[metaMatch[1]] = metaMatch[2];
      }

      const vertexRegex = /<vertex\s+x="([\-\d.e+]+)"\s+y="([\-\d.e+]+)"\s+z="([\-\d.e+]+)"/gi;
      let vMatch;
      while ((vMatch = vertexRegex.exec(content)) !== null) {
        analysis.vertexCount++;
        const x = parseFloat(vMatch[1]), y = parseFloat(vMatch[2]), z = parseFloat(vMatch[3]);
        analysis.boundingBox.min.x = Math.min(analysis.boundingBox.min.x, x);
        analysis.boundingBox.min.y = Math.min(analysis.boundingBox.min.y, y);
        analysis.boundingBox.min.z = Math.min(analysis.boundingBox.min.z, z);
        analysis.boundingBox.max.x = Math.max(analysis.boundingBox.max.x, x);
        analysis.boundingBox.max.y = Math.max(analysis.boundingBox.max.y, y);
        analysis.boundingBox.max.z = Math.max(analysis.boundingBox.max.z, z);
      }

      const triRegex = /<triangle/gi;
      let triMatch;
      while ((triMatch = triRegex.exec(content)) !== null) {
        analysis.triangleCount++;
      }

      const objectRegex = /<object/gi;
      let objMatch;
      while ((objMatch = objectRegex.exec(content)) !== null) {
        analysis.modelCount++;
      }
    }
  }

  if (analysis.vertexCount > 0) {
    analysis.dimensions = {
      width: analysis.boundingBox.max.x - analysis.boundingBox.min.x,
      height: analysis.boundingBox.max.y - analysis.boundingBox.min.y,
      depth: analysis.boundingBox.max.z - analysis.boundingBox.min.z,
    };
  }

  return analysis;
}

function trianglesTo3MF(triangles: Triangle[], solidName = "model"): Buffer {
  const vertices: Vertex[] = [];
  const vertexMap = new Map<string, number>();
  const triIndices: [number, number, number][] = [];

  for (const tri of triangles) {
    const indices: number[] = [];
    for (const v of [tri.v1, tri.v2, tri.v3]) {
      const key = `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
      if (!vertexMap.has(key)) {
        vertexMap.set(key, vertices.length);
        vertices.push(v);
      }
      indices.push(vertexMap.get(key)!);
    }
    triIndices.push([indices[0], indices[1], indices[2]]);
  }

  const verticesXML = vertices
    .map((v) => `          <vertex x="${v.x}" y="${v.y}" z="${v.z}" />`)
    .join("\n");
  const trianglesXML = triIndices
    .map((t) => `          <triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" />`)
    .join("\n");

  const modelXML = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Ulysse 3D</metadata>
  <metadata name="Title">${solidName}</metadata>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${verticesXML}
        </vertices>
        <triangles>
${trianglesXML}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
</Types>`));
  zip.addFile("_rels/.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`));
  zip.addFile("3D/3dmodel.model", Buffer.from(modelXML));

  return zip.toBuffer();
}

export class STL3MFService {
  analyzeSTL(filePath: string): STLAnalysis {
    const buffer = fs.readFileSync(filePath);
    const ascii = isSTLAscii(buffer);
    const triangles = ascii ? parseSTLAscii(buffer.toString("utf-8")) : parseSTLBinary(buffer);
    return {
      fileName: path.basename(filePath),
      format: ascii ? "ascii" : "binary",
      ...analyzeTriangles(triangles),
    };
  }

  analyze3MF(filePath: string): ThreeMFAnalysis {
    return parse3MF(filePath);
  }

  analyzeFile(filePath: string): STLAnalysis | ThreeMFAnalysis {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".stl") return this.analyzeSTL(filePath);
    if (ext === ".3mf") return this.analyze3MF(filePath);
    throw new Error(`Format non supporté: ${ext}. Formats acceptés: .stl, .3mf`);
  }

  generateSTL(options: {
    shape: "box" | "sphere" | "cylinder" | "pyramid" | "torus" | "custom";
    dimensions?: Record<string, number>;
    format?: "ascii" | "binary";
    fileName?: string;
    triangles?: Triangle[];
  }): { fileName: string; filePath: string; fileType: string; size: number; downloadUrl: string; analysis: ReturnType<typeof analyzeTriangles> } {
    let triangles: Triangle[];

    switch (options.shape) {
      case "box":
        triangles = createBoxTriangles(
          options.dimensions?.width || 10,
          options.dimensions?.height || 10,
          options.dimensions?.depth || 10
        );
        break;
      case "sphere":
        triangles = createSphereTriangles(
          options.dimensions?.radius || 5,
          options.dimensions?.segments || 32,
          options.dimensions?.rings || 24
        );
        break;
      case "cylinder":
        triangles = createCylinderTriangles(
          options.dimensions?.radius || 5,
          options.dimensions?.height || 10,
          options.dimensions?.segments || 32
        );
        break;
      case "pyramid":
        triangles = createPyramidTriangles(
          options.dimensions?.base || 10,
          options.dimensions?.height || 10
        );
        break;
      case "torus":
        triangles = createTorusTriangles(
          options.dimensions?.majorRadius || 5,
          options.dimensions?.minorRadius || 2,
          options.dimensions?.majorSegments || 32,
          options.dimensions?.minorSegments || 16
        );
        break;
      case "custom":
        triangles = options.triangles || [];
        if (triangles.length === 0) throw new Error("Triangles requis pour forme custom");
        break;
      default:
        throw new Error(`Forme inconnue: ${options.shape}`);
    }

    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const baseName = options.fileName || `${options.shape}_${timestamp}`;
    const fileName = `${baseName}.stl`;
    const filePath = path.join(GENERATED_DIR, fileName);

    if (options.format === "binary") {
      fs.writeFileSync(filePath, trianglesToBinarySTL(triangles));
    } else {
      fs.writeFileSync(filePath, trianglesToAsciiSTL(triangles, baseName));
    }

    const stats = fs.statSync(filePath);
    return {
      fileName,
      filePath,
      fileType: "stl",
      size: stats.size,
      downloadUrl: `/api/files/generated/${fileName}`,
      analysis: analyzeTriangles(triangles),
    };
  }

  generate3MF(options: {
    shape: "box" | "sphere" | "cylinder" | "pyramid" | "torus" | "custom";
    dimensions?: Record<string, number>;
    fileName?: string;
    triangles?: Triangle[];
  }): { fileName: string; filePath: string; fileType: string; size: number; downloadUrl: string } {
    let triangles: Triangle[];

    switch (options.shape) {
      case "box":
        triangles = createBoxTriangles(
          options.dimensions?.width || 10,
          options.dimensions?.height || 10,
          options.dimensions?.depth || 10
        );
        break;
      case "sphere":
        triangles = createSphereTriangles(options.dimensions?.radius || 5);
        break;
      case "cylinder":
        triangles = createCylinderTriangles(
          options.dimensions?.radius || 5,
          options.dimensions?.height || 10
        );
        break;
      case "pyramid":
        triangles = createPyramidTriangles(
          options.dimensions?.base || 10,
          options.dimensions?.height || 10
        );
        break;
      case "torus":
        triangles = createTorusTriangles(
          options.dimensions?.majorRadius || 5,
          options.dimensions?.minorRadius || 2
        );
        break;
      case "custom":
        triangles = options.triangles || [];
        if (triangles.length === 0) throw new Error("Triangles requis pour forme custom");
        break;
      default:
        throw new Error(`Forme inconnue: ${options.shape}`);
    }

    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const baseName = options.fileName || `${options.shape}_3mf_${timestamp}`;
    const fileName = `${baseName}.3mf`;
    const filePath = path.join(GENERATED_DIR, fileName);

    fs.writeFileSync(filePath, trianglesTo3MF(triangles, baseName));

    const stats = fs.statSync(filePath);
    return {
      fileName,
      filePath,
      fileType: "3mf",
      size: stats.size,
      downloadUrl: `/api/files/generated/${fileName}`,
    };
  }

  editSTL(filePath: string, operations: Array<{
    type: "scale" | "translate" | "rotate" | "merge";
    params: Record<string, number>;
    mergeFilePath?: string;
  }>): { fileName: string; filePath: string; analysis: ReturnType<typeof analyzeTriangles> } {
    const buffer = fs.readFileSync(filePath);
    const ascii = isSTLAscii(buffer);
    let triangles = ascii ? parseSTLAscii(buffer.toString("utf-8")) : parseSTLBinary(buffer);

    for (const op of operations) {
      switch (op.type) {
        case "scale":
          triangles = scaleTriangles(triangles, op.params.x || 1, op.params.y || 1, op.params.z || 1);
          break;
        case "translate":
          triangles = translateTriangles(triangles, op.params.x || 0, op.params.y || 0, op.params.z || 0);
          break;
        case "rotate":
          triangles = rotateTrianglesY(triangles, op.params.angle || 0);
          break;
        case "merge":
          if (op.mergeFilePath) {
            const buf2 = fs.readFileSync(op.mergeFilePath);
            const tris2 = isSTLAscii(buf2) ? parseSTLAscii(buf2.toString("utf-8")) : parseSTLBinary(buf2);
            triangles = mergeTriangles(triangles, tris2);
          }
          break;
      }
    }

    const baseName = path.basename(filePath, path.extname(filePath));
    const outputName = `${baseName}_edited_${Date.now().toString(36)}.stl`;
    const outputPath = path.join(GENERATED_DIR, outputName);

    fs.writeFileSync(outputPath, trianglesToBinarySTL(triangles));

    return {
      fileName: outputName,
      filePath: outputPath,
      analysis: analyzeTriangles(triangles),
    };
  }

  convertSTLto3MF(stlPath: string, outputName?: string): { fileName: string; filePath: string } {
    const buffer = fs.readFileSync(stlPath);
    const triangles = isSTLAscii(buffer) ? parseSTLAscii(buffer.toString("utf-8")) : parseSTLBinary(buffer);

    const baseName = outputName || path.basename(stlPath, ".stl");
    const fileName = `${baseName}.3mf`;
    const filePath = path.join(GENERATED_DIR, fileName);

    fs.writeFileSync(filePath, trianglesTo3MF(triangles, baseName));
    return { fileName, filePath };
  }

  convert3MFtoSTL(threeMFPath: string, outputName?: string): { fileName: string; filePath: string } {
    const zip = new AdmZip(threeMFPath);
    const modelEntry = zip.getEntries().find(
      (e) => e.entryName.endsWith(".model") || (e.entryName.includes("3D") && e.entryName.endsWith(".xml"))
    );
    if (!modelEntry) throw new Error("Aucun modèle 3D trouvé dans le fichier 3MF");

    const content = modelEntry.getData().toString("utf-8");
    const vertices: Vertex[] = [];
    const vertexRegex = /<vertex\s+x="([\-\d.e+]+)"\s+y="([\-\d.e+]+)"\s+z="([\-\d.e+]+)"/gi;
    let vMatch;
    while ((vMatch = vertexRegex.exec(content)) !== null) {
      vertices.push({ x: parseFloat(vMatch[1]), y: parseFloat(vMatch[2]), z: parseFloat(vMatch[3]) });
    }

    const triangles: Triangle[] = [];
    const triRegex = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/gi;
    let tMatch;
    while ((tMatch = triRegex.exec(content)) !== null) {
      const i1 = parseInt(tMatch[1]), i2 = parseInt(tMatch[2]), i3 = parseInt(tMatch[3]);
      if (i1 < vertices.length && i2 < vertices.length && i3 < vertices.length) {
        const v1 = vertices[i1], v2 = vertices[i2], v3 = vertices[i3];
        triangles.push({ normal: computeNormal(v1, v2, v3), v1, v2, v3 });
      }
    }

    const baseName = outputName || path.basename(threeMFPath, ".3mf");
    const fileName = `${baseName}.stl`;
    const filePath = path.join(GENERATED_DIR, fileName);

    fs.writeFileSync(filePath, trianglesToBinarySTL(triangles));
    return { fileName, filePath };
  }

  formatAnalysisForAI(analysis: STLAnalysis | ThreeMFAnalysis): string {
    if ("format" in analysis) {
      const a = analysis as STLAnalysis;
      return `### Analyse STL: ${a.fileName}
- Format: ${a.format}
- Triangles: ${a.triangleCount.toLocaleString()}
- Sommets uniques: ${a.vertexCount.toLocaleString()}
- Dimensions: ${a.dimensions.width.toFixed(2)} x ${a.dimensions.height.toFixed(2)} x ${a.dimensions.depth.toFixed(2)} mm
- Volume: ${a.volume.toFixed(2)} mm³
- Surface: ${a.surfaceArea.toFixed(2)} mm²
- Maillage fermé: ${a.isClosed ? "Oui ✅" : "Non ⚠️ (fuites détectées)"}
- Bounding box: [${a.boundingBox.min.x.toFixed(2)}, ${a.boundingBox.min.y.toFixed(2)}, ${a.boundingBox.min.z.toFixed(2)}] → [${a.boundingBox.max.x.toFixed(2)}, ${a.boundingBox.max.y.toFixed(2)}, ${a.boundingBox.max.z.toFixed(2)}]
- Centre de masse: (${a.centerOfMass.x.toFixed(2)}, ${a.centerOfMass.y.toFixed(2)}, ${a.centerOfMass.z.toFixed(2)})`;
    } else {
      const a = analysis as ThreeMFAnalysis;
      return `### Analyse 3MF: ${a.fileName}
- Objets 3D: ${a.modelCount}
- Triangles: ${a.triangleCount.toLocaleString()}
- Sommets: ${a.vertexCount.toLocaleString()}
- Unité: ${a.unit}
- Dimensions: ${a.dimensions.width.toFixed(2)} x ${a.dimensions.height.toFixed(2)} x ${a.dimensions.depth.toFixed(2)}
- Miniature: ${a.thumbnailPresent ? "Présente" : "Absente"}
- Métadonnées: ${Object.entries(a.metadata).map(([k, v]) => `${k}=${v}`).join(", ") || "Aucune"}`;
    }
  }
}

export const stl3mfService = new STL3MFService();
