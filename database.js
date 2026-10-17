import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

const SESSION_KEY = 'bugnai.auth.hsqsjxnotqpoodvnxecv';
let session;
let refreshing;

export class DatabaseError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readSession() {
  const value = localStorage.getItem(SESSION_KEY);
  if (!value) return null;
  try {
    const data = JSON.parse(value);
    return data.access_token && data.refresh_token && data.user?.id ? data : null;
  } catch {
    return null;
  }
}

function storeSession(data) {
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in,
    user: data.user
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  session = next;
  return next;
}

async function request(path, options = {}, token) {
  let response;
  try {
    response = await fetch(SUPABASE_URL + path, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        'Content-Type': 'application/json',
        ...options.headers
      },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new DatabaseError('Nepavyko pasiekti duomenų bazės. Patikrink internetą ir bandyk dar kartą.', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    let message = 'Veiksmas nepavyko. Bandyk dar kartą.';
    if (data?.code === '42P01' || data?.code === 'PGRST205') {
      message = 'Duomenų bazė dar neparuošta. Reikia paleisti projekto schema.sql Supabase SQL Editor.';
    } else if (data?.code === 'PGRST204' || data?.code === '42703') {
      message = /kit/i.test(data?.message || '')
        ? (options.body?.includes('salamander-v1') ? 'Pianino įrašams Supabase SQL Editor paleisk piano.sql.' : 'Antram būgnų rinkiniui Supabase SQL Editor paleisk drum-kits.sql.')
        : 'Duomenų bazę reikia atnaujinti pagal naujausią Supabase SQL papildymą.';
    } else if (data?.code === '23514' && options.body?.includes('salamander-v1') && /valid_performance|kit|piano/i.test(data?.message || '')) {
      message = 'Papildomoms pianino oktavoms Supabase SQL Editor paleisk piano-octaves.sql.';
    } else if (data?.code === '23505') {
      message = 'Šią vietą jau užėmė įrašas kitame lange. Ankstesnis ritmas nepakeistas.';
    } else if (data?.code === 'anonymous_provider_disabled') {
      message = 'Supabase nustatymuose reikia įjungti anoniminį prisijungimą.';
    } else if (response.status === 429) {
      message = 'Per daug bandymų. Palauk ir bandyk dar kartą.';
    } else if (response.status === 401 || response.status === 403) {
      message = 'Prisijungimas arba prieiga nebegalioja. Perkrauk puslapį ir bandyk dar kartą.';
    }
    throw new DatabaseError(message, response.status, data?.code || data?.error_code);
  }
  return data;
}

async function refreshSession() {
  if (refreshing) return refreshing;
  const refresh = async () => {
    // Re-read after taking the lock: another tab may have rotated the refresh token.
    session = readSession();
    if (!session) throw new DatabaseError('Prisijunk įvesdamas vardą.', 401);
    if (session.expires_at > Date.now() / 1000 + 60) return;
    try {
      storeSession(await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token })
      }));
    } catch (error) {
      if (error.status === 400 || error.status === 401) {
        localStorage.removeItem(SESSION_KEY);
        session = null;
        throw new DatabaseError('Šis anoniminis prisijungimas nebegalioja. Perkrauk puslapį, kad prisijungtum iš naujo.', 401);
      }
      throw error;
    }
  };
  refreshing = (navigator.locks
    ? navigator.locks.request(SESSION_KEY, refresh)
    : refresh()).finally(() => { refreshing = null; });
  return refreshing;
}

async function rest(path, options = {}) {
  session = readSession();
  if (!session) throw new DatabaseError('Prisijunk įvesdamas vardą.', 401);
  await refreshSession();
  return request('/rest/v1/' + path, options, session.access_token);
}

export function currentUser() {
  session = readSession();
  return session?.user || null;
}

export async function signIn(nickname) {
  // Check storage before creating an identity that the browser could not retain.
  localStorage.setItem(SESSION_KEY + '.check', '1');
  localStorage.removeItem(SESSION_KEY + '.check');
  session = readSession();
  if (!session) {
    storeSession(await request('/auth/v1/signup', {
      method: 'POST', body: JSON.stringify({ data: { nickname } })
    }));
  }
  return ensureProfile(nickname);
}

export async function ensureProfile(nickname) {
  const user = currentUser();
  if (!user) throw new DatabaseError('Prisijunk įvesdamas vardą.', 401);
  const existing = await rest('profiles?select=id,nickname,created_at,avatar_data&id=eq.' + user.id);
  if (existing.length) return existing[0];
  const name = (nickname || user.user_metadata?.nickname || '').trim();
  if (!name || name.length > 24) throw new Error('Įvesk vardą nuo 1 iki 24 simbolių.');
  await rest('profiles?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ id: user.id, nickname: name })
  });
  return (await rest('profiles?select=id,nickname,created_at,avatar_data&id=eq.' + user.id))[0];
}

export function listProfiles(offset = 0) {
  return rest('profiles?select=id,nickname,created_at,avatar_data&order=nickname.asc,id.asc&limit=50&offset=' + offset);
}

export function touchPresence() {
  if (!currentUser()) return Promise.resolve();
  return rest('rpc/touch_member_presence', { method: 'POST', body: '{}' });
}

export function startMemberSession(details) {
  return rest('rpc/start_member_session', {
    method: 'POST',
    body: JSON.stringify({
      p_device_type: details.deviceType,
      p_os_name: details.osName,
      p_browser_name: details.browserName,
      p_approx_location: details.approxLocation || null
    })
  });
}

export function pendingLocationRequest() {
  return rest('rpc/member_pending_location_request', { method: 'POST', body: '{}' });
}

export function respondLocationRequest(requestId, decision, position = null) {
  return rest('rpc/member_respond_location_request', {
    method: 'POST',
    body: JSON.stringify({
      p_request_id: requestId,
      p_decision: decision,
      p_latitude: position?.coords.latitude ?? null,
      p_longitude: position?.coords.longitude ?? null,
      p_accuracy_m: position?.coords.accuracy ?? null
    })
  });
}

export function saveAvatar(avatar) {
  return rest('profiles?id=eq.' + currentUser().id, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ avatar_data: avatar })
  });
}

export function listPerformances(owner) {
  return rest('performances?select=*&owner_id=eq.' + encodeURIComponent(owner) + '&order=slot.asc');
}

export async function savePerformance(slot, events, title, replace = false, kit = 'classic-v1') {
  const user = currentUser();
  const path = replace ? 'performances?owner_id=eq.' + user.id + '&slot=eq.' + slot : 'performances';
  const options = {
    method: replace ? 'PATCH' : 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...(replace ? {} : { owner_id: user.id, slot }),
      events, duration_ms: Math.max(...events.map(note => note.time + (note.length || 0))), title, kit
    })
  };
  let result;
  try {
    result = await rest(path, options);
  } catch (error) {
    // Old schemas may still save the original two-field classic format safely.
    // An unknown-column rejection occurs before any write, so this retry cannot duplicate it.
    if (kit !== 'classic-v1' || !['PGRST204', '42703'].includes(error.code)) throw error;
    const legacy = JSON.parse(options.body);
    delete legacy.kit;
    result = await rest(path, { ...options, body: JSON.stringify(legacy) });
  }
  if (!result.length) throw new Error('Ritmas kitame lange jau pašalintas. Atmesk bandymą ir sukurk naują ritmą.');
  return result;
}

// Page closing does not leave enough time for the regular request/refresh flow.
// Keepalive sends the unfinished take to the private first slot and overwrites
// only that same user's previous emergency take.
export function saveEmergencyPerformance(events, title = 'Ritmas 1', kit = 'classic-v1') {
  session = readSession();
  if (!session?.access_token || !events?.length) return Promise.resolve(false);
  const body = JSON.stringify({
    owner_id: session.user.id,
    slot: 1,
    events,
    duration_ms: Math.max(...events.map(note => note.time + (note.length || 0))),
    title,
    kit
  });
  return fetch(SUPABASE_URL + '/rest/v1/performances?on_conflict=owner_id,slot', {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body
  }).then(response => response.ok).catch(() => false);
}

export async function renamePerformance(slot, title) {
  const result = await rest('performances?owner_id=eq.' + currentUser().id + '&slot=eq.' + slot, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ title })
  });
  if (!result.length) throw new Error('Šis ritmas kitame lange jau pašalintas.');
  return result[0];
}

export function deletePerformance(slot) {
  const user = currentUser();
  return rest('performances?owner_id=eq.' + user.id + '&slot=eq.' + slot, { method: 'DELETE' });
}
