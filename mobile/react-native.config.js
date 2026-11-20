// Firebase + Notifee native code is linked only when push is configured
// (a google-services.json / GoogleService-Info.plist exists at build time,
// see app.config.ts). Otherwise it is left out of the binary entirely.
const fs = require("node:fs");
const path = require("node:path");

const pushAndroid = fs.existsSync(path.join(__dirname, "google-services.json"));
const pushIos = fs.existsSync(path.join(__dirname, "GoogleService-Info.plist"));

const platforms = { ...(pushAndroid ? {} : { android: null }), ...(pushIos ? {} : { ios: null }) };
const unlinked = Object.keys(platforms).length ? { platforms } : undefined;

module.exports = {
  dependencies: unlinked
    ? {
        "@react-native-firebase/app": unlinked,
        "@react-native-firebase/messaging": unlinked,
        "@notifee/react-native": unlinked,
      }
    : {},
};
