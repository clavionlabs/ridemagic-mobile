const { withAppBuildGradle, withAndroidManifest } = require("expo/config-plugins");

function withNavigationSDK(config) {
  config = withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;

    // Enable core library desugaring - add to compileOptions
    // Try multiple patterns since Expo generates different formats
    if (!buildGradle.includes("coreLibraryDesugaringEnabled")) {
      // Pattern 1: compileOptions { already exists
      if (buildGradle.includes("compileOptions {")) {
        buildGradle = buildGradle.replace(
          "compileOptions {",
          "compileOptions {\n        coreLibraryDesugaringEnabled true"
        );
      } else {
        // Pattern 2: inject compileOptions inside android {}
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
      // Try to find dependencies block
      if (buildGradle.includes("dependencies {")) {
        buildGradle = buildGradle.replace(
          "dependencies {",
          'dependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs_nio:2.1.4"'
        );
      } else {
        // Append dependencies block at the end
        buildGradle += '\ndependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs_nio:2.1.4"\n}\n';
      }
    }

    config.modResults.contents = buildGradle;
    return config;
  });

  // Add metadata to AndroidManifest
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

  return config;
}

module.exports = withNavigationSDK;
