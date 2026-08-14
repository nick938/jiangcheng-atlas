export const categoryMeta = {
  all: { label: "全部地点", shortLabel: "全部", icon: "江", color: "#f4f0e6" },
  landmark: { label: "城市地标", shortLabel: "地标", icon: "楼", color: "#ff7a45" },
  nature: { label: "江湖公园", shortLabel: "自然", icon: "叶", color: "#45c486" },
  culture: { label: "人文艺术", shortLabel: "人文", icon: "文", color: "#9a7cff" },
  neighborhood: { label: "街区漫游", shortLabel: "街区", icon: "巷", color: "#4aa8ff" },
  campus: { label: "高校校园", shortLabel: "高校", icon: "学", color: "#f2c94c" },
  food: { label: "过早宵夜", shortLabel: "美食", icon: "味", color: "#ff5c8a" },
} as const;

export type CategoryId = Exclude<keyof typeof categoryMeta, "all">;
export type CategoryFilter = keyof typeof categoryMeta;

export type Place = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  longitude: number;
  latitude: number;
  district: string;
  address: string;
  categoryId: CategoryId;
  featured: boolean;
  imageUrl?: string;
  imageCredit?: string;
  imageSourceUrl?: string;
};

export type PlaceStatus = "draft" | "published" | "archived";

export type AdminPlace = Place & {
  status: PlaceStatus;
};

const seedPlaceData: Place[] = [
  {
    id: "yellow-crane-tower",
    slug: "yellow-crane-tower",
    name: "黄鹤楼",
    subtitle: "江城天际线上的千年名楼",
    description: "登楼可以同时看见长江、蛇山与武汉三镇，是理解武汉城市格局最直观的一站。",
    longitude: 114.3064,
    latitude: 30.5444,
    district: "武昌区",
    address: "蛇山西山坡特1号",
    categoryId: "landmark",
    featured: true,
  },
  {
    id: "east-lake",
    slug: "east-lake",
    name: "东湖绿道",
    subtitle: "在城市中心骑进山水之间",
    description: "由湖泊、磨山、森林与城市绿道共同组成，适合骑行、散步和看日落。",
    longitude: 114.3744,
    latitude: 30.5594,
    district: "武昌区",
    address: "沿湖大道",
    categoryId: "nature",
    featured: true,
  },
  {
    id: "hubei-museum",
    slug: "hubei-museum",
    name: "湖北省博物馆",
    subtitle: "从曾侯乙编钟读懂荆楚",
    description: "馆藏以曾侯乙编钟、越王勾践剑等为代表，是武汉最重要的历史文化目的地之一。",
    longitude: 114.3661,
    latitude: 30.5612,
    district: "武昌区",
    address: "东湖路160号",
    categoryId: "culture",
    featured: true,
  },
  {
    id: "wuhan-university",
    slug: "wuhan-university",
    name: "武汉大学",
    subtitle: "珞珈山下的百年校园",
    description: "山、水、建筑与校园生活交织在一起，老斋舍和樱顶构成了极具辨识度的空间。",
    longitude: 114.3652,
    latitude: 30.5373,
    district: "武昌区",
    address: "八一路299号",
    categoryId: "campus",
    featured: true,
  },
  {
    id: "jianghan-road",
    slug: "jianghan-road",
    name: "江汉路",
    subtitle: "从租界建筑走进武汉烟火",
    description: "一条适合步行观察城市建筑、商业变迁和夜生活的老街，也是汉口城市漫游的起点。",
    longitude: 114.2892,
    latitude: 30.5835,
    district: "江汉区",
    address: "江汉路步行街",
    categoryId: "neighborhood",
    featured: true,
  },
  {
    id: "hankou-riverfront",
    slug: "hankou-riverfront",
    name: "汉口江滩",
    subtitle: "长江边的城市客厅",
    description: "从沿江大道走到江滩，可以感受防洪空间、租界建筑群和武汉人的滨江日常。",
    longitude: 114.3072,
    latitude: 30.6033,
    district: "江岸区",
    address: "沿江大道",
    categoryId: "nature",
    featured: false,
  },
  {
    id: "qingchuan-pavilion",
    slug: "qingchuan-pavilion",
    name: "晴川阁",
    subtitle: "隔江望黄鹤的楚地胜景",
    description: "位于龟山脚下，登阁可看长江与武昌岸线，适合串联铁门关和汉阳江滩。",
    longitude: 114.2854,
    latitude: 30.5521,
    district: "汉阳区",
    address: "洗马长街86号",
    categoryId: "landmark",
    featured: false,
  },
  {
    id: "gude-temple",
    slug: "gude-temple",
    name: "古德寺",
    subtitle: "藏在汉口街巷里的异域建筑",
    description: "建筑融合多种风格，空间安静克制，与周边高密度城市肌理形成强烈反差。",
    longitude: 114.3149,
    latitude: 30.6232,
    district: "江岸区",
    address: "工农兵路24号",
    categoryId: "culture",
    featured: true,
  },
  {
    id: "tanhualin",
    slug: "tanhualin",
    name: "昙华林",
    subtitle: "老武昌山坡上的慢街区",
    description: "沿山势展开的街巷保留了多时期建筑，适合从粮道街一路步行到得胜桥。",
    longitude: 114.3145,
    latitude: 30.5535,
    district: "武昌区",
    address: "昙华林",
    categoryId: "neighborhood",
    featured: false,
  },
  {
    id: "lingbo-gate",
    slug: "lingbo-gate",
    name: "凌波门",
    subtitle: "把东湖日出装进取景框",
    description: "武汉大学临东湖的一处标志性亲水空间，清晨与傍晚都有独特的湖面光线。",
    longitude: 114.3745,
    latitude: 30.5355,
    district: "武昌区",
    address: "东湖南路",
    categoryId: "nature",
    featured: true,
  },
  {
    id: "chu-river-han-street",
    slug: "chu-river-han-street",
    name: "楚河汉街",
    subtitle: "沿楚河展开的夜游街区",
    description: "连接沙湖与东湖的城市商业轴线，夜间灯光和滨水步道是主要体验。",
    longitude: 114.3375,
    latitude: 30.557,
    district: "武昌区",
    address: "中北路",
    categoryId: "neighborhood",
    featured: false,
  },
  {
    id: "optics-valley",
    slug: "optics-valley",
    name: "光谷广场",
    subtitle: "武汉最具年轻感的城市节点",
    description: "轨道交通、商业、大学与科技企业在这里汇集，是观察当代武汉活力的一扇窗口。",
    longitude: 114.4011,
    latitude: 30.5066,
    district: "洪山区",
    address: "珞喻路726号",
    categoryId: "landmark",
    featured: false,
  },
  {
    id: "wuhan-tiandi",
    slug: "wuhan-tiandi",
    name: "武汉天地",
    subtitle: "老里份旁的新城市生活",
    description: "从新天地商业街区向周边延伸，可以继续探索汉口历史风貌区和里份生活。",
    longitude: 114.3118,
    latitude: 30.6125,
    district: "江岸区",
    address: "卢沟桥路",
    categoryId: "neighborhood",
    featured: false,
  },
  {
    id: "guiyuan-temple",
    slug: "guiyuan-temple",
    name: "归元禅寺",
    subtitle: "汉阳老城里的清静一隅",
    description: "武汉代表性的佛教寺院，罗汉堂和春节祈福传统构成了独特的地方记忆。",
    longitude: 114.2598,
    latitude: 30.5485,
    district: "汉阳区",
    address: "归元寺路20号",
    categoryId: "culture",
    featured: false,
  },
  {
    id: "shanhaiguan-breakfast",
    slug: "shanhaiguan-breakfast",
    name: "山海关路过早",
    subtitle: "用一条街尝遍武汉清晨",
    description: "烧麦、豆皮、糊汤粉、鸡冠饺集中在街巷两侧，适合清晨边走边吃。",
    longitude: 114.31,
    latitude: 30.6072,
    district: "江岸区",
    address: "山海关路",
    categoryId: "food",
    featured: true,
  },
  { id: "wuhan-yangtze-bridge", slug: "wuhan-yangtze-bridge", name: "武汉长江大桥", subtitle: "一桥飞架南北的江城坐标", description: "从龟山、蛇山或轮渡上观察这座公铁两用桥，可以直观理解武汉因江而生的交通格局。", longitude: 114.297, latitude: 30.547, district: "武昌区", address: "临江大道与龟山南路之间", categoryId: "landmark", featured: true },
  { id: "jianghanguan-museum", slug: "jianghanguan-museum", name: "江汉关博物馆", subtitle: "钟楼下的汉口开埠记忆", description: "江汉关大楼位于江汉路与沿江大道交会处，适合作为汉口历史建筑漫步的起点。", longitude: 114.2921, latitude: 30.5787, district: "江汉区", address: "沿江大道129号", categoryId: "landmark", featured: true },
  { id: "wuchang-uprising", slug: "wuchang-uprising", name: "辛亥革命武昌起义纪念馆", subtitle: "从红楼回望首义之城", description: "纪念馆与首义广场相邻，可结合周边遗址了解武昌起义与近代武汉城市历史。", longitude: 114.3065, latitude: 30.5392, district: "武昌区", address: "武珞路1号", categoryId: "culture", featured: false },
  { id: "wuhan-art-museum", slug: "wuhan-art-museum", name: "武汉美术馆（汉口馆）", subtitle: "老金融建筑里的当代展览", description: "位于汉口历史风貌区，适合与江汉路、保华街和黎黄陂路安排为一条步行路线。", longitude: 114.2899, latitude: 30.5886, district: "江岸区", address: "中山大道保华街2号", categoryId: "culture", featured: false },
  { id: "baotong-temple", slug: "baotong-temple", name: "宝通禅寺", subtitle: "洪山脚下的古寺与塔影", description: "寺院依洪山而建，山门、殿宇和洪山宝塔形成由城市道路逐渐进入山林的空间层次。", longitude: 114.3318, latitude: 30.5268, district: "武昌区", address: "武珞路549号", categoryId: "culture", featured: false },
  { id: "jiefang-park", slug: "jiefang-park", name: "解放公园", subtitle: "汉口老城区的大尺度绿荫", description: "林荫、湖面和季节花木构成稳定的城市公园体验，适合散步、慢跑和观察本地日常。", longitude: 114.2987, latitude: 30.6194, district: "江岸区", address: "解放大道1861号", categoryId: "nature", featured: false },
  { id: "zhongshan-park", slug: "zhongshan-park", name: "中山公园", subtitle: "闹市中央的老牌公园", description: "从解放大道进入，很快就能从商业街区切换到湖面、树荫与游园空间。", longitude: 114.2729, latitude: 30.5805, district: "江汉区", address: "解放大道1265号", categoryId: "nature", featured: false },
  { id: "moshan-scenic-area", slug: "moshan-scenic-area", name: "东湖磨山", subtitle: "从楚城到山林湖岸", description: "磨山连接植物园、东湖绿道与多处观景空间，适合安排半日徒步或与骑行线路组合。", longitude: 114.4138, latitude: 30.5487, district: "武昌区", address: "沿湖大道58号", categoryId: "nature", featured: true },
  { id: "lihuangpi-road", slug: "lihuangpi-road", name: "黎黄陂路", subtitle: "把汉口旧租界读成一条街", description: "街道及周边分布多座历史建筑，适合从沿江大道向中山大道慢慢步行观察。", longitude: 114.3017, latitude: 30.5987, district: "江岸区", address: "黎黄陂路", categoryId: "neighborhood", featured: true },
  { id: "wansongyuan", slug: "wansongyuan", name: "万松园", subtitle: "从晚饭热闹到深夜的街区", description: "餐馆、小店和居民生活高密度交织，是体验汉口夜间烟火气的代表性片区。", longitude: 114.2725, latitude: 30.5905, district: "江汉区", address: "雪松路与万松园路一带", categoryId: "neighborhood", featured: false },
  { id: "liangdao-street", slug: "liangdao-street", name: "粮道街", subtitle: "从过早摊走进老武昌", description: "适合清晨从小东门方向一路边吃边走，并继续串联昙华林、胭脂路与得胜桥。", longitude: 114.3165, latitude: 30.5494, district: "武昌区", address: "粮道街", categoryId: "neighborhood", featured: true },
  { id: "hust", slug: "hust", name: "华中科技大学", subtitle: "森林感与工程气质并存的校园", description: "校园轴线长、绿化密度高，主校区与周边光谷生活共同组成武汉高校片区的重要一站。", longitude: 114.4146, latitude: 30.5159, district: "洪山区", address: "珞喻路1037号", categoryId: "campus", featured: false },
  { id: "ccnu", slug: "ccnu", name: "华中师范大学", subtitle: "桂子山上的百年学府", description: "校园依桂子山展开，适合从珞喻路进入，观察山地校园与城市主干道之间的空间变化。", longitude: 114.356, latitude: 30.5182, district: "洪山区", address: "珞喻路152号", categoryId: "campus", featured: false },
  { id: "hubei-university", slug: "hubei-university", name: "湖北大学", subtitle: "沙湖岸边的城市校园", description: "校园靠近沙湖与武昌滨江片区，可与沙湖公园、友谊大道安排在同一条城市漫步线上。", longitude: 114.3395, latitude: 30.5835, district: "武昌区", address: "友谊大道368号", categoryId: "campus", featured: false },
  { id: "hubu-alley", slug: "hubu-alley", name: "户部巷", subtitle: "黄鹤楼脚下的武汉小吃街", description: "游客密度较高但位置经典，适合与长江大桥、中华路码头和黄鹤楼一起安排。", longitude: 114.3, latitude: 30.5428, district: "武昌区", address: "自由路与户部巷", categoryId: "food", featured: false },
  { id: "jiqing-street", slug: "jiqing-street", name: "吉庆街", subtitle: "汉口夜色里的市井餐桌", description: "从大智路一带进入，可以把老街餐饮与中山大道、江汉路夜游串联起来。", longitude: 114.291, latitude: 30.595, district: "江岸区", address: "吉庆街", categoryId: "food", featured: false },
];

type DefaultPlaceMedia = Pick<Place, "imageUrl" | "imageCredit" | "imageSourceUrl">;

const defaultPlaceMedia: Partial<Record<string, DefaultPlaceMedia>> = {
  "yellow-crane-tower": {
    imageUrl: "/places/yellow-crane-tower.jpg",
    imageCredit: "xiquinhosilva · CC BY 2.0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Yellow_Crane_Tower_61472-Wuhan_(49150475341).jpg",
  },
  "east-lake": {
    imageUrl: "/places/east-lake.jpg",
    imageCredit: "Vmenkov · CC BY-SA 3.0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Wuhan_East_Lake_4172.jpg",
  },
  "hubei-museum": {
    imageUrl: "/places/hubei-museum.jpg",
    imageCredit: "Gary Todd · CC0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Hubei_Provincial_Museum,_Wuhan_(10154725164).jpg",
  },
  "wuhan-university": {
    imageUrl: "/places/wuhan-university.jpg",
    imageCredit: "Doraemon.tvb · CC BY-SA 3.0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Wuhan_University_01.jpg",
  },
  "qingchuan-pavilion": {
    imageUrl: "/places/qingchuan-pavilion.jpg",
    imageCredit: "Sherbet · CC BY 2.5",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Qingchuan_Pavilion,_Hubei,_China.jpg",
  },
  "gude-temple": {
    imageUrl: "/places/gude-temple.jpg",
    imageCredit: "ScareCriterion12 · CC BY-SA 4.0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Gude_Temple,_Wuhan,_Oct_2017.jpg",
  },
  tanhualin: {
    imageUrl: "/places/tanhualin.jpg",
    imageCredit: "Howchou · CC BY 3.0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Tanhualin.JPG",
  },
  "optics-valley": {
    imageUrl: "/places/optics-valley.jpg",
    imageCredit: "Zhangmoon618 · CC BY-SA 3.0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Optics_Valley_Square.jpg",
  },
  "guiyuan-temple": {
    imageUrl: "/places/guiyuan-temple.jpg",
    imageCredit: "Gary Todd · CC0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Guiyuan_Temple,_Wuhan_(10160025996).jpg",
  },
  "wuhan-yangtze-bridge": {
    imageUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Wuhan%20Yangtze%20River%20Bridge%20in%202020.jpg?width=1280",
    imageCredit: "Zheng Zhou · CC BY-SA 4.0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Wuhan_Yangtze_River_Bridge_in_2020.jpg",
  },
  "jianghanguan-museum": {
    imageUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/China%20Wuhan%20Jianghanguan.jpg?width=1280",
    imageCredit: "Mongol · CC BY-SA 3.0",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:China_Wuhan_Jianghanguan.jpg",
  },
};

export function withDefaultPlaceMedia(place: Place): Place {
  if (place.imageUrl) return place;
  const media = defaultPlaceMedia[place.id];
  return media ? { ...place, ...media } : place;
}

export const seedPlaces: Place[] = seedPlaceData.map(withDefaultPlaceMedia);
