/* 生成「我关心的城市」可选城市表 assets/cities.js —— 离线跑一次，产物是静态坐标，页面运行时零依赖。
 *
 * 数据源：Natural Earth 1:10m Populated Places（public domain，无署名要求）
 *   https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_populated_places.geojson
 * 用法：node scripts/build-cities.mjs [本地 geojson 路径，省略则下载约 19MB]
 *
 * 数据集的英文名可靠、中文名（NAME_ZH）有译错，省级归属（ADM1NAME）也有错，2026-10 逐条核过：
 *  - 中文名拼音与英文名比对，再把全部城市坐标反查行政区划（OpenStreetMap Nominatim），对不上的人工确认；
 *  - 同音字错译拼音比对抓不到（常平 / 昌平、大理 / 大荔），坐标反查才抓到。修正见 FIX。
 * 台风影响不到的西部五省区不收；数据集里缺的沿海城市从 OpenStreetMap 补（SUPPLEMENT，见注释）。
 * 只存城市名、省、经纬度：页面不读取设备位置，选的城市只存本机。
 */
import { readFile, writeFile } from "node:fs/promises";

const SRC = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson";
const OUT = new URL("../assets/cities.js", import.meta.url);

const PROVINCE = {
  Beijing: "北京", Tianjin: "天津", Hebei: "河北", Shanxi: "山西", "Nei Mongol": "内蒙古", Liaoning: "辽宁", Jilin: "吉林",
  Heilongjiang: "黑龙江", Shanghai: "上海", Jiangsu: "江苏", Zhejiang: "浙江", Anhui: "安徽", Fujian: "福建", Jiangxi: "江西",
  Shandong: "山东", Henan: "河南", Hubei: "湖北", Hunan: "湖南", Guangdong: "广东", Guangxi: "广西", Hainan: "海南",
  Chongqing: "重庆", Sichuan: "四川", Guizhou: "贵州", Yunnan: "云南", Shaanxi: "陕西", Gansu: "甘肃", "Ningxia Hui": "宁夏",
  "Xinjiang Uygur": "新疆", Xizang: "西藏", Qinghai: "青海",
};
/* 台风及其残余环流影响不到的省区 */
const EXCLUDE = new Set(["新疆", "西藏", "青海", "甘肃", "宁夏"]);

/* 键 = 英文名|ADM1NAME（中文名有重名且有错，英文名可靠）。值：改名 / 改省 / 删除 */
const FIX = {
  "Hangu|Tianjin": { name: "汉沽" },          /* 原作“路南区” */
  "Changping|Beijing": { name: "昌平" },      /* 原作“常平镇”（同音） */
  "Jinxi|Liaoning": { name: "葫芦岛" },        /* 原作“锦溪”，锦西即今葫芦岛市区 */
  "Bose|Guangxi": { name: "百色" },           /* 原作“白城” */
  "Dali|Shaanxi": { name: "大荔" },           /* 原作“大理”（同音） */
  "Jianmen|Hubei": { name: "天门" },          /* 原作“荆门”，坐标与人口都是天门 */
  "Nancha|Heilongjiang": { name: "南岔" },     /* 原作“联合街道” */
  "Jining|Nei Mongol": { name: "集宁" },       /* 原作“平地泉镇” */
  "Tengchong|Yunnan": { name: "腾冲" },        /* 原作“腾越镇” */
  "Jiaojing|Zhejiang": { name: "台州" },       /* 原作“椒江区”，台州市政府驻地 */
  "Ninde|Fujian": { name: "宁德" },            /* 原作“蕉城区”，宁德市政府驻地 */
  "Taoyuan|Taoyuan": { name: "桃园" },
  "Zhongli|Taoyuan": { name: "中坜" },
  /* 以下由坐标反查抓到（拼音同音或近音，拼音比对漏掉） */
  "Wuchuan|Nei Mongol": { name: "武川" },     /* 原作“吴川”——真吴川在广东湛江，选它会拿到内蒙古的坐标 */
  "Wuyuan|Nei Mongol": { name: "五原" },      /* 原作“婺源”——真婺源在江西 */
  "Yishan|Guangxi": { name: "宜州" },         /* 原作“峄山镇”，宜山即今河池市宜州区 */
  "Linqing|Hebei": { province: "山东" },       /* 临清属山东聊城，数据集归到河北 */
  "Zhuozhou|Beijing": { province: "河北", lat: 39.483, lng: 115.969 }, /* 属河北保定；原坐标落在北京房山，按 OSM 改 */
  "Zicheng|Hubei": { name: "宜都" },          /* 原作“枝城镇”，属宜都市 */
  "Yunxian|Hubei": { name: "郧阳" },          /* 郧县 2014 年撤县设区 */
  "Xinqing|Heilongjiang": { name: "丰林" },    /* 新青区 2019 年并入丰林县 */
  "Bugt|Nei Mongol": { name: "博克图" },       /* 原作“布格特” */
};

/* 数据集里缺的沿海城市：OpenStreetMap Nominatim 2026-10-01 查询的行政中心坐标
   （© OpenStreetMap contributors），查询结果的省、市名均已核对 */
const SUPPLEMENT = [
  ["盘锦", "辽宁", 41.117, 122.066], ["东营", "山东", 37.433, 118.669], ["舟山", "浙江", 29.987, 122.203],
  ["揭阳", "广东", 23.553, 116.368], ["汕尾", "广东", 22.789, 115.37], ["中山", "广东", 22.52, 113.387],
  ["防城港", "广西", 21.702, 108.359], ["贵港", "广西", 23.114, 109.595], ["儋州", "海南", 19.517, 109.57],
  ["琼海", "海南", 19.259, 110.47], ["文昌", "海南", 19.545, 110.793], ["万宁", "海南", 18.796, 110.387],
  ["五指山", "海南", 18.778, 109.513],
];

/* 省的排列：沿海由南往北，再港澳台，再内陆——选城市时常用的在前 */
const ORDER = ["海南", "广东", "香港", "澳门", "广西", "福建", "台湾", "浙江", "上海", "江苏", "山东", "天津", "河北", "北京",
  "辽宁", "吉林", "黑龙江", "江西", "湖南", "安徽", "湖北", "河南", "贵州", "云南", "重庆", "四川", "陕西", "山西", "内蒙古"];

const geo = JSON.parse(process.argv[2] ? await readFile(process.argv[2], "utf8") : await (await fetch(SRC)).text());
const rows = [];
for (const { properties: p } of geo.features) {
  if (!["CHN", "HKG", "MAC", "TWN"].includes(p.ADM0_A3)) continue;
  const fix = FIX[`${p.NAME}|${p.ADM1NAME}`] || {};
  if (fix.drop) continue;
  const province = fix.province || (p.ADM0_A3 === "HKG" ? "香港" : p.ADM0_A3 === "MAC" ? "澳门" : p.ADM0_A3 === "TWN" ? "台湾" : PROVINCE[p.ADM1NAME]);
  if (!province) throw new Error(`未知省份：${p.NAME} / ${p.ADM1NAME}`);
  if (EXCLUDE.has(province)) continue;
  rows.push({
    name: fix.name || p.NAME_ZH, province, pop: p.POP_MAX || 0,
    lat: fix.lat ?? +p.LATITUDE.toFixed(3), lng: fix.lng ?? +p.LONGITUDE.toFixed(3),
  });
}
for (const [name, province, lat, lng] of SUPPLEMENT) {
  if (rows.some((r) => r.name === name)) throw new Error(`补充城市已存在：${name}`);
  rows.push({ name, province, lat, lng, pop: 0 });
}
const dup = rows.map((r) => r.name).filter((n, i, a) => a.indexOf(n) !== i);
if (dup.length) throw new Error(`重名：${dup.join("、")}`);
for (const r of rows) if (!ORDER.includes(r.province)) throw new Error(`省份未排序：${r.province}`);

rows.sort((a, b) => ORDER.indexOf(a.province) - ORDER.indexOf(b.province) || b.pop - a.pop);
const body = rows.map((r) => `[${JSON.stringify(r.name)},${JSON.stringify(r.province)},${r.lat},${r.lng}]`).join(",\n");
await writeFile(OUT, `/* 生成文件，勿手改：node scripts/build-cities.mjs（来源与校对见脚本头注释）。
   [城市, 省级行政区, 纬度, 经度]，同省按人口降序；只用于用户手选「我关心的城市」，页面不读取设备位置。 */
var TY_CITIES = [
${body}
];
if (typeof module !== "undefined" && module.exports) module.exports = TY_CITIES;
`);
console.log(`ok: ${rows.length} 个城市 → assets/cities.js（${ORDER.filter((o) => rows.some((r) => r.province === o)).length} 个省级行政区）`);
