// Private, compressed travel album. All routes run after owner authentication.
export async function photos(request, env, tripId, headers, respond) {
  const root = `/v1/trips/${tripId}/photos`;
  const path = new URL(request.url).pathname;
  if (path !== root && !path.startsWith(root + '/')) return null;
  const id = path.slice(root.length + 1);
  if (id && !/^[a-f0-9-]{36}$/.test(id)) return respond({ error: 'not_found' }, 404);
  if (request.method === 'GET' && !id) {
    const row = await env.DB.prepare("SELECT json_group_array(json_object('id',id,'caption',caption,'day',day,'createdAt',created_at)) AS items FROM (SELECT * FROM trip_photos WHERE trip_id=? AND deleted_at IS NULL ORDER BY created_at DESC)").bind(tripId).first();
    return respond({ photos: JSON.parse(row.items) });
  }
  if (request.method === 'GET' && id) {
    const row = await env.DB.prepare('SELECT image FROM trip_photos WHERE trip_id=? AND id=? AND deleted_at IS NULL').bind(tripId, id).first();
    if (!row) return respond({ error: 'not_found' }, 404);
    return new Response(Uint8Array.from(atob(row.image), c => c.charCodeAt(0)), { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
  }
  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('UPDATE trip_photos SET deleted_at=? WHERE trip_id=? AND id=? AND deleted_at IS NULL').bind(new Date().toISOString(), tripId, id).run();
    return respond({ ok: true });
  }
  if (request.method !== 'PUT' || !id) return respond({ error: 'method_not_allowed' }, 405);
  if (!request.headers.get('Content-Type')?.startsWith('application/json') || !request.body) return respond({ error: 'invalid_photo' }, 400);
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 710000) { await reader.cancel(); return respond({ error: 'photo_too_large' }, 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  let body;
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return respond({ error: 'invalid_photo' }, 400); }
  if (!body || typeof body.image !== 'string' || body.image.length > 700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image) || typeof body.caption !== 'string' || body.caption.length > 300 || typeof body.day !== 'string' || !/^(cover|\d{4}-\d{2}-\d{2})?$/.test(body.day)) return respond({ error: 'invalid_photo' }, 400);
  try { const binary = atob(body.image); if (!binary.startsWith('\xff\xd8\xff') || !binary.endsWith('\xff\xd9')) throw new Error(); } catch { return respond({ error: 'invalid_photo' }, 400); }
  const result = await env.DB.prepare("INSERT INTO trip_photos(trip_id,id,caption,day,image,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM trip_photos WHERE trip_id=? AND deleted_at IS NULL)<24 ON CONFLICT(trip_id,id) DO NOTHING RETURNING id")
    .bind(tripId, id, body.caption, body.day, body.image, new Date().toISOString(), tripId).first();
  if (!result) {
    const existing = await env.DB.prepare('SELECT id FROM trip_photos WHERE trip_id=? AND id=? AND deleted_at IS NULL').bind(tripId, id).first();
    if (!existing) return respond({ error: 'album_full' }, 409);
  }
  return respond({ id }, 200);
}
