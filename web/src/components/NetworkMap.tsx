// Static map of the Halcyon warehouse network for the sign-in page: a dotted US outline, the warehouses and sample
// lanes to customer cities. Same projection as the portal's live map.
import { DATASET_WAREHOUSES, type LatLng, type MapWarehouse } from "@/lib/warehouses";

const MW = 640;
const MH = 360;

const DESTINATIONS: { region: string; at: LatLng }[] = [
  { region: "West", at: [44.05, -123.09] }, // Eugene
  { region: "West", at: [39.74, -104.99] }, // Denver
  { region: "Midwest", at: [42.96, -85.67] }, // Grand Rapids
  { region: "Midwest", at: [41.88, -87.63] }, // Chicago
  { region: "Midwest", at: [39.1, -94.58] }, // Kansas City
  { region: "Southeast", at: [33.75, -84.39] }, // Atlanta
  { region: "Southeast", at: [27.95, -82.46] }, // Tampa
  { region: "Southeast", at: [34.0, -81.03] }, // Columbia
  { region: "South", at: [32.78, -96.8] }, // Dallas
  { region: "South", at: [30.27, -97.74] }, // Austin
  { region: "Northeast", at: [43.66, -70.26] }, // Portland
  { region: "Northeast", at: [39.95, -75.17] }, // Philadelphia
];

const US: LatLng[] = [[48.4,-124.7],[46.2,-123.9],[43.3,-124.4],[40.4,-124.4],[37.8,-122.5],[34.5,-120.6],[34,-118.5],[32.5,-117.1],[32.7,-114.7],[31.3,-111],[31.3,-108.2],[31.8,-106.5],[29.6,-104.5],[29,-103],[29.8,-101.4],[27.5,-99.5],[25.9,-97.4],[27.8,-97.4],[29.4,-94.7],[29.7,-93.8],[29.3,-91],[28.9,-89.4],[30.3,-89.2],[30.7,-88],[30.4,-86.5],[29.7,-85],[29.9,-83.7],[27.9,-82.6],[25.9,-81.7],[25.2,-80.4],[26.9,-80.1],[28.4,-80.6],[30.7,-81.4],[32.1,-80.9],[33.6,-79],[34.6,-77],[35.2,-75.5],[36.9,-76],[37.9,-75.9],[38.9,-74.9],[40.5,-74],[41.3,-71.9],[41.7,-70],[42.6,-70.6],[43.1,-70.7],[44,-69],[44.8,-67],[47.1,-67.8],[47.4,-69.2],[45.2,-70.9],[45,-74.9],[44.1,-76.4],[43.4,-79.2],[42.9,-78.9],[41.7,-82.4],[42.1,-83.1],[43,-82.4],[45.3,-82.5],[46.5,-84.6],[48.3,-88.3],[48,-89.6],[49.3,-94.8],[49,-95.2],[49,-123.3]];

const project = ([lat, lng]: LatLng): [number, number] => [((lng + 125.5) / 59) * MW, ((50.2 - lat) / 26.8) * MH];

// Grid points that fall inside the US outline (even-odd point-in-polygon test).
const DOTS: [number, number][] = (() => {
  const poly = US.map(project);
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const dots: [number, number][] = [];
  for (let y = 5; y < MH; y += 8.5) for (let x = 5; x < MW; x += 8.5) if (inside(x, y)) dots.push([x, y]);
  return dots;
})();

// A gentle arc between two points, bowing upward more for longer lanes.
function lanePath(a: LatLng, b: LatLng) {
  const [x1, y1] = project(a);
  const [x2, y2] = project(b);
  const lift = Math.min(70, Math.hypot(x2 - x1, y2 - y1) * 0.28);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 - lift;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

// Each warehouse ships to a third of the out-of-region cities, so the lanes read as a network rather than a mesh.
const lanesFor = (warehouses: MapWarehouse[]) =>
  warehouses.flatMap((w, wi) =>
    DESTINATIONS.filter((d) => d.region !== w.region)
      .filter((_, i) => i % 3 === wi % 3)
      .map((d) => lanePath(w.at, d.at)),
  );

export default function NetworkMap({ warehouses = DATASET_WAREHOUSES }: { warehouses?: MapWarehouse[] }) {
  const lanes = lanesFor(warehouses);
  return (
    <svg className="map" viewBox={`0 0 ${MW} ${MH}`} role="img" aria-label="Halcyon warehouse network">
      <g className="map-dots">
        {DOTS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r="1.7" />
        ))}
      </g>
      <g>
        {lanes.map((d) => (
          <path key={d} className="lane" d={d} stroke="#5FD0D7" strokeOpacity=".35" strokeDasharray="3 5" />
        ))}
      </g>
      <g className="map-wh">
        {warehouses.map((w) => {
          const [x, y] = project(w.at);
          return (
            <g key={w.id}>
              <circle className="ring" cx={x} cy={y} r="8" />
              <circle className="core" cx={x} cy={y} r="3.5" />
              <text x={x + 12} y={y + 4}>{w.name}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
