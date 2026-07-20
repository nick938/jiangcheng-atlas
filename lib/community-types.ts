export type CommunityUser = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

export type CyclingRoute = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  distanceKm: number;
  durationMinutes: number;
  difficulty: "easy" | "medium" | "hard";
  color: string;
  startName: string;
  startLongitude: number;
  startLatitude: number;
  geometry: [number, number][];
  highlights: string[];
  tips: string[];
};

export type RideActivity = {
  id: string;
  routeId: string;
  routeName: string;
  routeColor: string;
  title: string;
  details: string;
  startsAt: string;
  meetingName: string;
  meetingLongitude: number;
  meetingLatitude: number;
  capacity: number;
  pace: "relaxed" | "steady" | "sport";
  status: "open" | "cancelled" | "completed";
  creator: CommunityUser;
  joinedCount: number;
  joinedByMe: boolean;
  isOwner: boolean;
};

export type CommunitySnapshot = {
  routes: CyclingRoute[];
  activities: RideActivity[];
  user: CommunityUser | null;
};
