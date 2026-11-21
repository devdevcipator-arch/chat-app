// Small source fixes to native dependencies, applied after every install
// (package.json "postinstall"). Idempotent: re-running changes nothing, and a
// dependency update that already contains the fix is left untouched.
//
// react-native-agora 4.6.4 (iOS): AgoraRtcSurfaceViewManager.mm includes
// "RCTBridge.h" in the old flat-header style. React Native 0.88 ships React
// Core prebuilt, so only framework-style imports resolve and the iOS build
// fails with `'RCTBridge.h' file not found`. The same file already imports
// <React/RCTUIManager.h> the framework way; this does the same for RCTBridge.
const fs = require("node:fs");
const path = require("node:path");

const patches = [
  {
    file: "node_modules/react-native-agora/ios/AgoraRtcSurfaceViewManager.mm",
    from: '#import "RCTBridge.h"',
    to: "#import <React/RCTBridge.h>",
  },
];

for (const { file, from, to } of patches) {
  const full = path.join(__dirname, "..", file);
  if (!fs.existsSync(full)) {
    console.log(`[patch-native-modules] skip (not installed): ${file}`);
    continue;
  }
  const source = fs.readFileSync(full, "utf8");
  if (!source.includes(from)) {
    console.log(`[patch-native-modules] ok (already fixed): ${file}`);
    continue;
  }
  fs.writeFileSync(full, source.split(from).join(to));
  console.log(`[patch-native-modules] patched: ${file}`);
}
