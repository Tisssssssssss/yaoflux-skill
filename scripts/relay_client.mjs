/**
 * YAO FLUX · 回环网关客户端（零依赖）
 *
 * Node 侧的 BroadcastChannel 只在同进程 worker 之间通信，跨 Agent 进程无效。
 * 所有跨进程事件一律走 HTTP 网关：上报用 POST /emit，订阅用 GET /events SSE。
 * 本模块是适配器、CLI、第三方脚本共用的唯一通道实现。
 */
const PORT = Number(process.env.YAOFLUX_PORT || 8787);
export const ORIGIN = 'http://127.0.0.1:' + PORT;

export async function health(timeout = 1500) {
  const r = await fetch(ORIGIN + '/health', { signal: AbortSignal.timeout(timeout) });
  return r.json();
}

export async function history(timeout = 1500) {
  const r = await fetch(ORIGIN + '/history', { signal: AbortSignal.timeout(timeout) });
  return r.json();
}

export async function postEvents(list, timeout = 2500) {
  const r = await fetch(ORIGIN + '/emit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: Array.isArray(list) ? list : [list] }),
    signal: AbortSignal.timeout(timeout),
  });
  return r.json();
}

/**
 * 订阅 SSE 事件流，断线自动重连。
 * @param {{since?:number, filter?:(evt:any)=>boolean, onEvent:(evt:any)=>void, onStatus?:(s:string)=>void, retryMs?:number}} opts
 * @returns {() => void} 取消订阅
 */
export function subscribeRelay(opts = {}) {
  let closed = false;
  let since = Number(opts.since || 0);
  let controller = null;
  const retryMs = Number(opts.retryMs || 1200);
  const status = s => { try { opts.onStatus?.(s); } catch { /* ignore */ } };

  async function loop() {
    while (!closed) {
      controller = new AbortController();
      try {
        status('connecting');
        const res = await fetch(ORIGIN + '/events?since=' + since, { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        status('live');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const part of parts) {
            const line = part.split('\n').find(l => l.startsWith('data: '));
            if (!line) continue;
            let evt;
            try { evt = JSON.parse(line.slice(6)); } catch { continue; }
            if (Number(evt.seq) > since) since = Number(evt.seq);
            if (opts.filter && !opts.filter(evt)) continue;
            try { opts.onEvent?.(evt); } catch { /* ignore */ }
          }
        }
      } catch (err) {
        if (!closed) status('retry: ' + err.message);
      }
      if (!closed) await new Promise(r => setTimeout(r, retryMs));
    }
  }
  loop();
  return () => { closed = true; try { controller?.abort(); } catch { /* ignore */ } };
}
