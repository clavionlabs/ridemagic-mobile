import { View, Text, StyleSheet } from "react-native";

/**
 * Icon components that mirror the web app's stroke-based SVG icons.
 * Built with pure RN primitives (no react-native-svg dependency).
 * The icons are drawn as composed Views with borders to approximate line-style icons.
 */

type IconProps = { color: string; size?: number };

// Home — house outline
export function HomeIcon({ color, size = 22 }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Roof triangle — drawn via borders */}
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.5,
          borderRightWidth: size * 0.5,
          borderBottomWidth: size * 0.45,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
          marginBottom: -1,
        }}
      />
      {/* Body */}
      <View
        style={{
          width: size * 0.75,
          height: size * 0.4,
          borderWidth: 1.5,
          borderColor: color,
          borderTopWidth: 0,
        }}
      >
        {/* Door */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: "50%",
            marginLeft: -size * 0.1,
            width: size * 0.2,
            height: size * 0.25,
            borderLeftWidth: 1.5,
            borderRightWidth: 1.5,
            borderTopWidth: 1.5,
            borderColor: color,
          }}
        />
      </View>
    </View>
  );
}

// Routes / Map — pin on a map
export function RoutesIcon({ color, size = 22 }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Outer pin bubble */}
      <View
        style={{
          width: size * 0.7,
          height: size * 0.7,
          borderRadius: size * 0.35,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Inner dot */}
        <View
          style={{
            width: size * 0.22,
            height: size * 0.22,
            borderRadius: size * 0.11,
            backgroundColor: color,
          }}
        />
      </View>
      {/* Tail */}
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.12,
          borderRightWidth: size * 0.12,
          borderTopWidth: size * 0.2,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
          marginTop: -2,
        }}
      />
    </View>
  );
}

// Tours / Audio — headphones (arc on top of two earcups)
export function ToursIcon({ color, size = 22 }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Headband — semi-circle via a rounded top border */}
      <View
        style={{
          width: size * 0.85,
          height: size * 0.55,
          borderTopLeftRadius: size * 0.425,
          borderTopRightRadius: size * 0.425,
          borderWidth: 1.5,
          borderColor: color,
          borderBottomWidth: 0,
          marginBottom: -size * 0.1,
        }}
      />
      {/* Earcups */}
      <View
        style={{
          flexDirection: "row",
          width: size * 0.85,
          justifyContent: "space-between",
        }}
      >
        <View
          style={{
            width: size * 0.2,
            height: size * 0.3,
            borderRadius: size * 0.05,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            width: size * 0.2,
            height: size * 0.3,
            borderRadius: size * 0.05,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

// Account — user avatar (head + shoulders)
export function AccountIcon({ color, size = 22 }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Head */}
      <View
        style={{
          width: size * 0.4,
          height: size * 0.4,
          borderRadius: size * 0.2,
          borderWidth: 1.5,
          borderColor: color,
          marginBottom: 2,
        }}
      />
      {/* Shoulders — wide rounded top */}
      <View
        style={{
          width: size * 0.85,
          height: size * 0.35,
          borderTopLeftRadius: size * 0.425,
          borderTopRightRadius: size * 0.425,
          borderWidth: 1.5,
          borderColor: color,
          borderBottomWidth: 0,
        }}
      />
    </View>
  );
}

// Hamburger menu icon — three horizontal lines
export function MenuIcon({ color, size = 22 }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: size * 0.85,
            height: 2,
            backgroundColor: color,
            borderRadius: 1,
            marginVertical: 2.5,
          }}
        />
      ))}
    </View>
  );
}

// Placeholder text icon (fallback)
export function TextIcon({ char, color, size = 22 }: { char: string; color: string; size?: number }) {
  return <Text style={[styles.textIcon, { color, fontSize: size - 4 }]}>{char}</Text>;
}

const styles = StyleSheet.create({
  textIcon: { textAlign: "center", fontWeight: "600" },
});
