PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  description TEXT NOT NULL,
  longitude REAL NOT NULL,
  latitude REAL NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  category_id TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS place_images (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_places_status_category ON places(status, category_id);
CREATE INDEX IF NOT EXISTS idx_places_district ON places(district);
CREATE INDEX IF NOT EXISTS idx_place_images_place ON place_images(place_id, sort_order);

INSERT OR IGNORE INTO categories (id, name, icon, color, sort_order) VALUES
  ('landmark', '城市地标', '楼', '#ff7a45', 10),
  ('nature', '江湖公园', '叶', '#45c486', 20),
  ('culture', '人文艺术', '文', '#9a7cff', 30),
  ('neighborhood', '街区漫游', '巷', '#4aa8ff', 40),
  ('campus', '高校校园', '学', '#f2c94c', 50),
  ('food', '过早宵夜', '味', '#ff5c8a', 60);

INSERT OR IGNORE INTO places
  (id, slug, name, subtitle, description, longitude, latitude, district, address, category_id, featured)
VALUES
  ('yellow-crane-tower', 'yellow-crane-tower', '黄鹤楼', '江城天际线上的千年名楼', '登楼可以同时看见长江、蛇山与武汉三镇，是理解武汉城市格局最直观的一站。', 114.3064, 30.5444, '武昌区', '蛇山西山坡特1号', 'landmark', 1),
  ('east-lake', 'east-lake', '东湖绿道', '在城市中心骑进山水之间', '由湖泊、磨山、森林与城市绿道共同组成，适合骑行、散步和看日落。', 114.3744, 30.5594, '武昌区', '沿湖大道', 'nature', 1),
  ('hubei-museum', 'hubei-museum', '湖北省博物馆', '从曾侯乙编钟读懂荆楚', '馆藏以曾侯乙编钟、越王勾践剑等为代表，是武汉最重要的历史文化目的地之一。', 114.3661, 30.5612, '武昌区', '东湖路160号', 'culture', 1),
  ('wuhan-university', 'wuhan-university', '武汉大学', '珞珈山下的百年校园', '山、水、建筑与校园生活交织在一起，老斋舍和樱顶构成了极具辨识度的空间。', 114.3652, 30.5373, '武昌区', '八一路299号', 'campus', 1),
  ('jianghan-road', 'jianghan-road', '江汉路', '从租界建筑走进武汉烟火', '一条适合步行观察城市建筑、商业变迁和夜生活的老街，也是汉口城市漫游的起点。', 114.2892, 30.5835, '江汉区', '江汉路步行街', 'neighborhood', 1),
  ('hankou-riverfront', 'hankou-riverfront', '汉口江滩', '长江边的城市客厅', '从沿江大道走到江滩，可以感受防洪空间、租界建筑群和武汉人的滨江日常。', 114.3072, 30.6033, '江岸区', '沿江大道', 'nature', 0),
  ('qingchuan-pavilion', 'qingchuan-pavilion', '晴川阁', '隔江望黄鹤的楚地胜景', '位于龟山脚下，登阁可看长江与武昌岸线，适合串联铁门关和汉阳江滩。', 114.2854, 30.5521, '汉阳区', '洗马长街86号', 'landmark', 0),
  ('gude-temple', 'gude-temple', '古德寺', '藏在汉口街巷里的异域建筑', '建筑融合多种风格，空间安静克制，与周边高密度城市肌理形成强烈反差。', 114.3149, 30.6232, '江岸区', '工农兵路24号', 'culture', 1),
  ('tanhualin', 'tanhualin', '昙华林', '老武昌山坡上的慢街区', '沿山势展开的街巷保留了多时期建筑，适合从粮道街一路步行到得胜桥。', 114.3145, 30.5535, '武昌区', '昙华林', 'neighborhood', 0),
  ('lingbo-gate', 'lingbo-gate', '凌波门', '把东湖日出装进取景框', '武汉大学临东湖的一处标志性亲水空间，清晨与傍晚都有独特的湖面光线。', 114.3745, 30.5355, '武昌区', '东湖南路', 'nature', 1),
  ('chu-river-han-street', 'chu-river-han-street', '楚河汉街', '沿楚河展开的夜游街区', '连接沙湖与东湖的城市商业轴线，夜间灯光和滨水步道是主要体验。', 114.3375, 30.5570, '武昌区', '中北路', 'neighborhood', 0),
  ('optics-valley', 'optics-valley', '光谷广场', '武汉最具年轻感的城市节点', '轨道交通、商业、大学与科技企业在这里汇集，是观察当代武汉活力的一扇窗口。', 114.4011, 30.5066, '洪山区', '珞喻路726号', 'landmark', 0),
  ('wuhan-tiandi', 'wuhan-tiandi', '武汉天地', '老里份旁的新城市生活', '从新天地商业街区向周边延伸，可以继续探索汉口历史风貌区和里份生活。', 114.3118, 30.6125, '江岸区', '卢沟桥路', 'neighborhood', 0),
  ('guiyuan-temple', 'guiyuan-temple', '归元禅寺', '汉阳老城里的清静一隅', '武汉代表性的佛教寺院，罗汉堂和春节祈福传统构成了独特的地方记忆。', 114.2598, 30.5485, '汉阳区', '归元寺路20号', 'culture', 0),
  ('shanhaiguan-breakfast', 'shanhaiguan-breakfast', '山海关路过早', '用一条街尝遍武汉清晨', '烧麦、豆皮、糊汤粉、鸡冠饺集中在街巷两侧，适合清晨边走边吃。', 114.3100, 30.6072, '江岸区', '山海关路', 'food', 1);
