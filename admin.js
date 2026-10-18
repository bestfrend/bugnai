import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';
import { subscribeLocationChanges } from './admin-live.js';

const ONLINE_WINDOW_MS = 75_000;
const $ = id => document.getElementById(id);
const locationStates = { pending: 'Laukiama patvirtinimo', declined: 'Atmesta programėlėje', browser_denied: 'Atmestas naršyklės leidimas', error: 'Nepavyko nustatyti', expired: 'Pasibaigė', cancelled: 'Atšaukta administratoriaus' };
let adminCode = '';
let members = [];
let refreshTimer;
let stopLiveUpdates;
let liveRefreshTimer;
let refreshGeneration = 0;

async function adminRpc(name, parameters = {}) {
  let response;
  try {
    response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: adminCode, ...parameters }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error('Nepavyko pasiekti serverio. Patikrinkite interneto ryšį.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || 'Nepavyko gauti narių sąrašo.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function listMembers() {
  return adminRpc('admin_list_members');
}

async function requestExactLocation(memberId, button) {
  button.disabled = true;
  try {
    await adminRpc('admin_request_location', { p_member_id: memberId });
    if (await refresh(true)) setStatus('Vietos bendrinimo prašymas išsiųstas. Jį galima atšaukti.');
  } catch (error) {
    setStatus(error.status === 401 || error.status === 403 ? 'Administratoriaus kodas nebegalioja.' : error.message, true);
    button.disabled = false;
  }
}

async function cancelLocationRequest(memberId, button) {
  button.disabled = true;
  try {
    await adminRpc('admin_cancel_location_request', { p_member_id: memberId });
    if (await refresh(true)) setStatus('Vietos bendrinimo prašymas atšauktas.');
  } catch (error) {
    setStatus(error.status === 401 || error.status === 403 ? 'Administratoriaus kodas nebegalioja.' : error.message, true);
    button.disabled = false;
  }
}

function setStatus(message = '', error = false) {
  $('admin-status').textContent = message;
  $('admin-status').classList.toggle('error', error);
}

function online(member) {
  const seen = new Date(member.last_seen_at).getTime();
  return Number.isFinite(seen) && Date.now() - seen < ONLINE_WINDOW_MS;
}

function pendingLocation(member) {
  return member.location_status === 'pending';
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Dar nebuvo aktyvus';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('lt-LT', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {})
  }).format(date);
}

function render() {
  const query = $('member-search').value.trim().toLocaleLowerCase('lt');
  const filter = $('status-filter').value;
  const visible = members.filter(member => {
    const isOnline = online(member);
    return (!query || member.nickname.toLocaleLowerCase('lt').includes(query) || member.id.toLowerCase().includes(query))
      && (filter === 'all' || (filter === 'online') === isOnline);
  });
  const body = $('member-rows');
  body.replaceChildren();
  for (const member of visible) {
    const row = document.createElement('tr');
    const identity = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = member.nickname;
    const id = document.createElement('small');
    id.textContent = member.id;
    identity.append(name, id);
    const state = document.createElement('td');
    const badge = document.createElement('span');
    const isOnline = online(member);
    badge.className = 'presence ' + (isOnline ? 'online' : 'offline');
    badge.textContent = isOnline ? 'Prisijungęs' : 'Atsijungęs';
    const lastActive = document.createElement('small');
    lastActive.textContent = 'Aktyvumas: ' + formatDate(member.last_seen_at, true);
    state.append(badge, lastActive);
    const sessionStarted = document.createElement('td');
    sessionStarted.textContent = formatDate(member.session_started_at, true);
    const device = document.createElement('td');
    const deviceName = document.createElement('strong');
    deviceName.textContent = member.device_type || 'Nežinoma';
    const deviceDetails = document.createElement('small');
    deviceDetails.textContent = [member.os_name, member.browser_name].filter(Boolean).join(' · ') || '—';
    device.append(deviceName, deviceDetails);
    const approximate = document.createElement('td');
    const approximateLabel = document.createElement('strong');
    approximateLabel.textContent = 'Apytikslė vietovė pagal IP';
    const approximateValue = document.createElement('small');
    approximateValue.textContent = member.approx_location || 'Nenustatyta';
    approximate.append(approximateLabel, approximateValue);
    const exact = document.createElement('td');
    exact.className = 'exact-location-cell';
    if (Number.isFinite(member.exact_latitude) && Number.isFinite(member.exact_longitude)) {
      const coordinates = `${member.exact_latitude.toFixed(6)}, ${member.exact_longitude.toFixed(6)}`;
      const coordinateActions = document.createElement('div');
      coordinateActions.className = 'coordinate-actions';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'coordinate-copy';
      copy.textContent = coordinates;
      copy.title = 'Kopijuoti koordinates';
      copy.setAttribute('aria-label', `Kopijuoti koordinates ${coordinates}`);
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(coordinates);
          setStatus('Koordinatės nukopijuotos.');
        } catch {
          setStatus('Koordinačių nukopijuoti nepavyko.', true);
        }
      });
      const map = document.createElement('a');
      map.className = 'coordinate-map';
      map.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
      map.target = '_blank';
      map.rel = 'noopener noreferrer';
      map.referrerPolicy = 'no-referrer';
      map.textContent = 'Žemėlapis ↗';
      map.setAttribute('aria-label', `Atverti koordinates ${coordinates} Google Maps`);
      coordinateActions.append(copy, map);
      const coordinateInfo = document.createElement('small');
      const accuracy = member.exact_accuracy_m;
      const hasAccuracy = Number.isFinite(accuracy) && accuracy >= 0;
      coordinateInfo.textContent = `${hasAccuracy ? `±${Math.ceil(accuracy)} m` : 'Paklaida nežinoma'} · ${formatDate(member.location_captured_at, true)}`;
      exact.append(coordinateActions, coordinateInfo);
      const exactKind = document.createElement('small');
      exactKind.className = 'coordinate-kind';
      exactKind.textContent = !hasAccuracy
        ? 'Vienkartinė naršyklės vieta · tikslumas nežinomas'
        : accuracy <= 100
          ? 'Vienkartinė naršyklės vieta · maža paklaida (iki 100 m)'
          : 'Vienkartinė apytikslė vieta (pagal naršyklės paklaidą)';
      exact.append(exactKind);
      if (member.location_status && member.location_status !== 'approved') {
        const previous = document.createElement('small');
        previous.className = 'coordinate-state';
        previous.textContent = `Ankstesnė patvirtinta vieta · Paskutinis prašymas: ${locationStates[member.location_status] || member.location_status}`;
        exact.append(previous);
      }
    } else {
      exact.textContent = locationStates[member.location_status] || 'Negauta';
    }
    const rhythms = document.createElement('td');
    rhythms.textContent = String(member.rhythm_count || 0);
    const joined = document.createElement('td');
    joined.textContent = formatDate(member.created_at);
    const controls = document.createElement('td');
    if (pendingLocation(member)) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'action danger';
      cancel.textContent = 'Atšaukti prašymą';
      cancel.addEventListener('click', () => cancelLocationRequest(member.id, cancel));
      controls.append(cancel);
    } else {
      const request = document.createElement('button');
      request.type = 'button';
      request.className = 'action';
      request.textContent = isOnline ? 'Prašyti vietos' : 'Vartotojas neprisijungęs';
      request.disabled = !isOnline;
      request.title = isOnline ? 'Prašyti vienkartinės vietos.' : 'Vietos galima prašyti tik prisijungusio vartotojo.';
      request.addEventListener('click', () => requestExactLocation(member.id, request));
      controls.append(request);
    }
    row.append(identity, state, sessionStarted, device, approximate, exact, rhythms, joined, controls);
    body.append(row);
  }
  $('members-empty').hidden = visible.length !== 0;
  const active = members.filter(online).length;
  $('admin-summary').textContent = `Iš viso: ${members.length} · Prisijungę: ${active} · Atsijungę: ${members.length - active}`;
}

function showLogin(message = '', error = false) {
  clearInterval(refreshTimer);
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = null;
  stopLiveUpdates?.();
  stopLiveUpdates = null;
  refreshGeneration++;
  adminCode = '';
  $('admin-panel').hidden = true;
  $('admin-login').hidden = false;
  setStatus(message, error);
}

function showPanel() {
  $('admin-login').hidden = true;
  $('admin-panel').hidden = false;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refresh(true), 60_000);
  stopLiveUpdates?.();
  stopLiveUpdates = subscribeLocationChanges(() => {
    if (!adminCode || liveRefreshTimer) return;
    liveRefreshTimer = setTimeout(() => {
      liveRefreshTimer = null;
      if (adminCode) refresh(true);
    }, 100);
  });
}

async function refresh(silent = false) {
  if (!adminCode) return showLogin();
  const generation = ++refreshGeneration;
  if (!silent) setStatus('Atnaujinama…');
  if (!silent) $('admin-refresh').disabled = true;
  try {
    const next = await listMembers();
    if (!adminCode || generation !== refreshGeneration) return false;
    members = next;
    render();
    setStatus('');
    return true;
  } catch (error) {
    if (generation !== refreshGeneration) return false;
    if (error.status === 401 || error.status === 403) showLogin('Neteisingas administratoriaus kodas.', true);
    else setStatus(error.message, true);
    return false;
  } finally {
    if (!silent) $('admin-refresh').disabled = false;
  }
}

$('admin-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('admin-login-button').disabled = true;
  adminCode = $('admin-code').value;
  $('admin-code').value = '';
  try {
    members = await listMembers();
    showPanel();
    render();
    setStatus('');
  } catch (error) {
    showLogin(error.status === 401 || error.status === 403 ? 'Neteisingas administratoriaus kodas.' : error.message, true);
  } finally {
    $('admin-login-button').disabled = false;
  }
});
$('admin-refresh').addEventListener('click', () => refresh());
$('admin-logout').addEventListener('click', () => showLogin('Atsijungta.'));
$('member-search').addEventListener('input', render);
$('status-filter').addEventListener('change', render);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && adminCode) refresh(true);
});
window.addEventListener('pagehide', () => {
  clearInterval(refreshTimer);
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = null;
  stopLiveUpdates?.();
});
window.addEventListener('pageshow', event => {
  if (event.persisted && adminCode) {
    showPanel();
    refresh(true);
  }
});

showLogin();
