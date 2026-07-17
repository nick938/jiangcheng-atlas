import { MapExplorer } from "@/components/map-explorer";
import { seedPlaces } from "@/lib/places";

export default function Home() {
  return <MapExplorer initialPlaces={seedPlaces} />;
}
