// Marker paths relative to Android assets/ folder.
// The navigation-sdk-plugin copies these PNGs from assets/markers/ into
// android/app/src/main/assets/markers/ at prebuild time. Google's
// BitmapDescriptorFactory.fromAsset() then reads them by relative path.
export function getMarkerPaths() {
  return {
    poiBlue: "markers/poi-blue.png",
    poiGreen: "markers/poi-green.png",
    poiPurple: "markers/poi-purple.png",
    origin: "markers/origin.png",
    destination: "markers/destination.png",
    userArrow: "markers/user-arrow.png",
  };
}
