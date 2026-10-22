import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDirectory = path.join(root, "chrome-extension");
const outputDirectory = path.join(root, "dist");
const outputPath = path.join(outputDirectory, "textai-chrome-extension.zip");
const files = [
  "manifest.json",
  "config.js",
  "service-worker.js",
  "content.js",
  "math.js",
  "popup.html",
  "popup.css",
  "popup.js",
];

const [configSource, manifestSource] = await Promise.all([
  fs.readFile(path.join(extensionDirectory, "config.js"), "utf8"),
  fs.readFile(path.join(extensionDirectory, "manifest.json"), "utf8"),
]);
const apiUrlMatch = configSource.match(/apiBaseUrl\s*:\s*["']([^"']+)["']/);
if (!apiUrlMatch) throw new Error("Set apiBaseUrl in chrome-extension/config.js before packaging.");
const apiUrl = new URL(apiUrlMatch[1]);
const isExampleHost = ["example.com", "example.net", "example.org"].some(
  (domain) => apiUrl.hostname === domain || apiUrl.hostname.endsWith(`.${domain}`),
);
if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash || isExampleHost) {
  throw new Error("Store builds require a real HTTPS API origin (no path, query, or example.com placeholder).");
}
const manifest = JSON.parse(manifestSource);
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify([`${apiUrl.origin}/*`])) {
  throw new Error(`Set manifest host_permissions to only ["${apiUrl.origin}/*"] before packaging.`);
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntry(fileName, content, localOffset) {
  const name = Buffer.from(fileName, "utf8");
  const checksum = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6); // UTF-8 filenames are ASCII in this package.
  local.writeUInt16LE(0, 8); // Stored, not compressed.
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0x21, 12); // DOS date 1980-01-01.
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(localOffset, 42);

  return {
    localParts: [local, name, content],
    centralParts: [central, name],
    localSize: local.length + name.length + content.length,
    centralSize: central.length + name.length,
  };
}

const localParts = [];
const centralParts = [];
let localOffset = 0;
let centralSize = 0;
for (const fileName of files) {
  const content = await fs.readFile(path.join(extensionDirectory, fileName));
  const entry = zipEntry(fileName, content, localOffset);
  localParts.push(...entry.localParts);
  centralParts.push(...entry.centralParts);
  localOffset += entry.localSize;
  centralSize += entry.centralSize;
}

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(localOffset, 16);
end.writeUInt16LE(0, 20);

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(outputPath, Buffer.concat([...localParts, ...centralParts, end]));
console.log(`Created ${outputPath}`);
