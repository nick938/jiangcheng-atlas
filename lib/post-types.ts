export const POST_TOPICS = ["chat", "meetup", "guide", "food", "photo", "help"] as const;
export type PostTopic = (typeof POST_TOPICS)[number];

export type PostAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

export type CommunityPost = {
  id: string;
  title: string;
  body: string;
  topic: PostTopic;
  imageUrl: string | null; // 形如 /media/posts/...
  author: PostAuthor;
  commentCount: number;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PostSummary = Omit<CommunityPost, "body"> & { excerpt: string };

export type PostComment = {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  author: PostAuthor;
  isMine: boolean;
};

export const POST_TOPIC_LABELS: Record<PostTopic, string> = {
  chat: "闲聊",
  meetup: "约伴",
  guide: "攻略",
  food: "吃喝",
  photo: "影像",
  help: "求助",
};
