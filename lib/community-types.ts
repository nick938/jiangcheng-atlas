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

export type ActivityType = "ride" | "walk" | "sports" | "food" | "photo" | "other";

export type CityActivity = {
  id: string;
  activityType: ActivityType;
  routeId: string | null;
  routeName: string | null;
  routeColor: string | null;
  title: string;
  details: string;
  startsAt: string;
  endsAt: string;
  meetingName: string;
  meetingLongitude: number;
  meetingLatitude: number;
  capacity: number;
  pace: "relaxed" | "steady" | "sport" | null;
  status: "open" | "cancelled" | "completed";
  completedAt: string | null;
  cancelledAt: string | null;
  imageUrl: string | null;
  creator: CommunityUser;
  joinedCount: number;
  joinedByMe: boolean;
  isOwner: boolean;
  commentCount: number;
};

export type ActivityComment = {
  id: string;
  activityId: string;
  body: string;
  createdAt: string;
  author: CommunityUser;
  isOwner: boolean;
};

export type CommunityNotification = {
  id: string;
  activityId: string | null;
  type: "activity_joined" | "activity_updated" | "activity_cancelled" | "new_comment" | "moderation";
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type CommunitySnapshot = {
  routes: CyclingRoute[];
  activities: CityActivity[];
  user: CommunityUser | null;
};
