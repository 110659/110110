// 校园外卖 · 云端实时数据库（Netlify Functions + Netlify Blobs）
// 后台（index.html）与小程序（utils/cloud.js）通过本函数双向互通：
//   GET  /api/db    → 读取云端库（后台每3秒拉取、小程序每5秒拉取）
//   POST /api/sync  → 单条推送 {kind:'order'|'aftersale'|'review', payload:{id,...}}
//   POST /api/push  → 批量推送 {db:{orders:[...], shops:[...], ...}}（后台操作推送）
// 合并规则：按 id 联合，冲突取 _t（更新时间戳）较大者，即"后写优先"
const { getStore } = require('@netlify/blobs');

const KEYS = ['orders', 'aftersales', 'reviews', 'chats', 'shops', 'users', 'acts'];
// 前端单数 kind → 云端复数集合名
const KIND_MAP = { order: 'orders', aftersale: 'aftersales', review: 'reviews' };
const HDR = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function ok(body) { return { statusCode: 200, headers: HDR, body: body }; }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HDR };
  let store;
  try {
    store = getStore({ name: 'campus_db', consistency: 'strong' });
  } catch (e) {
    return { statusCode: 500, headers: HDR, body: JSON.stringify({ error: 'blobs: ' + e.message }) };
  }
  try {
    /* ---- GET /api/db：返回全部云端集合（map by id） ---- */
    if (event.httpMethod === 'GET') {
      const out = {};
      for (const k of KEYS) out[k] = (await store.get(k, { type: 'json' })) || {};
      return ok(JSON.stringify(out));
    }
    /* ---- POST：单条 / 批量推送 ---- */
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      // 单条：小程序 push('order'|'aftersale'|'review', record)
      if (body.kind && body.payload && body.payload.id) {
        const k = KIND_MAP[body.kind] || body.kind;
        if (KEYS.indexOf(k) < 0) return { statusCode: 400, headers: HDR, body: '{"error":"bad kind"}' };
        const cur = (await store.get(k, { type: 'json' })) || {};
        const p = body.payload;
        if (!cur[p.id] || (p._t || 0) >= (cur[p.id]._t || 0)) cur[p.id] = p;
        await store.setJSON(k, cur);
        return ok('{"ok":1}');
      }

      // 批量：后台 {db:{集合名:数组}}，每条按 _t 后写优先
      if (body.db) {
        for (const k of KEYS) {
          const arr = body.db[k];
          if (!Array.isArray(arr) || !arr.length) continue;
          const cur = (await store.get(k, { type: 'json' })) || {};
          let changed = false;
          for (const r of arr) {
            if (!r || !r.id) continue;
            if (!cur[r.id] || (r._t || 0) > (cur[r.id]._t || 0)) { cur[r.id] = r; changed = true; }
          }
          if (changed) await store.setJSON(k, cur);
        }
        return ok('{"ok":1}');
      }
      return { statusCode: 400, headers: HDR, body: '{"error":"bad body"}' };
    }
    return { statusCode: 405, headers: HDR, body: '{}' };
  } catch (e) {
    return { statusCode: 500, headers: HDR, body: JSON.stringify({ error: e.message }) };
  }
};
