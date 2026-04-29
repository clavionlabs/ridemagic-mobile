const {
  withAppBuildGradle,
  withAndroidManifest,
  withDangerousMod,
  withXcodeProject,
  withInfoPlist,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withNavigationSDK(config) {
  // ─── Android: build.gradle (desugaring + maps exclude) ──
  config = withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;

    // Enable core library desugaring - add to compileOptions
    if (!buildGradle.includes("coreLibraryDesugaringEnabled")) {
      if (buildGradle.includes("compileOptions {")) {
        buildGradle = buildGradle.replace(
          "compileOptions {",
          "compileOptions {\n        coreLibraryDesugaringEnabled true"
        );
      } else {
        buildGradle = buildGradle.replace(
          "android {",
          "android {\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n        sourceCompatibility JavaVersion.VERSION_1_8\n        targetCompatibility JavaVersion.VERSION_1_8\n    }"
        );
      }
    }

    // Exclude play-services-maps from react-native-maps (Navigation SDK bundles its own)
    if (!buildGradle.includes("exclude group: 'com.google.android.gms', module: 'play-services-maps'")) {
      buildGradle = buildGradle.replace(
        /implementation project\(['"]:react-native-maps['"]\)/,
        `implementation(project(":react-native-maps")) {\n        exclude group: 'com.google.android.gms', module: 'play-services-maps'\n    }`
      );
    }

    // Add desugaring dependency
    if (!buildGradle.includes("desugar_jdk_libs")) {
      if (buildGradle.includes("dependencies {")) {
        buildGradle = buildGradle.replace(
          "dependencies {",
          'dependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs_nio:2.1.4"'
        );
      } else {
        buildGradle += '\ndependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs_nio:2.1.4"\n}\n';
      }
    }

    config.modResults.contents = buildGradle;
    return config;
  });

  // ─── Android: AndroidManifest.xml (Maps API key meta-data) ──
  config = withAndroidManifest(config, (config) => {
    const mainApp = config.modResults.manifest.application?.[0];
    if (mainApp) {
      if (!mainApp["meta-data"]) mainApp["meta-data"] = [];

      const hasNavKey = mainApp["meta-data"].some(
        (m) => m?.$?.["android:name"] === "com.google.android.geo.API_KEY"
      );
      if (!hasNavKey) {
        mainApp["meta-data"].push({
          $: {
            "android:name": "com.google.android.geo.API_KEY",
            "android:value": "AIzaSyDwdyLAWuYc6WacRQpgtPI06wxXLofg3VI",
          },
        });
      }
    }

    return config;
  });

  // ─── Android: copy marker PNGs to assets/markers/ ──
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const assetsDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
        "markers"
      );
      fs.mkdirSync(assetsDir, { recursive: true });

      const markersSource = path.join(projectRoot, "assets", "markers");
      if (fs.existsSync(markersSource)) {
        const files = fs.readdirSync(markersSource).filter((f) => f.endsWith(".png"));
        for (const file of files) {
          fs.copyFileSync(
            path.join(markersSource, file),
            path.join(assetsDir, file)
          );
        }
      }

      return config;
    },
  ]);

  // ─── iOS: copy marker PNGs into the iOS app folder ──
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const iosRoot = config.modRequest.platformProjectRoot;
      // App folder name is typically the project name
      const appName = (config.modRequest.projectName || config.name || "RideMagic").replace(/\s+/g, "");
      const markersDest = path.join(iosRoot, appName, "markers");
      fs.mkdirSync(markersDest, { recursive: true });

      const markersSource = path.join(projectRoot, "assets", "markers");
      if (fs.existsSync(markersSource)) {
        const files = fs.readdirSync(markersSource).filter((f) => f.endsWith(".png"));
        for (const file of files) {
          fs.copyFileSync(
            path.join(markersSource, file),
            path.join(markersDest, file)
          );
        }
      }

      return config;
    },
  ]);

  // ─── iOS: register the markers folder as a bundle resource in the Xcode project ──
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const appName = (config.modRequest.projectName || config.name || "RideMagic").replace(/\s+/g, "");
    const folderName = "markers";

    // Check if already added (avoid duplicates on re-prebuild)
    const allFiles = xcodeProject.pbxFileReferenceSection();
    const alreadyAdded = Object.values(allFiles).some(
      (entry) => entry && entry.path && String(entry.path).replace(/"/g, "") === folderName
    );
    if (alreadyAdded) return config;

    try {
      // Add as a folder reference (blue folder) so the entire markers/ dir
      // ships in the bundle. addResourceFile + lastKnownFileType=folder is
      // the standard way to add a folder reference via the xcode npm pkg.
      xcodeProject.addResourceFile(
        `${appName}/${folderName}`,
        { target: xcodeProject.getFirstTarget().uuid, lastKnownFileType: "folder" },
        xcodeProject.getFirstProject().firstProject.mainGroup
      );
    } catch (e) {
      console.warn("[nav-sdk-plugin] iOS marker bundling failed:", e?.message);
    }

    return config;
  });

  // ─── iOS: ensure Maps API key is in Info.plist ──
  // (expo handles this automatically via ios.config.googleMapsApiKey, but
  // we set it explicitly here as a belt-and-suspenders measure.)
  config = withInfoPlist(config, (config) => {
    if (!config.modResults.GMSApiKey) {
      config.modResults.GMSApiKey = "AIzaSyDwdyLAWuYc6WacRQpgtPI06wxXLofg3VI";
    }
    return config;
  });

  return config;
}

module.exports = withNavigationSDK;
