// Google Maps JSON styles matching the RideMagic brand palette
// Reference: ridemagic_vercel/src/app/style-guide/sections/14-MapStyling.tsx

export const lightMapStyle = [
  // Warm, desaturated base
  { featureType: "all", elementType: "geometry", stylers: [{ saturation: -40 }] },
  { featureType: "all", elementType: "labels.text.fill", stylers: [{ color: "#3A3530" }] },
  // Cream landscape
  { featureType: "landscape", elementType: "geometry.fill", stylers: [{ color: "#EDE9E0" }] },
  // Light blue water
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#D4E8F5" }] },
  // Warm white roads
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#FEFDFB" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#E5DFD5" }] },
  // Soft green parks
  { featureType: "poi.park", elementType: "geometry.fill", stylers: [{ color: "#E2EDD8" }] },
  // Hide POI and transit labels
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
];

export const darkMapStyle = [
  // Near Black base (#1A1816)
  { elementType: "geometry", stylers: [{ color: "#1A1816" }] },
  // Warm gray text
  { elementType: "labels.text.fill", stylers: [{ color: "#8A8580" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1A1816" }] },
  // Charcoal roads (#3A3530)
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#3A3530" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#2D2926" }] },
  // Dark surface for landscape
  { featureType: "landscape", elementType: "geometry.fill", stylers: [{ color: "#252220" }] },
  // Dark water
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1416" }] },
  // Subtle parks
  { featureType: "poi.park", elementType: "geometry.fill", stylers: [{ color: "#1e2a1e" }] },
  // Hide POI and transit labels
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
];
