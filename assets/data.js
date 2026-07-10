/* 风眼 · 内置降级数据
   与 data/typhoon.json（由 scripts/fetch-typhoon.mjs 生成）完全同构。
   仅在实时数据加载失败（如 file:// 直接打开、断网）时作为演示兜底。 */

const DEMO_DATA = {
  demo: true,
  updatedAt: "2026-07-10 14:00",
  source: "内置演示数据",
  sourceUrl: null,
  typhoons: [
    {
      name: "木兰",
      enName: "MULAN",
      code: "2607",
      level: "台风（13级）",
      summary: "预报路径趋向我国沿海，沿海地区请密切关注当地气象部门发布的最新预警。",
      nearCoast: true,
      now: {
        windLevel: 13,
        windSpeed: 40,      // m/s
        pressure: 955,      // hPa
        moveDir: "西北",
        moveSpeed: 18,      // km/h
        r7: 260,            // 七级风圈半径 km
        r10: 100,           // 十级风圈半径 km
        position: "中心位于南海东北部海面，距广东省深圳市东南方向约 320 公里",
        time: "07-10 14时",
      },
      /* phase = past（已过）/ now（当前）/ forecast（预报） */
      track: [
        { t: "07-08 08时", lat: 17.8, lng: 124.5, wind: 9,  strong: "热带风暴",   phase: "past" },
        { t: "07-08 20时", lat: 18.6, lng: 122.8, wind: 10, strong: "强热带风暴", phase: "past" },
        { t: "07-09 08时", lat: 19.6, lng: 120.8, wind: 11, strong: "强热带风暴", phase: "past" },
        { t: "07-09 20时", lat: 20.7, lng: 118.4, wind: 12, strong: "台风",       phase: "past" },
        { t: "07-10 08时", lat: 21.4, lng: 116.3, wind: 13, strong: "台风",       phase: "past" },
        { t: "07-10 14时", lat: 21.8, lng: 114.9, wind: 13, strong: "台风",       phase: "now" },
        { t: "07-11 08时", lat: 22.2, lng: 114.3, wind: 12, strong: "台风",       phase: "forecast" },
        { t: "07-11 20时", lat: 22.9, lng: 113.5, wind: 10, strong: "强热带风暴", phase: "forecast" },
        { t: "07-12 08时", lat: 23.8, lng: 112.4, wind: 8,  strong: "热带风暴",   phase: "forecast" },
      ],
    },
  ],
};

/* 四级预警与分级预案。
   清单为递进式：高等级页面会自动带上更低等级的全部事项。 */
const WARNING_LEVELS = ["blue", "yellow", "orange", "red"];

const PLANS = {
  blue: {
    name: "蓝色预警",
    short: "蓝",
    signal: "24 小时内可能或已经受台风影响，沿海平均风 6 级以上",
    tone: "未雨绸缪，从容准备。",
    items: [
      "关注官方预警与台风动态，打开手机应急信息提醒",
      "检查手电筒、充电宝、饮用水、常用药品是否齐备",
      "清理阳台、窗台、屋顶易坠物，收回晾晒衣物与花盆",
      "检查门窗密封与排水口，疏通地漏和天台落水管",
      "提醒家中老人孩子近两日减少外出安排",
    ],
  },
  yellow: {
    name: "黄色预警",
    short: "黄",
    signal: "24 小时内可能或已经受台风影响，沿海平均风 8 级以上",
    tone: "把准备做在风前面。",
    items: [
      "储备可维持 2–3 天的饮用水与即食食物",
      "手机、充电宝全部充满电，备一台收音机更稳妥",
      "加固门窗，大面积玻璃贴米字形胶条",
      "低洼地带、地下车库的车辆移至高处停放",
      "取消海边与山区行程，渔船回港避风、人员撤离上岸",
    ],
  },
  orange: {
    name: "橙色预警",
    short: "橙",
    signal: "12 小时内可能或已经受台风影响，沿海平均风 10 级以上",
    tone: "现在开始，安全高于一切。",
    items: [
      "非必要不外出，留在坚固建筑内，远离窗户与玻璃幕墙",
      "备好应急包（证件、药品、水、食物、手电）放在门口",
      "与家人约定失联后的集合地点与联系方式",
      "居住危房、工棚、低洼易涝区的住户按社区通知提前转移",
      "浴缸与水桶蓄水备用，检查燃气阀门是否关严",
    ],
  },
  red: {
    name: "红色预警",
    short: "红",
    signal: "6 小时内可能或已经受台风影响，沿海平均风 12 级以上",
    tone: "生命第一，其他都可以重来。",
    items: [
      "停课停工停市期间留在安全场所，服从政府统一安排",
      "收到转移指令立即撤离，不要为财物折返",
      "远离迎风面、玻璃幕墙、广告牌、大树与电线杆",
      "台风眼过境时风雨会骤停，切勿外出——大风将从反方向再袭",
      "遇险求助：110 / 120，水上遇险拨打 12395",
    ],
  },
};

/* 应急联络与权威信息源 */
const CONTACTS = [
  { num: "110", label: "报警求助" },
  { num: "119", label: "消防救援" },
  { num: "120", label: "医疗急救" },
  { num: "12395", label: "水上遇险" },
  { num: "12121", label: "气象服务" },
  { num: "12345", label: "政务热线" },
];

const SOURCES = [
  { name: "中央气象台 · 台风网", url: "http://typhoon.nmc.cn/web.html" },
  { name: "浙江省台风路径实时发布系统", url: "https://typhoon.slt.zj.gov.cn/" },
  { name: "国家应急广播", url: "https://www.cneb.gov.cn/" },
  { name: "中国天气 · 台风专题", url: "http://typhoon.weather.com.cn/" },
];
