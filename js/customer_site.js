// 在这里追加你自己的采集源，格式与 js/config.js 的 API_SITES 相同：
//   mykey: { api: 'https://example.com/api.php/provide/vod', name: '显示名称' }
// 留空即可，主源列表见 js/config.js。
const CUSTOMER_SITES = {};

// 调用全局方法合并
if (window.extendAPISites) {
    window.extendAPISites(CUSTOMER_SITES);
} else {
    console.error("错误：请先加载 config.js！");
}
